import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { expect, it, vi } from 'vitest'
import BrowserController, { type BrowserControl, type BrowserSnapshot } from '../src/index.ts'

const closed: BrowserSnapshot = { open: false, url: '', title: '', actions: [] }

it('delivers updates after the baseline and releases the subscriber on cancellation', async () => {
  const ctx = new Context()
  const listeners = new Set<(snapshot: BrowserSnapshot) => void>()
  const control: BrowserControl = {
    snapshot: () => closed,
    subscribe: (_id, listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    open: async () => {},
    close: async () => {},
  }
  ctx.provide('browserControl', control)
  const controller = new BrowserController(ctx)
  const abort = new AbortController()
  const stream = controller.watch({ sessionId: SessionId('browser-test') }, abort.signal)[Symbol.asyncIterator]()
  try {
    expect((await stream.next()).value).toEqual(closed)
    const opened = { ...closed, open: true, url: 'about:blank' }
    for (let index = 0; index < 100; index++) {
      for (const listener of listeners) listener({ ...opened, url: `https://example.test/${index}` })
    }
    for (const listener of listeners) listener(opened)
    expect((await stream.next()).value).toEqual(opened)
    for (const listener of listeners) listener(closed)
    expect((await stream.next()).value).toEqual(closed)
    for (const listener of listeners) listener(opened)
    expect((await stream.next()).value).toEqual(opened)
    const waiting = stream.next()
    abort.abort()
    expect((await waiting).done).toBe(true)
    expect(listeners.size).toBe(0)
  } finally {
    abort.abort()
    await stream.return?.()
    await ctx.fiber.dispose()
  }
})

it('waits for browser cleanup before acknowledging close', async () => {
  const ctx = new Context()
  let finish!: () => void
  ctx.provide('browserControl', {
    snapshot: () => closed,
    subscribe: () => () => {},
    open: async () => {},
    close: () => new Promise<void>((resolve) => { finish = resolve }),
  } satisfies BrowserControl)
  const controller = new BrowserController(ctx)
  let acknowledged = false
  try {
    const result = controller.close({ sessionId: SessionId('browser-test') }).then((value) => {
      acknowledged = true
      return value
    })
    await Promise.resolve()
    expect(acknowledged).toBe(false)
    finish()
    expect(await result).toEqual({ ok: true })
  } finally {
    await ctx.fiber.dispose()
  }
})


it('opens only a live session and rejects unknown and disposed identities', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const open = vi.fn(async () => {})
  ctx.provide('browserControl', {
    snapshot: () => closed,
    subscribe: () => () => {},
    open,
    close: async () => {},
  } satisfies BrowserControl)
  const controller = new BrowserController(ctx)
  const sessionId = SessionId('browser-test')
  try {
    await expect(controller.open({ sessionId })).rejects.toThrow('not found')
    expect(open).not.toHaveBeenCalled()
    const session = ctx.sessions.prepare(sessionId)
    const detach = ctx.sessions.enter(session)
    ctx.sessions.announce(session)
    await expect(controller.open({ sessionId, url: 'about:blank' })).resolves.toEqual({ ok: true })
    expect(open).toHaveBeenCalledWith(sessionId, 'about:blank')
    detach()
    await expect(controller.open({ sessionId })).rejects.toThrow('not found')
    expect(open).toHaveBeenCalledTimes(1)
  } finally {
    await ctx.fiber.dispose()
  }
})

it('releases a paused subscription when the consumer returns', async () => {
  const ctx = new Context()
  const unsubscribe = vi.fn()
  ctx.provide('browserControl', {
    snapshot: () => closed,
    subscribe: () => unsubscribe,
    open: async () => {},
    close: async () => {},
  } satisfies BrowserControl)
  const stream = new BrowserController(ctx).watch({ sessionId: SessionId('browser-test') }, new AbortController().signal)[Symbol.asyncIterator]()
  try {
    await stream.next()
    await stream.return?.()
    expect(unsubscribe).toHaveBeenCalledOnce()
  } finally {
    await stream.return?.()
    await ctx.fiber.dispose()
  }
})

it('closes a disposed session browser without closing other sessions', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const close = vi.fn(async () => {})
  ctx.provide('browserControl', {
    snapshot: () => closed, subscribe: () => () => {}, open: async () => {}, close,
  } satisfies BrowserControl)
  new BrowserController(ctx)
  const first = ctx.sessions.prepare(SessionId('first'))
  const second = ctx.sessions.prepare(SessionId('second'))
  const detach = ctx.sessions.enter(first)
  ctx.sessions.announce(first)
  ctx.sessions.enter(second)
  try {
    detach()
    await vi.waitFor(() => { expect(close).toHaveBeenCalledExactlyOnceWith(first.id) })
    expect(ctx.sessions.get(second.id)).toBe(second)
  } finally { await ctx.fiber.dispose() }
})

it('rejects a pending open after its session is disposed and awaits browser cleanup', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  let opened!: () => void
  let cleaned!: () => void
  const opening = new Promise<void>((resolve) => { opened = resolve })
  const cleaning = new Promise<void>((resolve) => { cleaned = resolve })
  const close = vi.fn(async () => { await opening; await cleaning })
  ctx.provide('browserControl', {
    snapshot: () => closed, subscribe: () => () => {}, open: () => opening, close,
  } satisfies BrowserControl)
  const controller = new BrowserController(ctx)
  const session = ctx.sessions.prepare(SessionId('pending'))
  const detach = ctx.sessions.enter(session)
  ctx.sessions.announce(session)
  try {
    let settled = false
    const result = controller.open({ sessionId: session.id }).finally(() => { settled = true })
    const rejection = expect(result).rejects.toThrow('disposed while opening')
    detach()
    expect(close).toHaveBeenCalledWith(session.id)
    opened()
    await Promise.resolve()
    expect(settled).toBe(false)
    cleaned()
    await rejection
  } finally { opened(); cleaned(); await ctx.fiber.dispose() }
})

it('reports disposal cleanup failures through session observers and allows explicit close retry', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  const close = vi.fn(async () => {}).mockRejectedValueOnce(new Error('browser close failed'))
  ctx.provide('browserControl', {
    snapshot: () => closed, subscribe: () => () => {}, open: async () => {}, close,
  } satisfies BrowserControl)
  const controller = new BrowserController(ctx)
  const session = ctx.sessions.prepare(SessionId('retry'))
  const detach = ctx.sessions.enter(session)
  ctx.sessions.announce(session)
  try {
    detach()
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('browser close failed')) })
    await expect(controller.close({ sessionId: session.id })).resolves.toEqual({ ok: true })
    expect(close).toHaveBeenCalledTimes(2)
  } finally { warn.mockRestore(); await ctx.fiber.dispose() }
})
