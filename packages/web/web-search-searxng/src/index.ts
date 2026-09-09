/** SearXNG provider registration and live configuration. @module */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-web'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { SearXNGSearchProvider } from './provider.ts'

export { SearXNGSearchProvider } from './provider.ts'
export type { SearXNGSearchOptions } from './provider.ts'

/** Loader plugin name. */
export const name = 'web-search-searxng'
/** Required provider registry. */
export const inject = ['web']
/** Settings section edited by the plugin configuration card. */
export const WEB_SEARCH_SEARXNG_SETTINGS_NAMESPACE = 'web-search-searxng'

/** Deployment settings; defaults are resolved before provider execution. */
export interface Config {
  /** Make SearXNG available for search selection. */
  enabled?: boolean
  /** HTTP(S) instance base, optionally including a path prefix. */
  baseURL?: string
  /** Complete request and response deadline in milliseconds. */
  timeoutMs?: number
}

/** Validated settings accepted by the loader and live settings service. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  baseURL: z.transform(z.string(), (value) => {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('SearXNG baseURL must be HTTP(S), without credentials, query, or fragment')
    }
    return value
  }).default('http://127.0.0.1:8080'),
  timeoutMs: z.number().step(1).min(1).max(2147483647).default(30000),
})

/** Register a provider whose next operation observes committed settings. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, WEB_SEARCH_SEARXNG_SETTINGS_NAMESPACE, Config, config, {
      setSource: (source) => { current = source },
      onChange: () => {},
    })
  })
  ctx.inject(['systemPrompt', 'tools'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'provider:web_search:searxng',
      order: promptCtx.systemPrompt.getSectionOrder('TOOL_WEB_SEARCH'),
      text: ({ scope }) => current().enabled === true && promptCtx.tools.get('web_search', scope) !== undefined
        ? 'SearXNG is enabled for web_search. When selected by this profile, it searches the configured SearXNG instance without an API key and returns source URLs with snippets rather than a generated answer. Use the same queries array and query limit described by web_search, and cite relevant source URLs as Markdown links. A profile that prefers SearXNG selects it ahead of its configured fallback, such as DeepSeek search. Disabling SearXNG restores that fallback; a failed SearXNG request returns an error without automatically retrying through DeepSeek.'
        : '',
    })
  })
  ctx.web.registerSearchProvider(new SearXNGSearchProvider(() => {
    const resolved = current()
    return {
      enabled: resolved.enabled ?? false,
      baseURL: resolved.baseURL ?? 'http://127.0.0.1:8080',
      timeoutMs: resolved.timeoutMs ?? 30000,
    }
  }))
}
