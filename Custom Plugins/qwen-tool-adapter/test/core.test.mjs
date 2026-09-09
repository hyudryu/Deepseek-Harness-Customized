// core.test.mjs — dependency-free unit tests for qwen-tool-adapter core.js.
//
// Runs with plain `node --test` and no harness packages installed, matching
// the repo's standalone custom-plugin test convention (see vision-router).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseQwenToolCalls,
  hasQwenToolCalls,
  translateFinishReason,
  translateQwenChunks,
} from '../core.js'

function collect(iterable) {
  return (async () => {
    const out = []
    for await (const chunk of iterable) out.push(chunk)
    return out
  })()
}

/** Assemble a text/tool-call block stream covering `text` as one block. */
function textStream(blocks) {
  return (async function* () {
    let index = 0
    for (const block of blocks) {
      if (block.kind === 'text') {
        yield { type: 'block-start', index, blockType: 'text' }
        yield { type: 'text-delta', index, text: block.text }
        yield { type: 'block-end', index, block: { type: 'text', text: block.text } }
      } else if (block.kind === 'reasoning') {
        yield { type: 'block-start', index, blockType: 'reasoning' }
        yield { type: 'reasoning-delta', index, text: block.text }
        yield { type: 'block-end', index, block: { type: 'reasoning', text: block.text } }
      }
      index += 1
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })()
}

test('hasQwenToolCalls detects the tag and JSON markers', () => {
  assert.equal(hasQwenToolCalls('<tool_call>a</tool_call>'), true)
  assert.equal(hasQwenToolCalls('plain text'), false)
  assert.equal(hasQwenToolCalls(undefined), false)
})

test('parseQwenToolCalls parses the tag form into function + parameters', () => {
  const pieces = parseQwenToolCalls([
    'Please read the file.',
    '<tool_call>',
    '<function=read>',
    '<parameter=file_path> src/a.ts </parameter>',
    '<parameter=lines> 40 </parameter>',
    '</function>',
    '</tool_call>',
  ].join('\n'))
  assert.equal(pieces[0].kind, 'text')
  assert.equal(pieces[0].text.trim(), 'Please read the file.')
  assert.equal(pieces[1].kind, 'call')
  assert.equal(pieces[1].name, 'read')
  assert.deepEqual(JSON.parse(pieces[1].arguments), { file_path: 'src/a.ts', lines: '40' })
})
test('parseQwenToolCalls parses the JSON form', () => {
  const pieces = parseQwenToolCalls('<tool_call>\n{"name": "grep", "arguments": {"pattern": "foo", "path": "src"}}\n</tool_call>')
  assert.equal(pieces.length, 1)
  assert.equal(pieces[0].kind, 'call')
  assert.equal(pieces[0].name, 'grep')
  assert.deepEqual(JSON.parse(pieces[0].arguments), { pattern: 'foo', path: 'src' })
})

test('parseQwenToolCalls passes a block with no markup through as one text segment', () => {
  const pieces = parseQwenToolCalls('Hello world')
  assert.deepEqual(pieces, [{ kind: 'text', text: 'Hello world' }])
})

test('translateFinishReason rewrites stop/absent to tool-calls when translated', () => {
  assert.deepEqual(translateFinishReason({ kind: 'stop' }, true), { kind: 'tool-calls' })
  assert.deepEqual(translateFinishReason(null, true), { kind: 'tool-calls' })
  // Untranslated keeps the incoming reason.
  assert.deepEqual(translateFinishReason({ kind: 'stop' }, false), { kind: 'stop' })
  // A non-stop reason is preserved even when translated.
  assert.deepEqual(translateFinishReason({ kind: 'max-tokens' }, true), { kind: 'max-tokens' })
})

test('translateQwenChunks converts a text tag block into text + tool-call blocks', async () => {
  const out = await collect(translateQwenChunks(textStream([
    { kind: 'text', text: 'Calling the tool.\n<tool_call>\n<function=read>\n<parameter=file_path> src/a.ts </parameter>\n</function>\n</tool_call>' },
  ])))
  const toolCalls = out.filter(chunk => chunk.type === 'tool-call-delta')
  const blocks = out.filter(chunk => chunk.type === 'block-end')
  assert.equal(toolCalls.length, 1)
  assert.equal(toolCalls[0].name, 'read')
  assert.deepEqual(JSON.parse(toolCalls[0].argumentsDelta), { file_path: 'src/a.ts' })
  // The block stream ends with a renumbered tool-call block and the finish
  // reason rewritten to tool-calls.
  assert.equal(out.at(-1).type, 'finish')
  assert.deepEqual(out.at(-1).reason, { kind: 'tool-calls' })
  const textBlock = blocks.find(b => b.block?.type === 'text')
  assert.equal(textBlock.block.text.trim(), 'Calling the tool.')
})

test('translateQwenChunks leaves ordinary text untouched (single text block, stop reason)', async () => {
  const incoming = textStream([{ kind: 'text', text: 'Just a summary.' }])
  const out = await collect(translateQwenChunks(incoming))
  const textBlocks = out.filter(chunk => chunk.type === 'block-end' && chunk.block?.type === 'text')
  assert.equal(textBlocks.length, 1)
  assert.equal(textBlocks[0].block.text, 'Just a summary.')
  assert.deepEqual(out.at(-1).reason, { kind: 'stop' })
})

test('translateQwenChunks streams reasoning through unchanged', async () => {
  const out = await collect(translateQwenChunks(textStream([
    { kind: 'reasoning', text: 'I will call grep.' },
    { kind: 'text', text: '<tool_call>\n{"name": "grep", "arguments": {"pattern": "x"}}\n</tool_call>' },
  ])))
  const reasoning = out.filter(chunk => chunk.type === 'block-end' && chunk.block?.type === 'reasoning')
  assert.equal(reasoning.length, 1)
  assert.equal(reasoning[0].block.text, 'I will call grep.')
  assert.deepEqual(out.at(-1).reason, { kind: 'tool-calls' })
})

test('translateQwenChunks drops replay state when it translated tool calls', async () => {
  const incoming = (async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: '<tool_call>\n<function=f>\n<parameter=a> 1 </parameter>\n</function>\n</tool_call>' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: '<tool_call>\n<function=f>\n<parameter=a> 1 </parameter>\n</function>\n</tool_call>' } }
    yield { type: 'finish', reason: { kind: 'stop' }, replayState: { response: { id: 'r1' }, blocks: [{}] } }
  })()
  const out = await collect(translateQwenChunks(incoming))
  const finish = out.at(-1)
  assert.deepEqual(finish.reason, { kind: 'tool-calls' })
  assert.equal('replayState' in finish, false)
})
