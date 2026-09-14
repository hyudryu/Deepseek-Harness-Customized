/**
 * DeepSeek API peak-hour schedule for the composer's peak badge: the two
 * weekday windows the platform bills at peak rates, classified against the
 * browser's clock in UTC, and rendered as clock times in a display zone.
 *
 * The windows are a published provider fact, not a deployment choice, so they
 * are fixed here rather than a plugin Config field. The Pacific and UTC
 * presentations the badge shows are the same two windows formatted through one
 * `Intl.DateTimeFormat` path, so the two lines can never disagree about which
 * window they name.
 *
 * @module dsh-client-ui-model-selection/peak-hours
 */

/**
 * Provider id of the DeepSeek API adapter (`@deepseek-ai/dsh-llm-deepseek`).
 *
 * Peak-hour rates are an API-side schedule, so the badge exists only on this
 * route: an aggregator or local route that happens to serve a DeepSeek model
 * bills on its own terms and must not borrow this schedule.
 */
export const DEEPSEEK_API_PROVIDER = 'deepseek-official'

/** Zone the schedule is classified in; the windows are a UTC fact. */
export const SCHEDULE_TIME_ZONE = 'UTC'

/** Zone the badge presents the schedule in. */
export const PACIFIC_TIME_ZONE = 'America/Los_Angeles'

/** One peak window as minutes from midnight, half-open at `endMinutes`. */
interface PeakWindow {
  readonly startMinutes: number
  readonly endMinutes: number
}

/** DeepSeek API peak windows in UTC: 01:00–04:00 and 06:00–10:00. */
const PEAK_WINDOWS = [
  { startMinutes: 1 * 60, endMinutes: 4 * 60 },
  { startMinutes: 6 * 60, endMinutes: 10 * 60 },
] as const satisfies readonly PeakWindow[]

/** One window's clock bounds, rendered in the zone it was asked for. */
export interface PeakWindowText {
  /** Clock time the window opens. */
  readonly start: string
  /** Clock time the window closes. */
  readonly end: string
}

/** Both windows' clock bounds, in schedule order. */
export type PeakWindowsText = readonly [PeakWindowText, PeakWindowText]

/**
 * Classify an instant against the DeepSeek API peak schedule.
 *
 * Peak is a UTC weekday inside a peak window; every other instant is
 * off-peak, including all of Saturday and Sunday UTC. A window's closing
 * minute is off-peak, so 04:00 and 10:00 UTC are the first off-peak minutes.
 * @param now - the instant to classify.
 * @returns whether the instant bills at peak rates.
 */
export function isPeakInstant(now: Date): boolean {
  const weekday = now.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes()
  return PEAK_WINDOWS.some(window => minutes >= window.startMinutes && minutes < window.endMinutes)
}

/**
 * Render both peak windows as clock times in one zone.
 *
 * The windows are taken from the UTC calendar day containing `now`, so they
 * stay in schedule order and a window that has already closed today still
 * renders the hours it keeps. Formatting each bound as its own instant is what
 * makes a Pacific line follow daylight saving: the zone's offset is read for
 * the bound being drawn, so the summer and winter renderings differ by the
 * hour they actually differ by.
 * @param now - the instant whose UTC day supplies the windows.
 * @param timeZone - IANA zone to render the clock times in.
 * @param locale - BCP 47 tag deciding the clock convention (12- or 24-hour).
 * @returns both windows in schedule order.
 */
export function peakWindowsIn(now: Date, timeZone: string, locale: string): PeakWindowsText {
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const clock = new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' })
  // A 24-hour locale reads `numeric` as a dropped leading zero, which would
  // spell the second window "23:00–3:00"; pad it there. A 12-hour locale keeps
  // `numeric`, whose zero padding would spell "06:00 PM".
  const read = clock.resolvedOptions().hour12 === true
    ? clock
    : new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit' })
  const text = ({ startMinutes, endMinutes }: PeakWindow): PeakWindowText => ({
    start: read.format(new Date(dayStart + startMinutes * 60_000)),
    end: read.format(new Date(dayStart + endMinutes * 60_000)),
  })
  const [first, second] = PEAK_WINDOWS
  return [text(first), text(second)]
}
