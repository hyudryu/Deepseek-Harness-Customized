/** Real HTTP admission, protocol initialization, and teardown regressions. */
import { createServer, request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, expect, it } from 'vitest'
import { Config } from '../src/index.ts'
import type { Config as McpConfig } from '../src/config.ts'
import type { SessionManagement } from '../src/sessions.ts'
import { createMcpHandler } from '../src/http.ts'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(close => close())) })

async function endpoint(overrides: Partial<McpConfig> = {}, management = {} as SessionManagement) {
  // Schema input accepts omitted defaulted fields; its callable type describes the resolved config.
  const config = Config(overrides as McpConfig)
  const server = createServer((req, res) => { void handler.handle(req, res) })
  const handler = createMcpHandler(management, config, () => (server.address() as AddressInfo).port)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(async () => {
    await handler.close()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() })
  })
  const port = (server.address() as AddressInfo).port
  return { handler, url: `http://127.0.0.1:${String(port)}/MCP` }
}

const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
const initialize = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
  protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' },
} })

it('initializes a stateless MCP connection over the exact configured pathname', async () => {
  const { url } = await endpoint()
  const response = await fetch(url, { method: 'POST', headers, body: initialize })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'dsh-session-management' } } })
  expect((await fetch(url.replace('/MCP', '/mcp'))).status).toBe(404)
  const get = await fetch(url)
  expect(get.status).toBe(405)
  expect(get.headers.get('Allow')).toBe('POST')
})

it('rejects remote browser origins, batches, oversized IDs, and oversized bodies', async () => {
  const { url } = await endpoint({ maxRequestBytes: 1024 })
  expect((await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'http://evil.example' }, body: initialize })).status).toBe(403)
  for (const body of ['[]', JSON.stringify({ jsonrpc: '2.0', id: 'x'.repeat(129), method: 'ping' })]) {
    expect((await fetch(url, { method: 'POST', headers, body })).status).toBe(400)
  }
  expect((await fetch(url, { method: 'POST', headers, body: 'x'.repeat(1025) })).status).toBe(413)
})

it('expires a stalled body and releases admission for the next request', async () => {
  const { url } = await endpoint({ requestTimeoutMs: 30, maxConcurrentRequests: 1 })
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(url, { method: 'POST', headers }, (response) => {
      response.resume()
      response.once('end', () => { request.destroy(); resolve(response.statusCode) })
    })
    request.once('error', reject)
    request.write('{')
  })
  expect(status).toBe(504)
  expect((await fetch(url, { method: 'POST', headers, body: initialize })).status).toBe(200)
})

it('awaits signal-ignoring tool work before plugin disposal completes', async () => {
  const entered: PromiseWithResolvers<void> = Promise.withResolvers()
  const release = Promise.withResolvers<unknown>()
  const { url, handler } = await endpoint({}, {
    listProjects: () => { entered.resolve(); return release.promise },
  } as unknown as SessionManagement)
  const response = fetch(url, { method: 'POST', headers, body: JSON.stringify({
    jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_projects', arguments: {} },
  }) })
  await entered.promise
  let disposed = false
  const closing = handler.close().then(() => { disposed = true })
  try {
    expect((await response).status).toBe(503)
    expect(disposed).toBe(false)
  } finally {
    release.resolve({ projects: [] })
    await closing
  }
  expect(disposed).toBe(true)
})

it('supports the MCP SDK client across initialization, discovery, and successive tool calls', async () => {
  const projects = { items: [{ directory: '/work/project', title: 'Project', sessionCount: 2 }], total: 1 }
  const { url } = await endpoint({}, { listProjects: async () => projects } as unknown as SessionManagement)
  const client = new Client({ name: 'supervisor-test', version: '1' })
  try {
    // SDK transport callback setters accept undefined; Transport uses exact optional callbacks.
    await client.connect(new StreamableHTTPClientTransport(new URL(url)) as Transport)
    expect((await client.listTools()).tools.map(tool => tool.name)).toContain('list_projects')
    for (let index = 0; index < 2; index++) {
      expect(await client.callTool({ name: 'list_projects', arguments: {} })).toMatchObject({
        content: [{ type: 'text', text: JSON.stringify(projects) }],
      })
    }
  } finally {
    await client.close()
  }
})

it('calls every supervision tool and reports bounded backend errors', async () => {
  const { url } = await endpoint({}, {
    listSessions: async () => ({ items: [{ sessionId: 's', title: 'XYZ' }] }),
    readSession: async () => ({ sessionId: 's', events: [] }),
    sendMessage: async () => ({ accepted: true }),
    stopSession: async () => { throw new Error('Cannot stop absent session') },
  } as unknown as SessionManagement)
  const client = new Client({ name: 'supervisor-test', version: '1' })
  try {
    // SDK transport callback setters accept undefined; Transport uses exact optional callbacks.
    await client.connect(new StreamableHTTPClientTransport(new URL(url)) as Transport)
    for (const [name, args] of [
      ['list_sessions', {}], ['get_session', { sessionId: 's' }], ['send_message', { sessionId: 's', text: 'Continue' }],
    ] as const) {
      expect((await client.callTool({ name, arguments: args })).isError).not.toBe(true)
    }
    expect(await client.callTool({ name: 'stop_session', arguments: { sessionId: 'absent' } })).toMatchObject({ isError: true })
  } finally { await client.close() }
})

it('omits control tools when disabled and bounds oversized results and thrown text', async () => {
  let oversized = true
  const { url } = await endpoint({ allowControl: false, maxResponseBytes: 4096 }, {
    listProjects: async () => {
      if (oversized) return { text: '?'.repeat(4096) }
      // Provider rejections cross an asynchronous boundary and need not be Error instances.
      throw '?'.repeat(4096)
    },
  } as unknown as SessionManagement)
  const client = new Client({ name: 'supervisor-test', version: '1' })
  try {
    // SDK transport callback setters accept undefined; Transport uses exact optional callbacks.
    await client.connect(new StreamableHTTPClientTransport(new URL(url)) as Transport)
    expect((await client.listTools()).tools).toHaveLength(3)
    const result = await client.callTool({ name: 'list_projects', arguments: {} })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('smaller page')
    oversized = false
    const rejected = await client.callTool({ name: 'list_projects', arguments: {} })
    expect(rejected.isError).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(rejected))).toBeLessThan(4096)
  } finally { await client.close() }
})

it('rejects additional requests during bounded admission and after disposal', async () => {
  const entered: PromiseWithResolvers<void> = Promise.withResolvers()
  const release = Promise.withResolvers<unknown>()
  const { url, handler } = await endpoint({ maxConcurrentRequests: 1 }, {
    listProjects: () => { entered.resolve(); return release.promise },
  } as unknown as SessionManagement)
  const first = fetch(url, { method: 'POST', headers, body: JSON.stringify({
    jsonrpc: '2.0', id: 'read', method: 'tools/call', params: { name: 'list_projects', arguments: {} },
  }) })
  await entered.promise
  try {
    expect((await fetch(url, { method: 'POST', headers, body: initialize })).status).toBe(429)
  } finally { release.resolve({ items: [] }) }
  expect((await first).status).toBe(200)
  await handler.close()
  expect((await fetch(url, { method: 'POST', headers, body: initialize })).status).toBe(503)
})

it('rejects malformed JSON and unsafe IDs while accepting a matching browser origin', async () => {
  const { url } = await endpoint()
  for (const body of ['{', 'null', '5', JSON.stringify({ id: null }), JSON.stringify({ id: 1.5 })]) {
    expect((await fetch(url, { method: 'POST', headers, body })).status).toBe(400)
  }
  expect((await fetch(url, { method: 'POST', headers: { ...headers, Origin: new URL(url).origin }, body: initialize })).status).toBe(200)
})

it('cancels active reads when the supervising client disconnects', async () => {
  const entered: PromiseWithResolvers<void> = Promise.withResolvers()
  const stopped: PromiseWithResolvers<void> = Promise.withResolvers()
  const { url, handler } = await endpoint({}, {
    listProjects: (_request: unknown, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { stopped.resolve(); reject(new Error('Client disconnected')) }, { once: true })
      entered.resolve()
    }),
  } as unknown as SessionManagement)
  const controller = new AbortController()
  const pending = fetch(url, { method: 'POST', headers, signal: controller.signal, body: JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_projects', arguments: {} },
  }) })
  await entered.promise
  controller.abort()
  await expect(pending).rejects.toThrow()
  await stopped.promise
  await handler.close()
})

it('terminates an already committed response when shared middleware precedes a rejected request', async () => {
  const config = Config({} as McpConfig)
  const server = createServer((request, response) => {
    response.writeHead(200)
    response.flushHeaders()
    void handler.handle(request, response)
  })
  const handler = createMcpHandler({} as SessionManagement, config, () => (server.address() as AddressInfo).port)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await handler.close()
    const url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/MCP`
    await expect(fetch(url).then(response => response.text())).rejects.toThrow()
  } finally {
    await new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() })
  }
})

it('bounds the serialized RPC id so escaped IDs cannot exceed the response budget', async () => {
  const { url } = await endpoint({ maxResponseBytes: 4096 }, {
    listProjects: async () => ({ text: '\\'.repeat(835) }),
  } as unknown as SessionManagement)
  const call = (id: string) => fetch(url, { method: 'POST', headers, body: JSON.stringify({
    jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'list_projects', arguments: {} },
  }) })
  expect((await call('\0'.repeat(128))).status).toBe(400)
  const accepted = await call('\0'.repeat(21))
  expect(accepted.status).toBe(200)
  expect(Buffer.byteLength(await accepted.text())).toBeLessThanOrEqual(4096)
})
