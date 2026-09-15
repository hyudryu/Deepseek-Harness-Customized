/**
 * Software Update client plugin: registers the sidebar control beside the
 * Settings trigger. The component owns its own visibility, so this plugin
 * contributes it whenever the profile is mounted.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { SoftwareUpdate } from './SoftwareUpdate.tsx'
import { en, zh, type SoftwareUpdateKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** One-click software update control. */
    softwareUpdate: SoftwareUpdateKey
  }
}

/** Services required by the software update UI. */
export const inject = ['slots', 'locale']

/**
 * Register the localized control beside the Settings trigger. The order places
 * it immediately after the mobile-access action, which is registered at 0.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register('softwareUpdate', { en, zh }),
    'software-update: dictionaries',
  )
  ctx.slots.inject('sidebar.settings.action', () => ctx.slots.register({
    name: 'sidebar.settings.action',
    id: 'software-update',
    order: 1,
    locale: 'softwareUpdate',
  }, SoftwareUpdate))
}
