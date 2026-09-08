/** Effect-owned MCP listener for project discovery and session supervision. */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { createMcpHandler } from './http.ts'
import { SessionManagement } from './sessions.ts'

export type { SessionMcpMessageSource } from './types.ts'

/** Session MCP deployment settings; Web transport uses the existing UI listener. */
export interface Config {
  /** Own a listener or register on the composed Web server. @default 'standalone' */
  transport: 'standalone' | 'web-server'
  /** Standalone loopback address. @default '127.0.0.1' */
  host: '127.0.0.1' | '::1'
  /** Standalone port; zero requests an OS-assigned port. @default 3080 */
  port: number
  /** Case-sensitive MCP pathname. @default '/mcp' */
  path: string
  /** Maximum entries in one list or transcript page. @default 100 */
  maxPageSize: number
  /** Maximum UTF-8 bytes in a complete tool response, including JSON-RPC. @default 65536 */
  maxResponseBytes: number
  /** Maximum UTF-8 bytes in an incoming HTTP request body. @default 65536 */
  maxRequestBytes: number
  /** Maximum request lifetime, including session reads; capped at the Node timer maximum. @default 30000 */
  requestTimeoutMs: number
  /** Maximum simultaneous MCP requests. @default 32 */
  maxConcurrentRequests: number
  /** Expose follow-up and stop tools for live, top-level sessions. @default true */
  allowControl: boolean
}

/** Loader schema; limits apply before requests reach session services. */
export const Config: z<Config> = z.object({
  transport: z.union([z.const('standalone'), z.const('web-server')]).default('standalone'),
  host: z.union([z.const('127.0.0.1'), z.const('::1')]).default('127.0.0.1'),
  port: z.natural().max(65535).default(3080),
  path: z.string().default('/mcp'),
  maxPageSize: z.natural().min(1).default(100),
  maxResponseBytes: z.natural().min(4096).default(65536),
  maxRequestBytes: z.natural().min(1024).default(65536),
  requestTimeoutMs: z.natural().min(1).max(2147483647).default(30000),
  maxConcurrentRequests: z.natural().min(1).default(32),
  allowControl: z.boolean().default(true),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionMcp: SessionMcpServer
  }
}

/** Starts with the application and drains its requests before releasing its listener. */
export class SessionMcpServer extends Service {
  static inject = ['sessions', 'sessionQuery', 'agents']
  static Config = Config

  private url!: string

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'sessionMcp')
    const parsed = new URL(config.path, 'http://localhost')
    if (!config.path.startsWith('/') || config.path.startsWith('//') || parsed.pathname !== config.path
      || config.path.endsWith('/') || parsed.search !== '' || parsed.hash !== '') {
      throw new Error('session-mcp path must be an absolute pathname without a trailing slash, query, or fragment')
    }
  }

  /** Local MCP URL, available after service initialization completes. */
  get endpoint(): string {
    return this.url
  }

  /** Own the standalone socket or an exact route on the composed Web server. */
  async [Service.init](): Promise<void> {
    const management = new SessionManagement(this.ctx, {
      maxPageSize: this.config.maxPageSize,
      // The text content is JSON-escaped again by MCP, at most doubling its bytes.
      maxResponseBytes: Math.floor((this.config.maxResponseBytes - 512) / 2),
    })
    let port = this.config.port
    const handler = createMcpHandler(management, this.config, () => port)
    if (this.config.transport === 'web-server') {
      const webServer = this.ctx.get('webServer')
      if (webServer === undefined) throw new Error('session-mcp web-server transport requires webServer')
      port = webServer.port
      this.ctx.effect(() => {
        const unregister = webServer.register({ kind: 'exact', path: this.config.path, handler: handler.handle })
        return async () => {
          unregister()
          await handler.close()
        }
      }, 'sessionMcp.route')
      this.url = `http://127.0.0.1:${port}${this.config.path}`
      return
    }

    const server = createServer((request, response) => {
      void handler.handle(request, response).catch((error: unknown) => {
        this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        if (response.headersSent) response.destroy()
        else response.writeHead(500).end()
      })
    })
    const listening = new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, this.config.host, () => {
        server.off('error', reject)
        server.on('error', this.ctx.logger.error.bind(this.ctx.logger))
        port = (server.address() as AddressInfo).port
        resolve()
      })
    })
    this.ctx.effect(() => async () => {
      // A pending bind must settle before close can release its socket.
      await listening.catch(() => undefined)
      const drained = handler.close()
      const closed = new Promise<void>((resolve) => { server.close(() => { resolve() }) })
      server.closeAllConnections()
      await Promise.all([drained, closed])
    }, 'sessionMcp.listen')
    await listening
    const host = this.config.host === '::1' ? '[::1]' : this.config.host
    this.url = `http://${host}:${port}${this.config.path}`
  }
}

export default SessionMcpServer
