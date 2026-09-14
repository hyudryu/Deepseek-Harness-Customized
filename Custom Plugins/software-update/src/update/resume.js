/**
 * The sessions an update interrupts, and the continuation each one is owed.
 *
 * A turn in flight lives only in the process that is running it: the durable
 * session log records an open `turn/start`, and the harness closes that turn as
 * `interrupted` when the session is resumed, but nothing anywhere continues the
 * work. The update stops the server on purpose, so this feature is the one
 * place that knows a restart is coming and can name the sessions it will cut
 * off. It writes them here immediately before the helper is started, and the
 * successor process — which recognizes itself by a different process id —
 * resumes exactly those sessions and opens one continuation turn in each.
 */
import { randomUUID } from 'node:crypto'

/** Sessions one update may continue; a larger set means the record is not ours. */
const MAX_RESUME_SESSIONS = 100

/** Longest session identity accepted from the record. */
const MAX_SESSION_ID_CHARS = 200

/** Plugin name recorded as the source of every continuation message. */
export const PLUGIN_NAME = 'software-update'

/** Bound the harness applies to a collapsed-context summary, mirrored here. */
const SUMMARY_MAX_CHARS = 120

/** One-line account shown on the continuation's collapsed transcript row. */
const CONTINUATION_SUMMARY = 'Continued after a software update restarted the server'

/**
 * Turn every live agent whose turn is in flight into the resume set.
 *
 * Only roots are taken: a running child always has a running parent that is
 * waiting on it, so the parent's continuation re-establishes the child's work
 * through the delegation it already owns. Resuming children as well would start
 * turns in sessions no user is watching and no parent is waiting on.
 * @param agents - the live agent registry, or undefined when absent.
 * @returns the running root sessions, newest first.
 */
export function runningRootSessions(agents) {
  if (agents === undefined || typeof agents.roots !== 'function') return []
  let roots
  try {
    roots = agents.roots()
  } catch {
    // A registry that cannot answer is reported as "nothing was running"
    // rather than blocking the update the user asked for.
    return []
  }
  if (!Array.isArray(roots)) return []
  const running = []
  for (const agent of roots) {
    // A root mid-teardown may already be missing its status or session.
    const id = agent?.id
    const title = agent?.session?.header?.title
    if (agent?.status !== 'running' || typeof id !== 'string' || id === '') continue
    running.push({ id, title: typeof title === 'string' && title !== '' ? title : null })
  }
  return running.slice(0, MAX_RESUME_SESSIONS)
}

/**
 * Build the durable record of a coming restart.
 * @param sessions - running sessions captured from the live registry.
 * @param extra - identity of the process that captured them.
 * @returns the record to persist, or null when there is nothing to continue.
 */
export function resumeRecord(sessions, extra = {}) {
  if (sessions.length === 0) return null
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    recorderPid: process.pid,
    sessions,
    ...extra,
  }
}

/**
 * Project the resume record onto the fields the successor may act on.
 *
 * The file outlives the process that wrote it, so every field is checked here
 * rather than trusted: it is a parser boundary.
 * @param value - the parsed `resume.json` value, or null.
 * @returns the sessions to continue and who wrote the record, or null.
 */
export function normalizeResumeRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.version !== 1) return null
  if (typeof value.capturedAt !== 'string' || value.capturedAt === '') return null
  if (!Number.isInteger(value.recorderPid)) return null
  if (!Array.isArray(value.sessions)) return null
  const sessions = []
  const seen = new Set()
  for (const entry of value.sessions) {
    if (sessions.length >= MAX_RESUME_SESSIONS) break
    const id = entry?.id
    if (typeof id !== 'string' || id === '' || id.length > MAX_SESSION_ID_CHARS) continue
    if (seen.has(id)) continue
    seen.add(id)
    sessions.push({ id, title: typeof entry.title === 'string' && entry.title !== '' ? entry.title : null })
  }
  return { capturedAt: value.capturedAt, recorderPid: value.recorderPid, sessions }
}

/**
 * Whether a resume record describes the restart this process is the successor of.
 *
 * Both conditions are needed. The process id separates the writer from its
 * successor, and the age bound discards a record whose update never took the
 * server down — a helper that failed to start leaves the server running, and a
 * much later restart must not resume sessions a stale file still names.
 * @param record - a normalized resume record.
 * @param windowMs - how long a record stays actionable.
 * @param now - current epoch milliseconds, for tests.
 * @returns true when this process should continue the recorded sessions.
 */
export function resumeRecordApplies(record, windowMs, now = Date.now()) {
  if (record === null) return false
  if (record.recorderPid === process.pid) return false
  if (record.sessions.length === 0) return false
  const captured = Date.parse(record.capturedAt)
  if (!Number.isFinite(captured)) return false
  const age = now - captured
  // A clock that moved backwards must not extend the window, so a future
  // timestamp is rejected rather than treated as very fresh.
  return age >= 0 && age <= windowMs
}

/**
 * Freeze a value and everything reachable from it.
 *
 * The loop publishes messages it assumes no caller can mutate; the harness
 * reaches that guarantee through its own utility package, which this standalone
 * plugin does not depend on.
 * @param value - the value to freeze in place.
 * @returns the same value.
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

/** Bound one summary the way the harness bounds a `notice` summary. */
function boundSummary(summary) {
  return summary.length <= SUMMARY_MAX_CHARS
    ? summary
    : `${summary.slice(0, SUMMARY_MAX_CHARS - 1)}…`
}

/**
 * Build the user-role message that opens the continuation turn.
 *
 * The harness helper that normally stamps a user message only adds
 * `role: 'user'` and a fresh identity, then freezes the result, so building the
 * value here produces exactly what the loop consumes without making this
 * standalone package import a harness package at runtime.
 * @param prompt - the model-facing continuation text.
 * @returns the frozen user message to submit.
 */
export function continuationMessage(prompt) {
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: prompt }],
    // A plugin-form notice is the harness's own spelling for context a session
    // plugin contributes rather than a prompt a human typed.
    source: { kind: 'plugin', plugin: PLUGIN_NAME, form: 'notice', summary: boundSummary(CONTINUATION_SUMMARY) },
  })
}

/**
 * The turn the successor opens in a session the update interrupted.
 *
 * The model is told what happened rather than asked to "continue", because the
 * synthetic repair already recorded its in-flight tool calls as failed: naming
 * that is what stops it from re-running a side effect that may have completed
 * before the process died.
 * @param session - the recorded session.
 * @param message - the operator's continuation text.
 * @param detail - facts about this restart.
 * @returns the model-facing continuation prompt.
 */
export function continuationPrompt(session, message, detail) {
  const lines = [message]
  lines.push('')
  lines.push(`The restart applied a software update: ${short(detail.previousBranch) ?? 'the previous checkout'} at ${short(detail.fromSha) ?? 'an unknown commit'} became ${short(detail.toSha) ?? 'an unknown commit'}.`)
  if (session.title !== null) lines.push(`Session: ${session.title}.`)
  return lines.join('\n')
}

/** Render one recorded commit or branch for the prompt, or null when absent. */
function short(value) {
  if (typeof value !== 'string' || value === '') return null
  return value.length > 12 ? value.slice(0, 12) : value
}
