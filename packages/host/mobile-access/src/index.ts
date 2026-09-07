/** Desktop-controlled Tailscale listener for the authenticated Web application. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage } from 'node:http'
import { join } from 'node:path'
import { tailscaleAddress } from './tailscale.ts'

/** Loader identity. */
export const name = 'host-mobile-access'
/** Existing authenticated transport dependencies. */
export const inject = ['webServer', 'connection']

/** Tailscale executable discovery and bounded command execution. */
export interface Config {
  /** Official CLI executable, used when the interface name does not identify Tailscale. */
  tailscaleExecutable: string
  /** Maximum CLI discovery duration in milliseconds. */
  discoveryTimeoutMs: number
}

export const Config: z<Partial<Config>, Config> = z.object({
  tailscaleExecutable: z.string().default(process.platform === 'win32'
    ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe')
    : 'tailscale'),
  discoveryTimeoutMs: z.natural().min(1).default(5000),
})

function loopback(address: string | undefined): boolean {
  return address === '::1' || address === '127.0.0.1'
}

/**
 * Register desktop-only controls; access starts off and is revoked on unload.
 * @param ctx - plugin owner providing the authenticated application transport.
 * @param config - resolved Tailscale discovery configuration.
 */
export function apply(ctx: Context, config: Config): void {
  let active: { url: string; close: () => Promise<void> } | undefined
  let operations: Promise<void> = Promise.resolve()
  let disposed = false
  const state = (): { enabled: boolean; url: string | null } => ({ enabled: active !== undefined, url: active?.url ?? null })
  const setEnabled = async (enabled: boolean): Promise<void> => {
    if (disposed) throw new Error('Mobile access is unloading')
    if (!enabled) {
      if (active === undefined) return
      await active.close()
      active = undefined
      return
    }
    if (active !== undefined) return
    if (!loopback(ctx.webServer.host)) throw new Error('Mobile access requires the desktop server to bind to loopback')
    const address = await tailscaleAddress(config)
    const authority = `${address}:${String(ctx.webServer.port)}`
    const untrust = ctx.connection.registerListeningAuthority(authority, address)
    let close: () => Promise<void>
    try {
      close = await ctx.webServer.listenOn(address, (request: IncomingMessage) => {
        if (request.headers.host !== authority || request.headers['sec-fetch-site'] === 'cross-site') return false
        if (request.headers.origin !== undefined && request.headers.origin !== `http://${authority}`) return false
        // Only the root token exchange may precede cookie authentication.
        if (request.url === '/' || request.url?.startsWith('/?') === true) return true
        return ctx.connection.requestRejection(request) === undefined
      })
    } catch (error) {
      untrust()
      throw error
    }
    active = {
      url: ctx.connection.authenticatedUrl(`http://${authority}`),
      close: async () => { untrust(); await close() },
    }
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/mobile-access',
    handler: async (request, response) => {
      response.setHeader('cache-control', 'no-store')
      const rejection = ctx.connection.requestRejection(request)
      if (rejection !== undefined || !loopback(request.socket.localAddress) || !loopback(request.socket.remoteAddress)) {
        response.writeHead(rejection ?? 403)
        response.end('forbidden')
        return
      }
      if (request.method !== 'GET' && request.method !== 'POST') {
        response.writeHead(405)
        response.end()
        return
      }
      if (request.method === 'POST') {
        let body = ''
        for await (const chunk of request) {
          body += String(chunk)
          if (body.length > 1024) { response.writeHead(413); response.end(); return }
        }
        let enabled: boolean
        try {
          const value: unknown = JSON.parse(body)
          if (typeof value !== 'object' || value === null || !('enabled' in value) || typeof value.enabled !== 'boolean') throw new Error('Expected enabled boolean')
          enabled = value.enabled
        } catch {
          response.writeHead(400)
          response.end('Expected enabled boolean')
          return
        }
        const operation = operations.then(async () => { await setEnabled(enabled) })
        operations = operation.catch(() => { /* Each HTTP caller receives its own activation failure below. */ })
        try { await operation } catch {
          response.writeHead(503, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ ...state(), error: 'tailscale-unavailable' }))
          return
        }
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(state()))
    },
  }), 'mobile-access: desktop control')
  ctx.effect(() => async () => {
    disposed = true
    await operations
    await active?.close()
    active = undefined
  }, 'mobile-access: listener disposal')
}
