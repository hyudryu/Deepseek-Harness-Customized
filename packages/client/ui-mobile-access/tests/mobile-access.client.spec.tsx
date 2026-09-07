// @vitest-environment jsdom
/** Pairing controls publish only confirmed state and hide revoked links. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { MobileAccess, type MobileAccessProps, type MobileAccessStatus } from '../src/client/MobileAccess.tsx'
import { en } from '../src/client/locales.ts'
afterEach(cleanup)
function mount(update = vi.fn(async (enabled: boolean) => ({ enabled, url: enabled ? 'http://100.64.0.1:3081/?token=test' : null }))) {
  const qr = vi.fn(async () => 'data:image/png;base64,test')
  const props = { t: makeTranslate(en), read: async () => ({ enabled: false, url: null }), update, qr } as unknown as MobileAccessProps
  render(<MobileAccess {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Mobile access' }))
  return { update, qr }
}
it('opens off, generates an authenticated QR after enabling, and removes it on disable', async () => {
  const b = mount()
  const toggle = await screen.findByRole<HTMLInputElement>('switch')
  expect(toggle.checked).toBe(false)
  expect(screen.getByRole('dialog').textContent).toMatchInlineSnapshot('"Mobile accessAllow mobile accessMobile access is off. Turning it on creates a private Tailscale link.Mobile access turns off when Harness restarts."')
  fireEvent.click(toggle)
  expect((await screen.findByRole('img')).getAttribute('alt')).toBe('Scan to open Harness on your phone')
  expect(b.qr).toHaveBeenCalledWith('http://100.64.0.1:3081/?token=test')
  expect(screen.getByRole('link').getAttribute('href')).toBe('http://100.64.0.1:3081/?token=test')
  expect(screen.getByRole('dialog').textContent).not.toContain('token=')
  fireEvent.click(toggle)
  await waitFor(() => { expect(toggle.checked).toBe(false) })
  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.queryByRole('link')).toBeNull()
})
it('keeps the switch off while activation is pending and reports activation failure', async () => {
  let reject!: (reason: Error) => void
  const update = vi.fn(() => new Promise<MobileAccessStatus>((_, no) => { reject = no }))
  mount(update)
  const toggle = await screen.findByRole<HTMLInputElement>('switch')
  fireEvent.click(toggle)
  expect(toggle.disabled).toBe(true)
  expect(toggle.checked).toBe(false)
  await act(async () => { reject(new Error('Tailscale unavailable')) })
  expect(screen.getByRole('alert').textContent).toContain('Check that Tailscale is running')
  expect(toggle.checked).toBe(false)
  expect(toggle.disabled).toBe(false)
  expect(screen.queryByRole('link')).toBeNull()
})
it('retains the working link when disabling fails', async () => {
  const update = vi.fn().mockResolvedValueOnce({ enabled: true, url: 'http://100.64.0.1:3081/?token=test' }).mockRejectedValueOnce(new Error('failed'))
  mount(update)
  const toggle = await screen.findByRole<HTMLInputElement>('switch')
  fireEvent.click(toggle)
  await screen.findByRole('link')
  fireEvent.click(toggle)
  await screen.findByRole('alert')
  expect(toggle.checked).toBe(true)
  expect(screen.getByRole('link')).toBeTruthy()
})

it('keeps the mobile link usable if local QR generation fails', async () => {
  const props = { t: makeTranslate(en), read: async () => ({ enabled: true, url: 'http://100.64.0.1:3081/?token=test' }), update: vi.fn(), qr: async () => { throw new Error('canvas unavailable') } } as unknown as MobileAccessProps
  render(<MobileAccess {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Mobile access' }))
  expect((await screen.findByRole('alert')).textContent).toContain('QR code could not be generated')
  expect(screen.getByRole('link')).toBeTruthy()
})
it('reports unavailable status without showing an enabled switch or pairing link', async () => {
  const props = { t: makeTranslate(en), read: async () => { throw new Error('offline') }, update: vi.fn(), qr: vi.fn() } as unknown as MobileAccessProps
  render(<MobileAccess {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Mobile access' }))
  await screen.findByRole('alert')
  expect(screen.queryByRole('switch')).toBeNull()
  expect(screen.queryByRole('link')).toBeNull()
})
