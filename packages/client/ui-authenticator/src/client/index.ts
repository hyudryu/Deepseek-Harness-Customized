/** Authenticator configuration card registered in Settings / Plugins. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { AuthenticatorCard } from './AuthenticatorCard.tsx'
import { en, zh, type AuthenticatorKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Authenticator account management. */
    authenticator: AuthenticatorKey
  }
}

/** Required card registry and locale service. */
export const inject = ['slots', 'locale']

/**
 * Register the locale dictionaries and keyed authenticator card.
 * @param ctx - client application context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('authenticator', { en, zh }), 'authenticator: locale')
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item', key: 'authenticator', locale: 'authenticator',
  }, AuthenticatorCard))
}
