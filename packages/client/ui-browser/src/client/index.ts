/**
 * Live browser panel plugin, browser half: one registration into the layout's
 * right-side 'browser' column renders the current session's browser view. The
 * live snapshots arrive through the generated `remote.browser` stream (opened
 * per session), so the plugin issues no fetch chain and holds no business
 * state of its own beyond the panel's transient viewing state. The inject face
 * carries the session-scoped verbs (open the stream, start/navigate a browser,
 * and open/close the layout panel).
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createBrowserSource } from './source.ts'
import type { BrowserSource } from './source.ts'
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
  /** Renderer-bound live browser state. */
  hooks: { browser: BrowserSource }
  /** Ensure an open browser for this session, navigating to the optional url. */
  start: (url?: string) => Promise<void>
  /** Navigate an open browser to a url. */
  navigate: (url: string) => Promise<void>
  /** Stop this session's browser and await its cleanup. */
  stop: () => Promise<void>
  /** Close the right-side browser panel. */
  closePanel: () => void
}

/** Required services for the browser panel, remote mutations, layout, and copy. */
export const inject = ['slots', 'remote', 'remote.browser', 'layout', 'locale']

/**
 * Client plugin body: register the dictionaries, the top-right browser toggle,
 * and the right-side browser panel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-browser: dictionaries')

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
        hooks: { browser: createBrowserSource(ctx.remote, sessionId) },
        start: (url?: string) => startSessionBrowser(sessionId, url),
        navigate: url => startSessionBrowser(sessionId, url),
        stop: async () => {
          const result = await ctx.remote.browser.close({ sessionId })
          if (!result.ok) throw new Error(result.error.message)
        },
        closePanel: () => { ctx.layout.closeBrowser() },
      }),
    }, BrowserPanel),
  )
}
