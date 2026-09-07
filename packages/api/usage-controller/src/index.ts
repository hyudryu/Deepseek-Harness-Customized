/** Read-only historical usage Remote backed by local Session persistence. */
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { aggregateSessionUsage } from './aggregate.ts'
import type { UsageDay, UsageSummary } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    usageController: UsageController
  }
}

/** Host owner of the historical `usage` Remote namespace. */
export class UsageController extends TypertRemoteService {
  /**
   * Register the usage Remote.
   * @param ctx - Host context containing local persistence.
   */
  constructor(ctx: Context) {
    super(ctx, 'usageController', { namespace: 'usage' })
  }

  /**
   * Read persisted sessions sequentially without activating agents or taking write ownership.
   * @returns UTC daily model totals and all-time summary statistics.
   * @throws RemoteError when Session persistence is unavailable.
   * @throws If persistence list, open, read, or close fails; no partial summary is returned.
   */
  @Remote
  async summary(): Promise<UsageSummary> {
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) throw new RemoteError('usage/unavailable', 'Session persistence is not configured.', {})
    const days = new Map<string, UsageDay>()
    let longestSessionMs = 0
    let missingUsageAttempts = 0
    const sessions = await persistence.list()
    for (const session of sessions) {
      const handle = await persistence.open(session.header.id, 'read')
      try {
        const usage = aggregateSessionUsage(await handle.read(), handle.inheritedEventCount)
        longestSessionMs = Math.max(longestSessionMs, usage.activeMs)
        missingUsageAttempts += usage.missingUsageAttempts
        for (const row of usage.days) {
          const key = JSON.stringify([row.date, row.provider, row.model])
          days.set(key, { ...row, tokens: (days.get(key)?.tokens ?? 0) + row.tokens })
        }
      } finally {
        await handle.close()
      }
    }
    const rows = [...days.values()].sort((a, b) =>
      a.date.localeCompare(b.date) || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model))
    const daily = new Map<string, number>()
    let totalTokens = 0
    for (const row of rows) {
      totalTokens += row.tokens
      daily.set(row.date, (daily.get(row.date) ?? 0) + row.tokens)
    }
    let peakDailyTokens = 0
    for (const total of daily.values()) peakDailyTokens = Math.max(peakDailyTokens, total)
    return { days: rows, totalTokens, peakDailyTokens, longestSessionMs, sessions: sessions.length, missingUsageAttempts }
  }
}

export default UsageController
