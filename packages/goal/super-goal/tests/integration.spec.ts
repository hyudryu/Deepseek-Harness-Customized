/** SuperGoal behavior through the real agent loop and command runtime. */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import UserQuestionService, { type AskUserQuestionAnswer, type AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import * as SuperGoalPlugin from '../src/index.ts'
import { readSuperGoal } from '../src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function harness(adapter: MockAdapter) {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(UserQuestionService)
  const goalPlugin = await ctx.plugin(SuperGoalPlugin)
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('super-goal-test'), { provider: 'mock', model: 'mock' })
  return { ctx, agent, goalPlugin }
}

function command(ctx: Context, agent: Agent, input: string) {
  return ctx.commands.execute(agent, '/supergoal ' + input, [], new AbortController().signal)
}

function idle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
}

function pendingQuestion(ctx: Context) {
  const received = Promise.withResolvers<AskUserQuestionRequest>()
  const answer = Promise.withResolvers<AskUserQuestionAnswer>()
  ctx.on('user-questions/request', (request) => {
    received.resolve(request)
    return answer.promise
  })
  return { received: received.promise, answer }
}

const blocker = { revision: 1, reason: 'Which deployment target is authorized?', choices: ['Use staging', 'Provide another target'] }

describe('SuperGoal through the real loop', () => {
  it('leaves ordinary session tool schemas unchanged until the user creates a goal', async () => {
    const adapter = new MockAdapter([textResponse('Ordinary answer.')])
    const { ctx, agent } = await harness(adapter)
    const settled = idle(ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'An ordinary question' }], source: { kind: 'user' } }))
    await settled
    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0]?.tools).toBeUndefined()
    expect(readSuperGoal(agent.session)).toBeNull()
    expect((await command(ctx, agent, 'pause'))?.result.kind).toBe('error')
    expect((await command(ctx, agent, 'resume'))?.result.kind).toBe('error')
  })

  it('continues after each premature final and stops only after logged completion evidence', async () => {
    const adapter = new MockAdapter([
      textResponse('First task is done.'),
      textResponse('Second task is done.'),
      toolCallResponse('complete', 'complete_super_goal', { revision: 1, evidence: 'Both acceptance checks passed.' }),
      textResponse('The full objective is complete.'),
    ])
    const { ctx, agent } = await harness(adapter)
    const settled = idle(ctx, agent)
    expect((await command(ctx, agent, 'Complete both acceptance checks'))?.result.kind).toBe('success')
    await settled
    expect(adapter.requests).toHaveLength(4)
    expect(readSuperGoal(agent.session)).toMatchObject({ phase: 'complete', revision: 2, evidence: 'Both acceptance checks passed.' })
    const log = agent.session.snapshotEvents()
    expect(log.filter(event => event.type === 'turn/end')).toHaveLength(1)
    expect(log.filter(event => event.type === 'user/message' && event.data.source.kind === 'plugin'
      && event.data.source.plugin === 'super-goal')).toHaveLength(3)
    const restored = ctx.sessions.create(SessionId('restored'), { seed: [...log] })
    expect(readSuperGoal(restored)).toEqual(readSuperGoal(agent.session))
  })

  it('holds at the multiple-choice question, logs the answer, then resumes pursuit', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('block', 'block_super_goal', blocker),
      textResponse('The target is configured.'),
      toolCallResponse('complete', 'complete_super_goal', { revision: 3, evidence: 'Staging deployment verified.' }),
      textResponse('Complete.'),
    ])
    const { ctx, agent } = await harness(adapter)
    const question = pendingQuestion(ctx)
    const settled = idle(ctx, agent)
    await command(ctx, agent, 'Deploy to an authorized target')
    const request = await question.received
    expect(request.agent).toBe(agent)
    expect(request.questions).toEqual([{ id: 'super-goal-blocker', header: 'SuperGoal', question: blocker.reason,
      options: blocker.choices.map(label => ({ label })), multiSelect: false }])
    expect(adapter.requests).toHaveLength(1)
    expect(readSuperGoal(agent.session)).toMatchObject({ phase: 'blocked', revision: 2 })
    question.answer.resolve({ answers: [{ id: 'super-goal-blocker', selected: ['Use staging'] }] })
    await settled
    expect(adapter.requests).toHaveLength(4)
    expect(readSuperGoal(agent.session)).toMatchObject({ phase: 'complete', answer: 'Use staging' })
    const resumed = agent.session.snapshotEvents().find(event => event.type === 'super-goal/change'
      && event.data.goal?.answer === 'Use staging' && event.data.goal.phase === 'active')
    expect(resumed).toBeDefined()
  })

  it.each(['pause', 'clear'])('a %s command invalidates a late blocker answer', async (action) => {
    const adapter = new MockAdapter([toolCallResponse('block', 'block_super_goal', blocker), textResponse('Stopped.')])
    const { ctx, agent } = await harness(adapter)
    const question = pendingQuestion(ctx)
    const settled = idle(ctx, agent)
    await command(ctx, agent, 'Deploy to an authorized target')
    const request = await question.received
    expect((await command(ctx, agent, action))?.result.kind).toBe('success')
    expect(request.signal?.aborted).toBe(true)
    question.answer.resolve({ answers: [{ id: 'super-goal-blocker', selected: ['Use staging'] }] })
    await settled
    expect(readSuperGoal(agent.session)).toEqual(action === 'clear' ? null : expect.objectContaining({ phase: 'paused' }))
    expect(agent.session.snapshotEvents().some(event => event.type === 'super-goal/change' && event.data.goal?.answer)).toBe(false)
  })

  it('manual cancellation does not restart the active goal on an unrelated task', async () => {
    const adapter = new MockAdapter(['hang', textResponse('Unrelated answer.')])
    const { ctx, agent } = await harness(adapter)
    const streaming = Promise.withResolvers<undefined>()
    ctx.on('agent/assistant-stream', ({ agent: subject, frame }) => {
      if (subject === agent && frame.type === 'chunk') streaming.resolve(undefined)
    })
    const stopped = idle(ctx, agent)
    await command(ctx, agent, 'Keep working until accepted')
    await streaming.promise
    agent.cancel({ kind: 'user' })
    await stopped
    await agent.whenIdle()
    const settled = idle(ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'An unrelated question' }], source: { kind: 'user' } }))
    await settled
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(2)
    expect(readSuperGoal(agent.session)?.phase).toBe('active')
    expect((await command(ctx, agent, 'show'))?.result.text).toContain('resume')
  })

  it.each([
    ['complete_super_goal', { revision: 1, evidence: '  ' }],
    ['complete_super_goal', { revision: 2, evidence: 'A stale observation' }],
    ['block_super_goal', { ...blocker, choices: ['Only one choice'] }],
    ['block_super_goal', { ...blocker, choices: ['Same', 'Same'] }],
  ])('rejects invalid %s input without settling the goal', async (name, args) => {
    const adapter = new MockAdapter([
      toolCallResponse('invalid', name, args),
      toolCallResponse('complete', 'complete_super_goal', { revision: 1, evidence: 'Acceptance check passed.' }),
      textResponse('Complete.'),
    ])
    const { ctx, agent } = await harness(adapter)
    const settled = idle(ctx, agent)
    await command(ctx, agent, 'Verify the acceptance check')
    await settled
    const results = agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
    expect(results[0]?.data.message.content[0]?.isError).toBe(true)
    expect(results[1]?.data.message.content[0]?.isError).toBe(false)
    expect(readSuperGoal(agent.session)).toMatchObject({ phase: 'complete', revision: 2 })
  })

  it('reopens a retained blocker before issuing another model request', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('block', 'block_super_goal', blocker),
      textResponse('Waiting for input.'),
      toolCallResponse('complete', 'complete_super_goal', { revision: 3, evidence: 'Target verified.' }),
      textResponse('Complete.'),
    ])
    const { ctx, agent } = await harness(adapter)
    const firstIdle = idle(ctx, agent)
    await command(ctx, agent, 'Deploy to an authorized target')
    await firstIdle
    expect(readSuperGoal(agent.session)?.phase).toBe('blocked')
    const question = pendingQuestion(ctx)
    const resumed = command(ctx, agent, 'resume')
    await question.received
    expect(adapter.requests).toHaveLength(2)
    expect(readSuperGoal(agent.session)?.phase).toBe('blocked')
    const settled = idle(ctx, agent)
    question.answer.resolve({ answers: [{ id: 'super-goal-blocker', selected: ['Use staging'] }] })
    expect((await resumed)?.result.kind).toBe('success')
    await settled
    expect(readSuperGoal(agent.session)).toMatchObject({ phase: 'complete', answer: 'Use staging' })
  })

  it('an unknown option cannot resume a blocked goal', async () => {
    const adapter = new MockAdapter([toolCallResponse('block', 'block_super_goal', blocker), textResponse('Waiting.')])
    const { ctx, agent } = await harness(adapter)
    const question = pendingQuestion(ctx)
    const settled = idle(ctx, agent)
    await command(ctx, agent, 'Deploy to an authorized target')
    await question.received
    question.answer.resolve({ answers: [{ id: 'super-goal-blocker', selected: ['An unoffered target'] }] })
    await settled
    expect(readSuperGoal(agent.session)).toMatchObject({ phase: 'blocked', revision: 2 })
  })

  it('a delegated agent cannot create or modify a root objective', async () => {
    const { ctx, agent } = await harness(new MockAdapter([]))
    const child = await ctx.agentLoop.createAgent(agent.ctx, {
      sessionId: SessionId('super-goal-child'),
      meta: { parentSession: agent.id, delegationDepth: 1, origin: 'subagent' },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await expect(command(ctx, child.agent, 'Own the parent objective')).rejects.toThrow('exact live root agent')
    expect(readSuperGoal(child.agent.session)).toBeNull()
    expect(readSuperGoal(agent.session)).toBeNull()
  })

  it('restores an unfinished objective without starting work until explicitly resumed', async () => {
    const adapter = new MockAdapter([textResponse('Unrelated reply.'),
      toolCallResponse('complete', 'complete_super_goal', { revision: 2, evidence: 'Resumed acceptance verified.' }),
      textResponse('Complete.')])
    const { ctx } = await harness(adapter)
    const saved = ctx.sessions.create(SessionId('saved-goal'))
    saved.append('super-goal/change', { version: 1, revision: 1,
      goal: { revision: 1, objective: 'Complete the retained acceptance check', phase: 'active' } })
    const { agent } = await ctx.agentLoop.createAgent(ctx, {
      sessionId: SessionId('restored-goal'), seed: [...saved.snapshotEvents()],
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(0)
    const unrelated = idle(ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'An unrelated question' }], source: { kind: 'user' } }))
    await unrelated
    expect(adapter.requests).toHaveLength(1)
    const settled = idle(ctx, agent)
    await command(ctx, agent, 'resume')
    await settled
    expect(readSuperGoal(agent.session)).toMatchObject({ phase: 'complete', revision: 3 })
  })

  it('clear retains its revision tombstone before a replacement objective is created', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('complete-first', 'complete_super_goal', { revision: 1, evidence: 'First check passed.' }),
      textResponse('First complete.'),
      toolCallResponse('complete-next', 'complete_super_goal', { revision: 4, evidence: 'Second check passed.' }),
      textResponse('Second complete.'),
    ])
    const { ctx, agent } = await harness(adapter)
    const firstIdle = idle(ctx, agent)
    await command(ctx, agent, 'First objective')
    await firstIdle
    await command(ctx, agent, 'clear')
    expect(readSuperGoal(agent.session)).toBeNull()
    const settled = idle(ctx, agent)
    await command(ctx, agent, 'Replacement objective')
    await settled
    expect(readSuperGoal(agent.session)).toMatchObject({ revision: 5, objective: 'Replacement objective', phase: 'complete' })
  })

  it('unloading the plugin drains goal work and leaves an ordinary agent running', async () => {
    const adapter = new MockAdapter(['hang', 'hang'])
    const { ctx, agent, goalPlugin } = await harness(adapter)
    const ordinary = await ctx.agentLoop.create(SessionId('ordinary'), { provider: 'mock', model: 'mock' })
    const goalStreaming = Promise.withResolvers<undefined>()
    const ordinaryStreaming = Promise.withResolvers<undefined>()
    ctx.on('agent/assistant-stream', ({ agent: subject, frame }) => {
      if (frame.type !== 'chunk') return
      if (subject === agent) goalStreaming.resolve(undefined)
      if (subject === ordinary) ordinaryStreaming.resolve(undefined)
    })
    await command(ctx, agent, 'A long-running objective')
    await goalStreaming.promise
    ordinary.followup(createUserMessage({ content: [{ type: 'text', text: 'Ordinary work' }], source: { kind: 'user' } }))
    await ordinaryStreaming.promise
    await goalPlugin.dispose()
    expect(agent.status).toBe('idle')
    expect(ordinary.status).toBe('running')
    expect(adapter.requests).toHaveLength(2)
    ordinary.cancel({ kind: 'user' })
    await ordinary.whenIdle()
  })

  it('unloading with a pending blocker aborts the question and rejects a late answer', async () => {
    const adapter = new MockAdapter([toolCallResponse('block', 'block_super_goal', blocker)])
    const { ctx, agent, goalPlugin } = await harness(adapter)
    const question = pendingQuestion(ctx)
    await command(ctx, agent, 'Deploy to an authorized target')
    const request = await question.received
    const aborted = Promise.withResolvers<undefined>()
    request.signal?.addEventListener('abort', () => { aborted.resolve(undefined) }, { once: true })
    const unloaded = goalPlugin.dispose()
    await aborted.promise
    expect(request.signal?.aborted).toBe(true)
    question.answer.resolve({ answers: [{ id: 'super-goal-blocker', selected: ['Use staging'] }] })
    await unloaded
    expect(agent.status).toBe('idle')
    await agent.whenIdle()
    expect(readSuperGoal(agent.session)).toMatchObject({ phase: 'blocked', revision: 2 })
    expect(adapter.requests).toHaveLength(1)
  })

  it('reads the exact revision through the model tool and presents the three goal operations', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('read', 'get_super_goal', {}),
      toolCallResponse('complete', 'complete_super_goal', { revision: 1, evidence: 'Check passed.' }),
      textResponse('Complete.'),
    ])
    const { ctx, agent } = await harness(adapter)
    const settled = idle(ctx, agent)
    await command(ctx, agent, 'Read and verify the objective')
    await settled
    const first = agent.session.snapshotEvents().find(event => event.type === 'tool/result')
    expect(first?.data.message.content[0]?.content).toEqual([{ type: 'text', text: JSON.stringify({
      revision: 1, objective: 'Read and verify the objective', phase: 'active',
    }) }])
    expect(ctx.tools.get('get_super_goal', agent)?.presentCall?.({})).toMatchObject({ title: 'Read SuperGoal', kind: 'read' })
    expect(ctx.tools.get('complete_super_goal', agent)?.presentCall?.({ revision: 1, evidence: 'Check passed.' }))
      .toMatchObject({ title: 'Complete SuperGoal', rawInput: 'Check passed.' })
    expect(ctx.tools.get('block_super_goal', agent)?.presentCall?.(blocker))
      .toMatchObject({ title: 'SuperGoal needs input', rawInput: blocker.reason })
    const direct = await ctx.tools.execute({ agent, signal: new AbortController().signal,
      callId: ToolCallId('direct-goal'), name: 'get_super_goal', arguments: {} })
    expect(direct.isError).toBe(true)
    expect((await command(ctx, agent, 'resume'))?.result.kind).toBe('error')
  })

  it('mounting the plugin around existing agents restores only the session that owns a goal', async () => {
    const { ctx, agent, goalPlugin } = await harness(new MockAdapter([]))
    await goalPlugin.dispose()
    agent.session.append('super-goal/change', { version: 1, revision: 1,
      goal: { revision: 1, objective: 'Retained objective', phase: 'paused' } })
    const ordinary = await ctx.agentLoop.create(SessionId('existing-ordinary'), { provider: 'mock', model: 'mock' })
    await ctx.plugin(SuperGoalPlugin)
    expect(ctx.tools.get('get_super_goal', agent)).toBeDefined()
    expect(ctx.tools.get('get_super_goal', ordinary)).toBeUndefined()
    expect((await command(ctx, ordinary, 'show'))?.result.text).toContain('No SuperGoal')
    expect((await command(ctx, agent, 'A different goal'))?.result.kind).toBe('error')
    const owned = await ctx.agentLoop.createAgent(ctx, { sessionId: SessionId('disposable-goal-agent'),
      agentOptions: { provider: 'mock', model: 'mock' } })
    await owned.dispose()
  })

  it('a concurrent durable pause prevents both continuation and a stale blocker answer', async () => {
    const adapter = new MockAdapter([toolCallResponse('block', 'block_super_goal', blocker), textResponse('Paused.')])
    const { ctx, agent } = await harness(adapter)
    const question = pendingQuestion(ctx)
    const settled = idle(ctx, agent)
    await command(ctx, agent, 'Deploy to an authorized target')
    await question.received
    const blocked = readSuperGoal(agent.session)
    if (!blocked) throw new Error('Expected the blocked objective')
    agent.session.append('super-goal/change', { version: 1, revision: 3, goal: { ...blocked, revision: 3, phase: 'paused' } })
    question.answer.resolve({ answers: [{ id: 'super-goal-blocker', selected: ['Use staging'] }] })
    await settled
    expect(readSuperGoal(agent.session)?.phase).toBe('paused')
    expect(adapter.requests).toHaveLength(2)
  })

  it('requires an answer belonging to the pending blocker', async () => {
    const adapter = new MockAdapter([toolCallResponse('block', 'block_super_goal', blocker), textResponse('Waiting.')])
    const { ctx, agent } = await harness(adapter)
    const question = pendingQuestion(ctx)
    const settled = idle(ctx, agent)
    await command(ctx, agent, 'Deploy to an authorized target')
    await question.received
    expect((await command(ctx, agent, 'show'))?.result.text).toContain(blocker.reason)
    question.answer.resolve({ answers: [] })
    await settled
    expect(readSuperGoal(agent.session)?.phase).toBe('blocked')
  })

  it('shows a running objective and respects an independently committed pause at task completion', async () => {
    const entered = Promise.withResolvers<undefined>()
    const adapter = new MockAdapter([() => { entered.resolve(undefined); return textResponse('One task done.') }])
    const { ctx, agent } = await harness(adapter)
    const settled = idle(ctx, agent)
    await command(ctx, agent, 'Long-term objective')
    await entered.promise
    expect((await command(ctx, agent, 'show'))?.result).toMatchObject({ text: 'SuperGoal (active): Long-term objective' })
    agent.session.append('super-goal/change', { version: 1, revision: 2,
      goal: { revision: 2, objective: 'Long-term objective', phase: 'paused' } })
    await settled
    expect(adapter.requests).toHaveLength(1)
  })

  it('refuses to read a persisted objective whose revision history has a gap', () => {
    const session = Session.create(SessionId('revision-gap'))
    session.append('super-goal/change', { version: 1, revision: 2,
      goal: { revision: 2, objective: 'Retained work', phase: 'active' } })
    expect(() => readSuperGoal(session)).toThrow('Invalid SuperGoal revision sequence')
  })

  it('replacing a pending resume keeps the newer question pending until its own answer', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('block', 'block_super_goal', blocker), textResponse('Waiting.'),
      toolCallResponse('complete', 'complete_super_goal', { revision: 3, evidence: 'Custom target verified.' }),
      textResponse('Complete.'),
    ])
    const { ctx, agent } = await harness(adapter)
    const blocked = idle(ctx, agent)
    await command(ctx, agent, 'Deploy to an authorized target')
    await blocked
    const firstQuestion = Promise.withResolvers<AskUserQuestionRequest>()
    const secondQuestion = Promise.withResolvers<AskUserQuestionRequest>()
    const firstAnswer = Promise.withResolvers<AskUserQuestionAnswer>()
    const secondAnswer = Promise.withResolvers<AskUserQuestionAnswer>()
    let requests = 0
    ctx.on('user-questions/request', (request) => {
      requests += 1
      if (requests === 1) { firstQuestion.resolve(request); return firstAnswer.promise }
      secondQuestion.resolve(request)
      return secondAnswer.promise
    })
    const firstResume = command(ctx, agent, 'resume')
    const firstRejected = expect(firstResume).rejects.toThrow()
    const first = await firstQuestion.promise
    const secondResume = command(ctx, agent, 'resume')
    const second = await secondQuestion.promise
    expect(first.signal?.aborted).toBe(true)
    firstAnswer.resolve({ answers: [{ id: 'super-goal-blocker', selected: ['Use staging'] }] })
    await firstRejected
    expect(second.signal?.aborted).toBe(false)
    expect(readSuperGoal(agent.session)?.phase).toBe('blocked')
    const settled = idle(ctx, agent)
    secondAnswer.resolve({ answers: [{ id: 'super-goal-blocker', selected: [], custom: 'Use the isolated preview target' }] })
    await secondResume
    await settled
    expect(readSuperGoal(agent.session)).toMatchObject({ phase: 'complete', answer: 'Use the isolated preview target' })
  })

  it.each([
    ['command', 'pause'], ['command', 'clear'], ['tool', 'pause'], ['tool', 'clear'],
  ])('a %s answer cannot resume after a %s at the answer commit', async (path, action) => {
    const adapter = new MockAdapter([
      toolCallResponse('block', 'block_super_goal', blocker),
      ...path === 'command' ? [textResponse('Waiting for input.')] : [],
    ])
    const { ctx, agent } = await harness(adapter)
    const firstIdle = idle(ctx, agent)
    const question = path === 'tool' ? pendingQuestion(ctx) : undefined
    await command(ctx, agent, 'Deploy to an authorized target')
    if (path === 'command') await firstIdle
    const pending = question ?? pendingQuestion(ctx)
    const stopped = Promise.withResolvers<Awaited<ReturnType<typeof command>>>()
    ctx.on('session/event', (session, event) => {
      if (session !== agent.session || event.type !== 'super-goal/change'
        || event.data.goal?.phase !== 'active' || event.data.goal.answer !== 'Use staging') return
      queueMicrotask(() => {
        void command(ctx, agent, action).then(stopped.resolve, stopped.reject)
      })
    })
    const resumed = path === 'command' ? command(ctx, agent, 'resume') : undefined
    const rejected = resumed === undefined ? undefined : expect(resumed).rejects.toThrow('inactive or the revision is stale')
    await pending.received
    pending.answer.resolve({ answers: [{ id: 'super-goal-blocker', selected: ['Use staging'] }] })
    expect((await stopped.promise)?.result.kind).toBe('success')
    await rejected
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(path === 'command' ? 2 : 1)
    expect(readSuperGoal(agent.session)).toEqual(action === 'clear' ? null : expect.objectContaining({ phase: 'paused' }))
    const log = agent.session.snapshotEvents()
    const stopEvent = log.find(event => event.type === 'super-goal/change' && event.data.revision === 4)
    if (!stopEvent) throw new Error('Expected the committed stop')
    expect(log.filter(event => event.seq > stopEvent.seq && event.type === 'agent/inbox/spliced'
      && event.data.inserted.length > 0)).toEqual([])
    expect(log.filter(event => event.type === 'user/message' && event.data.source.kind === 'plugin'
      && event.data.content.some(block => block.type === 'text' && block.text.includes('Human decision:')))).toEqual([])
  })
})
