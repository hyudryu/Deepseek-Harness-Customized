/** Pure calendar and chart projections of the Host usage response. */

import type { UsageSummary } from '@deepseek-ai/dsh-api-usage-controller/types'
export type { UsageSummary } from '@deepseek-ai/dsh-api-usage-controller/types'

const DAY = 86_400_000

/** One provider-qualified model's contiguous daily chart values. */
interface ModelSeries {
  key: string
  name: string
  provider: string
  model: string
  values: number[]
  total: number
}

/** Return a UTC calendar date offset from an instant.
 * @param now - End date instant.
 * @param offset - Signed day offset.
 * @returns ISO date without a time component.
 */
export function dateAt(now: number, offset: number): string {
  return new Date(now + offset * DAY).toISOString().slice(0, 10)
}

/** Combine models into UTC daily totals.
 * @param summary - Recorded usage.
 * @returns Date-indexed totals.
 */
export function dailyTotals(summary: UsageSummary): Map<string, number> {
  const totals = new Map<string, number>()
  for (const row of summary.days) totals.set(row.date, (totals.get(row.date) ?? 0) + row.tokens)
  return totals
}

/** Compute historical streaks and the current streak, allowing today to remain unused.
 * @param totals - Daily token totals.
 * @param now - Current instant.
 * @returns Current and longest positive-usage streaks in days.
 */
export function streaks(totals: Map<string, number>, now: number): { current: number; longest: number } {
  const dates = [...totals].filter(([date, tokens]) => tokens > 0 && date <= dateAt(now, 0)).map(([date]) => date).sort()
  let longest = 0
  let run = 0
  let previous = ''
  for (const date of dates) {
    run = previous !== '' && dateAt(Date.parse(previous), 1) === date ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = date
  }
  return { current: previous === dateAt(now, 0) || previous === dateAt(now, -1) ? run : 0, longest }
}

/** Project a contiguous range with zero-filled, provider-qualified model series.
 * @param summary - Recorded usage.
 * @param now - Last day of the range.
 * @param length - Number of calendar days.
 * @returns Dates and descending-total model series.
 */
export function seriesFor(summary: UsageSummary, now: number, length: number): { dates: string[]; models: ModelSeries[] } {
  const dates = Array.from({ length }, (_, index) => dateAt(now, index - length + 1))
  const models = new Map<string, ModelSeries>()
  for (const row of summary.days) {
    const index = dates.indexOf(row.date)
    if (index < 0 || row.tokens <= 0) continue
    const key = JSON.stringify([row.provider, row.model])
    let model = models.get(key)
    if (!model) {
      model = { key, name: `${row.model} · ${row.provider}`, provider: row.provider, model: row.model, values: dates.map(() => 0), total: 0 }
      models.set(key, model)
    }
    model.values[index] = (model.values[index] ?? 0) + row.tokens
    model.total += row.tokens
  }
  return { dates, models: [...models.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key)) }
}
