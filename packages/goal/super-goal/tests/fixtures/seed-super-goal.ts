/** Test-only command input at the first shipped-profile task boundary. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'

export const name = 'seed-super-goal'
export const inject = ['commands']

/** Mount the deterministic human command for the recorded-session scenario. */
export function apply(ctx: Context): void {
  let seeded = false
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    if (!seeded) {
      seeded = true
      const execution = await ctx.commands.execute(agent,
        '/supergoal Verify both acceptance checks before stopping', [], new AbortController().signal)
      if (execution?.result.kind !== 'success') throw new Error('SuperGoal fixture command failed')
    }
    return next()
  })
}
