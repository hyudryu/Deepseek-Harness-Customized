#!/usr/bin/env node
/**
 * Detached update helper.
 *
 * The plugin writes `request.json`, starts this process, and asks the launcher
 * to exit, so everything below runs with no server holding the checkout or the
 * listen port. It fetches, stops the recorded server process, sets local work
 * aside, updates the checkout to the remote branch, runs the configured
 * refresh pipeline, puts the local work back, and starts a replacement server
 * whose process identity is the one the plugin recorded.
 *
 * It is spawned detached and outlives the server that started it. Every import
 * is resolved before the first git command, so a checkout that replaces this
 * file mid-run cannot change the code already executing.
 *
 * Failure never leaves the machine without a server: the checkout is returned
 * to the commit it started from, the pipeline runs once more, and the previous
 * server is started again with the failure recorded in `update.json`.
 */
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, openSync, closeSync } from 'node:fs'
import { connect } from 'node:net'
import { delay } from '../src/update/delay.js'
import { runCommand } from '../src/update/exec.js'
import { readJson, statePaths, writeJsonAtomic } from '../src/update/records.js'

/** Bound applied to one git command when the request does not carry one. */
const DEFAULT_COMMAND_TIMEOUT_MS = 300_000

/** A failure attributed to the step that owns it, so recovery can report where the update stopped. */
class StepError extends Error {
  constructor(step, message) {
    super(message)
    this.name = 'StepError'
    this.step = step
  }
}

/** Read the required `--state-dir` argument. */
function stateDirFromArgs(argv) {
  const index = argv.indexOf('--state-dir')
  const value = index === -1 ? undefined : argv[index + 1]
  if (typeof value !== 'string' || value === '') {
    throw new Error('apply-update: --state-dir <directory> is required')
  }
  return value
}

/** First non-empty line of captured output, for a one-line failure report. */
function firstLine(text) {
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim()
    if (trimmed !== '') return trimmed
  }
  return ''
}

/** Whether a process id is still running, treating a permission error as "still there". */
function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/**
 * Resolve the package manager that runs the refresh pipeline.
 *
 * A launcher that started this server through pnpm exports `npm_execpath`, and
 * re-running that script with this Node executable needs neither a shell nor a
 * `PATH` entry. Windows resolves a bare `pnpm` to a `.cmd` shim that
 * CreateProcess cannot execute, so the fallback goes through the shell; every
 * argument there comes from validated configuration.
 */
function resolvePackageManager(env = process.env) {
  const execpath = env.npm_execpath
  if (typeof execpath === 'string' && execpath !== ''
    && existsSync(execpath) && /\.[cm]?js$/iu.test(execpath)) {
    return { command: process.execPath, prefix: [execpath], shell: false }
  }
  return { command: 'pnpm', prefix: [], shell: process.platform === 'win32' }
}

/**
 * Environment variables a refresh command must not receive.
 *
 * The pipeline runs code that the update just fetched, so handing it the
 * server's whole environment would let a compromised revision read this
 * deployment's credentials — the launcher loads `.env` into `process.env`, so
 * `DEEPSEEK_API_KEY` and everything like it is in scope. Names are matched by
 * suffix rather than listed, because a deployment adds its own.
 */
const SECRET_NAME_PATTERN = /(?:^|_)(?:API_?KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|AUTH)(?:_|$)/iu

/** Variables that must survive scrubbing because a build cannot run without them. */
const ENV_KEEP_ALWAYS = new Set(['PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'SystemRoot', 'windir', 'COMSPEC', 'TMPDIR', 'TEMP', 'TMP', 'SHELL', 'LANG', 'LC_ALL', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'ProgramData', 'NUMBER_OF_PROCESSORS', 'OS', 'TERM'])

/**
 * Build the environment a refresh command runs with.
 *
 * Everything needed to find a toolchain or a home directory survives; anything
 * that looks like a credential is dropped, so a build script — or a dependency
 * that a compromised revision introduced — cannot read this deployment's keys.
 * @param env - the helper's own environment.
 * @returns the scrubbed environment for the pipeline.
 */
function scrubbedEnvironment(env = process.env) {
  const scrubbed = {}
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (ENV_KEEP_ALWAYS.has(name)) {
      scrubbed[name] = value
      continue
    }
    if (SECRET_NAME_PATTERN.test(name)) continue
    // Node and npm/pnpm runtime plumbing is how the resolved package manager is
    // reached; it carries no deployment secret and the pipeline cannot start
    // without it.
    if (name.startsWith('npm_') || name === 'NODE' || name.startsWith('NODE_')) {
      scrubbed[name] = value
      continue
    }
    scrubbed[name] = value
  }
  return scrubbed
}

/**
 * Run one pipeline command, streaming its output into the update log.
 *
 * Output is written through the sink with backpressure: when the log reports a
 * full buffer both child streams pause until it drains, which bounds the
 * helper's memory no matter how much a build prints.
 */
function runStreaming(command, args, { cwd, shell, timeoutMs, sink }) {
  return new Promise((settle) => {
    const child = spawn(command, args, {
      cwd,
      shell,
      windowsHide: true,
      env: scrubbedEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
      // Its own process group, so a timeout can end the whole tree a build
      // started rather than only its top process.
      detached: process.platform !== 'win32',
    })
    let settled = false
    let timer = null
    const finish = (outcome) => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      settle(outcome)
    }
    /**
     * End the command and everything it started.
     *
     * `kill()` alone is not a bound: a build that ignores the signal, or one
     * whose descendant keeps the inherited pipes open, leaves `close` pending
     * forever — and by then the server is already stopped. So the tree is
     * signalled, then given a bounded window to die, after which the timeout is
     * reported regardless of whether `close` ever arrives.
     */
    const terminate = () => {
      const forced = terminateTree(child.pid)
      const giveUp = setTimeout(() => {
        finish({ ok: false, code: 124, message: `exceeded ${timeoutMs}ms and did not exit after termination` })
      }, TERMINATION_GRACE_MS)
      giveUp.unref?.()
      child.once('close', (code, signal) => {
        clearTimeout(giveUp)
        finish({ ok: false, code: 124, message: `exceeded ${timeoutMs}ms and was terminated${signal === null ? '' : ` (${String(signal)})`}${forced ? '' : ' without a reachable process tree'}` })
      })
    }
    timer = setTimeout(terminate, timeoutMs)
    let paused = false
    const write = (chunk) => {
      if (sink.write(chunk) || paused) return
      paused = true
      child.stdout.pause()
      child.stderr.pause()
      sink.once('drain', () => {
        paused = false
        child.stdout.resume()
        child.stderr.resume()
      })
    }
    child.stdout.on('data', write)
    child.stderr.on('data', write)
    child.once('error', (error) => {
      finish({ ok: false, code: 127, message: String(error.message) })
    })
    child.once('close', (code, signal) => {
      finish({
        ok: code === 0,
        code: code ?? 1,
        message: code === 0 ? null : `exited ${code ?? `on ${String(signal)}`}`,
      })
    })
  })
}

/** How long a signalled process tree is given to die before the timeout is reported anyway. */
const TERMINATION_GRACE_MS = 10_000

/**
 * End one process and every process it started.
 *
 * POSIX gets a signal to the whole process group the child was given. Windows
 * has no group signal, so `taskkill /T` walks the tree the operating system
 * recorded; it is the only portable way to reach a build's descendants there.
 * @param pid - the process to terminate.
 * @returns true when a termination attempt was made without error.
 */
function terminateTree(pid) {
  if (typeof pid !== 'number' || pid <= 0) return false
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      return true
    } catch {
      return false
    }
  }
  try {
    // The negative id addresses the child's process group.
    process.kill(-pid, 'SIGTERM')
    return true
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
      return true
    } catch {
      return false
    }
  }
}

/** Tolerance when comparing a recorded start time with the operating system's. */
const IDENTITY_TOLERANCE_MS = 5_000

/**
 * Ask the operating system when one process started.
 *
 * This is what makes a recorded process id verifiable: after the original
 * process exits the id can be reused, and only a start time distinguishes the
 * original from whatever inherited its number.
 * @param pid - the process to describe.
 * @returns epoch milliseconds, or null when the platform cannot report it.
 */
async function processStartTime(pid) {
  if (process.platform === 'win32') {
    // PowerShell emits Unix milliseconds directly. `.NET` ticks are around 6e17
    // today — past `Number.MAX_SAFE_INTEGER` — so parsing them as a JavaScript
    // number would silently reject every real process.
    const result = await runCommand('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `[long]((Get-Process -Id ${String(pid)} -ErrorAction Stop).StartTime.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds`,
    ], { timeoutMs: 15_000 })
    if (!result.ok) return null
    const millis = Number.parseInt(result.stdout.trim(), 10)
    return Number.isSafeInteger(millis) && millis > 0 ? millis : null
  }
  const result = await runCommand('ps', ['-p', String(pid), '-o', 'lstart='], { timeoutMs: 15_000 })
  if (!result.ok) return null
  const parsed = Date.parse(result.stdout.trim())
  return Number.isFinite(parsed) ? parsed : null
}

/** Probe one listen address once; a refused or silent connection means "not up yet". */
function probeListening(host, port, timeoutMs = 2_000) {
  return new Promise((settle) => {
    const socket = connect({ host, port })
    const finish = (value) => {
      socket.destroy()
      settle(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

/** Bound one run of the helper to a single state directory. */
async function main() {
  const paths = statePaths(stateDirFromArgs(process.argv.slice(2)))
  const request = await readJson(paths.request)
  if (request === null || typeof request !== 'object' || Array.isArray(request)
    || typeof request.checkout !== 'string' || request.checkout === ''
    || typeof request.relaunch?.command !== 'string'
    || !Array.isArray(request.relaunch?.args)) {
    process.stderr.write('apply-update: request.json is missing or incomplete\n')
    process.exitCode = 1
    return
  }
  // Every git command is bounded. The plugin sends its resolved value; a
  // request written by an older version, or edited by hand, still gets a bound
  // rather than none, because an unbounded fetch after the server has exited
  // would leave the application offline with no one to notice.
  if (request.commandTimeoutMs !== undefined
    && (!Number.isInteger(request.commandTimeoutMs) || request.commandTimeoutMs <= 0)) {
    process.stderr.write('apply-update: request.json has an invalid commandTimeoutMs\n')
    process.exitCode = 1
    return
  }
  if (!Number.isInteger(request.commandTimeoutMs)) request.commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS

  // Owner-only: the log carries complete build output, which routinely quotes
  // configuration, environment dumps, and registry URLs.
  const log = createWriteStream(paths.log, { flags: 'w', mode: 0o600 })
  // A write can fail long after the call that started it — a full disk while a
  // build streams is the realistic case — and an unhandled 'error' on a
  // Writable terminates the process outright, which would bypass recovery and
  // leave no server running. The failure is recorded here and raised at the
  // next step boundary, so it travels the same path as any other step failure.
  let logFailure = null
  log.on('error', (error) => { logFailure ??= error })
  const guardLog = (step) => {
    if (logFailure !== null) throw new StepError(step, `the update log failed: ${String(logFailure.message)}`)
  }
  const say = (message) => { log.write(`[${new Date().toISOString()}] ${message}\n`) }
  let record = {
    version: 1,
    state: 'running',
    startedAt: request.startedAt,
    finishedAt: null,
    step: 'starting',
    message: null,
    fromSha: request.fromSha ?? null,
    toSha: null,
    previousBranch: request.previousBranch ?? null,
    stashKept: false,
  }
  const commit = async (patch) => {
    record = { ...record, ...patch }
    await writeJsonAtomic(paths.update, record)
  }

  let stashed = false
  let switchedFrom = null
  let merged = false

  // The plugin waits for this first record before it answers the browser, so
  // it is written before any slow step runs.
  await commit({ step: 'starting' })
  say(`update requested at ${String(request.startedAt)}`)
  say(`checkout ${request.checkout}; ${request.remote}/${request.branch}`)

  const git = args => runCommand('git', ['-C', request.checkout, ...args], { timeoutMs: request.commandTimeoutMs })
  const gitRequire = async (step, args) => {
    const result = await git(args)
    say(`git ${args.join(' ')} -> ${result.code}`)
    if (result.ok) return result
    throw new StepError(step, firstLine(result.stderr) || `git ${args[0]} exited ${result.code}`)
  }

  /** Fetch the remote branch into its tracking ref, which the update then merges. */
  const fetchRemote = async () => {
    const refspec = `+refs/heads/${request.branch}:refs/remotes/${request.remote}/${request.branch}`
    await gitRequire('fetch', ['fetch', '--quiet', '--no-tags', request.remote, refspec])
  }

  /**
   * Whether the recorded process is still the server this update is replacing.
   *
   * A process id is not durable ownership: once the original server exits, the
   * operating system may hand that id to anything, and signalling it then would
   * kill an unrelated process. The recorded start time is compared against the
   * operating system's own view, a few seconds of tolerance covering clock
   * granularity. When the platform cannot report a start time the check has to
   * trust the id, which is why the caller says so in the log.
   */
  const serverIdentityMatches = async (pid) => {
    const expected = request.serverStartedAt
    if (!Number.isFinite(expected)) return { known: false, matches: true }
    const observed = await processStartTime(pid)
    if (observed === null) return { known: false, matches: true }
    return { known: true, matches: Math.abs(observed - expected) < IDENTITY_TOLERANCE_MS }
  }

  /** Wait for the recorded server process to exit, terminating it only past the grace. */
  const stopServer = async () => {
    const pid = request.serverPid
    if (!Number.isInteger(pid) || pid <= 0) {
      say('no server process was recorded; continuing')
      return
    }
    const gracefulUntil = Date.now() + request.gracefulStopMs
    while (Date.now() < gracefulUntil) {
      if (!isAlive(pid)) {
        say(`server ${pid} exited`)
        return
      }
      await delay(200)
    }
    const identity = await serverIdentityMatches(pid)
    if (!identity.known) {
      say(`could not verify that ${pid} is still the recorded server; relying on the recorded id`)
    } else if (!identity.matches) {
      // The recorded server is gone and its id now names something else.
      say(`server ${pid} is no longer the process this update recorded; leaving it alone`)
      return
    }
    say(`server ${pid} was still running after ${request.gracefulStopMs} ms; terminating`)
    try {
      process.kill(pid, 'SIGTERM')
    } catch (error) {
      say(`could not signal ${pid}: ${String(error)}`)
    }
    const forcedUntil = Date.now() + 10_000
    while (Date.now() < forcedUntil) {
      if (!isAlive(pid)) {
        say(`server ${pid} stopped`)
        return
      }
      await delay(200)
    }
    throw new StepError('stop-server', `server ${pid} did not stop`)
  }

  /** Set local work aside so the checkout can move to the remote branch. */
  const stashLocalChanges = async () => {
    const status = await git(['status', '--porcelain', '--untracked-files=normal'])
    if (!status.ok || status.stdout.trim() === '') {
      say('working tree is clean')
      return
    }
    const before = await git(['rev-parse', '--verify', '--quiet', 'refs/stash'])
    await gitRequire('stash', ['stash', 'push', '--include-untracked', '--message', `dsh software update ${String(request.startedAt)}`])
    const after = await git(['rev-parse', '--verify', '--quiet', 'refs/stash'])
    stashed = after.ok && after.stdout.trim() !== before.stdout.trim()
    if (!stashed) throw new StepError('stash', 'git stash push created no stash entry')
    say('local work was stashed')
  }

  /** Put the checkout on the updated branch, creating it from the remote when absent. */
  const switchToBranch = async () => {
    const current = await git(['rev-parse', '--abbrev-ref', 'HEAD'])
    const name = current.ok ? current.stdout.trim() : 'HEAD'
    say(`current branch: ${name}`)
    if (name === request.branch) return
    switchedFrom = name === 'HEAD' ? null : name
    const switched = await git(['checkout', request.branch])
    if (switched.ok) return
    say(`checkout ${request.branch} failed; creating it from ${request.remote}/${request.branch}`)
    await gitRequire('checkout', ['checkout', '-B', request.branch, `refs/remotes/${request.remote}/${request.branch}`])
  }

  /** Fast-forward onto the fetched commit; a diverged branch fails here, not silently. */
  const mergeRemote = async () => {
    // Captured before the merge so a rollback can put the tracked branch back
    // exactly where it was, instead of leaving it at the merged commit.
    const tip = await git(['rev-parse', `refs/heads/${request.branch}`])
    if (tip.ok) request.branchTipBefore = tip.stdout.trim()
    await gitRequire('merge', ['merge', '--ff-only', `refs/remotes/${request.remote}/${request.branch}`])
    merged = true
    const head = await git(['rev-parse', 'HEAD'])
    if (head.ok) await commit({ toSha: head.stdout.trim() })
  }

  /** Run the configured refresh pipeline through the launcher's own package manager. */
  const runPipeline = async () => {
    const manager = resolvePackageManager()
    for (const command of request.buildCommands) {
      const args = [...manager.prefix, ...command]
      await commit({ step: `build: ${command.join(' ')}` })
      say(`running ${manager.command} ${args.join(' ')}`)
      const result = await runStreaming(manager.command, args, {
        cwd: request.checkout,
        shell: manager.shell,
        timeoutMs: request.buildTimeoutMs,
        // The sink, not a fire-and-forget write: a verbose install can emit far
        // faster than the log drains, and by this point the server is stopped,
        // so unbounded buffering would end the update in an out-of-memory kill.
        sink: log,
      })
      if (!result.ok) throw new StepError(`build: ${command.join(' ')}`, result.message)
    }
    guardLog('build')
  }

  /**
   * Put the stashed work back, keeping the stash when it cannot apply cleanly.
   *
   * A failed `stash pop` leaves conflict markers in the working tree, and the
   * `dsh` CLI runs this checkout from source through tsx — so a marker inside a
   * TypeScript module makes the replacement server exit on a syntax error, and
   * the update then rolls back everything it had already achieved. The stash is
   * the durable copy of that work, so the tree is reset to the updated revision
   * and the user resolves the conflict from the stash.
   */
  const restoreStash = async () => {
    if (!stashed) return
    const result = await git(['stash', 'pop'])
    say(`git stash pop -> ${result.code}`)
    if (result.ok) {
      stashed = false
      return
    }
    const cleaned = await git(['reset', '--hard', 'HEAD'])
    say(`cleared the conflict markers in the working tree: ${cleaned.ok ? 'ok' : `failed (${firstLine(cleaned.stderr)})`}`)
    await commit({
      stashKept: true,
      message: `The update is applied, but your stashed changes could not be restored automatically (${firstLine(result.stderr)}). They are kept in the stash and the working tree holds the updated code; resolve the conflicts and run "git stash pop" again.`,
    })
  }

  /** Start the recorded server command detached, then wait for its listen address. */
  const relaunchServer = async () => {
    const { command, args, cwd } = request.relaunch
    say(`starting ${command} ${args.join(' ')}`)
    const out = openSync(paths.server, 'a', 0o600)
    const error = openSync(paths.server, 'a', 0o600)
    try {
      const child = spawn(command, args, {
        cwd,
        detached: true,
        windowsHide: true,
        env: process.env,
        stdio: ['ignore', out, error],
      })
      child.unref()
      say(`replacement server started as pid ${String(child.pid ?? 'unknown')}`)
    } finally {
      closeSync(out)
      closeSync(error)
    }
    if (!Number.isInteger(request.port) || request.port <= 0) {
      say('no listen address was recorded; not waiting for the port')
      return
    }
    const host = request.host === null || request.host === undefined || request.host === '0.0.0.0'
      ? '127.0.0.1'
      : request.host
    const deadline = Date.now() + request.relaunchTimeoutMs
    while (Date.now() < deadline) {
      if (await probeListening(host, request.port)) {
        say(`server is listening on ${host}:${request.port}`)
        return
      }
      await delay(1_000)
    }
    throw new StepError('relaunch', `nothing is listening on ${host}:${request.port} after ${request.relaunchTimeoutMs} ms`)
  }

  /** Return the checkout to where the update started and start the server anyway. */
  const recover = async (failure) => {
    const step = failure instanceof StepError ? failure.step : 'unknown'
    say(`FAILED at ${step}: ${failure.message}`)
    // Every recovery step is reported for what it actually did: claiming a
    // restoration that did not happen would hide a machine left on the wrong
    // branch, or with nothing listening at all.
    const outcomes = []
    try {
      if (merged) {
        // The fast-forward moved the TRACKED branch. When the checkout started
        // on that branch, its ref and the working tree both have to go back
        // together. When it started elsewhere, HEAD is restored to the original
        // branch first — resetting here would otherwise drag the tracked branch
        // to the other branch's commit and leave the user on the wrong one.
        if (switchedFrom === null) {
          await gitRequire('rollback', ['reset', '--hard', request.branchTipBefore ?? request.fromSha])
          outcomes.push(`the checkout is back at ${String(request.fromSha).slice(0, 12)}`)
        } else {
          await gitRequire('rollback', ['checkout', switchedFrom])
          await gitRequire('rollback', ['update-ref', `refs/heads/${request.branch}`, request.branchTipBefore ?? request.fromSha])
          outcomes.push(`the checkout is back on ${switchedFrom}`)
        }
      } else if (switchedFrom !== null) {
        await gitRequire('rollback', ['checkout', switchedFrom])
        outcomes.push(`the checkout is back on ${switchedFrom}`)
      } else {
        outcomes.push('the checkout had not moved')
      }
    } catch (rollbackError) {
      say(`rollback failed: ${String(rollbackError.message)}`)
      outcomes.push(`the checkout could NOT be returned (${firstLine(rollbackError.message)})`)
      await commit({ step: 'rollback' })
    }
    try {
      await restoreStash()
      if (stashed) outcomes.push('your stashed changes are kept in the stash')
      else outcomes.push('your local changes were restored')
    } catch (restoreError) {
      say(`stash restore failed during recovery: ${String(restoreError.message)}`)
      outcomes.push('your stashed changes could not be restored and remain in the stash')
    }
    try {
      await runPipeline()
    } catch (rebuildError) {
      say(`rebuild after rollback failed: ${String(rebuildError.message)}`)
      outcomes.push(`the previous code could NOT be rebuilt (${firstLine(rebuildError.message)})`)
    }
    let relaunched = false
    try {
      await relaunchServer()
      relaunched = true
    } catch (relaunchError) {
      say(`relaunch after rollback failed: ${String(relaunchError.message)}`)
      outcomes.push(`no server could be started (${firstLine(relaunchError.message)})`)
    }
    if (relaunched) outcomes.push('the previous server is running again')
    await commit({
      state: 'failed',
      step,
      finishedAt: new Date().toISOString(),
      message: `${failure.message}. Recovery: ${outcomes.join('; ')}.`,
    })
  }

  try {
    await fetchRemote()
    await stopServer()
    await stashLocalChanges()
    await switchToBranch()
    await mergeRemote()
    await runPipeline()
    await restoreStash()
    await relaunchServer()
    await commit({
      state: 'done',
      step: 'complete',
      finishedAt: new Date().toISOString(),
      // A warning recorded while the update ran — an unrestorable stash — is
      // the only thing the user still has to act on, so success keeps it.
      message: record.message,
    })
    say('update complete')
  } catch (failure) {
    await recover(failure)
  }

  await new Promise((settle) => { log.end(settle) })
  process.exitCode = record.state === 'done' ? 0 : 1
}

try {
  await main()
} catch (error) {
  // Nothing above can report this: the state directory itself was unusable.
  process.stderr.write(`apply-update: ${String(error)}\n`)
  process.exitCode = 1
}
