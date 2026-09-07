/** Calendar aggregation behavior independent of presentation. */
import { describe, expect, it } from 'vitest'
import { dailyTotals, seriesFor, streaks } from '../src/client/data.ts'
import type { UsageSummary } from '../src/client/data.ts'

const now = Date.parse('2026-09-07T13:00:00Z')
const summary: UsageSummary = {
  totalTokens: 70, peakDailyTokens: 40, longestSessionMs: 0, sessions: 2, missingUsageAttempts: 0,
  days: [
    { date: '2026-09-05', provider: 'first', model: 'shared', tokens: 10 },
    { date: '2026-09-06', provider: 'first', model: 'shared', tokens: 20 },
    { date: '2026-09-06', provider: 'second', model: 'shared', tokens: 20 },
    { date: '2026-08-01', provider: 'first', model: 'shared', tokens: 20 },
  ],
}

describe('usage calendar', () => {
  it('combines providers for daily totals and keeps yesterday current', () => {
    expect(dailyTotals(summary).get('2026-09-06')).toBe(40)
    expect(streaks(dailyTotals(summary), now)).toEqual({ current: 2, longest: 2 })
    expect(streaks(dailyTotals(summary), now + 86_400_000)).toEqual({ current: 0, longest: 2 })
    expect(streaks(new Map(), now)).toEqual({ current: 0, longest: 0 })
  })
  it('qualifies identical model names and zero-fills the exact selected dates', () => {
    const result = seriesFor(summary, now, 7)
    expect(result.dates).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07'])
    expect(result.models.map(model => [model.name, model.total])).toEqual([['shared · first', 30], ['shared · second', 20]])
    expect(result.models[0]?.values).toEqual([0, 0, 0, 0, 10, 20, 0])
  })
})
