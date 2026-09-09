/** Browser-control Remote owner: live per-session browser state, action log, and screenshot frames. */

import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  BrowserCloseRequest,
  BrowserCloseValue,
  BrowserOpenRequest,
  BrowserOpenValue,
  BrowserSnapshot,
  BrowserTabId,
  BrowserTabRequest,
  BrowserWatchRequest,
} from './types.ts'

export type * from './types.ts'

/** Live browser facts and control provided by the browser-control plugin. */
export interface BrowserControl {
  /**
   * Read the current replaceable snapshot for one session.
   * @param sessionId - session whose browser is observed.
   * @returns the current browser snapshot, including closed state before its browser is opened.
   */
  snapshot(sessionId: SessionId): BrowserSnapshot
  /**
   * Observe replacement snapshots across browser close and reopen transitions.
   * @param sessionId - session whose snapshots are observed.
   * @param listener - snapshot callback.
   * @returns unsubscribe function; the subscription stays active when no browser is open.
   */
  subscribe(sessionId: SessionId, listener: (snapshot: BrowserSnapshot) => void): () => void
  /**
   * Ensure an open page for one session, navigating to the optional URL or the configured homepage for a new session.
   * @param sessionId - session whose browser is opened.
   * @param url - optional navigation destination; the provider normalizes bare hostnames.
   * @throws Navigation failures close newly created contexts; existing contexts remain open. Cleanup failures retain the context for retry.
   */
  open(sessionId: SessionId, url?: string): Promise<void>
  /**
   * Close one session's owned tabs or isolated context; retain retryable state if cleanup fails.
   * @param sessionId - session whose browser is closed.
   * @throws Context cleanup failures; callers may retry.
   */
  close(sessionId: SessionId): Promise<void>
  /**
   * Create and select a session-owned tab, opening its browser if necessary.
   * @param sessionId - session owning the new tab.
   * @param url - optional destination; omission uses the configured homepage.
   */
  createTab(sessionId: SessionId, url?: string): Promise<void>
  /**
   * Select an existing tab and publish its current frame.
   * @param sessionId - session owning the tab.
   * @param tabId - opaque identity from that session's snapshot.
   */
  selectTab(sessionId: SessionId, tabId: BrowserTabId): Promise<void>
  /**
   * Close an owned tab; closing the last tab stops the session browser.
   * @param sessionId - session owning the tab.
   * @param tabId - opaque identity from that session's snapshot.
   */
  closeTab(sessionId: SessionId, tabId: BrowserTabId): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Live browser state and control for sessions, provided by the browser-control plugin. */
    browserControl: BrowserControl
  }
}

/** Host service backing the generated `ctx.remote.browser` namespace. */
export class BrowserController extends TypertRemoteService {
  static inject = ['typert', 'browserControl', 'sessions']

  /** @param ctx - Host context carrying the injected BrowserControl service. */
  constructor(ctx: Context) {
    super(ctx, 'browserController', { namespace: 'browser' })
    ctx.on('session/disposed', (session) => {
      void ctx.browserControl.close(session.id).catch((error: unknown) => {
        ctx.logger.warn(`session "${session.id}": browser cleanup failed: ${String(error)}`)
      })
    })
  }

  /**
   * Stream one session's complete browser state followed by replacement frames.
   * @param request - session whose browser is followed.
   * @param signal - generation cancellation owned by the Remote stream carrier.
   * @returns one opening snapshot followed by the latest pending replacement; slow readers skip superseded frames.
   */
  @Remote({ mode: 'stream' })
  watch(request: BrowserWatchRequest, signal: AbortSignal): AsyncIterable<BrowserSnapshot> {
    return this.follow(request.sessionId, signal)
  }

  /**
   * Open a browser for an existing live session, optionally navigating to a url.
   * @param request - session and optional initial url.
   * @returns an open acknowledgement.
   */
  @Remote('open')
  async open(request: BrowserOpenRequest): Promise<BrowserOpenValue> {
    const session = this.ctx.sessions.get(request.sessionId)
    if (session === undefined) {
      throw new Error(`session "${request.sessionId}" not found`)
    }
    await this.ctx.browserControl.open(request.sessionId, request.url)
    if (this.ctx.sessions.get(request.sessionId) !== session) {
      await this.ctx.browserControl.close(request.sessionId)
      throw new Error(`session "${request.sessionId}" was disposed while opening its browser`)
    }
    return { ok: true }
  }

  /**
   * Close one session's browser, if any.
   * @param request - session whose browser is closed.
   * @returns a close acknowledgement after the browser context has closed.
   */
  @Remote('close')
  async close(request: BrowserCloseRequest): Promise<BrowserCloseValue> {
    await this.ctx.browserControl.close(request.sessionId)
    return { ok: true }
  }

  /**
   * Create and select a tab for a live session.
   * @param request - session and optional initial URL.
   * @returns acknowledgement after the tab is ready.
   */
  @Remote('createTab')
  async createTab(request: BrowserOpenRequest): Promise<BrowserOpenValue> {
    await this.changeTab(request.sessionId, () => this.ctx.browserControl.createTab(request.sessionId, request.url))
    return { ok: true }
  }

  /**
   * Select an existing tab owned by a live session.
   * @param request - session and tab identity.
   * @returns acknowledgement after the active tab changes.
   */
  @Remote('selectTab')
  async selectTab(request: BrowserTabRequest): Promise<BrowserOpenValue> {
    await this.changeTab(request.sessionId, () => this.ctx.browserControl.selectTab(request.sessionId, request.tabId))
    return { ok: true }
  }

  /**
   * Close a tab owned by a live session.
   * @param request - session and tab identity.
   * @returns acknowledgement after tab cleanup completes.
   */
  @Remote('closeTab')
  async closeTab(request: BrowserTabRequest): Promise<BrowserCloseValue> {
    await this.changeTab(request.sessionId, () => this.ctx.browserControl.closeTab(request.sessionId, request.tabId))
    return { ok: true }
  }

  private async changeTab(sessionId: SessionId, operation: () => Promise<void>): Promise<void> {
    const session = this.ctx.sessions.get(sessionId)
    if (session === undefined) throw new Error(`session "${sessionId}" not found`)
    await operation()
    if (this.ctx.sessions.get(sessionId) !== session) {
      await this.ctx.browserControl.close(sessionId)
      throw new Error(`session "${sessionId}" was disposed while changing browser tabs`)
    }
  }

  private async *follow(sessionId: SessionId, signal: AbortSignal): AsyncIterable<BrowserSnapshot> {
    signal.throwIfAborted()
    let latest: BrowserSnapshot | undefined
    let wake: (() => void) | undefined
    const unsubscribe = this.ctx.browserControl.subscribe(sessionId, (snapshot) => {
      latest = snapshot
      const pending = wake
      wake = undefined
      pending?.()
    })
    const onAbort = (): void => { wake?.() }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      yield this.ctx.browserControl.snapshot(sessionId)
      while (!signal.aborted) {
        if (latest !== undefined) {
          const snapshot = latest
          latest = undefined
          yield snapshot
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
