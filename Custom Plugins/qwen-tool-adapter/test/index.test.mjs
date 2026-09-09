// index.test.mjs — wiring tests for dsh-qwen-tool-adapter index.js.
//
// Runs with plain `node --test`. It drives the `llm/stream` waterfall listener
// through a minimal fake `ctx` that records the registered handler, then calls
// it with a model reply and asserts the translated chunks and finish reason.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, __test } from '../index.js'

/** Minimal Cordis ctx: `effect` runs the registration body, `on` records the handler. */
function fakeCtx() {
  const handler = { fn: undefined }
  let effectRunner
  return {
    handler,
    effect(fn) {
      effectRunner = fn
      return () => {}
    },
    apply() {
      effectRunner?.()
    },
    on(_event, fn, _opts) {
      handler.fn = fn
      return () => {}
    },
  }
}

/** Collect a chunk async iterable to an array. */
async function collect(iterable) {
  const out = []
  for await (const chunk of iterable) out.push(chunk)
  return out
}

function modelReplyWithTextToolCall() {
  return (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: '<tool_call>\n<function=grep>\n<parameter=pattern> foo </parameter>\n</function>\n</tool_call>' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: '<tool_call>\n<function=grep>\n<parameter=pattern> foo </parameter>\n</function>\n</tool_call>' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })()
}

test('normalizeConfig defaults and validates', () => {
  const defaults = __test.normalizeConfig({})
  assert.equal(defaults.enabled, true)
  assert.deepEqual(defaults.providers, [])
  assert.deepEqual(defaults.models, [])
  assert.throws(() => __test.normalizeConfig({ enabled: 'yes' }), /enabled must be a boolean/u)
  assert.throws(() => __test.normalizeConfig({ providers: 'pi-ai' }), /providers must be an array/u)
  assert.throws(() => __test.normalizeConfig({ models: [1] }), /models must be an array/u)
})

test('matchesRequest applies providers/models scoping with empty = any', () => {
  assert.equal(__test.matchesRequest({ providers: [], models: [] }, 'pi-ai', 'qwen-max'), true)
  assert.equal(__test.matchesRequest({ providers: ['pi-ai'], models: [] }, 'pi-ai', 'anything'), true)
  assert.equal(__test.matchesRequest({ providers: ['pi-ai'], models: [] }, 'other', 'anything'), false)
  assert.equal(__test.matchesRequest({ providers: [], models: ['qwen-max'] }, 'pi-ai', 'qwen-max'), true)
  assert.equal(__test.matchesRequest({ providers: [], models: ['qwen-max'] }, 'pi-ai', 'qwen-mini'), false)
})

test('llm/stream listener wraps the stream and emits tool-call chunks + tool-calls finish', async () => {
  const ctx = fakeCtx()
  apply(ctx, { enabled: true, providers: [], models: [] })
  ctx.apply()
  const handler = ctx.handler.fn
  assert.equal(typeof handler, 'function')

  const calls = []
  const result = handler(
    { provider: 'pi-ai', model: 'qwen-max' },
    () => {
      calls.push('next-called')
      return modelReplyWithTextToolCall()
    },
  )
  const out = await collect(result)
  const toolCalls = out.filter(chunk => chunk.type === 'tool-call-delta')
  assert.equal(toolCalls.length, 1)
  assert.equal(toolCalls[0].name, 'grep')
  assert.deepEqual(JSON.parse(toolCalls[0].argumentsDelta), { pattern: 'foo' })
  assert.deepEqual(out.at(-1).reason, { kind: 'tool-calls' })
  assert.equal(calls.length, 1) // next() reached the real stream
})

test('llm/stream listener passes through when disabled or out of scope', async () => {
  const ctx = fakeCtx()
  apply(ctx, { enabled: true, providers: ['other-provider'], models: [] })
  ctx.apply()
  const handler = ctx.handler.fn
  // Out-of-scope provider: the listener returns the underlying stream untouched.
  const direct = modelReplyWithTextToolCall()
  const result = handler({ provider: 'pi-ai', model: 'qwen-max' }, () => direct)
  assert.equal(result, direct)
})
