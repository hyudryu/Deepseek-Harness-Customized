import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
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

/** One windowed route that records every request it was asked to serve. */
class WindowedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly contextWindow: number | undefined) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      ...this.contextWindow === undefined ? {} : { context: { contextWindow: this.contextWindow } },
    })
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

async function harness(contextWindow: number | undefined): Promise<{
  ctx: Context
  adapter: WindowedAdapter
  agent: Agent
}> {
  const ctx = new Context()
  const adapter = new WindowedAdapter(contextWindow)
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
})
