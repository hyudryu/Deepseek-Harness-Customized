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
  /** Maximum response body size in bytes; a larger body is refused. */
  readonly maxResponseBytes: number
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
      const payload: unknown = await this.readBody(response, options.maxResponseBytes)
      return mapResponse(payload)
    } catch (error: unknown) {
      if (signal?.aborted === true) throw new WebError('SearXNG search aborted', 'WEB_ABORTED', { cause: signal.reason })
      if (deadline.aborted) throw new WebError('SearXNG search timed out', 'WEB_TIMEOUT', { cause: error })
      if (error instanceof WebError) throw error
      throw new WebError('SearXNG search failed; verify the instance endpoint and JSON search format', 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  /**
   * Read and parse the response body, first refusing one larger than
   * `maxResponseBytes`. Reading the stream counts bytes per chunk so an
   * oversized single chunk or multi-byte payload is rejected before any full
   * body or field can be buffered into the model-facing result.
   * @param response - the fetched response.
   * @param maxBytes - response body cap in bytes.
   * @returns the parsed JSON payload.
   */
  private async readBody(response: Response, maxBytes: number): Promise<unknown> {
    /* v8 ignore next -- a 2xx fetch response always exposes a body stream; the null guard is defensive. */
    if (response.body === null) return {}
    const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new WebError(`SearXNG response exceeds the maximum of ${maxBytes} bytes`, 'WEB_PROVIDER_ERROR')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
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
    // Deduplicate and return the canonical `url.href`, not the raw string: a
    // non-canonical but parseable value such as `https:evil.example` passes the
    // protocol check here but would be emitted relative to the Harness origin,
    // and equivalent spellings would bypass deduplication.
    const href = url.href
    if (seen.has(href)) continue
    seen.add(href)
    sources.push({
      url: href,
      ...(typeof item.title === 'string' && item.title.length > 0 ? { title: item.title } : {}),
      ...(typeof item.content === 'string' && item.content.length > 0 ? { snippet: item.content } : {}),
      ...(typeof item.publishedDate === 'string' && item.publishedDate.length > 0 ? { publishedAt: item.publishedDate } : {}),
    })
  }
  return { sources, truncated: false }
}
