/** Local SearXNG JSON service for the real provider and web_search consumer. */
import { applyLoopbackServerEffect } from '../loopback-fixture-server.mjs'

/** Cordis plugin identity. */
export const name = 'searxng-fixture'

/**
 * Route only the fixture authority to an OS-assigned listener.
 * @param ctx - plugin owner of the listener and fetch wrapper.
 */
export async function apply(ctx) {
  let restore = () => {}
  await applyLoopbackServerEffect(ctx, {
    label: name,
    requestListener: (request, response) => {
      const url = new URL(request.url, 'http://localhost')
      if (request.method !== 'GET' || url.pathname !== '/search'
        || url.searchParams.get('format') !== 'json'
        || url.searchParams.get('q') !== 'SearXNG keyless search') {
        response.writeHead(400)
        response.end('Unexpected search request')
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ results: [{
        url: 'https://docs.searxng.org/dev/search_api.html',
        title: 'SearXNG Search API', content: 'Search an instance using its JSON API without a provider key.',
      }] }))
    },
    onListening: (address) => {
      const original = globalThis.fetch
      const wrapped = (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        if (url.hostname === 'searxng.snapshot.invalid') {
          url.hostname = '127.0.0.1'
          url.port = String(address.port)
          return original(input instanceof Request ? new Request(url, input) : url, init)
        }
        if (url.hostname === 'deepseek.snapshot.invalid') throw new Error('DeepSeek must not run when SearXNG is enabled')
        return original(input, init)
      }
      globalThis.fetch = wrapped
      restore = () => {
        if (globalThis.fetch !== wrapped) throw new Error('SearXNG fixture fetch owner changed')
        globalThis.fetch = original
      }
    },
    onCleanup: () => restore(),
  })
}
