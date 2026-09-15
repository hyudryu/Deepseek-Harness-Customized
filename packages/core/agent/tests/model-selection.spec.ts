import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import {
  agentEvents,
  installModelSelection,
  selectedRouteFor,
  type Agent,
  type ModelSelectionRef,
} from '../src/index.ts'
import { ReasoningEffortId, type LlmCallConfig } from '@deepseek-ai/dsh-llm'

describe('installModelSelection()', () => {
  it('snapshots prompt variables and request routing together, then disposes both listeners', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const selection: ModelSelectionRef = { current: undefined, assembled: undefined }
    const dispose = installModelSelection(ctx, selection)
    const agent = {} as Agent
    const seed: LlmCallConfig = { provider: 'seed', model: 'seed', temperature: 0.2 }
    const signal = new AbortController().signal

    expect((await ctx.systemPrompt.assemble()).variables).toEqual({})
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 0, signal }, () => Promise.resolve(seed),
    )).resolves.toBe(seed)

    selection.current = {
      provider: 'alpha',
      model: 'a1',
      reasoningEffort: ReasoningEffortId('high'),
    }
    expect((await ctx.systemPrompt.assemble()).variables).toMatchObject({ provider: 'alpha', model: 'a1' })
    selection.current = { provider: 'beta', model: 'b1' }
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 0, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual({
      provider: 'alpha',
      model: 'a1',
      reasoningEffort: ReasoningEffortId('high'),
      temperature: 0.2,
    })

    expect((await ctx.systemPrompt.assemble()).variables).toMatchObject({ provider: 'beta', model: 'b1' })
    const inherited: LlmCallConfig = {
      provider: 'alpha',
      model: 'a1',
      reasoningEffort: ReasoningEffortId('max'),
      temperature: 0.2,
    }
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve(inherited),
    )).resolves.toEqual({ provider: 'beta', model: 'b1', temperature: 0.2 })

    dispose()
    expect((await ctx.systemPrompt.assemble()).variables).toEqual({})
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 2, step: 0, signal }, () => Promise.resolve(seed),
    )).resolves.toBe(seed)
    await ctx.fiber.dispose()
  })
})

describe('selectedRouteFor()', () => {
  it('reports the assembled route, falls back to the pending one, and answers nothing otherwise', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const empty: ModelSelectionRef = { current: undefined, assembled: undefined }
    const disposeEmpty = installModelSelection(ctx, empty)
    expect(selectedRouteFor(ctx)).toBeUndefined()
    disposeEmpty()
    expect(selectedRouteFor(ctx)).toBeUndefined()

    const selection: ModelSelectionRef = {
      current: { provider: 'pending', model: 'p1' },
      assembled: undefined,
    }
    const dispose = installModelSelection(ctx, selection)
    // Detached: a consumer cannot mutate the entry point's live selection.
    expect(selectedRouteFor(ctx)).toEqual({ provider: 'pending', model: 'p1' })
    expect(selectedRouteFor(ctx)).not.toBe(selection.current)

    selection.assembled = { provider: 'assembled', model: 'a1' }
    expect(selectedRouteFor(ctx)).toEqual({ provider: 'assembled', model: 'a1' })

    dispose()
    expect(selectedRouteFor(ctx)).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('keeps a superseding install on the same scope when the earlier disposer runs', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const first: ModelSelectionRef = { current: { provider: 'first', model: 'm' }, assembled: undefined }
    const second: ModelSelectionRef = { current: { provider: 'second', model: 'm' }, assembled: undefined }
    const disposeFirst = installModelSelection(ctx, first)
    const disposeSecond = installModelSelection(ctx, second)

    disposeFirst()
    expect(selectedRouteFor(ctx)).toEqual({ provider: 'second', model: 'm' })
    disposeSecond()
    expect(selectedRouteFor(ctx)).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
