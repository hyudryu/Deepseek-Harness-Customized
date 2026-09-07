/** Usage settings registration and locale ownership. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { UsageSection } from './UsageSection.tsx'
import { en, zh, type UsageKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Usage dashboard copy. */
    usage: UsageKey
  }
}

/** Services required by the usage dashboard. */
export const inject = ['slots', 'locale', 'remote', 'remote.usage']

/** Register the fifth settings section after its owner declares the slot.
 * @param ctx - Browser plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('usage', { en, zh }), 'usage dictionaries')
  const t = ctx.locale.bind('usage')
  const loadUsage = async () => {
    const result = await ctx.remote.usage.summary()
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'usage', order: 40, locale: 'usage',
    label: () => t('nav'),
    inject: () => ({ loadUsage }),
  }, UsageSection))
}
