/** Real Loader compositions exercise listener ownership and startup failures. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import SessionMcpServer from '../src/index.ts'
import type { Config } from '../src/config.ts'

const owned: Array<{ context: Context; root: string }> = []

afterEach(async () => {
  for (const { context, root } of owned.splice(0).reverse()) {
    try {
      await context.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

async function load(config: Partial<Config> = {}, web = false) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-mcp-lifecycle-'))
  const context = new Context()
  owned.push({ context, root })
  const path = join(root, 'cordis.yml')
  await writeFile(path, JSON.stringify([
    { name: '@deepseek-ai/dsh-session' },
    { name: '@deepseek-ai/dsh-agent' },
    { name: '@deepseek-ai/dsh-session-query-sqlite', config: { path: ':memory:', openAt: 'never' } },
    ...(web ? [{ name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } }] : []),
    { name: '@deepseek-ai/dsh-session-mcp', ...(web ? { inject: ['webServer'] } : {}), config: { port: 0, ...config } },
  ]) + '\n')
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-session-query-sqlite', SessionQuery],
    ['@deepseek-ai/dsh-host-webserver', WebServer],
    ['@deepseek-ai/dsh-session-mcp', SessionMcpServer],
  ])
  // The real Loader resolves test-selected modules without requiring built package exports.
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`Unexpected test module ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } })
  await context.loader.await()
  return context
}

async function initialize(endpoint: string) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'lifecycle-test', version: '1.0' },
    } }),
  })
  const body = await response.text()
  return { status: response.status, body }
}

describe('MCP lifecycle through Loader', () => {
  it('publishes an assigned port and serves initialization at the exact uppercase path', async () => {
    const context = await load()
    const endpoint = context.sessionMcp.endpoint
    expect(new URL(endpoint).pathname).toBe('/MCP')
    expect(Number(new URL(endpoint).port)).toBeGreaterThan(0)
    const initialized = await initialize(endpoint)
    expect(initialized.status).toBe(200)
    expect(initialized.body).toContain('protocolVersion')
    const missing = await fetch(endpoint.replace('/MCP', '/mcp'))
    expect(missing.status).toBe(404)
    await missing.text()
  })

  it('fails on an occupied port and allows rebinding after teardown', async () => {
    const first = await load()
    const endpoint = first.sessionMcp.endpoint
    const port = Number(new URL(endpoint).port)
    await expect(load({ port })).rejects.toThrow('EADDRINUSE')
    await first.fiber.dispose()
    const replacement = await load({ port })
    expect((await initialize(replacement.sessionMcp.endpoint)).status).toBe(200)
  })

  it('rejects malformed pathnames during Loader activation', async () => {
    for (const path of ['MCP', '//MCP', '/MCP/', '/MCP?query', '/MCP#fragment', '/a/../MCP']) {
      await expect(load({ path })).rejects.toThrow('pathname')
    }
  })

  it('rejects web transport without its host service', async () => {
    await expect(load({ transport: 'web-server' })).rejects.toThrow('requires webServer')
  })

  it('releases a Web route while leaving the composed listener alive', async () => {
    const context = await load({ transport: 'web-server' }, true)
    const endpoint = context.sessionMcp.endpoint
    expect(Number(new URL(endpoint).port)).toBe(context.webServer.port)
    expect((await initialize(endpoint)).status).toBe(200)
    const entry = [...context.loader.entries()].find(candidate => candidate.options.name === '@deepseek-ai/dsh-session-mcp')
    if (entry?.fiber === undefined) throw new Error('MCP Loader entry has no fiber')
    await entry.fiber.dispose()
    const response = await fetch(endpoint)
    expect(response.status).toBe(404)
    await response.text()
    const unregister = context.webServer.register({ kind: 'exact', path: '/MCP', handler: (_request, reply) => {
      reply.writeHead(200).end('released')
    } })
    try {
      expect(await (await fetch(endpoint)).text()).toBe('released')
    } finally {
      unregister()
    }
  })
})
