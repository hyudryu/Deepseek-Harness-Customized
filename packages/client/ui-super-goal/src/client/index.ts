/** SuperGoal browser plugin: a projection-backed banner above the transcript. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-super-goal/client'
import { SuperGoalBanner } from './SuperGoalBanner.tsx'
import { en, type SuperGoalKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Persistent SuperGoal banner copy. */
    superGoal: SuperGoalKey
  }
}

/** Services used to register the banner and its copy. */
export const inject = ['slots', 'locale']

/**
 * Register the SuperGoal session banner.
 * @param ctx - Browser plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('superGoal', { en, zh: en }), 'ui-super-goal: dictionaries')
  ctx.slots.inject('conversation.session.banner', () => ctx.slots.register({
    name: 'conversation.session.banner',
    id: 'super-goal',
    order: 0,
    locale: 'superGoal',
  }, SuperGoalBanner))
}
