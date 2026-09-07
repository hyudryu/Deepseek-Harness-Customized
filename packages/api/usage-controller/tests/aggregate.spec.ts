import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { RetryId } from '@deepseek-ai/dsh-llm-retry'
import SessionStore, { type Session } from '@deepseek-ai/dsh-session'
import { aggregateSessionUsage } from '../src/aggregate.ts'

afterEach(() => { vi.useRealTimers() })

async function session(): Promise<Session> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  return ctx.sessions.create()
}

function attempt(log: Session, inputTokens: number, outputTokens: number): void {
  log.append('assistant/attempt', { turn: 1, step: 1, stream: [{ type: 'chunk', time: 0, chunk: { type: 'usage', usage: { inputTokens, outputTokens } } }] })
}

describe('historical usage accounting', () => {
  it('replaces an attempt settlement with its final message and includes disjoint cache buckets', async () => {
    const log = await session()
    attempt(log, 10, 2)
    const usage = { inputTokens: 10, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 7, reasoningTokens: 2 }
    log.append('assistant/message', {
      turn: 1, step: 1, stream: [], usage,
      message: createMessage({ role: 'assistant', content: [], source: { kind: 'model', provider: 'test', model: 'first' } }),
    }, { surfaceOp: 'append' })
    expect(aggregateSessionUsage(log.snapshotEvents()).days).toEqual([
      { date: new Date().toISOString().slice(0, 10), provider: 'test', model: 'first', tokens: 25 },
    ])
  })

  it('counts billed retries separately and leaves missing usage explicit', async () => {
    const log = await session()
    log.append('request/context', { provider: 'test', model: 'retry' })
    attempt(log, 10, 2)
    log.append('llm/retry-started', { retryId: RetryId('usage-retry'), turn: 1, step: 1, retry: 1 })
    attempt(log, 20, 4)
    log.append('step/start', { turn: 1, step: 2 })
    log.append('assistant/attempt', { turn: 1, step: 2, stream: [] })
    const usage = aggregateSessionUsage(log.snapshotEvents())
    expect(usage.days[0]).toMatchObject({ provider: 'test', model: 'retry', tokens: 36 })
    expect(usage.missingUsageAttempts).toBe(1)
  })

  it('sums completed active turns without counting idle gaps or open turns', async () => {
    const log = await session()
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    log.append('turn/start', { turn: 1 })
    vi.setSystemTime(4000)
    log.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    vi.setSystemTime(100000)
    log.append('turn/start', { turn: 2 })
    vi.setSystemTime(102000)
    log.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    log.append('turn/start', { turn: 3 })
    expect(aggregateSessionUsage(log.snapshotEvents()).activeMs).toBe(5000)
  })

  it('uses UTC settlement dates and excludes crash recovery gaps', async () => {
    const log = await session()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T23:59:00Z'))
    log.append('turn/start', { turn: 1 })
    attempt(log, 2, 3)
    log.append('llm/retry-started', { retryId: RetryId('midnight-retry'), turn: 1, step: 1, retry: 1 })
    vi.setSystemTime(new Date('2026-09-02T00:01:00Z'))
    attempt(log, 7, 11)
    log.append('turn/end', { turn: 1, reason: { kind: 'interrupted' } })
    const usage = aggregateSessionUsage(log.snapshotEvents())
    expect(usage.days.map(({ date, tokens }) => ({ date, tokens }))).toEqual([
      { date: '2026-09-01', tokens: 5 }, { date: '2026-09-02', tokens: 18 },
    ])
    expect(usage.activeMs).toBe(0)
  })
})
