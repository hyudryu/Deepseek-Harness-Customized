// @vitest-environment jsdom
/** User-visible loading, refresh, empty state, and range interactions. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UsageSection } from '../src/client/UsageSection.tsx'
import type { UsageProps } from '../src/client/UsageSection.tsx'
import type { UsageSummary } from '../src/client/data.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const empty: UsageSummary = { days: [], totalTokens: 0, peakDailyTokens: 0, longestSessionMs: 0, sessions: 0, missingUsageAttempts: 0 }
const t: UsageProps['t'] = key => en[key as keyof typeof en]
const props = (loadUsage: UsageProps['loadUsage']): UsageProps => ({ loadUsage, t, close: vi.fn() }) as UsageProps

it('renders empty usage and changes range without another request', async () => {
  const load = vi.fn().mockResolvedValue(empty)
  render(<UsageSection {...props(load)} />)
  expect(screen.getByRole('status').textContent).toBe(en.loading)
  await screen.findByText(en.empty)
  fireEvent.click(screen.getByRole('button', { name: en.thirty }))
  expect(screen.getByRole('button', { name: en.thirty }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: en.weekly }))
  expect(screen.getByRole('button', { name: en.weekly }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: en.cumulative }))
  expect(load).toHaveBeenCalledTimes(1)
})

it('supports retry after a failed initial query', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(empty)
  render(<UsageSection {...props(load)} />)
  expect((await screen.findByRole('alert')).textContent).toBe(en.error)
  fireEvent.click(screen.getByRole('button', { name: en.refresh }))
  await screen.findByText(en.empty)
  expect(screen.queryByRole('alert')).toBeNull()
})

it('renders provider-qualified models and preserves the data on refresh failure', async () => {
  const date = new Date().toISOString().slice(0, 10)
  const data = { ...empty, totalTokens: 120, missingUsageAttempts: 1, days: [{ date, provider: 'local', model: 'model', tokens: 120 }] }
  const load = vi.fn().mockResolvedValueOnce(data).mockRejectedValueOnce(new Error('offline'))
  render(<UsageSection {...props(load)} />)
  await waitFor(() =>{  expect(screen.getAllByText('model · local').length).toBeGreaterThan(0) })
  expect(screen.getByText(en.utc + ' ' + en.missing)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.refresh }))
  await screen.findByRole('alert')
  expect(screen.getAllByText('model · local').length).toBeGreaterThan(0)
})

it('labels usage whose recorded provider and model are unknown', async () => {
  const date = new Date().toISOString().slice(0, 10)
  const load = vi.fn().mockResolvedValue({ ...empty, totalTokens: 12, days: [{ date, provider: '', model: '', tokens: 12 }] })
  render(<UsageSection {...props(load)} />)
  await waitFor(() =>{  expect(screen.getAllByText(`${en.unknownModel} · ${en.unknownProvider}`).length).toBeGreaterThan(0) })
})


it('exposes exact full-year activity values through a disclosure in every selected mode', async () => {
  const date = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
  const next = new Date(Date.parse(date) + 86_400_000).toISOString().slice(0, 10)
  const load = vi.fn().mockResolvedValue({ ...empty, totalTokens: 1244, days: [
    { date, provider: 'local', model: 'old', tokens: 1234 },
    { date: next, provider: 'local', model: 'old', tokens: 10 },
  ] })
  render(<UsageSection {...props(load)} />)
  fireEvent.click(await screen.findByText(en.activityData))
  const table = screen.getByRole('table', { name: en.activityData })
  expect(within(table).getAllByRole('row')).toHaveLength(365)
  const row = within(table).getByRole('rowheader', { name: date }).parentElement!
  expect(within(row).getByRole('cell').textContent).toBe('1,234')
  fireEvent.click(screen.getByRole('button', { name: en.cumulative }))
  const nextRow = within(table).getByRole('rowheader', { name: next }).parentElement!
  expect(within(nextRow).getByRole('cell').textContent).toBe('1,244')
  expect(within(table).getByText(`${en.activity}: ${en.cumulative}`)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.weekly }))
  expect(within(table).getByText(`${en.activity}: ${en.weekly}`)).toBeTruthy()
  expect(load).toHaveBeenCalledTimes(1)
})
