import { afterEach, expect, it, vi } from 'vitest'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { BrowserSnapshot } from '@deepseek-ai/dsh-api-browser-controller/types'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { createBrowserSource } from '../src/client/source.ts'

afterEach(() => { vi.restoreAllMocks() })

function fixture() {
  let next: ((result: IteratorResult<{ value: BrowserSnapshot }>) => void) | undefined
  let fail: ((error: unknown) => void) | undefined
  const dispose = vi.fn(async () => {})
  let options!: { open: (signal: AbortSignal) => unknown; ended: (accepted: boolean) => Error }
  const watch = vi.fn()
  const stream = vi.fn((config: typeof options) => {
    options = config
    return ({
      dispose,
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<{ value: BrowserSnapshot }>>((resolve, reject) => {
          next = resolve
          fail = reject
        }),
      }),
    })
  })
  const source = createBrowserSource({ $stream: stream, browser: { watch } } as unknown as ClientRemote, SessionId('browser-source'))
  return { source, stream, dispose, watch, options: () => options,
    push: async (url: string) => {
      next?.({ done: false, value: { value: { open: true, url, title: '', actions: [] } } })
      await Promise.resolve()
    },
    reject: async (error: unknown = new Error('transport unavailable')) => { fail?.(error); await Promise.resolve() },
  }
}

it('shares one stream, preserves snapshot identity, and closes after the final observer leaves', async () => {
  const { source, stream, dispose, push } = fixture()
  const initial = source.getSnapshot()
  expect(source.getSnapshot()).toBe(initial)
  expect(stream).not.toHaveBeenCalled()
  const notify = vi.fn()
  const first = source.subscribe(notify)
  const last = source.subscribe(vi.fn())
  expect(stream).toHaveBeenCalledTimes(1)
  await push('https://example.test/')
  expect(source.getSnapshot()).not.toBe(initial)
  expect(source.getSnapshot().snapshot.url).toBe('https://example.test/')
  expect(notify).toHaveBeenCalledTimes(1)
  first()
  expect(dispose).not.toHaveBeenCalled()
  last()
  expect(dispose).toHaveBeenCalledTimes(1)
  const previous = source.getSnapshot()
  await push('https://late.test/')
  expect(source.getSnapshot()).toBe(previous)
  const remount = source.subscribe(notify)
  expect(stream).toHaveBeenCalledTimes(2)
  remount()
})

it('publishes stream errors through the same source and suppresses errors after disposal', async () => {
  const { source, reject } = fixture()
  const stop = source.subscribe(vi.fn())
  await reject()
  expect(source.getSnapshot().error).toBe('transport unavailable')
  stop()
  const second = fixture()
  const unsubscribe = second.source.subscribe(vi.fn())
  unsubscribe()
  await second.reject()
  expect(second.source.getSnapshot().error).toBe('')
})

it('opens the session watch and distinguishes early and accepted stream endings', () => {
  const { source, options, watch } = fixture()
  const stop = source.subscribe(vi.fn())
  const signal = new AbortController().signal
  options().open(signal)
  expect(watch).toHaveBeenCalledWith({ sessionId: SessionId('browser-source') }, signal)
  expect(options().ended(false).message).toContain('before its opening snapshot')
  expect(options().ended(true).message).toBe('Browser state stream ended')
  stop()
})

it('contains subscriber and disposal failures and publishes non-Error stream failures', async () => {
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { source, dispose, push, reject } = fixture()
  const first = source.subscribe(() => { throw new Error('observer failed') })
  const notified = vi.fn()
  const last = source.subscribe(notified)
  await push('https://example.test/')
  expect(notified).toHaveBeenCalledTimes(1)
  expect(report).toHaveBeenCalledWith('Browser snapshot subscriber failed:', expect.any(Error))
  await reject('transport failure')
  expect(source.getSnapshot().error).toBe('transport failure')
  dispose.mockRejectedValueOnce(new Error('cleanup failed'))
  first()
  last()
  await Promise.resolve()
  expect(report).toHaveBeenCalledWith('Browser stream disposal failed:', expect.any(Error))
})
