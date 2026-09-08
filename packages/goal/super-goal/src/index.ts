/** Persistent long-term objectives and root-agent continuation. @module @deepseek-ai/dsh-super-goal */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-user-questions'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { SuperGoal, SuperGoalChange } from './types.ts'
import { stateSchema, changeSchema, superGoalProjectionDefinition } from './projection.ts'
export type * from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Durable long-term objective and human decisions. */
    'super-goal/change': SuperGoalChange
  }
}
/** Read and validate all committed SuperGoal revisions, including tombstones. */
function readChange(session: Session): SuperGoalChange {
  let current: SuperGoalChange = { version: 1, revision: 0, goal: null }
  for (const event of session.snapshotEvents()) {
    if (event.type !== 'super-goal/change') continue
    const next = changeSchema.parse(event.data)
    if (next.revision !== current.revision + 1) {
      throw new Error('Invalid SuperGoal revision sequence')
    }
    current = next
  }
  return current
}

/** Read a detached durable objective without activating continuation.
 * @param session - Session whose goal is requested.
 * @returns Current goal or null after clearing or before creation.
 */
export function readSuperGoal(session: Session): SuperGoal | null {
  return readChange(session).goal
}

export const name = 'super-goal'
export const inject = ['agents', 'tools', 'commands', 'userQuestions', 'sessionProjections']

/** Mount the command, tools, and reversible continuation listeners.
 * @param ctx - Plugin context owning every registration and question lifetime.
 */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(superGoalProjectionDefinition)
  const armed = new Set<Agent>()
  const installed = new WeakMap<Agent, () => Promise<void>>()
  const definitions: ToolDefinition[] = []
  function ensureTools(agent: Agent): void {
    if (installed.has(agent)) return
    const disposers = definitions.map(definition => agent.ctx.tools.register(definition))
    const uninstall = ctx.effect(() => () => {
      installed.delete(agent)
      for (const dispose of disposers) dispose()
    })
    installed.set(agent, uninstall)
  }
  const pending = new Map<Agent, { controller: AbortController; done: Promise<unknown> }>()
  const questionWork = new Map<Promise<unknown>, Agent>()
  const lifetime = new AbortController()
  const message = (goal: SuperGoal) => createUserMessage({
    source: { kind: 'plugin', plugin: name },
    content: [{ type: 'text', text: 'SuperGoal: ' + goal.objective + '\nAssess this objective after each completed task. '
      + 'If achieved, call complete_super_goal with concrete verification evidence. Otherwise take the next useful action '
      + 'and keep pursuing it. Only a hard blocker requiring human input warrants block_super_goal; supply the concrete '
      + 'reason and 2 to 3 actionable choices. Difficulty or unfinished work is not a blocker. Respect permissions and manual stop. '
      + 'Use get_super_goal for the current revision.'
      + (goal.answer ? '\nHuman decision: ' + goal.answer : '') }],
  })
  function root(agent: Agent | undefined): Agent {
    if (!agent || ctx.agents.get(agent.id) !== agent || !ctx.agents.roots().includes(agent)) {
      throw new Error('SuperGoal requires the exact live root agent')
    }
    return agent
  }
  function executing(exec: ToolRunContext): Agent {
    lifetime.signal.throwIfAborted()
    const agent = root(exec.agent)
    exec.signal.throwIfAborted()
    if (ctx.agents.currentInitiator() !== agent || agent.status !== 'running') throw new Error('SuperGoal requires an active agent tool call')
    return agent
  }
  function commit(agent: Agent, goal: Omit<SuperGoal, 'revision'>): SuperGoal
  function commit(agent: Agent, goal: null): null
  function commit(agent: Agent, goal: Omit<SuperGoal, 'revision'> | null): SuperGoal | null
  function commit(agent: Agent, goal: Omit<SuperGoal, 'revision'> | null): SuperGoal | null {
    const revision = readChange(agent.session).revision + 1
    const next = goal === null ? null : stateSchema.parse({ ...goal, revision })
    agent.session.append('super-goal/change', { version: 1, revision, goal: next })
    return next
  }
  function active(agent: Agent, revision: number): SuperGoal {
    const goal = readSuperGoal(agent.session)
    if (!goal || goal.revision !== revision || goal.phase !== 'active' || !armed.has(agent)) {
      throw new Error('SuperGoal is inactive or the revision is stale; read it again or ask the user to /supergoal resume')
    }
    return goal
  }
  function askBlocker(agent: Agent, blocked: SuperGoal, callerSignal: AbortSignal): Promise<SuperGoal> {
    const controller = new AbortController()
    const signal = AbortSignal.any([callerSignal, lifetime.signal, controller.signal])
    const done = Promise.resolve().then(async () => {
      try {
        signal.throwIfAborted()
        const answer = await ctx.userQuestions.ask({ agent, signal, questions: [{ id: 'super-goal-blocker', header: 'SuperGoal',
          question: blocked.reason as string,
          options: (blocked.choices as readonly string[]).map(label => ({ label })), multiSelect: false }] })
        signal.throwIfAborted()
        root(agent)
        const current = readSuperGoal(agent.session)
        if (current?.revision !== blocked.revision || current.phase !== 'blocked') throw new Error('SuperGoal changed while waiting for input')
        const item = answer.answers.find(item => item.id === 'super-goal-blocker')
        if (item && !item.custom?.trim() && (item.selected.length !== 1 || !(blocked.choices as readonly string[]).includes(item.selected[0] ?? ''))) {
          throw new Error('Select one of the offered SuperGoal choices or provide a custom answer')
        }
        const decision = item?.custom?.trim() || item?.selected.join(', ').trim()
        if (!decision) throw new Error('SuperGoal requires an answer before continuing')
        const next = commit(agent, { ...blocked, phase: 'active', answer: decision })
        armed.add(agent)
        return next
      } finally {
        questionWork.delete(done)
        if (pending.get(agent)?.controller === controller) pending.delete(agent)
      }
    })
    pending.set(agent, { controller, done })
    questionWork.set(done, agent)
    return done
  }
  ctx.on('agent/session-start', ({ agent }) => {
    armed.delete(agent)
    if (ctx.agents.roots().includes(agent) && readSuperGoal(agent.session)) ensureTools(agent)
  })
  ctx.on('agent/disposed', ({ agent }) => {
    armed.delete(agent)
    pending.get(agent)?.controller.abort()
  })
  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'running') armed.delete(agent)
  })
  ctx.on('agent/turn-stopping', ({ agent, signal }) => {
    if (signal.aborted || lifetime.signal.aborted || !armed.has(agent)) return
    const goal = readSuperGoal(agent.session)
    if (goal?.phase === 'active') agent.steer(message(goal))
  })
  ctx.commands.register({
    name: 'supergoal', description: 'Set or control a persistent long-term objective',
    input: { hint: '[<objective>|show|pause|resume|clear]' },
    async handler(invocation) {
      lifetime.signal.throwIfAborted()
      const agent = root(invocation.agent)
      const input = invocation.rawInput.trim()
      const goal = readSuperGoal(agent.session)
      if (!input || input === 'show') return { kind: 'success', text: goal
        ? `SuperGoal (${goal.phase}${armed.has(agent) ? '' : '; use /supergoal resume to continue'}): ${goal.objective}${goal.reason ? '\nBlocker: ' + goal.reason : ''}`
        : 'No SuperGoal. Use /supergoal <objective>.' }
      if (input === 'pause' && goal?.phase === 'complete') return { kind: 'error', text: 'No unfinished SuperGoal to pause.' }
      if (input === 'pause' || input === 'clear') {
        armed.delete(agent)
        pending.get(agent)?.controller.abort()
        if (!goal) return { kind: 'error', text: 'No SuperGoal is set.' }
        commit(agent, input === 'clear' ? null : { ...goal, phase: 'paused' })
        const cleanup = input === 'clear' ? installed.get(agent)?.() : undefined
        agent.cancel({ kind: 'user' })
        await cleanup
        return { kind: 'success', text: `SuperGoal ${input === 'clear' ? 'cleared' : 'paused'}.` }
      }
      if (input === 'resume' && (!goal || goal.phase === 'complete')) return { kind: 'error', text: 'No unfinished SuperGoal to resume.' }
      if (input !== 'resume' && goal && goal.phase !== 'complete') return { kind: 'error', text: 'Clear or resume the existing SuperGoal first.' }
      pending.get(agent)?.controller.abort()
      if (input === 'resume' && goal?.phase === 'blocked') {
        const next = await askBlocker(agent, goal, lifetime.signal)
        lifetime.signal.throwIfAborted()
        active(agent, next.revision)
        ensureTools(agent)
        agent.steer(message(next))
        return { kind: 'success', text: `SuperGoal active: ${next.objective}` }
      }
      const next = commit(agent, { ...(input === 'resume' ? goal as SuperGoal : { objective: input }), phase: 'active' })
      ensureTools(agent)
      armed.add(agent)
      agent.steer(message(next))
      return { kind: 'success', text: `SuperGoal active: ${next.objective}` }
    },
  })
  const output = {
    schema: { type: 'string' as const },
    render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
  }
  const revision = { type: 'number' as const, required: true as const, description: 'Exact revision returned by get_super_goal.' }
  definitions.push(defineTool({
    name: 'get_super_goal', description: 'Read the long-term SuperGoal and exact revision.', parameters: {}, output,
    execute: (_args, exec) => Promise.resolve(JSON.stringify(readSuperGoal(executing(exec).session))),
    presentCall: () => ({ card: 'generic', title: 'Read SuperGoal', kind: 'read' }),
  }))
  definitions.push(defineTool({
    name: 'complete_super_goal', description: 'Complete SuperGoal only after verifying the entire objective; provide concrete evidence.',
    parameters: { revision, evidence: { type: 'string', required: true, description: 'Observed results proving completion.' } }, output,
    execute(args, exec) {
      const agent = executing(exec)
      const goal = active(agent, args.revision)
      const next = commit(agent, { ...goal, phase: 'complete', evidence: args.evidence })
      armed.delete(agent)
      return Promise.resolve(JSON.stringify(next))
    },
    presentCall: args => ({ card: 'generic', title: 'Complete SuperGoal', kind: 'other', rawInput: args.evidence }),
  }))
  definitions.push(defineTool({
    name: 'block_super_goal', description: 'Request human input for a hard blocker that prevents further useful progress. Offer 2 to 3 actionable choices; the selected answer resumes pursuit.',
    parameters: { revision, reason: { type: 'string', required: true, description: 'Concrete blocker requiring human input.' },
      choices: { type: 'array', required: true, items: { type: 'string' }, description: 'Two or three distinct actionable choices.' } }, output,
    async execute(args, exec) {
      const agent = executing(exec)
      const goal = active(agent, args.revision)
      const blocked = commit(agent, { ...goal, phase: 'blocked', reason: args.reason, choices: args.choices })
      armed.delete(agent)
      const next = await askBlocker(agent, blocked, exec.signal)
      lifetime.signal.throwIfAborted()
      exec.signal.throwIfAborted()
      active(agent, next.revision)
      exec.deferContext(message(next))
      return JSON.stringify(next)
    },
    presentCall: args => ({ card: 'generic', title: 'SuperGoal needs input', kind: 'other', rawInput: args.reason }),
  }))
  for (const agent of ctx.agents.roots()) {
    if (readSuperGoal(agent.session)) ensureTools(agent)
  }
  ctx.effect(() => async () => {
    lifetime.abort()
    const requests = [...pending.values()]
    const work = [...questionWork.keys()]
    const owned = new Set([...armed, ...questionWork.values()])
    armed.clear()
    for (const request of requests) request.controller.abort()
    for (const agent of owned) agent.cancel({ kind: 'parent' })
    await Promise.allSettled([
      ...work,
      ...[...owned].map(agent => agent.whenIdle()),
    ])
  })
}
