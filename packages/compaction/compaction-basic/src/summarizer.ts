/**
 * Default one-shot summarization and durable checkpoint framing.
 *
 * @module @deepseek-ai/dsh-compaction-basic/summarizer
 */

import type { Context } from '@deepseek-ai/cordis'
import { contentHasImage, createUserMessage, BlockAssembler, LlmError } from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock, FinishReason, GenerateOptions, LlmImageRequestPricing, Message, TokenUsage, ToolSchema,
} from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Type-only: the `ctx.tokenMeter` Context merge for the declared pricing face.
import type { TokenMeter } from '@deepseek-ai/dsh-token-meter'

interface SummaryConfig {
  readonly summarizationProvider: string
  readonly summarizationModel: string
  readonly maxTokens: number
}

/** Tags wrapping the structured summary inside the landed checkpoint node. */
const SUMMARY_OPEN_TAG = '<compacted-summary>'
const SUMMARY_CLOSE_TAG = '</compacted-summary>'

/**
 * Fraction of the routed model's window the summarization request may occupy.
 *
 * The auxiliary call has to fit where the conversation did not, so it is
 * budgeted strictly below capacity: the reserve covers the estimator's known
 * under-pricing of CJK text and JSON schemas plus provider-side framing.
 */
const SUMMARY_WINDOW_RATIO = 0.75

/**
 * The summarization directive, delivered as the FINAL user message after the
 * replayed conversation rather than as a distinct summarizer system prompt.
 * Keeping the conversation's own system prompt, tools, and message prefix in
 * front of it makes the auxiliary call a genuine prefix of the last routed
 * request, so the provider's KV cache is reused instead of invalidated.
 */
const COMPACTION_INSTRUCTION = [
  'You are now acting as a compaction engine for this AI coding assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.',
  '',
  'Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section — never drop a section.',
  '',
  '## Primary Request and Intent',
  "- [the user's original and evolving goals; quote verbatim where the exact wording matters]",
  '',
  '## Key Technical Concepts',
  '- [technologies, frameworks, patterns, and conventions in play]',
  '',
  '## Files and Code',
  '- [exact path: why it matters, key changes or snippets]',
  '',
  '## Errors and Fixes',
  '- [error: how it was resolved, plus any related user feedback]',
  '',
  '## Pending Jobs',
  '- [explicitly requested work not yet completed]',
  '',
  '## Current Work',
  '- [precisely what was in progress at this checkpoint]',
  '',
  '## Next Step',
  '- [the single next action, directly in line with the most recent request, or "(none)"]',
  '',
  '## Critical Context',
  '- [decisions and their rationale, constraints, user preferences, open questions, data needed to continue]',
  '',
  'Rules:',
  '- Write concise English engineering prose. Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments.',
  '- Capture user feedback and explicit instructions faithfully, especially corrections.',
  '- Do NOT mention this summarization request or that the context was compacted.',
  '- Output only the checkpoint text: do not call any tool or take any other action.',
  `- If the conversation already contains a ${SUMMARY_OPEN_TAG} block, it is a PRIOR checkpoint. Do not copy it forward verbatim: preserve still-true facts, drop stale ones, and merge newer information into a single consolidated summary under the same structure.`,
].join('\n')

/** Framing that makes the replacement user message established context. */
const CHECKPOINT_PREAMBLE =
  'This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.'

/**
 * The replayed conversation surface the summarizer condenses. Reproducing the
 * last routed request's system prompt, tools, and leading messages verbatim
 * lets the auxiliary call reuse the provider's warm prefix cache; the trailing
 * compaction instruction is then the only novel input.
 */
export interface SummarizationInput {
  /** The conversation's own system prompt, reused for prefix-cache alignment; absent for a system-less request. */
  readonly system?: string
  /** The conversation's tool schemas, reused for prefix-cache alignment; absent when the request carried none. */
  readonly tools?: readonly ToolSchema[]
  /** The shadowed region, in surface order, that precedes the compaction instruction. */
  readonly messages: readonly Message[]
}

/** Safe summary content plus the exact auxiliary call envelope recorded with it. */
export type SummaryResult = {
  summary: ContentBlock[]
  provider: string
  model: string
  maxTokens?: number
  /** Provider-reported usage for this summarization request. */
  usage?: TokenUsage
} & (
  | {
    /** Complete provider output before the text-only summary projection. */
    rawOutput: ContentBlock[]
    /** Identifies exactly one call through this context's `ctx.llm.stream()`. */
    llmStreamCall: true
  }
  | {
    /** Optional complete output from an unmarked template, remote, or other summarizer. */
    rawOutput?: ContentBlock[]
    /** An unmarked result does not identify a call through this context's LLM seam. */
    llmStreamCall?: never
  }
)

/**
 * The trailing directive that marks the auxiliary call and requests the
 * checkpoint. One instance is built per call so the priced envelope and the
 * sent request are the same message.
 */
function instructionMessage(): Message {
  return createUserMessage({
    content: [{ type: 'text', text: COMPACTION_INSTRUCTION }],
    source: { kind: 'plugin', plugin: 'dsh-compaction-basic' },
  })
}

/** One image occurrence reference, as route image pricing consumes them. */
type ImageRef = Parameters<LlmImageRequestPricing['priceImages']>[0][number]

/** Collect one message's image occurrences in content order. */
function collectImageRefs(blocks: readonly ContentBlock[], into: ImageRef[]): void {
  for (const block of blocks) {
    if (block.type === 'image') into.push(block.attachment)
    else if (block.type === 'tool-result') collectImageRefs(block.content, into)
  }
}

/** Fixed text density shared with the token meter's estimator. */
const CHARS_PER_TOKEN = 4

/** Per-block structural framing charged by the token meter's estimator. */
const BLOCK_OVERHEAD = 4

/**
 * Tokens of the replayed system prompt under the shared estimator.
 * @param input - replayed conversation prefix.
 * @param meter - pricing face of the token meter.
 * @returns heuristic system-prompt tokens; 0 when the region has none.
 */
function estimateSystemTokens(
  input: SummarizationInput,
  meter: Pick<TokenMeter, 'estimateMessage'>,
): number {
  if (input.system === undefined) return 0
  return meter.estimateMessage(createUserMessage({
    content: [{ type: 'text', text: input.system }],
    source: { kind: 'user' },
  }))
}

/**
 * Tokens of the replayed tool schemas under the shared estimator.
 * @param tools - tool schemas the routed request carried.
 * @returns heuristic schema tokens; 0 when there are none.
 */
function estimateToolsTokens(tools: readonly ToolSchema[] | undefined): number {
  if (tools === undefined || tools.length === 0) return 0
  return Math.ceil(JSON.stringify(tools).length / CHARS_PER_TOKEN)
}

/**
 * Price one replayed message for the summarization request.
 *
 * An image occurrence costs whatever the routed adapter charges for it, which
 * the fixed text estimator cannot see: it prices the block's structural JSON,
 * orders of magnitude below the visual tokens a provider bills. A route that
 * declares pricing therefore has its real figures added, so an image-heavy
 * region is not retained on a price that understates the request that will be
 * sent. A route that declares none keeps the structural estimate, which is what
 * the token meter itself charges for that same route.
 *
 * A route that advertises text-only input is different: it rejects the whole
 * request if any image is replayed, so an image-bearing message cannot be
 * retained at all.
 *
 * Adding to the structural estimate rather than replacing it over-counts each
 * image by a few framing tokens. This figure bounds a request that must fit, so
 * erring high is the safe direction.
 * @param message - one replayed region message.
 * @param meter - pricing face of the token meter.
 * @param pricing - the routed model's image pricing, when it declares one.
 * @param acceptsImages - whether the route advertises image input; `undefined` when unknown.
 * @returns heuristic tokens, or `undefined` when the message cannot be retained.
 */
function priceReplayedMessage(
  message: Message,
  meter: Pick<TokenMeter, 'estimateMessage'>,
  pricing: LlmImageRequestPricing | undefined,
  acceptsImages: boolean | undefined,
): number | undefined {
  const refs: ImageRef[] = []
  collectImageRefs(message.content, refs)
  if (refs.length === 0) return meter.estimateMessage(message)
  if (acceptsImages === false) return undefined
  if (pricing === undefined) return meter.estimateMessage(message)
  const prices = pricing.priceImages(refs)
  const images = prices.reduce(
    (total, price) => total + price.visualTokens
      + Math.ceil(price.text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD,
    0,
  )
  return meter.estimateMessage(message) + images
}

/**
 * Whether a message may begin a replayed span without orphaning a tool result.
 *
 * A span that starts at a tool result whose assistant tool-call was dropped
 * sends a `role: 'tool'` entry with no matching call, which providers reject —
 * leaving overflow recovery stuck exactly where this budget is meant to help.
 * @param message - candidate first message of the retained span.
 * @returns whether the message carries no tool result.
 */
function startsBalancedRegion(message: Message): boolean {
  return !message.content.some(block => block.type === 'tool-result')
}

/** The replayed region one budget admits, with its exact priced total. */
interface FittedRegion {
  /** Retained region messages in surface order. */
  readonly messages: readonly Message[]
  /** Sum of the retained messages' prices. */
  readonly tokens: number
}

/**
 * Keep the newest region messages that fit one token budget, oldest dropped
 * first. The newest messages describe the work in progress, so they carry the
 * facts a resumed conversation most needs; the summarizer's own directive
 * already records that earlier material was condensed away.
 *
 * The retained span never begins at a tool result, so trimming moves the cut
 * forward to the next balanced start rather than orphaning a call/result pair.
 * @param messages - replayed region messages in surface order.
 * @param budget - heuristic tokens available to the region.
 * @param price - per-message price, or `undefined` for an unretainable message.
 * @returns the retained span and the exact tokens it costs.
 */
function fitSummaryRegion(
  messages: readonly Message[],
  budget: number,
  price: (message: Message) => number | undefined,
): FittedRegion {
  if (budget <= 0) return { messages: [], tokens: 0 }
  // Walk newest-first, pricing each message once and recording only what the
  // budget actually admitted.
  const admitted: Array<{ message: Message; cost: number }> = []
  let used = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- index is inside the array bounds
    const message = messages[index]!
    const cost = price(message)
    if (cost === undefined || used + cost > budget) break
    used += cost
    admitted.push({ message, cost })
  }
  // `admitted` is newest-first, so its last entry is the span's oldest message.
  // A span starting at a tool result would name a call it no longer carries.
  while (admitted.length > 0) {
    const oldest = admitted.at(-1)
    if (oldest === undefined || startsBalancedRegion(oldest.message)) break
    admitted.pop()
    used -= oldest.cost
  }
  return { messages: admitted.toReversed().map(entry => entry.message), tokens: used }
}

/**
 * Resolve the heuristic prompt budget for one summarization request from the
 * capacity of the call that will actually be dispatched.
 *
 * A model that advertises no capacity cannot be budgeted, so the caller is
 * left unbounded and the provider decides — the same behavior as before
 * budgeting existed, and the only option that cannot invent a limit.
 * @param contextWindow - advertised capacity of the prepared dispatch, when known.
 * @param maxTokens - output allowance reserved out of that capacity.
 * @returns heuristic prompt-token budget, or `Number.POSITIVE_INFINITY`.
 */
function promptBudget(contextWindow: number | undefined, maxTokens: number): number {
  if (contextWindow === undefined || !Number.isInteger(contextWindow) || contextWindow <= 0) {
    return Number.POSITIVE_INFINITY
  }
  // Reserve the response the checkpoint itself needs: the budget governs the
  // prompt, so the output allowance is subtracted before scaling.
  return Math.floor(Math.max(0, contextWindow - maxTokens) * SUMMARY_WINDOW_RATIO)
}

/**
 * Run the default cache-reusing `ctx.llm.stream()` summarization call: replay
 * the conversation prefix, then append the compaction instruction as the final
 * user message so the provider's warm prefix cache is reused.
 *
 * The request is budgeted to the capacity of the prepared dispatch, dropping
 * the oldest region messages and then the tool schemas when the replayed prefix
 * would not fit. Without that budget the auxiliary call is built from the very
 * context that overflowed, so an over-window session could never compact: every
 * attempt would be answered with the same provider rejection.
 *
 * The retained span always starts at a tool-pair-balanced message, and an image
 * occurrence is charged the routed adapter's price rather than the fixed text
 * estimate's structural placeholder; a message whose images this route cannot
 * price is not retained at all. Both rules exist so the budget bounds the
 * request that is actually sent.
 * @param ctx - context providing the LLM service.
 * @param config - resolved backend configuration.
 * @param input - replayed conversation prefix (system, tools, and leading messages) to condense.
 * @param agent - supplies routed-model history, fallback model, and session id.
 * @param signal - optional cancellation forwarded to the adapter.
 * @returns safe text-only summary blocks and the exact call envelope and output.
 */
export async function summarizeWithLlm(
  ctx: Context,
  config: SummaryConfig,
  input: SummarizationInput,
  agent: Agent,
  signal?: AbortSignal,
): Promise<SummaryResult> {
  const latest = agent.session.requestHeader()?.config
  const configured = config.summarizationProvider.length === 0
    ? undefined
    : { provider: config.summarizationProvider, model: config.summarizationModel }
  const agentTarget = agent.options.provider !== undefined
    && agent.options.provider.length > 0
    && agent.options.model !== undefined
    && agent.options.model.length > 0
    ? { provider: agent.options.provider, model: agent.options.model }
    : undefined
  const target = configured ?? latest ?? agentTarget
  if (target === undefined) {
    throw new Error(
      'no provider/model available for summarization: set both BasicCompactionConfig summarization fields, route one request, or set both AgentOptions fields',
    )
  }

  const assembler = new BlockAssembler()
  // Capacity comes from the routed target's own adapter. Dispatch deliberately
  // stays on `ctx.llm.stream()`, whose `llm/stream` waterfall may reroute the
  // call; binding it to one prepared registration would forbid that extension
  // point. The budget is therefore advisory whenever a listener reroutes, and
  // the recorded envelope below reports the route that actually received it.
  const info = await ctx.llm.resolveModelInfo(target.provider, target.model, signal)
  const budget = promptBudget(info.context?.contextWindow, config.maxTokens)
  const meter = ctx.tokenMeter
  const imagePricing = ctx.llm.imageRequestPricing(target.provider, target.model)
  const acceptsImages = info.inputModalities?.includes('image')
  const price = (message: Message): number | undefined =>
    priceReplayedMessage(message, meter, imagePricing, acceptsImages)

  const instruction = instructionMessage()
  const regionBudget = budget
    - estimateSystemTokens(input, meter)
    - meter.estimateMessage(instruction)
  const region = fitSummaryRegion(input.messages, regionBudget, price)
  // The conversation outranks the schemas. The compaction instruction forbids
  // tool use, so the schemas are replayed for cache alignment only, and keeping
  // them when they would displace a region message would trade the work in
  // progress for pure overhead.
  const tools = input.tools
  const toolsTokens = estimateToolsTokens(tools)
  const replayedTools: readonly ToolSchema[] | undefined =
    tools !== undefined && toolsTokens > 0 && toolsTokens <= regionBudget - region.tokens
      ? tools
      : undefined

  const messages: Message[] = [...region.messages, instruction]
  const options: GenerateOptions = {
    provider: target.provider,
    model: target.model,
    messages,
    ...input.system === undefined ? {} : { system: input.system },
    ...replayedTools === undefined ? {} : { tools: [...replayedTools] },
    maxTokens: config.maxTokens,
    sessionId: agent.session.id,
    purpose: 'compaction',
    ...signal === undefined ? {} : { signal },
  }
  for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)
  const error = finishError(assembler.finish)
  if (error !== undefined) throw error

  const rawOutput = assembler.blocks()
  const summary = summaryText(rawOutput)
  if (!summary.some(block => block.text.trim().length > 0)) {
    throw new Error('summarization produced no text summary content')
  }
  return {
    summary,
    rawOutput,
    llmStreamCall: true,
    // A `llm/stream` listener may have rerouted the call in place, so the
    // recorded envelope is read after dispatch rather than from the request as
    // it was assembled.
    provider: options.provider,
    model: options.model,
    maxTokens: config.maxTokens,
    ...(assembler.usage === undefined ? {} : { usage: assembler.usage }),
  }
}

/**
 * Wrap raw summary blocks in the durable checkpoint framing.
 * @param summary - safe text-only model output.
 * @returns content for the synthesized replacement user message.
 */
export function frameSummary(summary: readonly ContentBlock[]): ContentBlock[] {
  return [
    { type: 'text', text: `${CHECKPOINT_PREAMBLE}\n\n${SUMMARY_OPEN_TAG}` },
    ...summary,
    { type: 'text', text: SUMMARY_CLOSE_TAG },
  ]
}

/** Map a terminal summarization finish to its fail-closed error. */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens': {
      const error = new Error('summarization truncated at the token cap (incomplete checkpoint)') as Error & { code?: string }
      error.code = 'MAX_TOKENS'
      return error
    }
    default:
      return undefined
  }
}

/** Reject visual output and keep only text before synthesizing a user message. */
function summaryText(
  blocks: readonly ContentBlock[],
): Array<Extract<ContentBlock, { type: 'text' }>> {
  if (contentHasImage(blocks)) {
    throw new LlmError('compaction summary cannot contain image output', 'UNSUPPORTED_CONTENT')
  }
  return blocks.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
}
