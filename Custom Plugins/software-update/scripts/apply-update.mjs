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

/** Run one pipeline command, streaming its output into the update log. */
function runStreaming(command, args, { cwd, shell, timeoutMs, onOutput }) {
  return new Promise((settle) => {
    const child = spawn(command, args, {
      cwd,
      shell,
      windowsHide: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => { child.kill() }, timeoutMs)
    child.stdout.on('data', chunk => onOutput(chunk))
    child.stderr.on('data', chunk => onOutput(chunk))
    child.once('error', (error) => {
      clearTimeout(timer)
      settle({ ok: false, code: 127, message: String(error.message) })
    })
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      settle({
        ok: code === 0,
        code: code ?? 1,
        message: code === 0 ? null : `exited ${code ?? `on ${String(signal)}`}`,
      })
    })
  })
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

  const log = createWriteStream(paths.log, { flags: 'w' })
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
        onOutput: chunk => log.write(chunk),
      })
      if (!result.ok) throw new StepError(`build: ${command.join(' ')}`, result.message)
    }
  }

  /** Put the stashed work back, keeping the stash when it cannot apply cleanly. */
  const restoreStash = async () => {
    if (!stashed) return
    const result = await git(['stash', 'pop'])
    say(`git stash pop -> ${result.code}`)
    if (result.ok) {
      stashed = false
      return
    }
    // A conflict is not an update failure: the new code is built and the stash
    // is intact. The record carries the state the user has to resolve.
    await commit({
      stashKept: true,
      message: `The update is applied, but your stashed changes could not be restored automatically (${firstLine(result.stderr)}). They are kept in the stash; resolve the conflicts and run "git stash pop" again.`,
    })
  }

  /** Start the recorded server command detached, then wait for its listen address. */
  const relaunchServer = async () => {
    const { command, args, cwd } = request.relaunch
    say(`starting ${command} ${args.join(' ')}`)
    const out = openSync(paths.server, 'a')
    const error = openSync(paths.server, 'a')
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
    try {
      if (merged) await gitRequire('rollback', ['reset', '--hard', request.fromSha])
      else if (switchedFrom !== null) await gitRequire('rollback', ['checkout', switchedFrom])
    } catch (rollbackError) {
      say(`rollback failed: ${String(rollbackError.message)}`)
      await commit({ step: 'rollback' })
    }
    try {
      await restoreStash()
    } catch (restoreError) {
      say(`stash restore failed during recovery: ${String(restoreError.message)}`)
    }
    try {
      await runPipeline()
    } catch (rebuildError) {
      say(`rebuild after rollback failed: ${String(rebuildError.message)}`)
    }
    try {
      await relaunchServer()
    } catch (relaunchError) {
      say(`relaunch after rollback failed: ${String(relaunchError.message)}`)
    }
    await commit({
      state: 'failed',
      step,
      finishedAt: new Date().toISOString(),
      message: `${failure.message}. The checkout was returned to ${String(request.fromSha)} and the previous server was started again.`,
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
