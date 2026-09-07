/** React-free browser stream adapted to the renderer observable lifecycle. */
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { BrowserSnapshot } from '@deepseek-ai/dsh-api-browser-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Stable snapshot and subscription source consumed only by the renderer. */
export interface BrowserSource {
  /** @returns The same snapshot object until the stream publishes a change. */
  getSnapshot(): { snapshot: BrowserSnapshot; error: string }
  /**
   * Subscribe; the final unsubscribe disposes the remote stream.
   * @param listener - Snapshot invalidation callback.
   * @returns The callback that releases this subscription.
   */
  subscribe(listener: () => void): () => void
}

/**
 * Create a lazy source for one session; resubscription starts a new stream generation.
 * @param remote - Generated Remote client.
 * @param sessionId - Session whose browser is observed.
 * @returns Stable observable owned by the renderer subscription.
 */
export function createBrowserSource(remote: ClientRemote, sessionId: SessionId): BrowserSource {
  let state = { snapshot: { open: false, url: '', title: '', actions: [] } as BrowserSnapshot, error: '' }
  const listeners = new Set<() => void>()
  let stop: (() => void) | undefined
  const publish = (next: typeof state) => {
    state = next
    for (const listener of [...listeners]) {
      try { listener() } catch (error) { console.error('Browser snapshot subscriber failed:', error) }
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      if (!stop) {
        const cancellation = new AbortController()
        const stream = remote.$stream<BrowserSnapshot>({
          name: 'Browser state stream',
          open: signal => remote.browser.watch({ sessionId }, signal),
          ended: accepted => new Error(accepted
            ? 'Browser state stream ended'
            : 'Browser state stream closed before its opening snapshot'),
        })
        stop = () => {
          cancellation.abort()
          void stream.dispose().catch((error: unknown) => { console.error('Browser stream disposal failed:', error) })
        }
        void (async () => {
          try {
            for await (const item of stream) {
              if (cancellation.signal.aborted) break
              publish({ snapshot: item.value, error: '' })
            }
          } catch (cause) {
            if (!cancellation.signal.aborted) publish({ ...state, error: cause instanceof Error ? cause.message : String(cause) })
          }
        })()
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          stop?.()
          stop = undefined
        }
      }
    },
  }
}
