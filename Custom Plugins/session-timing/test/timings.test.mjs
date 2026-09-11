import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, callSummary, foldOperations, formatDuration, renderReport } from '../index.js'

const BASE = 1_700_000_000_000

function event(seq, type, data) {
  return { seq, time: BASE + seq * 1_000, type, data }
}

function toolCall(callId, name, args) {
  return { callId, name, arguments: JSON.stringify(args), turn: 1, step: 1 }
}

function toolResult(callId, isError = false) {
  return { message: { source: { kind: 'tool', callId }, content: [{ isError }] } }
}

test('formatDuration switches at the minute', () => {
  assert.equal(formatDuration(0), '0s')
  assert.equal(formatDuration(-500), '0s')
  assert.equal(formatDuration(45_230), '45.2s')
  assert.equal(formatDuration(59_940), '59.9s')
  assert.equal(formatDuration(59_960), '1m 00s')
  assert.equal(formatDuration(162_000), '2m 42s')
})

test('callSummary prefers the argument that names the work', () => {
  assert.equal(callSummary(JSON.stringify({ command: 'pnpm run test' })), 'pnpm run test')
  assert.equal(callSummary(JSON.stringify({ path: '/tmp/a.ts' })), '/tmp/a.ts')
  assert.equal(callSummary(JSON.stringify({ queries: ['one', 'two'] })), 'one, two')
  assert.equal(callSummary(JSON.stringify({ other: 'fallback' })), 'fallback')
  assert.equal(callSummary(JSON.stringify({ n: 1 })), '')
  assert.equal(callSummary('{"command":"trunc'), '{"command":"trunc')
  assert.equal(callSummary(''), '')
  assert.equal(callSummary(undefined), '')
  assert.equal(callSummary('"a string"'), '')
  assert.equal(callSummary(JSON.stringify({ command: 'x'.repeat(200) })).length, 80)
  assert.equal(callSummary(JSON.stringify({ command: 'first\nsecond' })), 'first')
})

test('foldOperations pairs Tool calls with their results and ages the open ones', () => {
  const events = [
    event(1, 'tool/call', toolCall('c1', 'bash', { command: 'pnpm run test' })),
    event(3, 'tool/result', toolResult('c1')),
    event(4, 'tool/call', toolCall('c2', 'read', { path: 'src/a.ts' })),
    event(6, 'tool/result', toolResult('c2', true)),
    event(7, 'tool/call', toolCall('c3', 'pwsh', { command: 'long' })),
  ]
  const { completed, running } = foldOperations(events, BASE + 60_000)
  assert.deepEqual(completed, [
    { kind: 'tool', start: BASE + 1_000, label: 'bash pnpm run test', ms: 2_000, status: 'ok' },
    { kind: 'tool', start: BASE + 4_000, label: 'read src/a.ts', ms: 2_000, status: 'failed' },
  ])
  assert.deepEqual(running, [
    { kind: 'tool', start: BASE + 7_000, label: 'pwsh long', ms: 53_000 },
  ])
})

test('foldOperations times model steps and leaves unmatched events alone', () => {
  const events = [
    event(1, 'turn/start', { turn: 1 }),
    event(2, 'step/start', { turn: 1, step: 1 }),
    event(5, 'assistant/message', { turn: 1, step: 1 }),
    event(6, 'step/start', { turn: 1, step: 2 }),
    event(9, 'step/end', { turn: 1, step: 2 }),
    // A step/end for a step the assistant already closed must not double-count.
    event(10, 'step/end', { turn: 1, step: 1 }),
    event(11, 'step/start', { turn: 2, step: 1 }),
    // A result with no matching call is dropped rather than reported as zero-length.
    event(12, 'tool/result', toolResult('missing')),
  ]
  const { completed, running } = foldOperations(events, BASE + 20_000)
  assert.deepEqual(completed, [
    { kind: 'step', start: BASE + 2_000, label: 'turn 1 step 1', ms: 3_000, status: 'ok' },
    { kind: 'step', start: BASE + 6_000, label: 'turn 1 step 2', ms: 3_000, status: 'unfinished' },
  ])
  assert.deepEqual(running, [
    { kind: 'step', start: BASE + 11_000, label: 'turn 2 step 1', ms: 9_000 },
  ])
})

test('renderReport ranks the slowest first and summarizes the totals', () => {
  const { completed, running } = foldOperations([
    event(1, 'tool/call', toolCall('c1', 'bash', { command: 'quick' })),
    event(3, 'tool/result', toolResult('c1')),
    event(4, 'tool/call', toolCall('c2', 'bash', { command: 'slow' })),
    event(14, 'tool/result', toolResult('c2')),
    event(15, 'step/start', { turn: 1, step: 1 }),
    event(18, 'assistant/message', { turn: 1, step: 1 }),
  ], BASE + 20_000)
  const report = renderReport(completed, running, 2)
  assert.equal(report, [
    'Session timing: 3 completed operations, 2 slowest shown.',
    '      10s  tool  ok          bash slow',
    '       3s  step  ok          turn 1 step 1',
    'Totals: Tool calls 12s over 2, model steps 3s over 1.',
  ].join('\n'))
})

test('renderReport states an empty session and lists running operations', () => {
  assert.equal(renderReport([], [], 8), 'Session timing: 0 completed operations, 0 slowest shown.\n  (nothing has completed yet)')

  const { completed, running } = foldOperations([
    event(1, 'tool/call', toolCall('c1', 'pwsh', { command: 'long' })),
  ], BASE + 62_400)
  assert.equal(renderReport(completed, running, 8), [
    'Session timing: 0 completed operations, 0 slowest shown.',
    '  (nothing has completed yet)',
    'Still running:',
    '   1m 01s  tool  running     pwsh long',
  ].join('\n'))
})

test('apply registers the tool and rejects a limit outside its bounds', () => {
  let registration
  const ctx = {
    effect(callback) {
      callback()
    },
    tools: {
      register(value) {
        registration = value
      },
    },
  }
  apply(ctx)

  assert.equal(registration.name, 'session_timings')
  assert.equal(registration.output.schema.type, 'string')
  assert.deepEqual(registration.output.render({}, 'body'), [{ type: 'text', text: 'body' }])
  assert.equal(registration.isConcurrencySafe(), true)

  const exec = {
    agent: {
      session: {
        events: [
          event(1, 'tool/call', toolCall('c1', 'bash', { command: 'a' })),
          event(3, 'tool/result', toolResult('c1')),
        ],
      },
    },
  }
  assert.match(registration.execute({}, exec), /Session timing: 1 completed operation, 1 slowest shown\./)
  assert.match(registration.execute({ limit: 5 }, exec), /1 slowest shown\./)
  // A caller with no Agent (a non-session dispatch) reports an empty session.
  assert.match(registration.execute({}, {}), /0 completed operations/)
  assert.throws(() => registration.execute({ limit: 0 }, exec), /limit must be an integer/)
  assert.throws(() => registration.execute({ limit: 51 }, exec), /limit must be an integer/)
  assert.throws(() => registration.execute({ limit: 1.5 }, exec), /limit must be an integer/)
})
