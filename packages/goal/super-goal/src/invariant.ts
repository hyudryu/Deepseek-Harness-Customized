/** SuperGoal banner state must agree with the durable objective. */
import { isDeepStrictEqual } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from '@deepseek-ai/dsh-session-projection'
import { readSuperGoal } from './index.ts'

/** Companion plugin name. */
export const name = 'super-goal-invariant'
/** Registry owning the package-attributed check. */
export const inject = ['invariants']

const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const state = ctx.sessionProjections.stateOf(agent.session, 'superGoal')
    if (state !== undefined && (state.failure !== null || !isDeepStrictEqual(state.goal, readSuperGoal(agent.session)))) {
      fail('SuperGoal session projection disagrees with its durable objective')
    }
    return next()
  })
}, { inject: ['sessionProjections'] })

/**
 * Register the durable-state and banner agreement check.
 * @param ctx - Context carrying the invariant registry.
 * @returns The registration disposer after installation.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-super-goal', install))
