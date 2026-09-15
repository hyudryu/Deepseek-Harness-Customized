/** Desktop-controlled Tailscale listener for the authenticated Web application. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import type { IncomingMessage } from 'node:http'
import { join } from 'node:path'
import { tailscaleAddress } from './tailscale.ts'

/** Loader identity. */
export const name = 'host-mobile-access'
/** Existing authenticated transport dependencies. */
export const inject = ['webServer', 'connection']

/** Settings namespace holding the durable mobile-access intent. */
export const MOBILE_ACCESS_SETTINGS_NAMESPACE = 'mobile-access'

/** Tailscale executable discovery, bounded command execution, and the composition default. */
export interface Config {
  /** Official CLI executable, used when the interface name does not identify Tailscale. */
  tailscaleExecutable: string
  /** Maximum CLI discovery duration in milliseconds. */
  discoveryTimeoutMs: number
  /** Mobile access requested when no settings service owns {@link MOBILE_ACCESS_SETTINGS_NAMESPACE}. */
  enabled: boolean
}

export const Config: z<Partial<Config>, Config> = z.object({
  tailscaleExecutable: z.string().default(process.platform === 'win32'
    ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe')
    : 'tailscale'),
  discoveryTimeoutMs: z.natural().min(1).default(5000),
  enabled: z.boolean().default(false),
})

/** Durable mobile-access intent stored in user settings. */
export interface MobileAccessSettings {
  /** Whether this deployment keeps mobile access listening. */
  enabled: boolean
}

/** Schema of the stored intent, served to settings clients and the settings document. */
export const MOBILE_ACCESS_SETTINGS_SCHEMA: z<MobileAccessSettings> = z.object({
  enabled: z.boolean().default(false),
})

/** Why a requested listener change did not take effect, reported to the caller. */
type MobileAccessFailure = 'settings-unwritable' | 'tailscale-unavailable'

function loopback(address: string | undefined): boolean {
  return address === '::1' || address === '127.0.0.1'
}

/**
 * Register desktop-only controls. The requested state is durable: it is stored
 * in the settings namespace while a settings service owns it, and the listener
 * is restored to it at load, so enabling access once survives a restart.
 * @param ctx - plugin owner providing the authenticated application transport.
 * @param config - resolved discovery configuration and the composition default.
 */
export function apply(ctx: Context, config: Config): void {
  let active: { url: string; close: () => Promise<void> } | undefined
  let operations: Promise<unknown> = Promise.resolve()
  let disposed = false
  // The durable intent. `installSection` replaces this thunk with the resolved
  // settings value while a settings service is present, and restores the
  // composition entry if that service detaches.
  let fallback: MobileAccessSettings = { enabled: config.enabled }
  let source: () => MobileAccessSettings = () => fallback
  // Writes the intent through settings; absent without a settings service, where
  // the last requested value is held in memory for this process only.
  let store: ((enabled: boolean) => Promise<void>) | undefined
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
    const origin = new URL(`http://${address}:${String(ctx.webServer.port)}`).origin
    const authority = new URL(origin).host
    const untrust = ctx.connection.registerListeningAuthority(authority, address)
    let close: () => Promise<void>
    try {
      close = await ctx.webServer.listenOn(address, (request: IncomingMessage) => {
        if (request.headers.host !== authority || request.headers['sec-fetch-site'] === 'cross-site') return false
        if (request.headers.origin !== undefined && request.headers.origin !== origin) return false
        // Only the root token exchange may precede cookie authentication.
        if (request.url === '/' || request.url?.startsWith('/?') === true) return true
        return ctx.connection.requestRejection(request) === undefined
      })
    } catch (error) {
      untrust()
      throw error
    }
    active = {
      url: ctx.connection.authenticatedUrl(origin),
      close: async () => { untrust(); await close() },
    }
  }
  /** Serialize one listener change behind every earlier one; failures stay with their caller. */
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const operation = operations.then(work)
    operations = operation.then(() => undefined, () => undefined)
    return operation
  }
  /** Report a restore failure the user cannot see in a request result. */
  const reportRestoreFailure = (error: unknown): void => {
    ctx.logger.warn(`mobile access was not restored from the stored setting: ${String(error)}`)
  }
  ctx.inject(['settings'], (settingsCtx) => {
    const entry: MobileAccessSettings = { enabled: config.enabled }
    settingsCtx.settings.installSection(ctx, MOBILE_ACCESS_SETTINGS_NAMESPACE, MOBILE_ACCESS_SETTINGS_SCHEMA, entry, {
      setSource: (next) => { source = next },
      // `installSection` invokes this once on install, which is the restore at
      // load, and again after every commit — including an edit made directly in
      // the settings document.
      onChange: () => { void enqueue(async () => { await setEnabled(source().enabled) }).catch(reportRestoreFailure) },
    })
    store = async (enabled) => { await settingsCtx.settings.update(MOBILE_ACCESS_SETTINGS_NAMESPACE, { enabled }) }
  })
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
        // Store the intent first: a listener that came up without a durable
        // record would silently revert at the next launch.
        const failure = await enqueue(async (): Promise<MobileAccessFailure | undefined> => {
          try {
            if (store === undefined) fallback = { enabled }
            else await store(enabled)
          } catch { return 'settings-unwritable' }
          try {
            await setEnabled(enabled)
          } catch { return 'tailscale-unavailable' }
          return undefined
        })
        if (failure !== undefined) {
          response.writeHead(503, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ ...state(), error: failure }))
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
