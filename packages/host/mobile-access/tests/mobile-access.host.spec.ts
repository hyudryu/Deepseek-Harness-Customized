/** Real Loader composition exercises authenticated desktop controls and listener disposal. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer, request } from 'node:http'
import { connect } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as MobileAccess from '../src/index.ts'
import { tailscaleAddress } from '../src/tailscale.ts'

vi.mock('../src/tailscale.ts', () => ({ tailscaleAddress: vi.fn(async () => '127.0.0.2') }))
let context: Context | undefined
let directory: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  vi.mocked(tailscaleAddress).mockResolvedValue('127.0.0.2')
})

async function boot(host = '127.0.0.1'): Promise<Context> {
  directory = await mkdtemp(join(tmpdir(), 'dsh-mobile-'))
  const config = join(directory, 'cordis.yml')
  await writeFile(config, [
    '- name: credentials', '  config:', `    path: '${join(directory, 'credentials.yaml')}'`, '    watch: false',
    '- name: webserver', '  config:', `    host: '${host}'`, '    port: 0',
    '- name: connection', '- id: mobile', '  name: mobile-access', '',
  ].join('\n'))
  const ctx = context = new Context()
  ctx.baseUrl = pathToFileURL(directory).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['credentials', LocalCredentials], ['webserver', WebServer], ['connection', Connection], ['mobile-access', MobileAccess],
  ])
  ctx.loader.internal = {
    version: 'v2', async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`Unknown test plugin ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  ctx.effect(() => ctx.webServer.registerFallback((req, res) => {
    if (!ctx.connection.authorizeIndex(req, res)) return
    res.end('existing sessions')
  }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/asset.js', handler: (_req, res) => { res.end('asset') } }))
  ctx.connection.fetch.register({ path: '/api/mobile-test', methods: ['GET'], requestBody: 'buffered', fetch: async () => new Response('same session API') })
  ctx.effect(() => ctx.webServer.registerUpgrade({ path: '/mobile-test-socket', handler: (_req, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n')
  } }))
  return ctx
}

async function call(url: string, cookie = '', method = 'GET', body?: string, extraHeaders: Record<string, string> = {}, rawPath?: string): Promise<{ status: number; cookie: string; body: string }> {
  return new Promise((resolve, reject) => {
    const options = { method, headers: { cookie, ...extraHeaders }, ...(rawPath === undefined ? {} : { path: rawPath }) }
    const req = request(url, options, (res) => {
      let content = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { content += chunk })
      res.on('end', () => { resolve({ status: res.statusCode!, cookie: res.headers['set-cookie']?.[0]?.split(';')[0] ?? '', body: content }) })
    })
    req.on('error', reject)
    req.end(body)
  })
}

it('starts disabled, authenticates the tailnet, and revokes only mobile access', async () => {
  const ctx = await boot()
  const desktop = `http://127.0.0.1:${String(ctx.webServer.port)}`
  const mobile = `http://127.0.0.2:${String(ctx.webServer.port)}`
  expect((await call(desktop + '/mobile-access')).status).toBe(401)
  const desktopCookie = (await call(ctx.connection.authenticatedUrl(desktop))).cookie
  expect(JSON.parse((await call(desktop + '/mobile-access', desktopCookie)).body)).toEqual({ enabled: false, url: null })
  expect((await call(desktop + '/mobile-access', desktopCookie, 'DELETE')).status).toBe(405)
  expect((await call(desktop + '/mobile-access', desktopCookie, 'POST', 'x'.repeat(1025))).status).toBe(413)
  expect((await call(desktop + '/mobile-access', desktopCookie, 'POST', '{"enabled":false}')).status).toBe(200)
  expect((await call(desktop + '/mobile-access', desktopCookie, 'POST', '{"enabled":true}', { origin: 'http://attacker.invalid' })).status).toBe(403)
  expect((await call(desktop + '/mobile-access', desktopCookie, 'POST', '{"enabled":"yes"}')).status).toBe(400)
  const on = await call(desktop + '/mobile-access', desktopCookie, 'POST', '{"enabled":true}')
  expect(on.status).toBe(200)
  const state = JSON.parse(on.body) as { enabled: boolean; url: string }
  expect(state.enabled).toBe(true)
  expect((await call(desktop + '/mobile-access', desktopCookie, 'POST', '{"enabled":true}')).status).toBe(200)
  expect((await call(mobile + '/asset.js')).status).toBe(403)
  expect((await call(mobile, '', 'GET', undefined, {}, 'http://[')).status).toBe(403)
  const mobileCookie = (await call(state.url)).cookie
  expect((await call(mobile + '/', mobileCookie)).body).toBe('existing sessions')
  expect((await call(mobile + '/asset.js', mobileCookie)).body).toBe('asset')
  expect((await call(mobile + '/api/mobile-test', mobileCookie)).body).toBe('same session API')
  expect((await call(mobile + '/asset.js', desktopCookie)).status).toBe(403)
  expect((await call(mobile + '/asset.js', mobileCookie, 'GET', undefined, { host: 'attacker.invalid' })).status).toBe(403)
  expect((await call(mobile + '/asset.js', mobileCookie, 'GET', undefined, { origin: 'http://attacker.invalid' })).status).toBe(403)
  expect((await call(mobile + '/mobile-access', mobileCookie)).status).toBe(403)
  const upgraded = connect({ host: '127.0.0.2', port: ctx.webServer.port })
  const socketClosed = new Promise<void>((resolve) => { upgraded.once('close', () => { resolve() }) })
  try {
    const response = new Promise<string>((resolve, reject) => {
      upgraded.once('data', (data: Buffer) => { resolve(data.toString()) })
      upgraded.once('error', reject)
    })
    upgraded.write(`GET /mobile-test-socket HTTP/1.1\r\nHost: ${new URL(mobile).host}\r\nCookie: ${mobileCookie}\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n`)
    expect(await response).toContain('101 Switching Protocols')
    expect((await call(desktop + '/mobile-access', desktopCookie, 'POST', '{"enabled":false}')).status).toBe(200)
    await socketClosed
  } finally {
    upgraded.destroy()
    await socketClosed
  }
  await expect(call(mobile + '/')).rejects.toThrow()
  expect((await call(desktop + '/', desktopCookie)).body).toBe('existing sessions')
  expect((await call(desktop + '/mobile-access', desktopCookie, 'POST', '{"enabled":true}')).status).toBe(200)
  await Array.from(ctx.loader.entries()).find(entry => entry.options.id === 'mobile')!.fiber!.dispose()
  await expect(call(mobile + '/')).rejects.toThrow()
  expect((await call(desktop + '/', desktopCookie)).body).toBe('existing sessions')
})

it('keeps desktop available and access off when Tailscale discovery fails', async () => {
  const ctx = await boot()
  const desktop = `http://127.0.0.1:${String(ctx.webServer.port)}`
  const cookie = (await call(ctx.connection.authenticatedUrl(desktop))).cookie
  vi.mocked(tailscaleAddress).mockRejectedValue(new Error('Tailscale is offline'))
  const result = await call(desktop + '/mobile-access', cookie, 'POST', '{"enabled":true}')
  expect(result.status).toBe(503)
  expect(JSON.parse(result.body)).toEqual({ enabled: false, url: null, error: 'tailscale-unavailable' })
  expect((await call(desktop + '/', cookie)).status).toBe(200)
})

it('scopes dynamic authority trust to its receiving interface and revokes it', async () => {
  const ctx = await boot()
  const address = '100.64.2.3'
  const headers = { host: `${address}:3080` }
  const revoke = ctx.connection.registerListeningAuthority(headers.host, address)
  expect(ctx.connection.requestRejection({ headers, socket: { localAddress: address } })).toBe(401)
  expect(ctx.connection.requestRejection({ headers, socket: { localAddress: '127.0.0.1' } })).toBe(403)
  revoke()
  expect(ctx.connection.requestRejection({ headers, socket: { localAddress: address } })).toBe(403)
})

it('rolls back a failed bind and permits a later retry', async () => {
  const ctx = await boot()
  const desktop = `http://127.0.0.1:${String(ctx.webServer.port)}`
  const cookie = (await call(ctx.connection.authenticatedUrl(desktop))).cookie
  const occupied = createServer()
  await new Promise<void>((resolve, reject) => {
    occupied.once('error', reject)
    occupied.listen(ctx.webServer.port, '127.0.0.2', () => { resolve() })
  })
  try {
    const result = await call(desktop + '/mobile-access', cookie, 'POST', '{"enabled":true}')
    expect(result.status).toBe(503)
    expect(JSON.parse(result.body)).toMatchObject({ enabled: false })
    expect((await call(desktop + '/', cookie)).status).toBe(200)
  } finally {
    await new Promise<void>((resolve) => { occupied.close(() => { resolve() }) })
  }
  expect((await call(desktop + '/mobile-access', cookie, 'POST', '{"enabled":true}')).status).toBe(200)
})

it('refuses additional mobile serving when the primary listener already binds every interface', async () => {
  const ctx = await boot('0.0.0.0')
  const desktop = `http://127.0.0.1:${String(ctx.webServer.port)}`
  const cookie = (await call(ctx.connection.authenticatedUrl(desktop))).cookie
  expect((await call(desktop + '/mobile-access', cookie, 'POST', '{"enabled":true}')).status).toBe(503)
  expect((await call(desktop + '/', cookie)).status).toBe(200)
})

it('waits for activation during disposal and rejects a queued toggle', async () => {
  const ctx = await boot()
  const desktop = `http://127.0.0.1:${String(ctx.webServer.port)}`
  const cookie = (await call(ctx.connection.authenticatedUrl(desktop))).cookie
  let finishDiscovery: (address: string) => void = () => { throw new Error('Discovery has not started') }
  vi.mocked(tailscaleAddress).mockImplementationOnce(() => new Promise<string>((resolve) => { finishDiscovery = resolve }))
  const discoveryCount = vi.mocked(tailscaleAddress).mock.calls.length
  const first = call(desktop + '/mobile-access', cookie, 'POST', '{"enabled":true}')
  await vi.waitFor(() => { expect(vi.mocked(tailscaleAddress).mock.calls.length).toBe(discoveryCount + 1) })
  const second = call(desktop + '/mobile-access', cookie, 'POST', '{"enabled":false}')
  // A following GET completes only after the earlier POST has arrived on its socket.
  await call(desktop + '/mobile-access', cookie)
  const stopping = Array.from(ctx.loader.entries()).find(entry => entry.options.id === 'mobile')!.fiber!.dispose()
  finishDiscovery('127.0.0.2')
  await stopping
  expect((await first).status).toBe(200)
  expect((await second).status).toBe(503)
  await expect(call(`http://127.0.0.2:${String(ctx.webServer.port)}/`)).rejects.toThrow()
})
