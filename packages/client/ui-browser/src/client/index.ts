/**
 * Browser slots receive Session-scoped commands and a framework-bound observable
 * over the generated Remote stream. The adapter owns subscription lifetimes;
 * components own only viewing state.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BrowserInputEvent, BrowserSnapshot, BrowserTabId } from '@deepseek-ai/dsh-api-browser-controller/types'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
// Type-only: pulls the generated Remote API and ctx.remote merge (remote.browser).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the layout panel actions (ctx.layout.openBrowser/closeBrowser).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and the slot
// namespace map.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer-owned slots service.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { BrowserPanel } from './BrowserPanel.tsx'
import { StartBrowserDock } from './StartBrowserDock.tsx'
import { en, NS, zh, type BrowserKey } from './locales.ts'
import { BrowserState, type BrowserStreamHandle } from './browser-state.ts'

export type { BrowserPanelProps } from './BrowserPanel.tsx'
export type { BrowserKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The live browser panel's copy. */
    browser: BrowserKey
  }
}

/** The session-scoped verbs the BrowserPanel consumes. */
export interface BrowserInjected {
  /** Private observable bound to the component's framework-owned useBrowser hook. */
  hooks: { browser: BrowserState }
  /** Ensure an open browser for this session, navigating to the optional url. */
  start: (url?: string) => Promise<void>
  /** Navigate an open browser to a url. */
  navigate: (url: string) => Promise<void>
  /** Stop this session's browser and await its cleanup. */
  stop: () => Promise<void>
  /** Create and select a new session tab at the optional URL or configured homepage. */
  createTab: (url?: string) => Promise<void>
  /** Select a tab belonging to this session. */
  selectTab: (tabId: BrowserTabId) => Promise<void>
  /** Close one session-owned tab. */
  closeTab: (tabId: BrowserTabId) => Promise<void>
  /** Reveal the panel for a browser that opened without a panel gesture. */
  openPanel: () => void
  /** Forward one pointer, wheel, or keyboard event to the session's page. */
  sendInput: (event: BrowserInputEvent) => Promise<void>
  /** Close the right-side browser panel. */
  closePanel: () => void
}

/** Required services for the browser panel, remote mutations, layout, and copy. */
export const inject = ['slots', 'remote', 'remote.browser', 'layout', 'locale']

/** Open one reconnecting stream of browser snapshots that the panel can iterate. */
function openBrowserStream(remote: ClientRemote, sessionId: SessionId): BrowserStreamHandle {
  const raw = remote.$stream<BrowserSnapshot>({
    name: 'Browser state stream',
    open: signal => remote.browser.watch({ sessionId }, signal),
    ended: accepted => new Error(
      accepted
        ? 'Browser state stream ended'
        : 'Browser state stream closed before its opening snapshot',
    ),
  })
  return {
    [Symbol.asyncIterator]: () => (async function* () {
      for await (const item of raw) yield item.value
    })(),
    dispose: () => raw.dispose(),
  }
}

/**
 * Client plugin body: register the dictionaries, the top-right browser toggle,
 * and the right-side browser panel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-browser: dictionaries')
  const states = new Map<SessionId, BrowserState>()
  ctx.effect(() => async () => {
    const disposing = [...states.values()].map(state => state.dispose())
    states.clear()
    const results = await Promise.allSettled(disposing)
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failures.length > 0) throw new AggregateError(failures.map(result => result.reason as unknown), 'Browser subscriptions failed to close')
  }, 'ui-browser: session streams')
  const stateFor = (sessionId: SessionId): BrowserState => {
    let state = states.get(sessionId)
    if (state === undefined) {
      state = new BrowserState(() => openBrowserStream(ctx.remote, sessionId))
      states.set(sessionId, state)
    }
    return state
  }

  const startSessionBrowser = async (sessionId: SessionId, url?: string): Promise<void> => {
    const result = await ctx.remote.browser.open({
      sessionId,
      ...(typeof url === 'string' && url.trim() !== '' ? { url } : {}),
    })
    if (!result.ok) throw new Error(result.error.message)
    ctx.layout.openBrowser()
  }

  ctx.slots.inject('browser.toggle', () => ctx.slots.register({
    name: 'browser.toggle',
    locale: NS,
    inject: (sessionId: SessionId) => ({
      start: (url?: string) => startSessionBrowser(sessionId, url),
      closePanel: () => { ctx.layout.closeBrowser() },
    }),
  }, StartBrowserDock))

  ctx.slots.inject(
    'browser',
    () => ctx.slots.register({
      name: 'browser',
      locale: NS,
      inject: (sessionId: SessionId): BrowserInjected => ({
        hooks: { browser: stateFor(sessionId) },
        start: (url?: string) => startSessionBrowser(sessionId, url),
        navigate: url => startSessionBrowser(sessionId, url),
        createTab: async (url?: string) => {
          const result = await ctx.remote.browser.createTab({ sessionId, ...(url === undefined ? {} : { url }) })
          if (!result.ok) throw new Error(result.error.message)
        },
        selectTab: async (tabId) => {
          const result = await ctx.remote.browser.selectTab({ sessionId, tabId })
          if (!result.ok) throw new Error(result.error.message)
        },
        closeTab: async (tabId) => {
          const result = await ctx.remote.browser.closeTab({ sessionId, tabId })
          if (!result.ok) throw new Error(result.error.message)
        },
        openPanel: () => { ctx.layout.openBrowser() },
        sendInput: async (event) => {
          const result = await ctx.remote.browser.input({ sessionId, event })
          if (!result.ok) throw new Error(result.error.message)
        },
        stop: async () => {
          const result = await ctx.remote.browser.close({ sessionId })
          if (!result.ok) throw new Error(result.error.message)
        },
        closePanel: () => { ctx.layout.closeBrowser() },
      }),
    }, BrowserPanel),
  )
}
