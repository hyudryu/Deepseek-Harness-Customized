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

/** Project the full heatmap window in its selected aggregation mode.
 * @param totals - UTC daily token totals.
 * @param now - Last displayed date.
 * @param mode - Daily, displayed week, or cumulative window totals.
 * @returns One date and displayed value per heatmap cell.
 */
export function activityFor(totals: Map<string, number>, now: number, mode: 'daily' | 'weekly' | 'cumulative'): { date: string; value: number }[] {
  const dates = Array.from({ length: 364 }, (_, index) => dateAt(now, index - 363))
  let running = 0
  return dates.map((date, index) => {
    running += totals.get(date) ?? 0
    const value = mode === 'cumulative' ? running : mode === 'weekly'
      ? dates.slice(Math.floor(index / 7) * 7, Math.floor(index / 7) * 7 + 7).reduce((sum, day) => sum + (totals.get(day) ?? 0), 0)
      : totals.get(date) ?? 0
    return { date, value }
  })
}

/** Locate month transitions in a column-major seven-day heatmap.
 * @param dates - Contiguous UTC dates in display order.
 * @returns First visible date of each month and its one-based grid column.
 */
export function monthMarkers(dates: string[]): { date: string; column: number }[] {
  return dates.flatMap((date, index) => index === 0 || date.slice(0, 7) !== dates[index - 1]?.slice(0, 7)
    ? [{ date, column: Math.floor(index / 7) + 1 }] : [])
}

/** Assign model encodings without cycling through a finite color palette.
 * @param index - Model position in the sorted all-history identity list.
 * @returns Theme-relative hue and a distinct line dash pattern.
 */
export function modelEncoding(index: number): { color: string; dash: string } {
  return {
    color: `oklch(from var(--dsw-alias-link) l c calc(h + ${index * 137.50776405003785}))`,
    dash: index === 0 ? 'none' : `${index + 2} 2 1 2`,
  }
}
