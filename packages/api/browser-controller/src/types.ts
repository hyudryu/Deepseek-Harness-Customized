/** Browser-control Remote wire types: live per-session browser state and action log. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Opaque identity of a tab owned by one session. */
export type BrowserTabId = Branded<'BrowserTabId'>

/** Public facts about one session-owned browser tab. */
export interface BrowserTab {
  readonly id: BrowserTabId
  readonly title: string
  readonly url: string
}

/** One recorded Playwright tool action for a session's browser. */
export interface BrowserActionEntry {
  /** Monotonic per-session action sequence. */
  readonly id: number
  /** Action name: open, reload, back, click, fill, press, select, check, uncheck, assert, viewport, ... */
  readonly action: string
  /** JSON string of the tool arguments (lossless, model-visible summary). */
  readonly args: string
  /** Whether the tool action completed without throwing. */
  readonly ok: boolean
  /** Page URL after the action. */
  readonly url: string
  /** Action epoch milliseconds. */
  readonly time: number
  /** Viewport width at capture, when known. */
  readonly viewportWidth?: number
  /** Viewport height at capture, when known. */
  readonly viewportHeight?: number
  /** Page-relative x of the pointer target, when the action targets a point. */
  readonly clickX?: number
  /** Page-relative y of the pointer target, when the action targets a point. */
  readonly clickY?: number
}

/** Complete, replaceable snapshot of one session's browser. */
export interface BrowserSnapshot {
  /** True when a browser context/page is open for the session. */
  readonly open: boolean
  /** Provider used by the session browser. */
  readonly backend?: 'chrome' | 'playwright'
  /** Session-owned tabs in browser order; unrelated user tabs are excluded. */
  readonly tabs?: readonly BrowserTab[]
  /** Identity of the tab supplying the current frame and address. */
  readonly activeTabId?: BrowserTabId
  /** Current page URL (empty when closed). */
  readonly url: string
  /** Current page title (empty when closed). */
  readonly title: string
  /** Bounded action log in execution order, oldest first. */
  readonly actions: readonly BrowserActionEntry[]
  /** Latest captured page frame as a base64 data URL, when a frame is available. */
  readonly frame?: string
  /** Captured frame natural width in px. */
  readonly frameWidth?: number
  /** Captured frame natural height in px. */
  readonly frameHeight?: number
}

/** Watch request for one session's browser stream. */
export interface BrowserWatchRequest {
  readonly sessionId: SessionId
}

/** Open request; url is optional and defaults to the configured homepage. */
export interface BrowserOpenRequest {
  readonly sessionId: SessionId
  readonly url?: string
}

/** Open acknowledgement. */
export interface BrowserOpenValue {
  readonly ok: boolean
}

/** Close request for one session's browser. */
export interface BrowserCloseRequest {
  readonly sessionId: SessionId
}

/** Close acknowledgement. */
export interface BrowserCloseValue {
  readonly ok: boolean
}


/** Select or close one tab owned by the requested session. */
export interface BrowserTabRequest {
  readonly sessionId: SessionId
  readonly tabId: BrowserTabId
}
