import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { expect, it } from 'vitest'
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
