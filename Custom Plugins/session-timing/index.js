/**
 * Model-facing session timing report.
 *
 * Registers `session_timings`: the slowest completed Tool calls and model steps
 * of the current session, anything still open and how long it has been open,
 * and the per-kind totals. The transcript shows a duration next to each row for
 * a human; this is the same measurement where the agent can act on it, so a
 * session that is burning time in one place is visible without re-running it.
 *
 * Everything here reads the live Session log, so the figure the model gets is
 * the figure the transcript drew.
 */

export const name = 'session-timing'

/** Read-only over the Tool registry's own service. */
export const inject = ['tools']

/** Slowest completed operations listed when the caller names no limit. */
const DEFAULT_LIMIT = 8

/** Ceiling on either list, so one call cannot flood the context. */
const MAX_LIMIT = 50

/** Argument keys whose value best names what a call was doing. */
const SUMMARY_KEYS = [
  'command', 'description', 'file_path', 'path', 'query', 'pattern', 'url',
  'objective', 'prompt', 'name', 'id',
]

const SUMMARY_CHARS = 80

/**
 * Elapsed span as `x.xs` under a minute, `Xm YYs` above it.
 * @param {number} ms - elapsed milliseconds; negatives clamp to zero.
 * @returns {string} the display label.
 */
export function formatDuration(ms) {
  const seconds = Math.max(0, ms) / 1000
  const tenths = Math.round(seconds * 10) / 10
  if (tenths < 60) return `${tenths}s`
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`
}

function firstLine(text) {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function clip(text) {
  return text.length <= SUMMARY_CHARS ? text : `${text.slice(0, SUMMARY_CHARS - 1)}…`
}

function stringAt(source, key) {
  const value = source[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Best one-line label for a Tool call's arguments.
 * @param {unknown} argumentsRaw - the recorded `arguments` field.
 * @returns {string} the label, empty when nothing usable was recorded.
 */
export function callSummary(argumentsRaw) {
  if (typeof argumentsRaw !== 'string' || argumentsRaw === '') return ''
  let parsed
  try {
    parsed = JSON.parse(argumentsRaw)
  } catch {
    // Mid-stream truncation and non-JSON payloads still name the call better
    // than leaving the row as a bare tool name.
    return clip(firstLine(argumentsRaw))
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return ''
  for (const key of SUMMARY_KEYS) {
    const picked = stringAt(parsed, key)
    if (picked !== undefined) return clip(firstLine(picked))
  }
  const queries = parsed.queries
  if (Array.isArray(queries)) {
    const joined = queries.filter(query => typeof query === 'string' && query !== '').join(', ')
    if (joined !== '') return clip(firstLine(joined))
  }
  for (const value of Object.values(parsed)) {
    if (typeof value === 'string' && value !== '') return clip(firstLine(value))
  }
  return ''
}

function stepKey(turn, step) {
  return `${String(turn)}:${String(step)}`
}

function stepLabel(turn, step) {
  return `turn ${String(turn)} step ${String(step)}`
}

function closeStep(completed, openSteps, turn, step, time, status) {
  const key = stepKey(turn, step)
  const started = openSteps.get(key)
  if (started === undefined) return
  openSteps.delete(key)
  completed.push({ ...started, ms: Math.max(0, time - started.start), status })
}

/**
 * Fold one session log into completed and still-open operations.
 * @param {readonly {time: number, type: string, data: any}[]} events - live Session events.
 * @param {number} now - current epoch ms, used to age an open operation.
 * @returns {{completed: object[], running: object[]}} both lists unordered.
 */
export function foldOperations(events, now) {
  const openTools = new Map()
  const openSteps = new Map()
  const completed = []
  for (const event of events) {
    const data = event.data
    switch (event.type) {
      case 'tool/call': {
        const summary = callSummary(data.arguments)
        openTools.set(String(data.callId), {
          kind: 'tool',
          start: event.time,
          label: summary === '' ? String(data.name) : `${String(data.name)} ${summary}`,
        })
        break
      }
      case 'tool/result': {
        const callId = String(data.message?.source?.callId ?? '')
        const started = openTools.get(callId)
        if (started === undefined) break
        openTools.delete(callId)
        const failed = data.message?.content?.[0]?.isError === true
        completed.push({ ...started, ms: Math.max(0, event.time - started.start), status: failed ? 'failed' : 'ok' })
        break
      }
      case 'step/start':
        openSteps.set(stepKey(data.turn, data.step), {
          kind: 'step',
          start: event.time,
          label: stepLabel(data.turn, data.step),
        })
        break
      case 'assistant/message':
        closeStep(completed, openSteps, data.turn, data.step, event.time, 'ok')
        break
      case 'step/end':
        // A step whose model request never settled is still worth timing: the
        // wait itself is what a caller needs to see.
        closeStep(completed, openSteps, data.turn, data.step, event.time, 'unfinished')
        break
      default:
        // Every other session event carries no operation boundary.
        break
    }
  }
  const age = operation => ({ ...operation, ms: Math.max(0, now - operation.start) })
  return {
    completed,
    running: [...openTools.values()].map(age).concat([...openSteps.values()].map(age)),
  }
}

function totalsOf(completed) {
  let toolMs = 0
  let tools = 0
  let stepMs = 0
  let steps = 0
  for (const operation of completed) {
    if (operation.kind === 'tool') {
      toolMs += operation.ms
      tools += 1
    } else {
      stepMs += operation.ms
      steps += 1
    }
  }
  return { toolMs, tools, stepMs, steps }
}

function row(operation) {
  // An open operation has no outcome yet; saying so beats an empty column.
  const status = operation.status ?? 'running'
  return `  ${formatDuration(operation.ms).padStart(7)}  ${operation.kind.padEnd(4)}  ${status.padEnd(10)}  ${operation.label}`
}

/**
 * Render the report the model reads.
 * @param {object[]} completed - settled operations.
 * @param {object[]} running - operations with no closing event yet.
 * @param {number} limit - rows per list.
 * @returns {string} the report text.
 */
export function renderReport(completed, running, limit) {
  const ranked = [...completed].sort((left, right) => right.ms - left.ms)
  const lines = [
    `Session timing: ${String(completed.length)} completed operation${completed.length === 1 ? '' : 's'}, ${String(Math.min(ranked.length, limit))} slowest shown.`,
  ]
  if (ranked.length === 0) lines.push('  (nothing has completed yet)')
  for (const operation of ranked.slice(0, limit)) lines.push(row(operation))
  if (running.length > 0) {
    lines.push('Still running:')
    for (const operation of [...running].sort((left, right) => right.ms - left.ms).slice(0, limit)) {
      lines.push(row(operation))
    }
  }
  const totals = totalsOf(completed)
  if (totals.tools > 0 || totals.steps > 0) {
    lines.push(
      `Totals: Tool calls ${formatDuration(totals.toolMs)} over ${String(totals.tools)}, model steps ${formatDuration(totals.stepMs)} over ${String(totals.steps)}.`,
    )
  }
  return lines.join('\n')
}

function resolveLimit(value) {
  if (value === undefined) return DEFAULT_LIMIT
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${String(MAX_LIMIT)}`)
  }
  return value
}

/** Register the `session_timings` Tool. */
export function apply(ctx) {
  ctx.effect(() => ctx.tools.register({
    name: 'session_timings',
    description: 'Report how long this session\'s operations took: the slowest completed Tool calls and model steps, anything still running and for how long, and the per-kind totals. Use it to find what is taking long instead of re-running work to measure it.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: {
          type: 'integer',
          description: `Rows shown for each list. Defaults to ${String(DEFAULT_LIMIT)}, at most ${String(MAX_LIMIT)}.`,
        },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    isConcurrencySafe: () => true,
    execute: (args, exec) => {
      const limit = resolveLimit(args.limit)
      const events = exec.agent?.session?.events ?? []
      const { completed, running } = foldOperations(events, Date.now())
      return renderReport(completed, running, limit)
    },
  }))
}
