/**
 * A restarted process resumes a goal its human already asked for: the second
 * context loads the persisted session through the production persistence
 * backend, and the driver arms the goal from that session start with no human
 * resume and no new goal mutation from a caller.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import GoalService from '@deepseek-ai/dsh-goal'
import type { GoalView } from '@deepseek-ai/dsh-goal'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as goalSession from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(context => context.fiber.dispose()))
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Mount the production loop, goal service, driver, and a real persistence backend. */
async function mountProcess(root: string, adapter: MockAdapter, withDriver = true): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(GoalService)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  if (withDriver) await ctx.plugin(goalSession, {})
  return ctx
}

async function waitForGoal(
  ctx: Context,
  agent: { id: SessionId },
  predicate: (goal: GoalView | undefined) => boolean,
): Promise<GoalView | undefined> {
  await vi.waitFor(() => {
    expect(predicate(ctx.goals.get(ctx.agents.get(agent.id)!))).toBe(true)
  })
  return ctx.goals.get(ctx.agents.get(agent.id)!)
}

describe('goal continuation across a process restart', () => {
  it('resumes a persisted active goal when the session is loaded again', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goal-restart-'))
    roots.push(root)
    const sessionId = SessionId('goal-session-restart')
    // The first process only records the objective: no driver runs, so the
    // persisted session is exactly an unfinished goal, as after a host restart.
    const before = await mountProcess(root, new MockAdapter([]), false)
    const first = await before.agentLoop.create(sessionId, { provider: 'mock', model: 'mock' })
    before.goals.create(first, { objective: 'Survive a process restart', maxGoalRounds: 1 })
    await before.fiber.dispose()

    const resumedAdapter = new MockAdapter([textResponse('resumed round ran')])
    const after = await mountProcess(root, resumedAdapter)
    const resumed = await after.agentLoop.resume(after, {
      resumeSessionId: sessionId,
      agentOptions: { provider: 'mock', model: 'mock' },
    })

    // No human resume and no caller mutation: the session start alone arms the
    // goal, admits its round, and reports the round cap the goal was created
    // with once that round settles.
    const goal = await waitForGoal(after, resumed.agent, current => current?.roundsStarted === 1)
    expect(goal).toMatchObject({ phase: 'blocked', objective: 'Survive a process restart' })
    expect(goal?.blockedReason?.code).toBe('round-limit')
    expect(resumedAdapter.requests).toHaveLength(1)

    const changes = resumed.agent.session.snapshotEvents().filter(event => event.type === 'goal/change')
    expect(changes.filter(event => event.type === 'goal/change' && event.data.operation === 'resume')).toHaveLength(1)
    await resumed.agent.whenIdle()
  })

  it('leaves a seeded session disarmed when it is loaded again', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goal-restart-fork-'))
    roots.push(root)
    const adapter = new MockAdapter([textResponse('never runs')])
    const before = await mountProcess(root, adapter)
    const source = await before.agentLoop.create(SessionId('goal-restart-source'), { provider: 'mock', model: 'mock' })
    before.goals.create(source, { objective: 'Inherited objective', maxGoalRounds: 3 })
    await before.fiber.dispose()

    const after = await mountProcess(root, adapter)
    const forked = await after.agentLoop.createAgent(after, {
      sessionId: SessionId('goal-restart-forked'),
      seed: [...(await readPersisted(after, SessionId('goal-restart-source')))],
      meta: { parentSession: SessionId('goal-restart-source'), isSeeded: true },
      inheritedEventCount: await persistedCount(after, SessionId('goal-restart-source')),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    agentEvents(after, forked.agent).emit('agent/session-start', { source: 'resume' })
    await forked.agent.whenIdle()

    expect(after.goals.get(forked.agent)).toMatchObject({ phase: 'active', activation: 'disarmed' })
    expect(adapter.requests).toHaveLength(0)
  })
})

/** Read one persisted session's validated log through the production backend. */
async function readPersisted(ctx: Context, sessionId: SessionId) {
  const handle = await ctx.sessionPersistence.open(sessionId, 'read')
  try {
    return await handle.read()
  } finally {
    await handle.close()
  }
}

/** Exact inherited prefix length for a seeded session. */
async function persistedCount(ctx: Context, sessionId: SessionId) {
  return (await readPersisted(ctx, sessionId)).length as never
}
