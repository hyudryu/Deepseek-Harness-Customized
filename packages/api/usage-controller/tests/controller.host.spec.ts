import { expect, it, vi } from 'vitest'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import UsageController from '../src/index.ts'

it('reports unavailable persistence instead of a zero usage summary', async () => {
  const ctx = new Context()
  await ctx.plugin(UsageController)
  try {
    await expect(ctx.usageController.summary()).rejects.toMatchObject({ code: 'usage/unavailable' })
  } finally {
    await ctx.fiber.dispose()
  }
})

it('reads the full log for inherited routing and closes one handle before opening the next', async () => {
  const ctx = new Context()
  const operations: string[] = []
  const read = vi.fn(async () => [])
  const open = vi.fn(async (id: string, access: string) => {
    operations.push(`open:${id}:${access}`)
    return { inheritedEventCount: SessionLogOffset(12), read, close: async () => { operations.push(`close:${id}`) } }
  })
  ctx.provide('sessionPersistence', {
    list: async () => [{ header: { id: SessionId('first') } }, { header: { id: SessionId('second') } }], open,
  })
  await ctx.plugin(UsageController)
  try {
    await expect(ctx.usageController.summary()).resolves.toEqual({
      days: [], sessions: 2, totalTokens: 0, peakDailyTokens: 0, longestSessionMs: 0, missingUsageAttempts: 0,
    })
    expect(read).toHaveBeenCalledWith()
    expect(operations).toEqual(['open:first:read', 'close:first', 'open:second:read', 'close:second'])
  } finally {
    await ctx.fiber.dispose()
  }
})

it('closes a failed read and refuses to report partial totals', async () => {
  const ctx = new Context()
  const close = vi.fn(async () => {})
  ctx.provide('sessionPersistence', {
    list: async () => [{ header: { id: SessionId('failed') } }],
    open: async () => ({ inheritedEventCount: SessionLogOffset(0), read: async () => { throw new Error('broken log') }, close }),
  })
  await ctx.plugin(UsageController)
  try {
    await expect(ctx.usageController.summary()).rejects.toThrow('broken log')
    expect(close).toHaveBeenCalledOnce()
  } finally {
    await ctx.fiber.dispose()
  }
})

it('attributes a fork attempt to inherited routing without counting the parent usage twice', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const log = ctx.sessions.create()
  log.append('request/context', { provider: 'test', model: 'inherited' })
  log.append('assistant/attempt', { turn: 1, step: 1, stream: [
    { type: 'chunk', time: 0, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 200 } } },
  ] })
  const inheritedEventCount = SessionLogOffset(log.snapshotEvents().length)
  const parentEvents = log.snapshotEvents()
  log.append('assistant/attempt', { turn: 2, step: 1, stream: [
    { type: 'chunk', time: 0, chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 20 } } },
  ] })
  ctx.provide('sessionPersistence', {
    list: async () => [{ header: { id: SessionId('parent') } }, { header: { id: SessionId('fork') } }],
    open: async (id: string) => ({
      inheritedEventCount: id === 'parent' ? SessionLogOffset(0) : inheritedEventCount,
      read: async () => id === 'parent' ? parentEvents : log.snapshotEvents(),
      close: async () => {},
    }),
  })
  await ctx.plugin(UsageController)
  try {
    const result = await ctx.usageController.summary()
    expect(result.totalTokens).toBe(330)
    expect(result.days).toEqual([{ date: new Date().toISOString().slice(0, 10), provider: 'test', model: 'inherited', tokens: 330 }])
  } finally {
    await ctx.fiber.dispose()
  }
})

it.each(['list', 'open', 'close'] as const)('rejects %s failures without returning a partial summary', async (operation) => {
  const ctx = new Context()
  const fail = (): never => { throw new Error(`${operation} failed`) }
  ctx.provide('sessionPersistence', {
    list: async () => operation === 'list' ? fail() : [{ header: { id: SessionId('failed') } }],
    open: async () => operation === 'open' ? fail() : {
      inheritedEventCount: SessionLogOffset(0), read: async () => [], close: async () => { fail() },
    },
  })
  await ctx.plugin(UsageController)
  try {
    await expect(ctx.usageController.summary()).rejects.toThrow(`${operation} failed`)
  } finally {
    await ctx.fiber.dispose()
  }
})

it('orders rows by UTC date, provider, and model and combines daily model totals for the peak', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const log = ctx.sessions.create()
  for (const [provider, model] of [['z', 'z'], ['a', 'z'], ['a', 'a'], ['b', 'b']] as const) {
    log.append('assistant/message', {
      turn: 1, step: 1, stream: [], usage: { inputTokens: 10, outputTokens: 2 },
      message: createMessage({ role: 'assistant', content: [], source: { kind: 'model', provider, model } }),
    }, { surfaceOp: 'append' })
  }
  const events = log.snapshotEvents().map((event, index) => ({ ...event, time: Date.parse(index === 3 ? '2026-09-02T00:00:00Z' : '2026-09-01T00:00:00Z') }))
  ctx.provide('sessionPersistence', {
    list: async () => [{ header: { id: log.id } }],
    open: async () => ({ inheritedEventCount: SessionLogOffset(0), read: async () => events, close: async () => {} }),
  })
  await ctx.plugin(UsageController)
  try {
    const result = await ctx.usageController.summary()
    expect(result.days.map(({ date, provider, model }) => [date, provider, model])).toEqual([
      ['2026-09-01', 'a', 'a'], ['2026-09-01', 'a', 'z'], ['2026-09-01', 'z', 'z'], ['2026-09-02', 'b', 'b'],
    ])
    expect(result.totalTokens).toBe(48)
    expect(result.peakDailyTokens).toBe(36)
  } finally {
    await ctx.fiber.dispose()
  }
})
