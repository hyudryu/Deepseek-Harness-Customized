/** Real authenticated HTTP/MCP transport and native session tool dispatch. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { request } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SettingsFile from '@deepseek-ai/dsh-settings-file'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as Authenticator from '../src/index.ts'

let context: Context | undefined
let directory: string | undefined
afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
})

async function boot(maxAccounts = 100, maxMetadataBytes = 256) {
  directory = await mkdtemp(join(tmpdir(), 'dsh-authenticator-http-'))
  const config = join(directory, 'cordis.yml')
  await writeFile(config, [
    '- name: credentials', '  config:', `    path: '${join(directory, 'credentials.yaml')}'`, '    watch: false',
    '- name: webserver', '  config:', "    host: '127.0.0.1'", '    port: 0',
    '- name: connection', '- name: system-prompt', '- name: tools',
    '- name: settings', '  config:', `    dshHome: '${directory}'`, '    watch: false',
    '- id: authenticator', '  name: authenticator', '  config:', `    dshHome: '${directory}'`, `    maxAccounts: ${maxAccounts}`, `    maxMetadataBytes: ${maxMetadataBytes}`, '',
  ].join('\n'))
  const ctx = context = new Context()
  ctx.baseUrl = pathToFileURL(directory).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['credentials', LocalCredentials], ['webserver', WebServer], ['connection', Connection], ['authenticator', Authenticator],
    ['system-prompt', SystemPrompt], ['tools', ToolRuntime], ['settings', SettingsFile],
  ])
  ctx.loader.internal = { version: 'v2', async import(specifier: string) { return modules.get(specifier) } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  ctx.effect(() => ctx.webServer.registerFallback((req, res) => {
    if (ctx.connection.authorizeIndex(req, res)) res.end('authenticated')
  }))
  const origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  const login = await fetch(ctx.connection.authenticatedUrl(origin), { redirect: 'manual' })
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!
  const call = (path: string, body?: unknown, headers: Record<string, string> = {}) => fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { cookie, 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { ctx, origin, call, cookie }
}

it('preserves a Unicode account label split across HTTP request chunks', async () => {
  const { origin, cookie } = await boot()
  const body = Buffer.from(JSON.stringify({ uri: 'otpauth://totp/测试账户?secret=JBSWY3DPEHPK3PXP' }))
  const split = body.indexOf(Buffer.from('测')) + 1
  const result = await new Promise<string>((resolve, reject) => {
    const req = request(origin + '/authenticator/import', {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    }, (response) => {
      response.setEncoding('utf8')
      let text = ''
      response.on('data', (chunk: string) => { text += chunk })
      response.on('error', reject)
      response.on('end', () => { resolve(text) })
    })
    req.on('error', reject)
    req.write(body.subarray(0, split))
    setImmediate(() => req.end(body.subarray(split)))
  })
  expect(JSON.parse(result) as unknown).toMatchObject({ label: '测试账户' })
})

it('refuses unauthenticated and cross-origin callers before storing or returning codes', async () => {
  const { origin, call } = await boot()
  for (const path of ['/authenticator', '/authenticator/import', '/authenticator/delete', '/authenticator/mcp']) {
    expect((await fetch(origin + path)).status).toBe(401)
    expect((await call(path, {}, { origin: 'http://attacker.invalid' })).status).toBe(403)
  }
  expect((await call('/authenticator/import', { uri: 'private-invalid-payload' })).status).toBe(400)
  expect(await (await call('/authenticator')).json()).toEqual({ accounts: [] })
})

it('imports, returns codes through REST and official MCP, and deletes through the settings route', async () => {
  const { call, ctx } = await boot()
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
  const imported = await call('/authenticator/import', { uri: `otpauth://totp/Example:alice?issuer=Example&secret=${secret}` })
  expect(imported.status).toBe(200)
  const account = await imported.json() as { id: string }
  const duplicate = await call('/authenticator/import', { uri: `otpauth://totp/Example:alice?issuer=Example&secret=${secret}` })
  expect(duplicate.status).toBe(400)
  expect(await duplicate.json()).toMatchObject({ errorCode: 'duplicate-account' })
  const unsupported = await call('/authenticator/import', { uri: `otpauth://hotp/Example:alice?secret=${secret}` })
  expect(await unsupported.json()).toMatchObject({ errorCode: 'unsupported-provisioning' })
  const snapshot = await (await call('/authenticator')).json() as { accounts: { code: string }[] }
  expect(snapshot.accounts[0]?.code).toMatch(/^\d{6}$/)
  expect(JSON.stringify(snapshot)).not.toContain(secret)
  expect(ctx.tools.schemas().map(tool => ({
    name: tool.name, description: tool.description, parameters: tool.parameters,
  }))).toMatchSnapshot()
  const execute = (name: string, args: unknown) => ctx.tools.execute({
    name, arguments: args, callId: ToolCallId('authenticator-test'), signal: new AbortController().signal,
  })
  const listed = await execute('authenticator_list_accounts', {})
  expect(listed.isError).toBe(false)
  expect(listed.content).toEqual([{ type: 'text', text: JSON.stringify({ accounts: [account] }) }])
  const native = await execute('authenticator_get_code', { id: account.id })
  expect(native.isError).toBe(false)
  const first = native.content[0]
  expect(first?.type).toBe('text')
  expect(first?.type === 'text' ? first.text : '').toContain(account.id)
  expect(JSON.stringify(native)).not.toContain(secret)
  const rpc = async (method: string, params: unknown) => {
    const response = await call('/authenticator/mcp', { jsonrpc: '2.0', id: 1, method, params }, {
      accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-03-26',
    })
    expect(response.status).toBe(200)
    return await response.json() as { result: { tools?: { name: string }[]; content?: { text: string }[] } }
  }
  const initialized = await rpc('initialize', {
    protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'authenticator-test', version: '1.0.0' },
  })
  expect(initialized.result).toMatchObject({ serverInfo: { name: 'dsh-authenticator' } })
  expect((await rpc('tools/list', {})).result.tools?.map(tool => tool.name)).toEqual(['authenticator_list_accounts', 'authenticator_get_code'])
  const value = (await rpc('tools/call', { name: 'authenticator_get_code', arguments: { id: account.id } })).result.content?.[0]?.text
  expect(value).toContain(account.id)
  expect(value).not.toContain(secret)
  expect(await (await call('/authenticator/delete', { id: account.id })).json()).toEqual({ removed: true })
  expect(await (await call('/authenticator')).json()).toEqual({ accounts: [] })
  expect((await execute('authenticator_get_code', { id: account.id })).isError).toBe(true)
  await Array.from(ctx.loader.entries()).find(entry => entry.options.id === 'authenticator')!.fiber!.dispose()
  expect(ctx.tools.schemas()).toEqual([])
  expect((await call('/authenticator')).status).toBe(200)
  expect(await (await call('/authenticator')).text()).toBe('authenticated')
})


it('enforces configured list bounds through the shared HTTP, native and MCP store', async () => {
  const { call, ctx } = await boot(1, 3)
  const imported = await call('/authenticator/import', { uri: 'otpauth://totp/%E7%95%8C?secret=JBSWY3DPEHPK3PXP' })
  expect(imported.status).toBe(200)
  const rejected = await call('/authenticator/import', { uri: 'otpauth://totp/bob?secret=GEZDGNBVGY3TQOJQ' })
  expect(rejected.status).toBe(400)
  const oversized = await call('/authenticator/import', { uri: 'otpauth://totp/long?secret=GEZDGNBVGY3TQOJQ' })
  expect(oversized.status).toBe(400)
  const settings = await (await call('/authenticator')).json() as { accounts: unknown[] }
  expect(settings.accounts).toHaveLength(1)
  const native = await ctx.tools.execute({ name: 'authenticator_list_accounts', arguments: {},
    callId: ToolCallId('bounded-list'), signal: new AbortController().signal })
  expect(native.isError).toBe(false)
  const mcp: unknown = await (await call('/authenticator/mcp', {
    jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'authenticator_list_accounts', arguments: {} },
  }, { accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-03-26' })).json()
  for (const projection of [settings, native, mcp]) {
    expect(Buffer.byteLength(JSON.stringify(projection))).toBeLessThan(1024)
    expect(JSON.stringify(projection)).not.toContain('JBSWY3DPEHPK3PXP')
  }
})
