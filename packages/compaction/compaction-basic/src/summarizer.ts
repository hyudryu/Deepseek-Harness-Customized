/**
 * Default one-shot summarization and durable checkpoint framing.
 *
 * @module @deepseek-ai/dsh-compaction-basic/summarizer
 */

import type { Context } from '@deepseek-ai/cordis'
import { contentHasImage, createUserMessage, BlockAssembler, LlmError } from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock, FinishReason, GenerateOptions, Message, TokenUsage, ToolSchema,
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

/** Heuristic tokens of the replayed non-message envelope under the shared estimator. */
function estimateHeaderTokens(
  input: SummarizationInput,
  withTools: boolean,
  meter: Pick<TokenMeter, 'estimateMessage'>,
): number {
  const system = input.system === undefined
    ? 0
    : meter.estimateMessage(createUserMessage({
      content: [{ type: 'text', text: input.system }],
      source: { kind: 'user' },
    }))
  if (!withTools || input.tools === undefined || input.tools.length === 0) return system
  // Tool schemas are priced as one structural JSON payload, matching
  // `estimateToolsTokens`' fixed-density treatment of the same bytes.
  return system + Math.ceil(JSON.stringify(input.tools).length / 4)
}

/**
 * Keep the newest region messages that fit one token budget, oldest dropped
 * first. The newest messages describe the work in progress, so they carry the
 * facts a resumed conversation most needs; the summarizer's own directive
 * already records that earlier material was condensed away.
 * @param messages - replayed region messages in surface order.
 * @param budget - heuristic tokens available to the region.
 * @param meter - pricing face of the token meter.
 * @returns the retained suffix of the region, possibly empty.
 */
function fitSummaryRegion(
  messages: readonly Message[],
  budget: number,
  meter: Pick<TokenMeter, 'estimateMessage'>,
): readonly Message[] {
  if (budget <= 0) return []
  let used = 0
  let keepFrom = messages.length
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- index is inside the array bounds
    used += meter.estimateMessage(messages[index]!)
    if (used > budget) break
    keepFrom = index
  }
  return messages.slice(keepFrom)
}

/**
 * Resolve the heuristic prompt budget for one summarization request from the
 * routed model's advertised capacity.
 *
 * A model that advertises no capacity cannot be budgeted, so the caller is
 * left unbounded and the provider decides — the same behavior as before
 * budgeting existed, and the only option that cannot invent a limit.
 * @param ctx - context providing the LLM service and token meter.
 * @param config - resolved backend configuration supplying the output reserve.
 * @param target - exact provider/model route the auxiliary call will use.
 * @param signal - optional cancellation forwarded to adapter-owned lookup.
 * @returns heuristic prompt-token budget, or `Number.POSITIVE_INFINITY`.
 */
async function summarizationBudget(
  ctx: Context,
  config: SummaryConfig,
  target: { provider: string; model: string },
  signal?: AbortSignal,
): Promise<number> {
  const info = await ctx.llm.resolveModelInfo(target.provider, target.model, signal)
  const contextWindow = info.context?.contextWindow
  if (contextWindow === undefined || !Number.isInteger(contextWindow) || contextWindow <= 0) {
    return Number.POSITIVE_INFINITY
  }
  // Reserve the response the checkpoint itself needs: the budget governs the
  // prompt, so the output allowance is subtracted before scaling.
  const promptCapacity = Math.max(0, contextWindow - config.maxTokens)
  return Math.floor(promptCapacity * SUMMARY_WINDOW_RATIO)
}

/**
 * Run the default cache-reusing `ctx.llm.stream()` summarization call: replay
 * the conversation prefix, then append the compaction instruction as the final
 * user message so the provider's warm prefix cache is reused.
 *
 * The request is budgeted to the routed model's advertised window, dropping
 * the oldest region messages and then the tool schemas when the replayed
 * prefix would not fit. Without that budget the auxiliary call is built from
 * the very context that overflowed, so an over-window session could never
 * compact: every attempt would be answered with the same provider rejection.
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
  const budget = await summarizationBudget(ctx, config, target, signal)
  const meter = ctx.tokenMeter
  const tools = input.tools
  // The compaction instruction forbids tool use, so the conversation's tool
  // schemas are replayed for cache alignment only. They are the first thing to
  // drop when the request must fit: pure overhead for a call that cannot call a
  // tool.
  const replayTools = tools !== undefined && tools.length > 0
    && estimateHeaderTokens(input, true, meter) <= budget
  const fixedTokens = estimateHeaderTokens(input, replayTools, meter)
    + meter.estimateMessage(instructionMessage())
  const messages: Message[] = [
    ...fitSummaryRegion(input.messages, budget - fixedTokens, meter),
    instructionMessage(),
  ]
  const options: GenerateOptions = {
    provider: target.provider,
    model: target.model,
    messages,
    ...input.system === undefined ? {} : { system: input.system },
    ...replayTools ? { tools: [...tools] } : {},
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
