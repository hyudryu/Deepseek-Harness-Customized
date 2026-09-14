/**
 * Software update plugin.
 *
 * The host half answers `/software-update` with how this checkout compares
 * with a remote branch, and — on an authenticated POST, once an update really
 * exists — hands a detached helper everything needed to stop this server,
 * apply the update, and start a replacement. The browser half renders the
 * sidebar control for the same endpoint.
 *
 * Stopping the server is this process's own graceful exit, requested through
 * the launcher-provided `appExit` hook after the response has flushed. The
 * helper only forces the process when that hook is absent or the exit does
 * not complete inside the configured grace.
 */
import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { fetchBranch, readCheckoutStatus } from './src/update/git.js'
import {
  isReplayableLaunch,
  launchRecord,
  normalizeUpdateRecord,
  readJson,
  statePaths,
  writeJsonAtomic,
} from './src/update/records.js'
import {
  continuationMessage,
  continuationPrompt,
  normalizeResumeRecord,
  resumeRecord,
  resumeRecordApplies,
  runningRootSessions,
} from './src/update/resume.js'
import { delay } from './src/update/delay.js'
import { updateStateDir } from './src/update/home.js'

/** Loader identity. */
export const name = 'software-update'

/** The authenticated transport and the route table this plugin registers into. */
export const inject = ['webServer', 'connection']

/** The detached helper that applies an update and restarts the server. */
const HELPER_PATH = fileURLToPath(new URL('./scripts/apply-update.mjs', import.meta.url))

/** How long the plugin waits for the helper to acknowledge the request before answering the browser. */
const HELPER_HANDSHAKE_MS = 5_000

/** Poll interval while waiting for that acknowledgement. */
const HANDSHAKE_POLL_MS = 100

/** Grace between the flushed response and the process-exit request. */
const EXIT_DELAY_MS = 300

/** Charset accepted for a configured git remote or branch name. */
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

function positiveInt(value, fallback, field) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`software-update: ${field} must be a positive integer`)
  }
  return value
}

function refName(value, fallback, field) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !REF_PATTERN.test(value) || value.endsWith('/') || value.includes('..')) {
    throw new Error(`software-update: ${field} must be a git ${field} name`)
  }
  return value
}

/** Continuation prompt submitted to each session the update interrupted. */
const DEFAULT_RESUME_MESSAGE = [
  'An automatic software update restarted the server while you were working, so this turn was cut off before it finished.',
  'Any tool call that was still in flight did not complete and is recorded as a failure; a call that returns an error now may still have taken effect before the restart.',
  'Re-check the current state of anything you were changing rather than repeating it, then continue the task from where it stopped.',
].join(' ')

function resumeMessage(value) {
  if (value === undefined) return DEFAULT_RESUME_MESSAGE
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('software-update: resumeMessage must be a non-empty string')
  }
  return value
}

function boolean(value, fallback, field) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Error(`software-update: ${field} must be a boolean`)
  return value
}

/** The refresh pipeline an update runs after pulling, before the server restarts. */
const DEFAULT_BUILD_COMMANDS = [
  ['install'],
  ['run', 'install:custom-plugins'],
  ['run', 'build'],
]

function buildCommands(value) {
  if (value === undefined) return DEFAULT_BUILD_COMMANDS.map(command => [...command])
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('software-update: buildCommands must be a non-empty list of argument lists')
  }
  return value.map((command, index) => {
    if (!Array.isArray(command) || command.length === 0
      || !command.every(argument => typeof argument === 'string' && argument !== '')) {
      throw new Error(`software-update: buildCommands[${index}] must be a non-empty list of non-empty strings`)
    }
    return [...command]
  })
}

/**
 * Resolve the plugin configuration, failing loud on an unusable value.
 * @param raw - the loader-supplied configuration object.
 * @returns every setting this plugin reads, with its default applied.
 */
export function normalizeConfig(raw = {}) {
  return {
    remote: refName(raw.remote, 'origin', 'remote'),
    branch: refName(raw.branch, 'main', 'branch'),
    checkout: typeof raw.checkout === 'string' ? raw.checkout : '',
    fetchTtlMs: positiveInt(raw.fetchTtlMs, 60_000, 'fetchTtlMs'),
    commandTimeoutMs: positiveInt(raw.commandTimeoutMs, 300_000, 'commandTimeoutMs'),
    buildTimeoutMs: positiveInt(raw.buildTimeoutMs, 1_800_000, 'buildTimeoutMs'),
    gracefulStopMs: positiveInt(raw.gracefulStopMs, 15_000, 'gracefulStopMs'),
    relaunchTimeoutMs: positiveInt(raw.relaunchTimeoutMs, 1_800_000, 'relaunchTimeoutMs'),
    commitListLimit: positiveInt(raw.commitListLimit, 20, 'commitListLimit'),
    buildCommands: buildCommands(raw.buildCommands),
    resumeOnRestart: boolean(raw.resumeOnRestart, true, 'resumeOnRestart'),
    resumeMessage: resumeMessage(raw.resumeMessage),
    resumeWindowMs: positiveInt(raw.resumeWindowMs, 3_600_000, 'resumeWindowMs'),
  }
}

function respond(response, status, value, onFlushed) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  if (onFlushed === undefined) {
    response.end(body)
    return
  }
  // The exit request rides the response's own flush callback: the browser has
  // its answer before the listener closes.
  response.end(body, onFlushed)
}

/**
 * Wait for the helper's first record, which proves it is running before the
 * browser is told the update started. A helper that never writes leaves this
 * server the owner of a failed request instead of a promise it cannot keep.
 */
async function awaitHelperAcknowledgement(updatePath, startedAt, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const record = await readJson(updatePath)
    if (record !== null && typeof record === 'object' && record.startedAt === startedAt) return true
    await delay(HANDSHAKE_POLL_MS)
  }
  return false
}

/**
 * Ask the launcher to exit this process once the tree has been disposed.
 * Absent hook: the helper stops the process itself after its grace period, so
 * the update still completes on an embedding host that provides no exit verb.
 */
function requestProcessExit(ctx) {
  const exit = ctx.get('appExit')
  if (typeof exit !== 'function') return
  setTimeout(() => { exit(0) }, EXIT_DELAY_MS)
}

/**
 * Register the checkout status endpoint.
 * @param ctx - plugin owner providing the authenticated application transport.
 * @param rawConfig - resolved remote, branch, and timing configuration.
 */
export function apply(ctx, rawConfig = {}) {
  const config = normalizeConfig(rawConfig)
  const paths = statePaths(updateStateDir())
  const checkout = config.checkout === '' ? process.cwd() : config.checkout
  let lastFetchAt = 0
  let inFlight = null
  let starting = false
  // Serialized so a poll that lands while the load-time claim is still running
  // waits for it instead of writing a second, racing record.
  let claiming = null

  const identity = () => ({
    checkout,
    host: typeof ctx.webServer.host === 'string' ? ctx.webServer.host : null,
    port: Number.isInteger(ctx.webServer.port) ? ctx.webServer.port : null,
  })

  /**
   * Keep the relaunch identity describing THIS process.
   *
   * It is written at load, before any update can be requested, so the helper
   * replays a recorded identity instead of inventing a launcher: a checkout
   * started as `pnpm dsh web`, a direct node entry, or an installed binary all
   * restart the same way. It is rewritten whenever the stored record names a
   * different process, because several profiles can share one harness home and
   * an update must restart the server that is actually asking.
   */
  const claimLaunchIdentity = async () => {
    if (claiming !== null) return claiming
    const attempt = (async () => {
      const existing = await readJson(paths.launch)
      if (existing !== null && existing.pid === process.pid) return
      await writeJsonAtomic(paths.launch, launchRecord(identity()))
    })()
    claiming = attempt
    try {
      await attempt
    } finally {
      if (claiming === attempt) claiming = null
    }
  }
  claimLaunchIdentity().catch((error) => {
    ctx.logger?.warn?.(`software-update: relaunch identity was not written: ${String(error)}`)
  })

  /**
   * Resolve one session to a live Agent, resuming it when the restart left it cold.
   *
   * The live registry answers for a session the browser already reopened. For
   * one nothing has touched yet, the Typert `agent` lookup is the seam the RPC
   * gateway itself uses: it resumes the session with the preset composition it
   * was created under, which re-deriving the resume call here would lose.
   */
  const resolveAgent = async (sessionId) => {
    const agents = ctx.get('agents')
    const live = agents?.get?.(sessionId)
    if (live !== undefined && live !== null) return live
    const provider = ctx.get('typert')?.lookups?.get?.('agent')
    if (provider === undefined || provider === null || typeof provider.resolve !== 'function') return undefined
    return await provider.resolve(sessionId)
  }

  /**
   * Continue every session the helper's predecessor recorded before it exited.
   *
   * Runs once, after startup is committed. The record is removed either way:
   * an update that never stopped this server left a record naming sessions that
   * are still running fine, and a stale record must not later resume work the
   * user has since finished.
   */
  const continueInterruptedSessions = async () => {
    if (!config.resumeOnRestart) return
    const record = normalizeResumeRecord(await readJson(paths.resume))
    if (record === null) return
    if (!resumeRecordApplies(record, config.resumeWindowMs)) {
      await rm(paths.resume, { force: true })
      return
    }
    const detail = normalizeUpdateRecord(await readJson(paths.update)) ?? {}
    const agents = ctx.get('agents')
    let continued = 0
    for (const session of record.sessions) {
      try {
        const agent = await resolveAgent(session.id)
        if (agent === undefined) continue
        const submit = () => {
          agent.followup(continuationMessage(continuationPrompt(session, config.resumeMessage, detail)))
        }
        // Nothing here is inside an agent tool call, so the submission needs
        // its own initiator boundary — the same shape the goal drivers use.
        if (typeof agents?.withoutInitiator === 'function') await agents.withoutInitiator(submit)
        else submit()
        continued += 1
      } catch (error) {
        ctx.logger?.warn?.(`software-update: session "${session.id}" was not continued: ${String(error)}`)
      }
    }
    await rm(paths.resume, { force: true })
    if (continued > 0) {
      ctx.logger?.info?.(`software-update: continued ${continued} session(s) interrupted by the update`)
    }
  }

  // Registered as an effect because it is a contribution to another service's
  // lifetime. It fires immediately when startup already committed, so a plugin
  // mounted late still continues the sessions rather than silently skipping them.
  ctx.effect(() => {
    const dispose = ctx.get('appReady')?.onReady(() => {
      continueInterruptedSessions().catch((error) => {
        ctx.logger?.warn?.(`software-update: interrupted sessions were not continued: ${String(error)}`)
      })
    })
    return () => { dispose?.() }
  }, 'software-update: continue the sessions an update interrupts')

  /** Refresh the remote-tracking ref at most once per configured interval. */
  const refreshFetch = async () => {
    if (Date.now() - lastFetchAt < config.fetchTtlMs) return null
    const fetched = await fetchBranch({
      checkout,
      remote: config.remote,
      branch: config.branch,
      timeoutMs: config.commandTimeoutMs,
    })
    // The stamp advances on failure too: a poll loop must not turn an
    // unreachable remote into an unbounded stream of fetch attempts.
    lastFetchAt = Date.now()
    return fetched.ok ? null : fetched.message
  }

  /** One serialized status read; concurrent polls share the in-flight probe. */
  const readStatus = async (options = {}) => {
    if (inFlight !== null) return inFlight
    const operation = (async () => {
      if (options.forceFetch === true) lastFetchAt = 0
      // Before any update can be started from this call: the record must name
      // this process, not whichever server last wrote to the shared home.
      await claimLaunchIdentity()
      const fetchError = await refreshFetch()
      const status = await readCheckoutStatus({
        checkout,
        remote: config.remote,
        branch: config.branch,
        timeoutMs: config.commandTimeoutMs,
        commitLimit: config.commitListLimit,
      })
      return { ...status, fetchError, update: normalizeUpdateRecord(await readJson(paths.update)) }
    })()
    inFlight = operation
    try {
      return await operation
    } finally {
      if (inFlight === operation) inFlight = null
    }
  }

  const startUpdate = async (status) => {
    const record = await readJson(paths.launch)
    if (!isReplayableLaunch(record)) return { ok: false, error: 'no-launch-record' }
    const startedAt = new Date().toISOString()
    // Captured here, immediately before the server is asked to exit, because
    // this is the last moment the in-flight turns still exist to be named.
    const sessions = config.resumeOnRestart ? runningRootSessions(ctx.get('agents')) : []
    await writeJsonAtomic(paths.request, {
      version: 1,
      startedAt,
      checkout: status.checkout,
      remote: config.remote,
      branch: config.branch,
      previousBranch: status.currentBranch,
      fromSha: status.localSha,
      toSha: status.remoteSha,
      serverPid: process.pid,
      gracefulStopMs: config.gracefulStopMs,
      relaunchTimeoutMs: config.relaunchTimeoutMs,
      buildTimeoutMs: config.buildTimeoutMs,
      buildCommands: config.buildCommands,
      resumableSessions: sessions.length,
      host: typeof ctx.webServer.host === 'string' ? ctx.webServer.host : null,
      port: Number.isInteger(ctx.webServer.port) ? ctx.webServer.port : null,
      relaunch: {
        command: record.execPath,
        args: [...record.execArgv, ...record.argv],
        cwd: record.cwd,
      },
    })
    const resume = resumeRecord(sessions)
    if (resume === null) await rm(paths.resume, { force: true })
    else await writeJsonAtomic(paths.resume, resume)
    const child = spawn(process.execPath, [HELPER_PATH, '--state-dir', paths.dir], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      cwd: status.checkout,
      env: process.env,
    })
    child.unref()
    const acknowledged = await awaitHelperAcknowledgement(paths.update, startedAt, HELPER_HANDSHAKE_MS)
    if (!acknowledged) {
      // This server stays alive, so no restart will consume the record and a
      // later unrelated boot must not resume sessions it still names.
      await rm(paths.resume, { force: true })
      return { ok: false, error: 'helper-did-not-start' }
    }
    return { ok: true, startedAt, sessions: sessions.length }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/software-update',
    async handler(request, response) {
      // Named routes are dispatched ahead of the authenticated fallback, so
      // this handler authenticates for itself: the Host/Origin fence and the
      // browser-session check run before any git command or server restart.
      const rejection = ctx.connection.requestRejection(request)
      if (rejection !== undefined) {
        respond(response, rejection, { ok: false, error: 'unauthorized' })
        return
      }

      if (request.method === 'GET') {
        const status = await readStatus()
        respond(response, 200, {
          ok: true,
          ...status,
          remote: config.remote,
          branch: config.branch,
          // Read live rather than cached: it describes what the restart would
          // interrupt right now, which is what the confirmation is about.
          runningSessions: config.resumeOnRestart ? runningRootSessions(ctx.get('agents')).length : 0,
          canUpdate: status.state === 'behind' && !starting,
        })
        return
      }

      if (request.method === 'POST') {
        if (starting) {
          respond(response, 409, { ok: false, error: 'in-progress' })
          return
        }
        starting = true
        try {
          // Forced fetch: the confirmation the user just gave is about the
          // newest commit on the branch, not one the status cache already saw.
          const status = await readStatus({ forceFetch: true })
          if (status.state !== 'behind') {
            respond(response, 409, { ok: false, error: status.state === 'current' ? 'no-update' : (status.reason ?? 'unknown') })
            return
          }
          if (status.update?.state === 'running') {
            respond(response, 409, { ok: false, error: 'in-progress' })
            return
          }
          const started = await startUpdate(status)
          if (!started.ok) {
            respond(response, 500, { ok: false, error: started.error })
            return
          }
          respond(response, 202, { ok: true, started: true, startedAt: started.startedAt, sessions: started.sessions }, () => {
            requestProcessExit(ctx)
          })
        } catch (error) {
          ctx.logger?.warn?.(`software-update: update request failed: ${String(error)}`)
          respond(response, 500, { ok: false, error: 'update-request-failed' })
        } finally {
          starting = false
        }
        return
      }

      respond(response, 405, { ok: false, error: 'method-not-allowed' })
    },
  }), 'software-update: checkout status route')
}

export const __test = {
  normalizeConfig,
  normalizeUpdateRecord,
  normalizeResumeRecord,
  awaitHelperAcknowledgement,
  HELPER_PATH,
}
