import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import LlmRuntime, {
  createMessage, createToolResultMessage, createUserMessage, LlmAdapter, ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions, LlmImageRequestPricing, LlmResolvedModelInfo, Message, StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { summarizeWithLlm } from '../src/summarizer.ts'

/**
 * The summarizer must build a request that fits the routed model's window.
 * Replaying the whole oversized prefix made the auxiliary call fail with the
 * same provider rejection that triggered recovery, so a session over its
 * window could never compact.
 */

/** Optional route facts one budget case needs beyond raw capacity. */
interface AdapterRoute {
  /** Advertised input modalities; omitted leaves image support unknown. */
  modalities?: NonNullable<LlmResolvedModelInfo['inputModalities']>
  /** Visual tokens charged per image occurrence; omitted declares no pricing. */
  visualTokensPerImage?: number
}

/** One windowed route that records every request it was asked to serve. */
class WindowedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(
    private readonly contextWindow: number | undefined,
    private readonly route: AdapterRoute = {},
  ) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      ...this.route.modalities === undefined ? {} : { inputModalities: [...this.route.modalities] },
      ...this.contextWindow === undefined ? {} : { context: { contextWindow: this.contextWindow } },
    })
  }

  override imageRequestPricing(): LlmImageRequestPricing | undefined {
    const visualTokens = this.route.visualTokensPerImage
    if (visualTokens === undefined) return undefined
    return {
      priceImages: images => images.map(() => ({ visualTokens, text: '' })),
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'CHECKPOINT' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Prompt tokens of one request at the token meter's fixed-density estimate. */
function requestTokens(options: GenerateOptions): number {
  const system = options.system ?? ''
  const tools = JSON.stringify(options.tools ?? [])
  const messages = JSON.stringify(options.messages)
  return Math.ceil((system.length + tools.length + messages.length) / 4)
}

async function harness(contextWindow: number | undefined, route: AdapterRoute = {}): Promise<{
  ctx: Context
  adapter: WindowedAdapter
  agent: Agent
}> {
  const ctx = new Context()
  const adapter = new WindowedAdapter(contextWindow, route)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(TokenMeter)
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = {
    session: ctx.sessions.create(),
    options: { provider: 'mock', model: 'mock' },
  } as unknown as Agent
  return { ctx, adapter, agent }
}

/** One user message whose text is long enough to matter at the budget scale. */
function region(size: number): { content: [{ type: 'text'; text: string }]; source: { kind: 'user' } } {
  return {
    content: [{ type: 'text', text: 'x'.repeat(size) }],
    source: { kind: 'user' },
  }
}

describe('summarizeWithLlm request budgeting', () => {
  it('drops the oldest region messages so the auxiliary call fits the window', async () => {
    const { ctx, adapter, agent } = await harness(4_000)
    // Region messages far larger than the whole prompt budget: only the
    // newest can survive, and the older ones must be dropped.
    const input = {
      system: 'a system prompt',
      messages: [
        createUserMessage(region(40_000)),
        createUserMessage(region(40_000)),
        createUserMessage(region(100)),
      ],
    }

    await summarizeWithLlm(ctx, { summarizationProvider: '', summarizationModel: '', maxTokens: 64 }, input, agent)

    const request = adapter.requests[0]!
    // The request fits the advertised window...
    expect(requestTokens(request)).toBeLessThanOrEqual(4_000)
    // ...by dropping the oldest messages and keeping the newest, plus the
    // trailing instruction.
    expect(request.messages).toHaveLength(2)
    expect(JSON.stringify(request.messages[0])).toContain('x'.repeat(100))
    expect(JSON.stringify(request.messages)).not.toContain('x'.repeat(40_000))
  })

  it('drops the tool schemas before it drops the conversation', async () => {
    const { ctx, adapter, agent } = await harness(4_000)
    const input = {
      system: 'a system prompt',
      // Larger than the whole prompt budget on its own, so the schemas cannot
      // be replayed without displacing the conversation entirely.
      tools: [{ name: 'work', description: 'does work', parameters: { pad: 'y'.repeat(40_000) } }],
      messages: [createUserMessage(region(100))],
    }

    await summarizeWithLlm(ctx, { summarizationProvider: '', summarizationModel: '', maxTokens: 64 }, input, agent)

    const request = adapter.requests[0]!
    expect(requestTokens(request)).toBeLessThanOrEqual(4_000)
    // The conversation message survived; the pure-overhead schemas did not.
    expect(request.tools).toBeUndefined()
    expect(request.messages).toHaveLength(2)
  })

  it('keeps the tool schemas when the whole request already fits', async () => {
    const { ctx, adapter, agent } = await harness(1_000_000)
    const input = {
      system: 'a system prompt',
      tools: [{ name: 'work', description: 'does work', parameters: {} }],
      messages: [createUserMessage(region(100))],
    }

    await summarizeWithLlm(ctx, { summarizationProvider: '', summarizationModel: '', maxTokens: 64 }, input, agent)

    // Cache alignment is the reason tools are replayed at all, so they stay
    // whenever the budget does not force them out.
    expect(adapter.requests[0]!.tools).toHaveLength(1)
  })

  it('leaves the request unbounded when the route advertises no capacity', async () => {
    const { ctx, adapter, agent } = await harness(undefined)
    const input = {
      system: 'a system prompt',
      messages: [createUserMessage(region(40_000)), createUserMessage(region(40_000))],
    }

    await summarizeWithLlm(ctx, { summarizationProvider: '', summarizationModel: '', maxTokens: 64 }, input, agent)

    // An unadvertised window cannot be budgeted against; inventing a limit
    // would silently truncate a conversation the provider would have accepted.
    expect(adapter.requests[0]!.messages).toHaveLength(3)
  })

  it('keeps the conversation when schemas fit only by displacing it', async () => {
    // The schemas fit the whole prompt budget on their own. Keeping them would
    // leave the region empty, so the checkpoint would describe nothing while
    // the work in progress was dropped for pure overhead.
    const { ctx, adapter, agent } = await harness(4_000)
    const input = {
      system: 'a system prompt',
      tools: [{ name: 'work', description: 'does work', parameters: { pad: 'y'.repeat(10_000) } }],
      messages: [createUserMessage(region(2_000)), createUserMessage(region(2_000))],
    }

    await summarizeWithLlm(ctx, { summarizationProvider: '', summarizationModel: '', maxTokens: 64 }, input, agent)

    const request = adapter.requests[0]!
    expect(request.tools).toBeUndefined()
    // The conversation survived instead, so the summary has something to read.
    expect(request.messages.length).toBeGreaterThan(1)
  })

  it('never starts the retained region at a tool result whose call was dropped', async () => {
    // Trimming at an arbitrary index would send a `role: 'tool'` entry with no
    // matching call, which providers reject — leaving recovery stuck. The
    // window admits the small result but not the large call that precedes it,
    // so the naive cut lands on the orphaned result and must move forward.
    const { ctx, adapter, agent } = await harness(4_000)
    const callId = ToolCallId('call-1')
    const call: Message = createMessage({
      role: 'assistant',
      content: [
        { type: 'text', text: 'c'.repeat(20_000) },
        { type: 'tool-call', id: callId, name: 'read', arguments: '{}' },
      ],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    })
    const result: Message = createToolResultMessage({
      callId,
      content: [{ type: 'text', text: 'r'.repeat(20) }],
      isError: false,
    })
    const input = { system: 'a system prompt', messages: [call, result] }

    await summarizeWithLlm(ctx, { summarizationProvider: '', summarizationModel: '', maxTokens: 64 }, input, agent)

    const request = adapter.requests[0]!
    // The result fits the budget on its own, but retaining it would orphan the
    // call, so the whole pair is dropped rather than the call alone.
    expect(JSON.stringify(request.messages)).not.toContain('"tool-result"')
    expect(requestTokens(request)).toBeLessThanOrEqual(4_000)
  })

  it('charges the routed visual tokens for a retained image', async () => {
    // The fixed text estimator prices an image block's structural JSON, orders
    // of magnitude below what a provider bills, so an image-heavy region could
    // be retained on a price that understates the request.
    const padded = createUserMessage({
      content: [{ type: 'text', text: 'x'.repeat(3_000) }],
      source: { kind: 'user' },
    })
    const image: Message = createUserMessage({
      content: [{
        type: 'image',
        attachment: {
          attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
          mediaType: 'image/png',
          bytes: 1,
          width: 1,
          height: 1,
        },
      }],
      source: { kind: 'user' },
    })
    const input = { system: 'a system prompt', messages: [padded, image] }

    // 2,000 visual tokens make the image, not the padded message, the expensive
    // unit, so the image is the one the budget cannot afford.
    const { ctx, adapter, agent } = await harness(2_500, { modalities: ['text', 'image'], visualTokensPerImage: 2_000 })
    await summarizeWithLlm(ctx, { summarizationProvider: '', summarizationModel: '', maxTokens: 64 }, input, agent)
    expect(JSON.stringify(adapter.requests[0]!.messages)).not.toContain('"type":"image"')

    // With the same window but no image, the padded message is affordable.
    const textOnly = await harness(2_500, { modalities: ['text', 'image'], visualTokensPerImage: 2_000 })
    await summarizeWithLlm(
      textOnly.ctx,
      { summarizationProvider: '', summarizationModel: '', maxTokens: 64 },
      { system: 'a system prompt', messages: [padded] },
      textOnly.agent,
    )
    expect(JSON.stringify(textOnly.adapter.requests[0]!.messages)).toContain('x'.repeat(3_000))
  })

  it('drops an image the routed model cannot accept instead of failing the call', async () => {
    // A text-only route rejects the whole request if any image is replayed, so
    // retaining one would fail the summarization the recovery depends on.
    const image: Message = createUserMessage({
      content: [
        { type: 'text', text: 'keep me' },
        {
          type: 'image',
          attachment: {
            attachmentId: AttachmentId(`sha256:${'b'.repeat(64)}`),
            mediaType: 'image/png',
            bytes: 1,
            width: 1,
            height: 1,
          },
        },
      ],
      source: { kind: 'user' },
    })
    const { ctx, adapter, agent } = await harness(1_000_000, { modalities: ['text'] })

    await summarizeWithLlm(
      ctx,
      { summarizationProvider: '', summarizationModel: '', maxTokens: 64 },
      { system: 'a system prompt', messages: [image] },
      agent,
    )

    expect(JSON.stringify(adapter.requests[0]!.messages)).not.toContain('"type":"image"')
  })
})
