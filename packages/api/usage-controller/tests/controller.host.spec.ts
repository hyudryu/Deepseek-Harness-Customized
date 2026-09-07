import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
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

it('reads only owned event suffixes and closes one handle before opening the next', async () => {
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
    expect(read).toHaveBeenCalledWith(12)
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
