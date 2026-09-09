// core.js — dependency-free Qwen tool-call translation.
//
// Qwen (and some Qwen-family models behind OpenAI-compatible or proxied
// routes) emit tool calls as literal text in the assistant reply, most often:
//
//   <tool_call>
//   <function=read>
//   <parameter=file_path> src/a.ts </parameter>
//   </function>
//   </tool_call>
//
// or the JSON form Qwen also uses:
//
//   <tool_call>
//   {"name": "read", "arguments": {"file_path": "src/a.ts"}}
//   </tool_call>
//
// The harness only dispatches tools that arrive as structured `tool-call`
// content blocks, so an unwrapped text reply carrying that markup yields no
// tool calls and the turn ends with nothing executed. This module translates
// the chunk stream: it buffers each assistant text block, and when the block
// carries Qwen tool-call markup it re-emits the preamble as text plus one
// `tool-call` block per call, and rewrites the terminal finish reason to
// `tool-calls` so the agent loop dispatches them.
//
// This module is deliberately free of any @deepseek-ai import so the unit
// tests run with plain `node --test` and no harness packages installed. The
// wiring in index.js is the only place that touches the `llm` service.

const TOOL_CALL_OPEN = '<tool_call>'
const TOOL_CALL_CLOSE = '</tool_call>'

/** Parse one `<tool_call>...</tool_call>` inner payload, either Qwen form. */
function parseCallText(inner) {
  const trimmed = inner.trim()
  // JSON form: a single JSON object { name, arguments }.
  if (trimmed.startsWith('{')) {
    let parsed
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return undefined
    }
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
    if (name === '') return undefined
    const args = parsed.arguments ?? parsed.parameters ?? {}
    const argumentsJson = typeof args === 'string'
      ? (() => { try { return JSON.stringify(JSON.parse(args)) } catch { return args } })()
      : JSON.stringify(args)
    return { name, arguments: argumentsJson }
  }
  // Tag form: <function=NAME> ... <parameter=KEY>VALUE</parameter> ... </function>
  const nameMatch = /<function\s*=\s*([^>\s]+)\s*>/.exec(trimmed)
  if (nameMatch === null) return undefined
  const name = nameMatch[1].trim()
  if (name === '') return undefined
  const args = {}
  const paramPattern = /<parameter\s*=\s*([^\s>]+)\s*>([\s\S]*?)<\/parameter>/g
  let paramMatch
  while ((paramMatch = paramPattern.exec(trimmed)) !== null) {
    const key = paramMatch[1].trim()
    const value = paramMatch[2].trim()
    if (key !== '') args[key] = value
  }
  return { name, arguments: JSON.stringify(args) }
}

/**
 * Parse an assistant text block into ordered segments: text runs and tool
 * calls. A text block with no Qwen markup returns a single text segment, so
 * the transformer can pass it through unchanged.
 * @param {string} text - the assembled assistant text block.
 * @returns {Array<{kind:'text'|'call',text?:string,name?:string,arguments?:string}>}
 *   ordered segments; empty when the text carried nothing.
 */
export function parseQwenToolCalls(text) {
  const segments = []
  let cursor = 0
  while (true) {
    const open = text.indexOf(TOOL_CALL_OPEN, cursor)
    if (open === -1) {
      const remaining = text.slice(cursor)
      if (remaining !== '') segments.push({ kind: 'text', text: remaining })
      break
    }
    if (open > cursor) segments.push({ kind: 'text', text: text.slice(cursor, open) })
    const close = text.indexOf(TOOL_CALL_CLOSE, open + TOOL_CALL_OPEN.length)
    if (close === -1) {
      // Unclosed marker: keep the rest as text; the model was truncated.
      segments.push({ kind: 'text', text: text.slice(open) })
      break
    }
    const inner = text.slice(open + TOOL_CALL_OPEN.length, close)
    const call = parseCallText(inner)
    if (call === undefined) {
      segments.push({ kind: 'text', text: text.slice(open, close + TOOL_CALL_CLOSE.length) })
    } else {
      segments.push({ kind: 'call', name: call.name, arguments: call.arguments })
    }
    cursor = close + TOOL_CALL_CLOSE.length
  }
  return segments
}

/**
 * Whether one assistant text block contains Qwen tool-call markup. Cheap
 * pre-check so the transformer only buffers-and-parses blocks that can change.
 * @param {string} text - the assembled assistant text block.
 * @returns {boolean} true when a `<tool_call>` marker is present.
 */
export function hasQwenToolCalls(text) {
  return typeof text === 'string' && text.includes(TOOL_CALL_OPEN)
}

/**
 * Rewrite one terminal finish reason to `tool-calls` when the stream's final
 * text block carried parsed tool calls. Qwen's provider reports `stop` because
 * the calls are text, so without this the loop sees a text-only message and
 * never dispatches.
 * @param {object|null} reason - the incoming finish reason, or null.
 * @param {boolean} translated - whether tool calls were emitted.
 * @returns {object|null} the reason to emit; `tool-calls` when translated.
 */
export function translateFinishReason(reason, translated) {
  if (translated && (reason == null || reason.kind === 'stop')) {
    return { kind: 'tool-calls' }
  }
  return reason
}

/**
 * Wrap a harness chunk stream and translate Qwen tool-call markup.
 *
 * Non-text blocks (reasoning, images, structured tool-calls) stream through
 * unchanged. Assistant text blocks are buffered to their `block-end`; a block
 * with no Qwen markup is re-emitted verbatim, while one that carries calls is
 * split into its preamble text plus one tool-call block per call, in order.
 * Blocks are renumbered with a fresh sequential index so the emitted stream
 * stays self-consistent. When any tool call was emitted, the terminal finish
 * reason becomes `tool-calls` and replay state is dropped (it no longer
 * matches the rewritten block layout).
 *
 * A text block is emitted only at its end, so a plain Qwen text turn surfaces
 * at block granularity rather than per-token; the reasoning block still
 * streams through immediately.
 * @param {AsyncIterable<object>} upstream - the underlying chunk stream.
 * @returns {AsyncIterable<object>} the translated chunk stream.
 */
export async function* translateQwenChunks(upstream) {
  let nextIndex = 0
  let translated = false
  // One pending text block: its accumulated text and the original index.
  let pending = undefined

  for await (const chunk of upstream) {
    if (chunk == null || typeof chunk !== 'object') continue
    switch (chunk.type) {
      case 'block-start': {
        if (chunk.blockType === 'text') {
          pending = { index: chunk.index, text: '' }
        } else {
          yield { ...chunk, index: nextIndex++ }
        }
        break
      }
      case 'text-delta': {
        if (pending !== undefined && chunk.index === pending.index) {
          pending.text += chunk.text
        } else if (pending === undefined) {
          pending = { index: chunk.index, text: chunk.text }
        }
        break
      }
      case 'reasoning-delta':
      case 'tool-call-delta': {
        yield { ...chunk, index: nextIndex++ }
        break
      }
      case 'block-end': {
        if (pending !== undefined && chunk.index === pending.index) {
          if (chunk.block?.type === 'text') {
            const emitted = emitTextBlock(pending.text, nextIndex)
            for (const piece of emitted.pieces) yield piece.chunk
            if (emitted.hadCalls) translated = true
            nextIndex = emitted.next
          } else {
            yield { ...chunk, index: nextIndex++ }
          }
          pending = undefined
          break
        }
        yield { ...chunk, index: nextIndex++ }
        break
      }
      case 'usage': {
        yield chunk
        break
      }
      case 'finish': {
        if (pending !== undefined && pending.text !== '') {
          const emitted = emitTextBlock(pending.text, nextIndex)
          for (const piece of emitted.pieces) yield piece.chunk
          if (emitted.hadCalls) translated = true
          nextIndex = emitted.next
          pending = undefined
        }
        const reason = translateFinishReason(chunk.reason, translated)
        yield {
          type: 'finish',
          reason,
          ...(translated ? {} : chunk.replayState === undefined ? {} : { replayState: chunk.replayState }),
        }
        return
      }
      default:
        yield chunk
    }
  }
}

/**
 * Emit the converted blocks for one assistant text block. With no markup this
 * is a single verbatim text block (renumbered); with markup it is the preamble
 * text plus one tool-call block per call, in order.
 * @param {string} text - the assembled text block.
 * @param {number} start - the first fresh block index to use.
 * @returns {{pieces:Array<{next:number,chunk:object|null}>,next:number,hadCalls:boolean}}
 *   the block pieces, the next free index, and whether a call was emitted.
 */
function emitTextBlock(text, start) {
  if (!hasQwenToolCalls(text)) {
    return { pieces: textBlockPieces(text, start), next: start + 1, hadCalls: false }
  }
  const parts = parseQwenToolCalls(text)
  const pieces = []
  let index = start
  let hadCalls = false
  for (const part of parts) {
    if (part.kind === 'text') {
      for (const piece of textBlockPieces(part.text, index)) pieces.push(piece)
    } else if (part.kind === 'call') {
      hadCalls = true
      pieces.push({ next: index, chunk: { type: 'block-start', index, blockType: 'tool-call' } })
      pieces.push({ next: index, chunk: { type: 'tool-call-delta', index, id: `qwen-call-${index}`, name: part.name, argumentsDelta: part.arguments } })
      pieces.push({ next: index + 1, chunk: { type: 'block-end', index, block: { type: 'tool-call', id: `qwen-call-${index}`, name: part.name, arguments: part.arguments } } })
      index += 1
    }
  }
  return { pieces, next: index, hadCalls }
}

/**
 * Pieces for one verbatim text block at index `index`: start, the delta text,
 * and the end. All three consume the single index `index`.
 * @param {string} text - the text to emit.
 * @param {number} index - the block index.
 * @returns {Array<{next:number,chunk:object|null}>} the block's pieces.
 */
function textBlockPieces(text, index) {
  return [
    { next: index, chunk: { type: 'block-start', index, blockType: 'text' } },
    { next: index, chunk: { type: 'text-delta', index, text } },
    { next: index + 1, chunk: { type: 'block-end', index, block: { type: 'text', text } } },
  ]
}
