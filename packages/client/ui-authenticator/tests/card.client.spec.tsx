// @vitest-environment jsdom
/** Account import, deletion and polling through the real configuration card. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createAuthenticatorActions } from '../src/client/actions.ts'
import { AuthenticatorCard } from '../src/client/AuthenticatorCard.tsx'
import { readAuthenticatorQr } from '../src/client/qr.ts'
import { en } from '../src/client/locales.ts'
import type {} from '../src/client/index.ts'
vi.mock('../src/client/qr.ts', () => ({ readAuthenticatorQr: vi.fn() }))
const t = makeTranslate(en)
const account = { id: '00000000-0000-4000-8000-000000000001', label: 'alice', issuer: 'Example', period: 30, code: '123456', validUntil: 30000 }
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks() })
async function open() {
  render(<AuthenticatorCard t={t} {...createAuthenticatorActions()} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Authenticator MCP/ })) })
}
it('loads only after expansion and pins the empty account view', async () => {
  const fetch = vi.fn(async () => response({ accounts: [] }))
  vi.stubGlobal('fetch', fetch)
  const { container } = render(<AuthenticatorCard t={t} {...createAuthenticatorActions()} />)
  expect(fetch).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Authenticator MCP/ })) })
  expect(container.textContent).toMatchInlineSnapshot('"Authenticator MCPImport authenticator QR codes and share current verification codes with session agents.Import QR codeNo authenticator accounts saved."')
  expect(fetch).toHaveBeenCalledWith('/authenticator', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }))
})
it('imports decoded QR content and refetches the saved account', async () => {
  let imported = false
  const fetch = vi.fn(async (path: string) => {
    if (path === '/authenticator/import') { imported = true; return response(account) }
    return response({ accounts: imported ? [account] : [] })
  })
  vi.stubGlobal('fetch', fetch)
  vi.mocked(readAuthenticatorQr).mockResolvedValue('otpauth://totp/test?secret=TEST')
  await open()
  await act(async () => { fireEvent.change(screen.getByLabelText('Import QR code'), { target: { files: [new File(['qr'], 'qr.png', { type: 'image/png' })] } }) })
  expect(fetch).toHaveBeenCalledWith('/authenticator/import', expect.objectContaining({ method: 'POST', body: JSON.stringify({ uri: 'otpauth://totp/test?secret=TEST' }) }))
  expect(screen.getByText('Authenticator account added.')).toBeTruthy()
  expect(screen.getByLabelText('alice').textContent).toBe('123456')
})
it('requires confirmation before deletion and removes a confirmed account', async () => {
  let deleted = false
  const fetch = vi.fn(async (path: string) => {
    if (path === '/authenticator/delete') { deleted = true; return response({ removed: true }) }
    return response({ accounts: deleted ? [] : [account] })
  })
  vi.stubGlobal('fetch', fetch)
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Delete alice' }))
  expect(deleted).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(deleted).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Delete alice' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })) })
  expect(fetch).toHaveBeenCalledWith('/authenticator/delete', expect.objectContaining({ body: JSON.stringify({ id: account.id }) }))
  expect(screen.getByText('Authenticator account deleted.')).toBeTruthy()
  expect(screen.queryByLabelText('alice')).toBeNull()
})
it('keeps accounts and reports failed deletion without a success notice', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path === '/authenticator/delete' ? response({}, 500) : response({ accounts: [account] })))
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Delete alice' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })) })
  expect(screen.getByRole('alert').textContent).toBe(en.failed)
  expect(screen.getByLabelText('alice')).toBeTruthy()
  expect(screen.queryByText(en.deleted)).toBeNull()
})
it('reports invalid QR locally without sending import requests', async () => {
  const fetch = vi.fn(async () => response({ accounts: [] }))
  vi.stubGlobal('fetch', fetch)
  vi.mocked(readAuthenticatorQr).mockRejectedValue(new Error('invalid-qr'))
  await open()
  await act(async () => { fireEvent.change(screen.getByLabelText('Import QR code'), { target: { files: [new File(['not QR'], 'qr.png', { type: 'image/png' })] } }) })
  expect(screen.getByRole('alert').textContent).toBe(en.invalidQr)
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('hides expired codes during failed polls, clears the error on recovery and stops polling on collapse', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ accounts: [{ ...account, validUntil: 11000 }] })).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(response({ accounts: [{ ...account, code: '654321', validUntil: 60000 }] }))
  vi.stubGlobal('fetch', fetch)
  await open()
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(screen.getByLabelText('alice').textContent).toBe(en.expired)
  expect(screen.getByRole('alert')).toBeTruthy()
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(screen.getByLabelText('alice').textContent).toBe('654321')
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Authenticator MCP/ }))
  const calls = fetch.mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(fetch).toHaveBeenCalledTimes(calls)
})
it('rejects malformed account JSON without crashing the card', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({ accounts: [{ ...account, code: 123456 }] })))
  await open()
  expect(screen.getByRole('alert').textContent).toBe(en.failed)
  expect(screen.queryByLabelText('alice')).toBeNull()
})

it('does not acknowledge an import with a malformed server response', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path === '/authenticator/import' ? response({ ok: true }) : response({ accounts: [] })))
  vi.mocked(readAuthenticatorQr).mockResolvedValue('otpauth://totp/test?secret=TEST')
  await open()
  await act(async () => { fireEvent.change(screen.getByLabelText('Import QR code'), { target: { files: [new File(['qr'], 'qr.png', { type: 'image/png' })] } }) })
  expect(screen.getByRole('alert').textContent).toBe(en.failed)
  expect(screen.queryByText(en.imported)).toBeNull()
})

it.each([
  ['duplicate-account', en.duplicateAccount],
  ['invalid-provisioning', en.invalidProvisioning],
  ['unsupported-provisioning', en.unsupportedProvisioning],
  ['unknown-new-code', en.failed],
])('renders localized import failure %s without server prose', async (errorCode, message) => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path === '/authenticator/import'
    ? response({ errorCode, error: 'raw server details' }, 400)
    : response({ accounts: [] })))
  vi.mocked(readAuthenticatorQr).mockResolvedValue('otpauth://totp/test?secret=TEST')
  await open()
  await act(async () => { fireEvent.change(screen.getByLabelText('Import QR code'), { target: { files: [new File(['qr'], 'qr.png', { type: 'image/png' })] } }) })
  expect(screen.getByRole('alert').textContent).toBe(message)
  expect(screen.queryByText('raw server details')).toBeNull()
})

it('renders and mutates through injected callbacks without browser transport', async () => {
  const loadAccounts = vi.fn(async () => [account])
  const deleteAccount = vi.fn(async () => {})
  const importAccount = vi.fn(async () => {})
  const fetch = vi.fn(() => { throw new Error('presentation must not fetch') })
  vi.stubGlobal('fetch', fetch)
  render(<AuthenticatorCard t={t} loadAccounts={loadAccounts} importAccount={importAccount} deleteAccount={deleteAccount} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Authenticator MCP/ })) })
  expect(screen.getByLabelText('alice').textContent).toBe('123456')
  fireEvent.click(screen.getByRole('button', { name: 'Delete alice' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })) })
  expect(deleteAccount).toHaveBeenCalledWith(account.id)
  vi.mocked(readAuthenticatorQr).mockResolvedValue('otpauth://totp/test?secret=TEST')
  await act(async () => { fireEvent.change(screen.getByLabelText('Import QR code'), {
    target: { files: [new File(['qr'], 'qr.png', { type: 'image/png' })] },
  }) })
  expect(importAccount).toHaveBeenCalledWith('otpauth://totp/test?secret=TEST')
  expect(fetch).not.toHaveBeenCalled()
})

it('shows a localized error when the account endpoint rejects access', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'forbidden' }, 403)))
  await open()
  expect(screen.getByRole('alert').textContent).toBe(en.failed)
  expect(screen.queryByLabelText('alice')).toBeNull()
})


it('reports a concurrent deletion as account not found without a success notice', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path === '/authenticator/delete'
    ? response({ removed: false }) : response({ accounts: [account] })))
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Delete alice' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })) })
  expect(screen.getByRole('alert').textContent).toMatchInlineSnapshot('"This authenticator account no longer exists. Refresh the account list."')
  expect(screen.queryByText(en.deleted)).toBeNull()
})
