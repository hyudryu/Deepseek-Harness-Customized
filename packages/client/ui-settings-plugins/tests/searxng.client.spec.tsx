// @vitest-environment jsdom
/** Staged SearXNG controls and their settings writes. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { bindSnapshotSelector, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { SearxngCard } from '../src/client/SearxngCard.tsx'
import type { SearxngCardProps } from '../src/client/SearxngCard.tsx'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { SearxngCardController, type SearxngSettings } from '../src/client/searxng-card-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function bench() {
  const host = stubSettingsScope<SearxngSettings>()
  const defaults = { enabled: false, baseURL: 'http://127.0.0.1:8080', timeoutMs: 30_000 }
  host.publish({ status: 'ready', writable: true, value: defaults, base: defaults, user: {} })
  host.mutate.mockImplementation((ops: readonly SettingsPathOpView[]) => {
    const state = host.scope.getSnapshot()
    let value: Record<string, unknown> = { ...state.value as object }
    let user: Record<string, unknown> = { ...state.user as object }
    for (const op of ops) {
      const field = op.path[0]!
      if (op.op === 'set') {
        value = { ...value, [field]: op.value }
        user = { ...user, [field]: op.value }
      } else {
        user = Object.fromEntries(Object.entries(user).filter(([key]) => key !== field))
        value = { ...value, [field]: defaults[field as keyof typeof defaults] }
      }
    }
    host.publish({ value, user })
  })
  const face = new SearxngCardController(host.scope).inject()
  return { host, face, state: () => face.hooks.searxngCard.getSnapshot() }
}

function showCard(face: ReturnType<typeof bench>['face']) {
  const props = {
    ...face, t: (key: keyof typeof en) => en[key],
    useSearxngCard: bindSnapshotSelector(face.hooks.searxngCard),
  } as unknown as SearxngCardProps
  render(<SearxngCard {...props} />)
  fireEvent.click(screen.getByRole('button', { name: `${en.expand}: ${en.searxngTitle}` }))
}

describe('SearXNG settings card', () => {
  it('stages enablement and endpoint, discards them, then saves accepted values', async () => {
    const { host, face, state } = bench()
    face.edit('enabled', 'true')
    face.edit('baseURL', 'https://search.example/searxng')
    expect(host.mutate).not.toHaveBeenCalled()
    expect(state().enabled).toBe(true)
    face.discard()
    expect(state().enabled).toBe(false)
    expect(state().baseURL.text).toBe('http://127.0.0.1:8080')
    face.edit('baseURL', 'https://search.example/searxng')
    face.edit('timeoutMs', '12000')
    face.edit('enabled', 'true')
    face.save()
    await waitFor(() => { expect(state().saving).toBe(false) })
    // Enablement is committed with its endpoint and timeout in ONE mutation, so a
    // concurrent search never observes SearXNG enabled against an old endpoint.
    expect(host.mutate).toHaveBeenCalledTimes(1)
    expect(host.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['baseURL'], value: 'https://search.example/searxng' },
      { op: 'set', path: ['timeoutMs'], value: 12000 },
      { op: 'set', path: ['enabled'], value: true },
    ], host.scope.getSnapshot().revision)
    expect(host.scope.getSnapshot().value).toEqual({ enabled: true, baseURL: 'https://search.example/searxng', timeoutMs: 12000 })
    expect(state().dirty).toBe(false)
    face.edit('enabled', 'false')
    face.save()
    await waitFor(() => { expect(state().saving).toBe(false) })
    expect(host.scope.getSnapshot().value?.enabled).toBe(false)
  })

  it.each(['relative', 'ftp://example.com', 'https://user:pass@example.com', 'https://example.com?q=x', 'https://example.com/#x'])('refuses invalid instance URL %s without writing', async (url) => {
    const { host, face, state } = bench()
    face.edit('baseURL', url)
    expect(state().baseURL.invalid).toBe(true)
    face.save()
    await waitFor(() => { expect(state().saving).toBe(false) })
    expect(host.mutate).not.toHaveBeenCalled()
  })

  it.each(['0', '-1', '1.5', '2147483648', 'not a number'])('refuses invalid timeout %s', async (timeout) => {
    const { host, face, state } = bench()
    face.edit('timeoutMs', timeout)
    expect(state().timeoutMs.invalid).toBe(true)
    face.save()
    await waitFor(() => { expect(state().saving).toBe(false) })
    expect(host.mutate).not.toHaveBeenCalled()
  })

  it('resets overridden settings and retains drafts when the Host refuses a write', async () => {
    const { host, face, state } = bench()
    face.edit('baseURL', 'https://example.com')
    face.save()
    await waitFor(() => { expect(state().saving).toBe(false) })
    face.resetField('baseURL')
    face.save()
    await waitFor(() => { expect(state().saving).toBe(false) })
    expect(state().baseURL.text).toBe('http://127.0.0.1:8080')
    expect(host.mutate).toHaveBeenCalledWith(
      [{ op: 'unset', path: ['baseURL'] }],
      host.scope.getSnapshot().revision,
    )
    host.mutate.mockImplementation(() => {})
    face.edit('enabled', 'true')
    face.save()
    await waitFor(() => { expect(state().saving).toBe(false) })
    expect(state()).toMatchObject({ dirty: true, failed: true, enabled: true })
  })

  it('renders the switch, validation, and discard actions using locale copy', async () => {
    const { host, face } = bench()
    showCard(face)
    expect(screen.getByText(en.searxngEnabledHint)).toBeDefined()
    fireEvent.click(screen.getByRole('switch', { name: en.searxngEnabled }))
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.searxngBaseURL), { target: { value: 'invalid' } })
    expect(screen.getByText(en.searxngInvalidURL)).toBeDefined()
    expect((screen.getByRole<HTMLButtonElement>('button', { name: en.save })).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.discard }))
    expect((screen.getByRole<HTMLInputElement>('switch')).checked).toBe(false)
    fireEvent.click(screen.getByRole<HTMLInputElement>('switch'))
    await act(async () => { fireEvent.click(screen.getByRole<HTMLButtonElement>('button', { name: en.save })) })
    expect(host.scope.getSnapshot().value?.enabled).toBe(true)
  })

  it('validates unexpected toggle drafts and blank fields that inherit defaults', async () => {
    const { host, face, state } = bench()
    face.edit('enabled', 'invalid')
    expect(state().invalid).toBe(true)
    face.discard()
    face.edit('baseURL', 'https://example.com')
    face.edit('timeoutMs', '1000')
    face.save()
    await waitFor(() => { expect(state().saving).toBe(false) })
    face.edit('baseURL', ' ')
    face.edit('timeoutMs', ' ')
    face.save()
    await waitFor(() => { expect(state().saving).toBe(false) })
    expect(host.scope.getSnapshot().value).toEqual({ enabled: false, baseURL: 'http://127.0.0.1:8080', timeoutMs: 30000 })
  })

  it('stages URL and timeout resets from their rendered controls', () => {
    const { face } = bench()
    showCard(face)
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.searxngBaseURL), { target: { value: 'https://example.com' } })
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.searxngTimeout), { target: { value: '5000' } })
    fireEvent.click(screen.getAllByRole('button', { name: en.reset })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: en.reset })[0]!)
    expect((screen.getByLabelText<HTMLInputElement>(en.searxngBaseURL)).value).toBe('http://127.0.0.1:8080')
    expect((screen.getByLabelText<HTMLInputElement>(en.searxngTimeout)).value).toBe('30000')
  })

  it('disables controls when the document is read-only and hides unavailable namespaces', () => {
    const { host, face } = bench()
    host.publish({ writable: false })
    showCard(face)
    expect((screen.getByRole<HTMLInputElement>('switch')).disabled).toBe(true)
    expect((screen.getByLabelText<HTMLInputElement>(en.searxngBaseURL)).disabled).toBe(true)
    act(() => { host.publish({ status: 'unavailable' }) })
    expect(screen.queryByRole('switch')).toBeNull()
  })
})
