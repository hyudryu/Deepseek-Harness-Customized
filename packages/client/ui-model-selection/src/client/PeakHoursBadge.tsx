/**
 * Composer peak badge: the lit/shaded chip beside the model seat that says
 * whether the DeepSeek API is billing peak rates right now, with the peak
 * windows themselves in its tooltip.
 *
 * The badge carries state only — a dot and a word — because the composer's
 * trailing row is short of room, and the schedule it reports is two clock
 * spans that would crowd the model name they sit beside. It re-reads the clock
 * on its own timer, so a session left open crosses a window boundary without
 * needing a model switch or a reload.
 */

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  isPeakInstant, peakWindowsIn, PACIFIC_TIME_ZONE, SCHEDULE_TIME_ZONE, type PeakWindowText,
} from './peak-hours.ts'
import css from './PeakHoursBadge.module.css'

/**
 * Clock refresh interval, in milliseconds.
 *
 * Both peak windows open and close on the minute, so a read within a minute of
 * a boundary keeps the badge honest; 30s bounds how late a flip can be without
 * waking the composer every second. A design constant of this badge's own
 * staleness, fixed here rather than a plugin Config field.
 */
const TICK_MS = 30_000

/** The badge's props: the standard locale seat of the model namespace. */
export type PeakHoursBadgeProps = PropsLocale<'model'>

/**
 * Track the current instant on {@link TICK_MS}.
 * @returns the instant of the latest tick.
 */
function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => { setNow(new Date()) }, TICK_MS)
    return () => { clearInterval(timer) }
  }, [])
  return now
}

/**
 * Render the composer's DeepSeek API peak badge.
 * @param props - the standard locale seat of the model namespace.
 * @returns the lit or shaded badge chip.
 */
export function PeakHoursBadge({ t }: PeakHoursBadgeProps) {
  const now = useClock()
  const peak = isPeakInstant(now)
  const locale = t('language')
  const windows = (timeZone: string): string => {
    const [first, second] = peakWindowsIn(now, timeZone, locale)
    const span = ({ start, end }: PeakWindowText): string => t('peak.window', { start, end })
    return t('peak.windows', { first: span(first), second: span(second) })
  }
  const schedule = [
    t('peak.tooltip.title'),
    t('peak.tooltip.pacific', { windows: windows(PACIFIC_TIME_ZONE) }),
    t('peak.tooltip.utc', { windows: windows(SCHEDULE_TIME_ZONE) }),
  ].join('\n')

  return (
    <Tooltip label={schedule} side="top" delayMs={200}>
      <span
        className={clsx(css.badge, peak ? css.peak : css.offPeak)}
        tabIndex={0}
      >
        <span className={css.dot} aria-hidden />
        {t(peak ? 'peak.state.peak' : 'peak.state.offPeak')}
      </span>
    </Tooltip>
  )
}
