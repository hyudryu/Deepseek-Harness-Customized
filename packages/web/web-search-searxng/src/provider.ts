/** SearXNG JSON API adapter with bounded, cancellable HTTP requests. @module */
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'

/** Fully resolved settings captured once for each search. */
export interface SearXNGSearchOptions {
  /** Whether this provider participates in selection. */
  readonly enabled: boolean
  /** Validated instance base URL. */
  readonly baseURL: string
  /** Deadline covering dispatch and response decoding. */
  readonly timeoutMs: number
}

/** Search provider for an instance exposing SearXNG's JSON search format. */
export class SearXNGSearchProvider implements WebSearchProvider {
  readonly id = 'searxng'

  constructor(private readonly resolveOptions: () => SearXNGSearchOptions) {}

  available(): boolean {
    return this.resolveOptions().enabled
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions()
    if (!options.enabled) throw new WebError('SearXNG search is disabled', 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
    const deadline = AbortSignal.timeout(options.timeoutMs)
    const combined = signal === undefined ? deadline : AbortSignal.any([signal, deadline])
    const endpoint = new URL(`${options.baseURL.replace(/\/+$/u, '')}/search`)
    endpoint.searchParams.set('q', request.query)
    endpoint.searchParams.set('format', 'json')
    try {
      combined.throwIfAborted()
      const response = await fetch(endpoint, { signal: combined, redirect: 'error', headers: { accept: 'application/json' } })
      if (!response.ok) {
        await response.body?.cancel()
        throw new WebError(response.status === 403
          ? 'SearXNG returned HTTP 403; enable json in search.formats in the SearXNG settings.yml and verify instance access'
          : `SearXNG returned HTTP ${response.status}`, 'WEB_PROVIDER_ERROR')
      }
      const payload: unknown = await response.json()
      return mapResponse(payload)
    } catch (error: unknown) {
      if (signal?.aborted === true) throw new WebError('SearXNG search aborted', 'WEB_ABORTED', { cause: signal.reason })
      if (deadline.aborted) throw new WebError('SearXNG search timed out', 'WEB_TIMEOUT', { cause: error })
      if (error instanceof WebError) throw error
      throw new WebError('SearXNG search failed; verify the instance endpoint and JSON search format', 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mapResponse(payload: unknown): WebSearchResult {
  if (!record(payload) || !Array.isArray(payload.results)) {
    throw new WebError('SearXNG response must contain a results array', 'WEB_PROVIDER_ERROR')
  }
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  for (const item of payload.results) {
    if (!record(item) || typeof item.url !== 'string' || !URL.canParse(item.url)) {
      throw new WebError('SearXNG result must contain an absolute URL', 'WEB_PROVIDER_ERROR')
    }
    const url = new URL(item.url)
    if (!['http:', 'https:'].includes(url.protocol)) continue
    for (const field of ['title', 'content', 'publishedDate']) {
      if (item[field] !== undefined && item[field] !== null && typeof item[field] !== 'string') {
        throw new WebError(`SearXNG result ${field} must be a string`, 'WEB_PROVIDER_ERROR')
      }
    }
    if (seen.has(item.url)) continue
    seen.add(item.url)
    sources.push({
      url: item.url,
      ...(typeof item.title === 'string' && item.title.length > 0 ? { title: item.title } : {}),
      ...(typeof item.content === 'string' && item.content.length > 0 ? { snippet: item.content } : {}),
      ...(typeof item.publishedDate === 'string' && item.publishedDate.length > 0 ? { publishedAt: item.publishedDate } : {}),
    })
  }
  return { sources, truncated: false }
}
