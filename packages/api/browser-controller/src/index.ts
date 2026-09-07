/** Browser-control Remote owner: live per-session browser state, action log, and screenshot frames. */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  BrowserCloseRequest,
  BrowserCloseValue,
  BrowserOpenRequest,
  BrowserOpenValue,
  BrowserSnapshot,
  BrowserWatchRequest,
} from './types.ts'

export type * from './types.ts'

/** Live browser facts and control provided by the browser-control plugin. */
export interface BrowserControl {
  /**
   * Read the current replaceable snapshot for one session.
   * @param sessionId - session whose browser is observed.
   * @returns the current browser snapshot, including closed state for an unknown session.
   */
  snapshot(sessionId: string): BrowserSnapshot
  /**
   * Be notified on every new snapshot for one session.
   * @param sessionId - session whose snapshots are observed.
   * @param listener - snapshot callback.
   * @returns unsubscribe function; a no-op when the session is unknown.
   */
  subscribe(sessionId: string, listener: (snapshot: BrowserSnapshot) => void): () => void
  /**
   * Ensure an open context and page for one session, navigating to the optional url.
   * @param sessionId - session whose browser is opened.
   * @param url - optional navigation destination.
   */
  open(sessionId: string, url?: string): Promise<void>
  /**
   * Close one session's browser context, if any.
   * @param sessionId - session whose browser is closed.
   */
  close(sessionId: string): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Live browser state and control for sessions, provided by the browser-control plugin. */
    browserControl: BrowserControl
  }
}

/** Host service backing the generated `ctx.remote.browser` namespace. */
export class BrowserController extends TypertRemoteService {
  static inject = ['typert', 'browserControl']

  /** @param ctx - Host context carrying the injected BrowserControl service. */
  constructor(ctx: Context) {
    super(ctx, 'browserController', { namespace: 'browser' })
  }

  /**
   * Stream one session's complete browser state followed by replacement frames.
   * @param request - session whose browser is followed.
   * @param signal - generation cancellation owned by the Remote stream carrier.
   * @returns one opening snapshot followed by live replacement snapshots.
   */
  @Remote({ mode: 'stream' })
  watch(request: BrowserWatchRequest, signal: AbortSignal): AsyncIterable<BrowserSnapshot> {
    return this.follow(request.sessionId, signal)
  }

  /**
   * Open a browser for one session, optionally navigating to a url.
   * @param request - session and optional initial url.
   * @returns an open acknowledgement.
   */
  @Remote('open')
  async open(request: BrowserOpenRequest): Promise<BrowserOpenValue> {
    await this.browserControl.open(request.sessionId, request.url)
    return { ok: true }
  }

  /**
   * Close one session's browser, if any.
   * @param request - session whose browser is closed.
   * @returns a close acknowledgement after the browser context has closed.
   */
  @Remote('close')
  async close(request: BrowserCloseRequest): Promise<BrowserCloseValue> {
    await this.browserControl.close(request.sessionId)
    return { ok: true }
  }

  private get browserControl(): BrowserControl {
    return this.ctx.get('browserControl') as BrowserControl
  }

  private async *follow(sessionId: string, signal: AbortSignal): AsyncIterable<BrowserSnapshot> {
    signal.throwIfAborted()
    const queue: BrowserSnapshot[] = []
    let wake: (() => void) | undefined
    const unsubscribe = this.browserControl.subscribe(sessionId, (snapshot) => {
      queue.push(snapshot)
      const pending = wake
      wake = undefined
      pending?.()
    })
    const onAbort = (): void => { wake?.() }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      yield this.browserControl.snapshot(sessionId)
      while (!signal.aborted) {
        if (queue.length > 0) {
          const snapshot = queue.shift()
          if (snapshot !== undefined) yield snapshot
          continue
        }
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      unsubscribe()
    }
  }
}

export default BrowserController
