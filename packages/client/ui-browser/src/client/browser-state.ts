/** React-free snapshot adapter for one Session's reconnecting browser stream. */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import type { BrowserSnapshot } from '@deepseek-ai/dsh-api-browser-controller/types'

/** Browser state and the current stream failure presented by the panel. */
export interface BrowserView {
  /** Latest complete Host snapshot. */
  snapshot: BrowserSnapshot
  /** Current stream failure, cleared by successful delivery. */
  error: string
}

/** A reconnecting stream with explicit asynchronous cleanup. */
export interface BrowserStreamHandle extends AsyncIterable<BrowserSnapshot> {
  /** Permanently stop the underlying stream and await cleanup. */
  dispose: () => Promise<void>
}

/** Observable source whose stream lives only while the Session has subscribers. */
export class BrowserState implements HostObservable<BrowserView> {
  private view: BrowserView = { snapshot: { open: false, url: '', title: '', actions: [] }, error: '' }
  private readonly listeners = new Set<() => void>()
  private stream: BrowserStreamHandle | undefined
  private disposed = false
  private readonly cleanups = new Set<Promise<void>>()
  private readonly cleanupErrors: unknown[] = []
  /** @param open - create a stream for this Session on first subscription. */
  constructor(private readonly open: () => BrowserStreamHandle) {}

  getSnapshot = (): BrowserView => this.view
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    if (this.stream === undefined) {
      const stream = this.open()
      this.stream = stream
      void this.consume(stream)
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.release()
    }
  }

  private async consume(stream: BrowserStreamHandle): Promise<void> {
    try {
      for await (const snapshot of stream) {
        if (this.stream !== stream) return
        this.publish({ snapshot, error: '' })
      }
    } catch (cause) {
      if (this.stream === stream) this.publish({ ...this.view, error: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  private publish(view: BrowserView): void {
    this.view = view
    notifySubscribers(this.listeners, 'ui-browser')
  }

  private release(): void {
    const stream = this.stream
    this.stream = undefined
    this.view = { snapshot: { open: false, url: '', title: '', actions: [] }, error: '' }
    if (stream === undefined) return
    const cleanup = Promise.resolve().then(() => stream.dispose()).catch((error: unknown) => {
      this.cleanupErrors.push(error)
    }).finally(() => { this.cleanups.delete(cleanup) })
    this.cleanups.add(cleanup)
  }

  /** Retire the source; resolves after all retired streams finish cleanup, or rejects with their failures. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.release()
    this.listeners.clear()
    await Promise.all(this.cleanups)
    if (this.cleanupErrors.length > 0) throw new AggregateError(this.cleanupErrors, 'Browser stream cleanup failed')
  }
}
