// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { BrowserSnapshot } from '@deepseek-ai/dsh-api-browser-controller/types'
import { BrowserPanel, type BrowserPanelProps } from '../src/client/BrowserPanel.tsx'
import { StartBrowserDock } from '../src/client/StartBrowserDock.tsx'
import { apply, type BrowserInjected, type BrowserStreamHandle } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const copy = { ...commonEn, ...en }
const t: BrowserPanelProps['t'] = key => copy[key]

function snapshots() {
  let pending: ((result: IteratorResult<BrowserSnapshot>) => void) | undefined
  const queue: BrowserSnapshot[] = []
  let done = false
  const dispose = vi.fn(async () => {
    done = true
    pending?.({ done: true, value: undefined })
  })
  const stream: BrowserStreamHandle = {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        if (done) return { done: true, value: undefined }
        const value = queue.shift()
        if (value !== undefined) return { done: false, value }
        return new Promise((resolve) => { pending = resolve })
      },
    }),
    dispose,
  }
  return {
    stream,
    dispose,
    push(value: BrowserSnapshot) {
      if (pending) {
        const resolve = pending
        pending = undefined
        resolve({ done: false, value })
      } else queue.push(value)
    },
  }
}

function panel(overrides: Partial<BrowserInjected> = {}) {
  const source = snapshots()
  const props = {
    t, stream: () => source.stream, start: vi.fn(async () => {}), navigate: vi.fn(async () => {}),
    stop: vi.fn(async () => {}), closePanel: vi.fn(), ...overrides,
  }
  // This component consumes none of the renderer's global/session selector hooks.
  const view = render(<BrowserPanel {...props as BrowserPanelProps} />)
  return { ...view, ...source, props }
}

it('shows start failures and suppresses repeated starts while pending', async () => {
  let reject!: (error: Error) => void
  const start = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail }))
  render(<StartBrowserDock t={t} start={start} expanded={false} closePanel={vi.fn()} />)
  const button = screen.getByRole('button', { name: en.start })
  fireEvent.click(button)
  fireEvent.click(button)
  expect(start).toHaveBeenCalledTimes(1)
  expect((button as HTMLButtonElement).disabled).toBe(true)
  await act(async () => { reject(new Error('Chromium unavailable')) })
  expect(screen.getByRole('alert').textContent).toContain('Chromium unavailable')
  expect((button as HTMLButtonElement).disabled).toBe(false)
  expect({
    label: button.getAttribute('aria-label'),
    expanded: button.getAttribute('aria-expanded'),
    disabled: (button as HTMLButtonElement).disabled,
    alert: screen.getByRole('alert').textContent,
  }).toMatchInlineSnapshot(`
    {
      "alert": "Failed to start browser: Chromium unavailable",
      "disabled": false,
      "expanded": "false",
      "label": "Start Browser",
    }
  `)
})

it('hides an expanded panel without starting another browser', () => {
  const start = vi.fn(async () => {})
  const closePanel = vi.fn()
  render(<StartBrowserDock t={t} start={start} expanded closePanel={closePanel} />)
  fireEvent.click(screen.getByRole('button', { name: en.closePanel }))
  expect(closePanel).toHaveBeenCalledTimes(1)
  expect(start).not.toHaveBeenCalled()
})

it('renders replacement frames and actions, stops the browser, and releases its stream', async () => {
  const fixture = panel()
  const snapshot: BrowserSnapshot = {
    open: true, title: 'Fixture', url: 'http://example.test/', frame: 'data:image/jpeg;base64,first',
    actions: [{ id: 1, action: 'click', args: '{"name":"Try it"}', ok: true, url: 'http://example.test/', time: 1 }],
  }
  await act(async () => { fixture.push(snapshot) })
  expect(screen.getByRole('img', { name: 'Fixture' }).getAttribute('src')).toBe(snapshot.frame)
  fireEvent.click(screen.getByRole('button', { name: en.showActions }))
  expect(screen.getByText('click')).toBeTruthy()
  await act(async () => { fixture.push({ ...snapshot, frame: 'data:image/jpeg;base64,second' }) })
  expect(screen.getByRole('img').getAttribute('src')).toContain('second')
  expect(fixture.props.start).not.toHaveBeenCalled()
  expect(screen.getAllByRole('button').map(button => button.textContent)).toMatchInlineSnapshot(`
    [
      "Navigate",
      "Stop browser",
      "Hide actions",
    ]
  `)
  fireEvent.click(screen.getByRole('button', { name: en.stop }))
  await waitFor(() => { expect(fixture.props.stop).toHaveBeenCalledTimes(1) })
  fixture.unmount()
  expect(fixture.dispose).toHaveBeenCalledTimes(1)
})

it('rejects a failed remote open without revealing the browser panel', async () => {
  const ctx = new Context()
  const open = vi.fn(async () => ({ ok: false, error: { message: 'Browser launch failed' } }))
  const openBrowser = vi.fn()
  const registrations = new Map<string, (sessionId: SessionId) => Pick<BrowserInjected, 'start'>>()
  ctx.provide('remote', { browser: { open } })
  ctx.provide('layout', { openBrowser, closeBrowser: vi.fn() })
  ctx.provide('locale', { register: () => () => {} })
  ctx.provide('slots', {
    inject: (_name: string, callback: () => void) => { callback() },
    register: (options: { name: string; inject: (sessionId: SessionId) => Pick<BrowserInjected, 'start'> }) => {
      registrations.set(options.name, options.inject)
      return () => {}
    },
  })
  try {
    apply(ctx)
    const sessionId = SessionId('browser-test')
    const toggle = registrations.get('browser.toggle')!(sessionId)
    await expect(toggle.start('https://example.test/')).rejects.toThrow('Browser launch failed')
    expect(open).toHaveBeenCalledWith({ sessionId, url: 'https://example.test/' })
    expect(openBrowser).not.toHaveBeenCalled()
  } finally {
    await ctx.fiber.dispose()
  }
})

it('keeps failed navigation visible and preserves the address for retry', async () => {
  const navigate = vi.fn(async () => { throw new Error('Navigation timed out') })
  const fixture = panel({ navigate })
  await act(async () => { fixture.push({ open: true, title: '', url: 'about:blank', actions: [] }) })
  const input = screen.getByPlaceholderText(en.openUrlPlaceholder)
  fireEvent.change(input, { target: { value: 'https://example.test/' } })
  fireEvent.click(screen.getByRole('button', { name: en.navigate }))
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Navigation timed out') })
  expect(navigate).toHaveBeenCalledWith('https://example.test/')
  expect((input as HTMLInputElement).value).toBe('https://example.test/')
  expect(fixture.props.start).not.toHaveBeenCalled()
})
