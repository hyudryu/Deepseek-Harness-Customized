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

import type { ModelProviderGroup } from '@deepseek-ai/dsh-api-session-controller/types'

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

/** Milliseconds in one UTC calendar day. */
const DAY_MS = 86_400_000

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
 * Whether the DeepSeek API peak schedule applies to one provider group.
 *
 * Both facts are required. The provider id selects the route the adapter owns,
 * and `officialEndpoint` is the adapter's own report that the route still
 * reaches the public API: a deployment can point `deepseek-official` at a proxy
 * or a local server, which keeps the provider id and its model ids while
 * replacing the rates this schedule describes.
 * @param group - the current selection's provider group, absent when the advisory catalog does not list it.
 * @returns whether the badge may present DeepSeek's schedule.
 */
export function showsPeakSchedule(
  group: Pick<ModelProviderGroup, 'id' | 'officialEndpoint'> | undefined,
): boolean {
  return group?.id === DEEPSEEK_API_PROVIDER && group.officialEndpoint === true
}

/**
 * The UTC day whose windows a presentation should render.
 *
 * Weekends are skipped rather than rendered: no window exists on a UTC
 * Saturday or Sunday, so anchoring there would print hours that never apply
 * that day. The fall-back transition is always a Sunday, and formatting bounds
 * across an offset change is what made a Sunday anchor print `6:00–9:00 PM` for
 * a Monday whose windows actually run `5:00–8:00 PM`. The next Monday is the
 * first day a window applies to and, with it, the smaller offset.
 * @param now - the instant whose presentation day is resolved.
 * @returns UTC midnight of the day the windows are drawn from.
 */
function billableDayStart(now: Date): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const weekday = now.getUTCDay()
  if (weekday === 6) return midnight + 2 * DAY_MS
  if (weekday === 0) return midnight + DAY_MS
  return midnight
}

/**
 * Render both peak windows as clock times in one zone.
 *
 * The windows are taken from the billable UTC calendar day containing `now`, so
 * they stay in schedule order and a window that has already closed today still
 * renders the hours it keeps. Formatting each bound as its own instant is what
 * makes a Pacific line follow daylight saving: the zone's offset is read for
 * the bound being drawn, so the summer and winter renderings differ by the
 * hour they actually differ by.
 * @param now - the instant whose presentation day supplies the windows.
 * @param timeZone - IANA zone to render the clock times in.
 * @param locale - BCP 47 tag deciding the clock convention (12- or 24-hour).
 * @returns both windows in schedule order.
 */
export function peakWindowsIn(now: Date, timeZone: string, locale: string): PeakWindowsText {
  const dayStart = billableDayStart(now)
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
