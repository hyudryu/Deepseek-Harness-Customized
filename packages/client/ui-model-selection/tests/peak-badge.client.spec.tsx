// @vitest-environment jsdom
/**
 * Peak badge behavior: which state it shows, the schedule it reveals, and its
 * own clock crossing a window boundary without a re-render from above.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PeakHoursBadge } from '../src/client/PeakHoursBadge.tsx'
import { en, zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'

/** Translate from the zh dictionary the component's seat resolves against. */
const t: Parameters<typeof PeakHoursBadge>[0]['t'] = (key, params) => {
  const template = (zh as Record<string, string>)[key]
    ?? (commonZh as Record<string, string>)[key]
    ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

/** Translate from the en dictionary, for the schedule lines' own spelling. */
const tEn: typeof t = (key, params) => {
  const template = (en as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** Reveal the badge's tooltip, which appears after its hover delay. */
function hover(badge: HTMLElement): string {
  fireEvent.mouseEnter(badge)
  act(() => { vi.advanceTimersByTime(200) })
  return screen.getByRole('tooltip').textContent ?? ''
}

describe('PeakHoursBadge', () => {
  it('lights up inside a peak window and names the schedule in Pacific and UTC time', () => {
    // Monday 01:30 UTC: inside the first window, and 6:30 PM Sunday in Pacific.
    vi.setSystemTime(new Date('2026-09-14T01:30:00Z'))
    render(<PeakHoursBadge t={t} />)

    const badge = screen.getByText('高峰')
    expect(hover(badge)).toBe([
      'DeepSeek API 高峰时段',
      '太平洋时间（周日至周四，第二个时段至次日凌晨）：18:00–21:00、23:00–03:00',
      'UTC 工作日（周一至周五）：01:00–04:00、06:00–10:00',
    ].join('\n'))
  })

  it('opens the schedule from the keyboard, not only from the pointer', () => {
    vi.setSystemTime(new Date('2026-09-14T01:30:00Z'))
    render(<PeakHoursBadge t={t} />)

    const badge = screen.getByText('高峰')
    expect(badge.tabIndex).toBe(0)
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.focus(badge)
    expect(screen.getByRole('tooltip').textContent).toContain('UTC 工作日（周一至周五）：01:00–04:00、06:00–10:00')
  })

  it('shades the badge outside a peak window', () => {
    // Monday 12:00 UTC: between the windows and after both.
    vi.setSystemTime(new Date('2026-09-14T12:00:00Z'))
    render(<PeakHoursBadge t={t} />)

    expect(screen.getByText('非高峰')).toBeTruthy()
    expect(screen.queryByText('高峰')).toBeNull()
  })

  it('spells the schedule in the reader\'s clock convention', () => {
    // Sunday 02:00 UTC is off-peak; the winter windows are 5–8 PM and 10 PM–2 AM.
    vi.setSystemTime(new Date('2026-01-18T02:00:00Z'))
    render(<PeakHoursBadge t={tEn} />)

    expect(hover(screen.getByText('Off-peak'))).toBe([
      'DeepSeek API peak hours',
      'Pacific time (Sunday–Thursday, second window ending the next morning): 5:00 PM–8:00 PM, 10:00 PM–2:00 AM',
      'UTC weekdays (Monday–Friday): 1:00 AM–4:00 AM, 6:00 AM–10:00 AM',
    ].join('\n'))
  })

  it('draws a weekend tooltip from the next billable day, across the fall-back transition', () => {
    // Sunday 2026-11-01 12:00 UTC is off-peak and past that morning's fall-back,
    // so the day itself has no window and mixes both offsets. The next Monday
    // runs the winter windows, which is what the tooltip must report.
    vi.setSystemTime(new Date('2026-11-01T12:00:00Z'))
    render(<PeakHoursBadge t={tEn} />)

    expect(hover(screen.getByText('Off-peak'))).toContain('Pacific time (Sunday–Thursday, second window ending the next morning): 5:00 PM–8:00 PM, 10:00 PM–2:00 AM')
  })

  it('flips to peak on its own clock when a window opens', () => {
    vi.setSystemTime(new Date('2026-09-14T00:59:30Z'))
    render(<PeakHoursBadge t={t} />)
    expect(screen.getByText('非高峰')).toBeTruthy()

    act(() => { vi.advanceTimersByTime(30_000) })
    expect(screen.getByText('高峰')).toBeTruthy()
    expect(screen.queryByText('非高峰')).toBeNull()
  })
})
