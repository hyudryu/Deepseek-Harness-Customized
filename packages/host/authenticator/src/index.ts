/** Authenticator administration and MCP tools on the existing authenticated Web transport. */
import type { Context } from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { join, resolve } from 'node:path'
import type { IncomingMessage } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { z } from 'zod'
import { AccountError, AuthenticatorStore, parseAccountId } from './store.ts'
import { createAuthenticatorMcp } from './mcp.ts'

/** Loader identity. */
export const name = 'host-authenticator'
/** Services owning authentication, configuration and session tool execution. */
export const inject = ['webServer', 'connection', 'settings', 'tools']

/** Durable account storage configuration. */
export interface Config {
  /** Dedicated account file; omission uses the current Harness home. */
  path?: string
  /** Maximum accounts retained and returned in one list. */
  maxAccounts: number
  /** Maximum UTF-8 bytes in each account label and issuer. */
  maxMetadataBytes: number
  /** Explicit Harness home, otherwise DSH_HOME or ~/.dsh. */
  dshHome?: string
}

export const Config: schema<Config> = schema.object({
  path: schema.string(), dshHome: schema.string(),
  maxAccounts: schema.number().min(1).default(100),
  maxMetadataBytes: schema.number().min(1).default(256),
})

const metadata = {
  id: { type: 'string', required: true }, label: { type: 'string', required: true },
  issuer: { type: 'string', required: true }, period: { type: 'number', required: true },
} as const

/** Decode only a bounded JSON request, without exposing parse errors containing provisioning data. */
async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += bytes.length
    if (size > 16_384) throw new AccountError('Authenticator request is too large', 'invalid-request')
    chunks.push(bytes)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
    throw new AccountError('Invalid authenticator request', 'invalid-request')
  }
}

/**
 * Register account administration, native tools and the MCP endpoint.
 * @param ctx - plugin context carrying the authenticated application server.
 * @param config - account storage location.
 */
export function apply(ctx: Context, config: Config): void {
  for (const [key, value] of [['maxAccounts', config.maxAccounts], ['maxMetadataBytes', config.maxMetadataBytes]] as const) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${key} must be a positive safe integer`)
  }
  const filename = resolve(config.path ?? join(resolveDshHome(config.dshHome), 'authenticator', 'accounts.json'))
  const store = new AuthenticatorStore(filename, config)
  ctx.settings.register('authenticator', schema.object({}))
  ctx.tools.register(defineTool({
    name: 'authenticator_list_accounts',
    description: 'List stored authenticator account ids, labels and issuers without provisioning secrets.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      accounts: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: metadata } },
    } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async () => ({ accounts: await store.list() }),
    presentCall: () => ({ card: 'generic', title: 'List authenticator accounts', kind: 'other' }),
  }))
  ctx.tools.register(defineTool({
    name: 'authenticator_get_code',
    description: 'Get the current six-digit TOTP code and expiration for a stored authenticator account id.',
    parameters: { id: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      ...metadata, code: { type: 'string', required: true }, validUntil: { type: 'number', required: true },
    } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: args => store.getCode(parseAccountId(args.id)),
    presentCall: args => ({ card: 'generic', title: 'Get authenticator code', kind: 'other', rawInput: args.id }),
  }))
  for (const path of ['/authenticator', '/authenticator/import', '/authenticator/delete', '/authenticator/mcp']) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact', path,
      handler: async (request, response) => {
        response.setHeader('cache-control', 'no-store')
        const rejection = ctx.connection.requestRejection(request)
        if (rejection !== undefined) { response.writeHead(rejection); response.end('forbidden'); return }
        if (request.method !== (path === '/authenticator' ? 'GET' : 'POST')) {
          response.writeHead(405); response.end(); return
        }
        try {
          if (path === '/authenticator/mcp') {
            const server = createAuthenticatorMcp(store)
            const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true })
            try {
              // SDK transport callbacks explicitly include undefined while Transport's optional fields do not.
              await server.connect(transport as Transport)
              await transport.handleRequest(request, response, await readBody(request))
            } finally { await server.close() }
            return
          }
          let value: unknown
          if (path === '/authenticator') value = { accounts: await store.codes() }
          else if (path === '/authenticator/import') {
            const parsed = z.object({ uri: z.string().max(8192) }).strict().safeParse(await readBody(request))
            if (!parsed.success) throw new AccountError('Expected a TOTP provisioning URI', 'invalid-request')
            value = await store.importUri(parsed.data.uri)
          } else {
            const parsed = z.object({ id: z.uuid() }).strict().safeParse(await readBody(request))
            if (!parsed.success) throw new AccountError('Expected an authenticator account id', 'invalid-request')
            value = { removed: await store.remove(parseAccountId(parsed.data.id)) }
          }
          response.setHeader('content-type', 'application/json')
          response.end(JSON.stringify(value))
        } catch (error) {
          if (response.headersSent) { response.end(); return }
          response.writeHead(error instanceof AccountError ? 400 : 500, { 'content-type': 'application/json' })
          response.end(JSON.stringify({
            errorCode: error instanceof AccountError ? error.code : 'operation-failed',
            error: error instanceof AccountError ? error.message : 'Authenticator operation failed',
          }))
        }
      },
    }))
  }
}
