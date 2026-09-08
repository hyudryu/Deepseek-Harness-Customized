// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { BrowserSnapshot } from '@deepseek-ai/dsh-api-browser-controller/types'
import { BrowserPanel, type BrowserPanelProps } from '../src/client/BrowserPanel.tsx'
import { StartBrowserDock } from '../src/client/StartBrowserDock.tsx'
import { apply, type BrowserInjected } from '../src/client/index.ts'
import { BrowserState, type BrowserStreamHandle } from '../src/client/browser-state.ts'
import { useSyncExternalStore } from 'react'
import { en } from '../src/client/locales.ts'
import * as hostPlugin from '../src/index.ts'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const copy = { ...commonEn, ...en }
const t: BrowserPanelProps['t'] = key => copy[key]

function snapshots() {
  let pending: ((result: IteratorResult<BrowserSnapshot>) => void) | undefined
  const queue: BrowserSnapshot[] = []
  let done = false
  const stream: BrowserStreamHandle = {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        if (done) return { done: true, value: undefined }
        const value = queue.shift()
        if (value !== undefined) return { done: false, value }
        return new Promise((resolve) => { pending = resolve })
      },
    }),
    dispose: vi.fn(async () => {
      done = true
      pending?.({ done: true, value: undefined })
    }),
  }
  return {
    stream,
    push(value: BrowserSnapshot) {
      if (pending) {
        const resolve = pending
        pending = undefined
        resolve({ done: false, value })
      } else queue.push(value)
    },
  }
}

function panel(overrides: Partial<BrowserPanelProps> = {}) {
  const source = snapshots()
  const observable = new BrowserState(() => source.stream)
  const useBrowser: BrowserPanelProps['useBrowser'] = selector => selector(useSyncExternalStore(observable.subscribe, observable.getSnapshot))
  const props = {
    t, useBrowser, start: vi.fn(async () => {}), navigate: vi.fn(async () => {}),
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
  await act(async () => { fixture.unmount() })
  expect(fixture.stream.dispose).toHaveBeenCalledTimes(1)
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
    await ctx.plugin(hostPlugin)
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

it('starts with Enter, ignores unrelated keys, and renders empty page and action states', async () => {
  let complete!: () => void
  const fixture = panel({ start: vi.fn(() => new Promise<void>((resolve) => { complete = resolve })) })
  const input = screen.getByPlaceholderText(en.openUrlPlaceholder)
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(fixture.props.start).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: 'https://example.test/' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(fixture.props.start).toHaveBeenCalledTimes(1)
  await act(async () => { complete() })
  expect((input as HTMLInputElement).value).toBe('')
  await act(async () => { fixture.push({ open: true, title: '', url: '', actions: [] }) })
  fireEvent.click(screen.getByRole('button', { name: en.showActions }))
  expect(screen.getByText(en.noActions)).toBeTruthy()
  await act(async () => { fixture.push({
    open: true, title: '', url: 'https://example.test/', frame: 'data:image/png;base64,frame',
    actions: [{ id: 1, action: 'navigate', args: '', ok: false, url: 'https://example.test/', time: 1 }],
  }) })
  expect(screen.getByRole('img').getAttribute('alt')).toBe('https://example.test/')
  expect(screen.getByText(en.actionFail)).toBeTruthy()
  const viewport = screen.getByRole('img').parentElement!
  fireEvent(viewport, new MouseEvent('pointermove', { bubbles: true, clientX: 12, clientY: 23 }))
  expect(viewport.querySelector('[data-user]')).not.toBeNull()
  fireEvent.pointerLeave(viewport)
  expect(viewport.querySelector('[data-user]')).toBeNull()
})

it('renders thrown non-Error failures in both start controls', async () => {
  const start = vi.fn(async () => { throw 'start rejected' })
  const fixture = panel({ start })
  fireEvent.click(screen.getByRole('button', { name: en.start }))
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('start rejected') })
  fixture.unmount()
  render(<StartBrowserDock t={t} start={start} expanded={false} closePanel={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: en.start }))
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('start rejected') })
})

it('renders the framework-provided stream error when no mutation failed', () => {
  panel({ useBrowser: selector => selector({ snapshot: { open: false, url: '', title: '', actions: [] }, error: 'connection lost' }) })
  expect(screen.getByRole('alert').textContent).toBe('connection lost')
})

it.each([
  { width: 400, height: 400, x: '100px', y: '150px' },
  { width: 800, height: 200, x: '300px', y: '50px' },
])('aligns the agent cursor with contained image pixels at $width x $height', async ({ width, height, x, y }) => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width, height, left: 0, top: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}),
  })
  const fixture = panel()
  await act(async () => { fixture.push({
    open: true, title: 'Page', url: 'about:blank', frame: 'data:image/png;base64,frame', frameWidth: 800, frameHeight: 400,
    actions: [{ id: 1, action: 'click', args: '', ok: true, url: 'about:blank', time: 1, clickX: 200, clickY: 100 }],
  }) })
  const cursor = fixture.container.querySelector<HTMLElement>('[class*="cursor"]')!
  expect({ left: cursor.style.left, top: cursor.style.top }).toEqual({ left: x, top: y })
})

it('shares one stream and ignores late frames from a retired subscription', async () => {
  const first = snapshots()
  first.stream.dispose = vi.fn(async () => {})
  const second = snapshots()
  const open = vi.fn().mockReturnValueOnce(first.stream).mockReturnValueOnce(second.stream)
  const state = new BrowserState(open)
  const initial = state.getSnapshot()
  expect(state.getSnapshot()).toBe(initial)
  const offA = state.subscribe(vi.fn())
  const offB = state.subscribe(vi.fn())
  expect(open).toHaveBeenCalledTimes(1)
  offA()
  expect(first.stream.dispose).not.toHaveBeenCalled()
  await act(async () => { offB() })
  expect(first.stream.dispose).toHaveBeenCalledTimes(1)
  const offC = state.subscribe(vi.fn())
  await act(async () => { second.push({ open: true, url: 'new', title: '', actions: [] }) })
  await act(async () => { first.push({ open: true, url: 'stale', title: '', actions: [] }) })
  expect(state.getSnapshot().snapshot.url).toBe('new')
  await state.dispose()
  expect(second.stream.dispose).toHaveBeenCalledTimes(1)
  offC()
  state.subscribe(vi.fn())()
  expect(open).toHaveBeenCalledTimes(2)
})

it.each([new Error('stream failed'), 'stream failed'])('publishes a failed stream and releases it on unsubscribe (%s)', async (cause) => {
  const stream: BrowserStreamHandle = {
    async *[Symbol.asyncIterator]() { throw cause },
    dispose: vi.fn(async () => {}),
  }
  const source = new BrowserState(() => stream)
  const off = source.subscribe(vi.fn())
  await waitFor(() => { expect(source.getSnapshot().error).toBe('stream failed') })
  off()
  expect(source.getSnapshot().error).toBe('')
  await source.dispose()
  expect(stream.dispose).toHaveBeenCalledTimes(1)
})

it('ignores a delayed failure after its subscriber has left', async () => {
  let reject!: (cause: Error) => void
  const stream: BrowserStreamHandle = {
    [Symbol.asyncIterator]: () => ({ next: () => new Promise((_resolve, fail) => { reject = fail }) }),
    dispose: vi.fn(async () => {}),
  }
  const source = new BrowserState(() => stream)
  source.subscribe(vi.fn())()
  await act(async () => { reject(new Error('late failure')) })
  expect(source.getSnapshot().error).toBe('')
  await source.dispose()
})

it.each([false, true])('opens and controls a Session through registered callbacks with cleanup failure %s', async (cleanupFails) => {
  const ctx = new Context()
  const reported = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
  const fixture = snapshots()
  if (cleanupFails) {
    const dispose = fixture.stream.dispose
    fixture.stream.dispose = vi.fn(async () => { await dispose(); throw new Error('cleanup failed') })
  }
  const open = vi.fn(async () => ({ ok: true }))
  const close = vi.fn(async () => ({ ok: true }))
  const watch = vi.fn()
  let streamOptions!: { open: (signal: AbortSignal) => unknown; ended: (accepted: boolean) => Error }
  const remoteStream = vi.fn((options: typeof streamOptions) => {
    streamOptions = options
    options.open(new AbortController().signal)
    return {
      async *[Symbol.asyncIterator]() { for await (const value of fixture.stream) yield { value } },
      dispose: () => fixture.stream.dispose(),
    }
  })
  const openBrowser = vi.fn()
  const closeBrowser = vi.fn()
  const registrations = new Map<string, (sessionId: SessionId) => BrowserInjected>()
  ctx.provide('remote', { browser: { open, close, watch }, $stream: remoteStream })
  ctx.provide('layout', { openBrowser, closeBrowser })
  ctx.provide('locale', { register: () => () => {} })
  ctx.provide('slots', {
    inject: (_name: string, callback: () => void) => { callback() },
    register: (options: { name: string; inject: (sessionId: SessionId) => BrowserInjected }) => {
      registrations.set(options.name, options.inject)
      return () => {}
    },
  })
  try {
    apply(ctx)
    const sessionId = SessionId('browser-live-test')
    const injected = registrations.get('browser')!(sessionId)
    expect(registrations.get('browser')!(sessionId).hooks.browser).toBe(injected.hooks.browser)
    const unsubscribe = injected.hooks.browser.subscribe(vi.fn())
    await act(async () => { fixture.push({ open: true, title: 'Observed', url: 'about:blank', actions: [] }) })
    expect(injected.hooks.browser.getSnapshot().snapshot.title).toBe('Observed')
    expect(watch).toHaveBeenCalledWith({ sessionId }, expect.any(AbortSignal))
    expect(streamOptions.ended(true).message).toBe('Browser state stream ended')
    expect(streamOptions.ended(false).message).toBe('Browser state stream closed before its opening snapshot')
    await injected.start(' ')
    expect(open).toHaveBeenLastCalledWith({ sessionId })
    await injected.navigate('https://example.test/')
    expect(openBrowser).toHaveBeenCalledTimes(2)
    await injected.stop()
    close.mockResolvedValueOnce({ ok: false, error: { message: 'close failed' } } as never)
    await expect(injected.stop()).rejects.toThrow('close failed')
    injected.closePanel()
    registrations.get('browser.toggle')!(sessionId).closePanel()
    expect(closeBrowser).toHaveBeenCalledTimes(2)
    unsubscribe()
    await ctx.fiber.dispose()
    if (cleanupFails) expect(reported).toHaveBeenCalledWith(expect.objectContaining({ message: 'Browser subscriptions failed to close' }))
    else expect(reported).not.toHaveBeenCalled()
    expect(fixture.stream.dispose).toHaveBeenCalledTimes(1)
  } finally {
    if (!cleanupFails) await ctx.fiber.dispose()
  }
})

it('awaits retired stream cleanup and reports a cleanup failure to plugin disposal', async () => {
  const fixture = snapshots()
  let reject!: (error: Error) => void
  fixture.stream.dispose = () => new Promise((_resolve, fail) => { reject = fail })
  const state = new BrowserState(() => fixture.stream)
  const unsubscribe = state.subscribe(vi.fn())
  unsubscribe()
  let settled = false
  const disposal = state.dispose().finally(() => { settled = true })
  const assertion = expect(disposal).rejects.toThrow('Browser stream cleanup failed')
  await Promise.resolve()
  expect(settled).toBe(false)
  reject(new Error('release failed'))
  await assertion
})

it('contains a subscriber exception without stopping frame delivery or reporting a stream error', async () => {
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
  const fixture = snapshots()
  const state = new BrowserState(() => fixture.stream)
  state.subscribe(() => { throw new Error('observer failed') })
  const listener = vi.fn()
  state.subscribe(listener)
  await act(async () => { fixture.push({ open: true, url: 'first', title: '', actions: [] }) })
  await act(async () => { fixture.push({ open: true, url: 'second', title: '', actions: [] }) })
  expect(listener).toHaveBeenCalledTimes(2)
  expect(state.getSnapshot().snapshot.url).toBe('second')
  expect(state.getSnapshot().error).toBe('')
  expect(diagnostic).toHaveBeenCalledTimes(2)
  await state.dispose()
})
