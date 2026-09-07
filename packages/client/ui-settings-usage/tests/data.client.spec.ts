/** Calendar aggregation behavior independent of presentation. */
import { describe, expect, it } from 'vitest'
import { activityFor, dailyTotals, modelEncoding, monthMarkers, seriesFor, streaks } from '../src/client/data.ts'
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


it('projects every heatmap cell in the selected mode, including usage outside the trend range', () => {
  const totals = new Map([['2026-01-01', 1234], ['2026-01-02', 10]])
  const daily = activityFor(totals, now, 'daily')
  expect(daily).toHaveLength(364)
  expect(daily[0]?.date).toBe('2025-09-09')
  expect(daily.at(-1)?.date).toBe('2026-09-07')
  expect(daily.find(cell => cell.date === '2026-01-01')?.value).toBe(1234)
  expect(activityFor(totals, now, 'weekly').find(cell => cell.date === '2026-01-01')?.value).toBe(1244)
  expect(activityFor(totals, now, 'cumulative').at(-1)?.value).toBe(1244)
})

it.each(['2026-02-28', '2024-03-01', '2026-09-07', '2026-12-31'])('places each visible month at its real transition ending %s', (end) => {
  const dates = activityFor(new Map(), Date.parse(end), 'daily').map(cell => cell.date)
  const markers = monthMarkers(dates)
  expect(markers.map(marker => marker.date.slice(0, 7))).toEqual([...new Set(dates.map(date => date.slice(0, 7)))])
  for (const marker of markers) {
    expect(marker.column).toBe(Math.floor(dates.indexOf(marker.date) / 7) + 1)
    expect(marker.date === dates[0] || marker.date.endsWith('-01')).toBe(true)
  }
  expect(monthMarkers([])).toEqual([])
})

it('keeps encodings distinct beyond four models and for sparse historical positions', () => {
  const encodings = Array.from({ length: 20 }, (_, index) => modelEncoding(index))
  expect(new Set(encodings.map(value => value.color)).size).toBe(20)
  expect(new Set(encodings.map(value => value.dash)).size).toBe(20)
  expect(modelEncoding(0)).not.toEqual(modelEncoding(4))
  expect(modelEncoding(4)).not.toEqual(modelEncoding(8))
  expect(modelEncoding(4)).toEqual(encodings[4])
})
