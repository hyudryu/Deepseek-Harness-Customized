/** Runtime agreement between durable SuperGoal and its client projection. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as Companion from '../src/invariant.ts'
import { superGoalProjectionDefinition } from '../src/projection.ts'

const contexts: Context[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(superGoalProjectionDefinition)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  const companion = await ctx.plugin(Companion)
  const session = ctx.sessions.create(SessionId('super-goal-invariant'))
  const goal = { revision: 1, objective: 'Verify banner state', phase: 'active' as const }
  session.append('super-goal/change', { version: 1, revision: 1, goal })
  // This invariant reads only the durable session; no driver or model executes.
  const agent = { session } as Agent
  const check = () => agentEvents(ctx, agent).waterfall('agent/pre-step',
    { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
    async () => ({ kind: 'enter' as const, messages: [] }))
  return { ctx, companion, goal, check }
}

describe('SuperGoal invariant', () => {
  it('delegates when the projection agrees with durable state', async () => {
    const { check } = await setup()
    await expect(check()).resolves.toEqual({ kind: 'enter', messages: [] })
  })

  it.each(['mismatch', 'failure'])('rejects projection %s with package attribution', async (condition) => {
    const { ctx, goal, check } = await setup()
    vi.spyOn(ctx.sessionProjections, 'stateOf').mockReturnValue({
      revision: 1,
      goal: condition === 'mismatch' ? { ...goal, objective: 'Wrong objective' } : goal,
      failure: condition === 'failure' ? 'Invalid event' : null,
    })
    await expect(check()).rejects.toMatchObject({ code: 'INVARIANT', packageName: '@deepseek-ai/dsh-super-goal' })
  })

  it('removes the check when the companion unloads', async () => {
    const { ctx, companion, check } = await setup()
    vi.spyOn(ctx.sessionProjections, 'stateOf').mockReturnValue({ revision: 1, goal: null, failure: 'Invalid event' })
    await expect(check()).rejects.toMatchObject({ code: 'INVARIANT' })
    await companion.dispose()
    await expect(check()).resolves.toEqual({ kind: 'enter', messages: [] })
  })
})
