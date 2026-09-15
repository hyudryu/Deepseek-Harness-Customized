/**
 * DeepSeek API peak schedule: window classification in UTC and the Pacific
 * rendering the badge presents, including both daylight-saving offsets.
 */
import { describe, expect, it } from 'vitest'
import {
  isPeakInstant, peakWindowsIn, PACIFIC_TIME_ZONE, SCHEDULE_TIME_ZONE,
} from '../src/client/peak-hours.ts'

/** A Monday inside the first window (01:00–04:00 UTC). */
const PEAK_MONDAY = '2026-09-14T01:30:00Z'
/** The same Monday inside the second window (06:00–10:00 UTC). */
const PEAK_MONDAY_LATE = '2026-09-14T06:00:00Z'

describe('isPeakInstant', () => {
  it('classifies both UTC windows on a weekday as peak', () => {
    expect(isPeakInstant(new Date(PEAK_MONDAY))).toBe(true)
    expect(isPeakInstant(new Date('2026-09-14T03:59:00Z'))).toBe(true)
    expect(isPeakInstant(new Date(PEAK_MONDAY_LATE))).toBe(true)
    expect(isPeakInstant(new Date('2026-09-14T09:59:00Z'))).toBe(true)
  })

  it('classifies the closing minute and the hours between the windows as off-peak', () => {
    expect(isPeakInstant(new Date('2026-09-14T00:59:00Z'))).toBe(false)
    expect(isPeakInstant(new Date('2026-09-14T04:00:00Z'))).toBe(false)
    expect(isPeakInstant(new Date('2026-09-14T05:59:00Z'))).toBe(false)
    expect(isPeakInstant(new Date('2026-09-14T10:00:00Z'))).toBe(false)
  })

  it('classifies every UTC weekend hour as off-peak', () => {
    // 2026-09-19 is a Saturday and 2026-09-20 a Sunday; both instants sit
    // inside a peak window's hours, so only the weekday rule can reject them.
    expect(isPeakInstant(new Date('2026-09-19T02:00:00Z'))).toBe(false)
    expect(isPeakInstant(new Date('2026-09-20T07:00:00Z'))).toBe(false)
  })
})

describe('peakWindowsIn', () => {
  it('draws a weekend presentation from the next billable day', () => {
    // Neither weekend day has a window of its own, so the hours shown are the
    // next Monday's: 2026-09-19 is a Saturday and 2026-09-20 its Sunday.
    const monday = [
      { start: '6:00 PM', end: '9:00 PM' },
      { start: '11:00 PM', end: '3:00 AM' },
    ]
    expect(peakWindowsIn(new Date('2026-09-19T12:00:00Z'), PACIFIC_TIME_ZONE, 'en')).toEqual(monday)
    expect(peakWindowsIn(new Date('2026-09-20T12:00:00Z'), PACIFIC_TIME_ZONE, 'en')).toEqual(monday)
  })

  it('renders the summer windows at their daylight-saving Pacific hours', () => {
    expect(peakWindowsIn(new Date(PEAK_MONDAY), PACIFIC_TIME_ZONE, 'en'))
      .toEqual([
        { start: '6:00 PM', end: '9:00 PM' },
        { start: '11:00 PM', end: '3:00 AM' },
      ])
  })

  it('renders the winter windows an hour earlier in Pacific time', () => {
    expect(peakWindowsIn(new Date('2026-01-14T12:00:00Z'), PACIFIC_TIME_ZONE, 'en'))
      .toEqual([
        { start: '5:00 PM', end: '8:00 PM' },
        { start: '10:00 PM', end: '2:00 AM' },
      ])
  })

  it('renders the same windows in UTC', () => {
    expect(peakWindowsIn(new Date(PEAK_MONDAY_LATE), SCHEDULE_TIME_ZONE, 'en'))
      .toEqual([
        { start: '1:00 AM', end: '4:00 AM' },
        { start: '6:00 AM', end: '10:00 AM' },
      ])
  })

  it('follows the locale clock convention, not a fixed 12-hour form', () => {
    expect(peakWindowsIn(new Date(PEAK_MONDAY), PACIFIC_TIME_ZONE, 'zh-CN'))
      .toEqual([
        { start: '18:00', end: '21:00' },
        { start: '23:00', end: '03:00' },
      ])
  })

  it('keeps the windows on the UTC day of the instant, whatever the local date', () => {
    // 00:30 UTC Monday is still Sunday in Pacific time; the schedule follows
    // the UTC day, so both windows are Monday's.
    expect(peakWindowsIn(new Date('2026-09-14T00:30:00Z'), SCHEDULE_TIME_ZONE, 'en'))
      .toEqual([
        { start: '1:00 AM', end: '4:00 AM' },
        { start: '6:00 AM', end: '10:00 AM' },
      ])
  })
})
