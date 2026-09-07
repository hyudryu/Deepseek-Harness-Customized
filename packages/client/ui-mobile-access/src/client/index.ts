/** Registers authenticated desktop controls for the Tailscale listener. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import QRCode from 'qrcode/lib/browser.js'
import { MobileAccess, type MobileAccessStatus } from './MobileAccess.tsx'
import { en, zh, type MobileAccessKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop Tailscale pairing controls. */
    mobileAccess: MobileAccessKey
  }
}
/** Services required by the mobile access UI. */
export const inject = ['slots', 'locale', 'remote']

async function request(enabled?: boolean): Promise<MobileAccessStatus> {
  const response = await fetch('/mobile-access', enabled === undefined
    ? { credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) })
  if (!response.ok) throw new Error(`Mobile access request failed: ${response.status}`)
  const value: unknown = await response.json()
  if (typeof value !== 'object' || value === null || !('enabled' in value) || typeof value.enabled !== 'boolean'
    || !('url' in value) || (value.url !== null && typeof value.url !== 'string')) throw new Error('Invalid mobile access response')
  if (value.enabled !== (value.url !== null)) throw new Error('Invalid mobile access state')
  if (value.url !== null && !['http:', 'https:'].includes(new URL(value.url).protocol)) throw new Error('Invalid mobile access URL')
  return { enabled: value.enabled, url: value.url }
}

/** Register the desktop-only Settings action and localized copy.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('mobileAccess', { en, zh }), 'ui-mobile-access: dictionaries')
  if (!ctx.remote.$host.isLoopback) return
  const commands = {
    read: () => request(), update: (enabled: boolean) => request(enabled),
    qr: (url: string) => QRCode.toDataURL(url, { width: 256, margin: 4, errorCorrectionLevel: 'M' }),
  }
  ctx.slots.inject('sidebar.settings.action', () => ctx.slots.register({
    name: 'sidebar.settings.action', id: 'mobile-access', order: 0, locale: 'mobileAccess', inject: () => commands,
  }, MobileAccess))
}
