/** Persistent objective and progress status, read from the durable session projection. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SuperGoal } from '@deepseek-ai/dsh-super-goal/client'
import type { SuperGoalKey } from './locales.ts'
import css from './SuperGoalBanner.module.css'

const statusKeys = {
  active: 'status.active',
  paused: 'status.paused',
  blocked: 'status.blocked',
  complete: 'status.complete',
} as const satisfies Record<SuperGoal['phase'], SuperGoalKey>

type BannerProps = PropsRuntime<'conversation.session.banner'> & PropsLocale<'superGoal'>

/**
 * Render the current objective above the session transcript.
 * @param props - Session projection and localized copy supplied by Slots.
 * @returns The banner, or nothing before a SuperGoal exists.
 */
export function SuperGoalBanner({ useProjection, useSession, t }: BannerProps) {
  const goal = useProjection('superGoal')
  const running = useSession(snapshot => snapshot.running)
  if (goal == null) return null
  return (
    <section className={css.banner} data-phase={goal.phase} aria-label={t('title')}>
      <div className={css.title}>{t('title')}</div>
      <div className={css.objective}>{goal.objective}</div>
      <div className={css.status} role="status" aria-live="polite">
        {t(goal.phase === 'active' && !running ? 'status.ready' : statusKeys[goal.phase])}
      </div>
      {goal.phase === 'blocked' && goal.reason !== undefined
        ? <div className={css.detail}>{goal.reason}</div>
        : null}
    </section>
  )
}
