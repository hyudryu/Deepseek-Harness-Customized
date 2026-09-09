/** Local HTTP coverage for the SearXNG JSON adapter. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { SearXNGSearchProvider, Config } from '../src/index.ts'

let origin: string
let targetHits = 0
const server = createServer((request, response) => {
  const url = new URL(request.url!, 'http://fixture.test')
  if (url.pathname === '/target') { targetHits++; response.end(); return }
  const query = url.searchParams.get('q')
  if (query === 'hang') return
  if (query === 'body-hang') { response.writeHead(200, { 'content-type': 'application/json' }); response.write('{'); return }
  if (query === 'redirect') { response.writeHead(302, { location: `${origin}/target` }).end(); return }
  if (query === '403' || query === '500') { response.writeHead(Number(query)).end(); return }
  if (query === 'invalid-json') { response.end('<html>'); return }
  if (query === 'invalid-results') { response.end('{}'); return }
  if (query === 'invalid-url') { response.end(JSON.stringify({ results: [{ url: 'relative' }] })); return }
  if (query === 'invalid-title') { response.end(JSON.stringify({ results: [{ url: 'https://a.test', title: 1 }] })); return }
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify({ results: query === 'empty' ? [] : [
    { url: 'https://a.test', title: url.pathname, content: url.searchParams.get('format'), publishedDate: '2026-09-08T00:00:00Z' },
    { url: 'https://a.test', title: 'duplicate' }, { url: 'https://b.test' }, { url: 'mailto:a@test' },
  ] }))
})
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
})
function provider(timeoutMs = 1000): SearXNGSearchProvider {
  return new SearXNGSearchProvider(() => ({ enabled: true, baseURL: `${origin}/prefix/`, timeoutMs }))
}
describe('SearXNG HTTP search', () => {
  it('requests JSON under the configured prefix and preserves portable, unique sources', async () => {
    expect(provider().available()).toBe(true)
    await expect(provider().search({ query: 'a & b' })).resolves.toEqual({ sources: [
      { url: 'https://a.test', title: '/prefix/search', snippet: 'json', publishedAt: '2026-09-08T00:00:00Z' },
      { url: 'https://b.test' },
    ], truncated: false })
  })
  it('accepts an empty result set', async () => {
    await expect(provider().search({ query: 'empty' })).resolves.toEqual({ sources: [], truncated: false })
  })
  it.each(['500', 'invalid-json', 'invalid-results', 'invalid-url', 'invalid-title'])('reports %s as a provider error', async (query) => {
    await expect(provider().search({ query })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })
  it('explains JSON format configuration on HTTP 403', async () => {
    await expect(provider().search({ query: '403' })).rejects.toThrow('search.formats')
  })
  it('rejects redirects without contacting their target', async () => {
    await expect(provider().search({ query: 'redirect' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(targetHits).toBe(0)
  })
  it.each(['hang', 'body-hang'])('bounds the complete %s response', async (query) => {
    await expect(provider(50).search({ query })).rejects.toMatchObject({ code: 'WEB_TIMEOUT' })
  })
  it('honors cancellation before dispatch and during the response', async () => {
    await expect(provider().search({ query: 'hang' }, AbortSignal.abort('stop'))).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    const controller = new AbortController()
    const pending = provider().search({ query: 'body-hang' }, controller.signal)
    controller.abort('stop')
    await expect(pending).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })
  it('rejects direct calls while disabled', async () => {
    const disabled = new SearXNGSearchProvider(() => ({ enabled: false, baseURL: origin, timeoutMs: 1000 }))
    expect(disabled.available()).toBe(false)
    await expect(disabled.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' })
  })
  it.each(['file:///tmp', 'https://user:password@test', 'https://test?q=1', 'https://test#fragment', 'invalid'])('rejects invalid base %s', (baseURL) => {
    expect(() => Config({ baseURL })).toThrow()
  })
  it.each([0, -1, 0.5, 2147483648])('rejects invalid timeout %s', (timeoutMs) => {
    expect(() => Config({ timeoutMs })).toThrow()
  })
})
