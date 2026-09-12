/** Persistent long-term objectives and root-agent continuation. @module @deepseek-ai/dsh-super-goal */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-user-questions'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { SuperGoal, SuperGoalChange, SuperGoalProjectionState } from './types.ts'
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

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Read process-local pursuit for the exact live root Session.
     * @mode bail
     * @param session - Session whose pursuit is requested.
     */
    'super-goal/activation'(session: Session): boolean | undefined
    /**
     * Publish a committed process-local pursuit change.
     * @mode emit
     * @param session - Session whose pursuit changed.
     * @param armed - Whether SuperGoal continuation is armed.
     */
    'super-goal/activation-changed'(session: Session, armed: boolean): void
  }
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

/** Configures how an armed objective absorbs turns that end without progress. */
export interface Config {
  /**
   * Consecutive turns that end without completing work before the objective
   * reports a durable blocker instead of being retried (default 3).
   */
  maxConsecutiveFailures?: number
}

export const Config: z<Config> = z.object({
  maxConsecutiveFailures: z.number().min(1).default(3),
})

/** Turn-end causes that record a human or teardown decision rather than a failure. */
const DELIBERATE_STOP_CAUSES: readonly string[] = ['user', 'parent', 'disposed', 'legacy']

/**
 * Whether one turn end ends pursuit by decision instead of by failure. A
 * merge-extensible cause added by another plugin is treated as a failure, so an
 * unknown cause retries within the failure budget rather than stopping silently.
 * @param reason - the turn end reason recorded for the pursuing agent.
 * @returns whether pursuit must stop for this turn end.
 */
function deliberateStop(reason: TurnEndReason): boolean {
  if (reason.kind !== 'aborted') return false
  return DELIBERATE_STOP_CAUSES.includes(reason.reason.kind)
}

/**
 * Concrete account of a turn that ended without completing work.
 * @param reason - the recorded turn end reason.
 * @returns model- and human-readable text naming the observed condition.
 */
function failureReason(reason: TurnEndReason): string {
  switch (reason.kind) {
    case 'error':
      return reason.error.message
    case 'max-tokens':
      return 'the model reached its output-token ceiling'
    case 'blocked':
      return 'a plugin rejected the turn before it ran'
    case 'interrupted':
      return 'the harness stopped while the turn was running'
    case 'aborted':
      return `the turn was cancelled by a ${reason.reason.kind} hook`
    case 'completed':
      return 'the turn completed without finishing the objective'
    default:
      // TurnEndReasonMap is merge-extensible: another plugin's reason is a
      // failure the objective retries within its budget.
      return 'the turn ended without completing the objective'
  }
}

/** Process-local pursuit of one exact root agent. */
interface Pursuit {
  /** Whether this agent may continue the objective automatically. */
  armed: boolean
  /** Consecutive turns that ended without completing work. */
  failures: number
  /** Turn end recorded for the most recent turn, absent before the first one. */
  lastTurn: TurnEndReason | undefined
}

/** Mount the command, tools, and reversible continuation listeners.
 * @param ctx - Plugin context owning every registration and question lifetime.
 * @param config - deployment defaults for the failure budget.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const maxConsecutiveFailures = config.maxConsecutiveFailures ?? 3
  ctx.sessionProjections.register(superGoalProjectionDefinition)
  function currentChange(session: Session): SuperGoalProjectionState {
    const state = ctx.sessionProjections.stateOf(session, 'superGoal')
    if (!state) throw new Error('SuperGoal projection is not registered')
    if (state.failure !== null) throw new Error(state.failure)
    return state
  }
  function currentGoal(session: Session): SuperGoal | null {
    return currentChange(session).goal
  }
  /**
   * Read the durable objective without letting a replay failure break a caller
   * that runs inside an agent lifecycle event.
   * @param session - Session whose objective is requested.
   * @returns the current objective, or null when it cannot be read.
   */
  function readGoal(session: Session): SuperGoal | null {
    try {
      return currentGoal(session)
    } catch (error: unknown) {
      ctx.logger.warn(`super-goal: cannot read the objective for session "${session.id}": ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }
  const pursuits = new Map<Agent, Pursuit>()
  function pursuit(agent: Agent): Pursuit {
    let existing = pursuits.get(agent)
    if (existing === undefined) {
      existing = { armed: false, failures: 0, lastTurn: undefined }
      pursuits.set(agent, existing)
    }
    return existing
  }
  function isArmed(agent: Agent): boolean {
    return pursuits.get(agent)?.armed === true
  }
  function setArmed(agent: Agent, value: boolean): void {
    const state = pursuit(agent)
    if (state.armed === value) return
    state.armed = value
    if (!value) state.failures = 0
    ctx.emit('super-goal/activation-changed', agent.session, value)
  }
  ctx.on('super-goal/activation', session => ctx.agents.roots().some(agent => agent.session === session && isArmed(agent)))
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
    const revision = currentChange(agent.session).revision + 1
    const next = goal === null ? null : stateSchema.parse({ ...goal, revision })
    agent.session.append('super-goal/change', { version: 1, revision, goal: next })
    return next
  }
  function active(agent: Agent, revision: number, activate = false): SuperGoal {
    const goal = currentGoal(agent.session)
    if (!goal || goal.revision !== revision || goal.phase !== 'active' || (!activate && !isArmed(agent))) {
      throw new Error('SuperGoal is inactive or the revision is stale; read it again or ask the user to /supergoal resume')
    }
    if (activate) setArmed(agent, true)
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
        const current = currentGoal(agent.session)
        if (current?.revision !== blocked.revision || current.phase !== 'blocked') throw new Error('SuperGoal changed while waiting for input')
        const item = answer.answers.find(item => item.id === 'super-goal-blocker')
        if (item && !item.custom?.trim() && (item.selected.length !== 1 || !(blocked.choices as readonly string[]).includes(item.selected[0] ?? ''))) {
          throw new Error('Select one of the offered SuperGoal choices or provide a custom answer')
        }
        const decision = item?.custom?.trim() || item?.selected.join(', ').trim()
        if (!decision) throw new Error('SuperGoal requires an answer before continuing')
        const next = commit(agent, { ...blocked, phase: 'active', answer: decision })
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
  /**
   * Report an objective that exhausted its failure budget, then resume pursuit
   * from the human answer. The durable blocker is committed before the question
   * opens, so a session that is never answered still records why it stopped.
   */
  async function reportExhausted(agent: Agent, blocked: SuperGoal, reason: string): Promise<void> {
    try {
      const next = await askBlocker(agent, blocked, lifetime.signal)
      lifetime.signal.throwIfAborted()
      root(agent)
      active(agent, next.revision, true)
      ensureTools(agent)
      agent.steer(message(next))
    } catch (error: unknown) {
      // A cancelled, unavailable, or superseded question leaves the committed
      // blocker in place; the plugin instance may also be tearing down, which is
      // not a failure worth reporting.
      if (!lifetime.signal.aborted) {
        ctx.logger.warn(`super-goal: objective revision ${blocked.revision} stopped after ${maxConsecutiveFailures} failed turns `
          + `(${reason}): ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  ctx.on('agent/session-start', ({ agent }) => {
    const state = pursuit(agent)
    state.failures = 0
    state.lastTurn = undefined
    const goal = ctx.agents.roots().includes(agent) ? readGoal(agent.session) : null
    if (goal === null) {
      setArmed(agent, false)
      return
    }
    ensureTools(agent)
    // A reloaded objective is the human's standing instruction, so an active
    // goal resumes itself. A seeded session (a fork or an inherited child log)
    // carries the objective without the authority to pursue it, because the
    // session it was forked from may still be running.
    if (goal.phase === 'active' && !agent.session.header.isSeeded) {
      setArmed(agent, true)
      agent.steer(message(goal))
      return
    }
    setArmed(agent, false)
  })
  ctx.on('agent/disposed', ({ agent }) => {
    setArmed(agent, false)
    pursuits.delete(agent)
    pending.get(agent)?.controller.abort()
  })
  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'running') return
    const state = pursuits.get(agent)
    if (state === undefined || !state.armed) return
    const goal = readGoal(agent.session)
    if (!goal || goal.phase !== 'active') {
      setArmed(agent, false)
      return
    }
    const lastTurn = state.lastTurn
    if (lastTurn !== undefined && deliberateStop(lastTurn)) {
      setArmed(agent, false)
      return
    }
    // An armed objective that reaches idle ended its turn without being steered
    // onward, so this turn failed or completed without finishing the work.
    if (lastTurn === undefined || lastTurn.kind === 'completed') {
      state.failures = 0
    } else {
      state.failures += 1
    }
    if (state.failures >= maxConsecutiveFailures) {
      const reason = lastTurn === undefined ? 'the objective stopped making progress' : failureReason(lastTurn)
      setArmed(agent, false)
      const blocked = commitBlocked(agent, goal, reason)
      if (blocked !== undefined) {
        void reportExhausted(agent, blocked, reason)
        return
      }
      // A concurrent mutation replaced the revision that exhausted its budget.
      // A replacement still active starts with its own budget; a pause, clear,
      // or completion is the deliberate stop that already owns the change.
      const latest = readGoal(agent.session)
      if (latest !== null && latest.phase === 'active') {
        state.failures = 0
        setArmed(agent, true)
        agent.steer(message(latest))
      }
      return
    }
    agent.steer(message(goal))
  })
  /**
   * Commit the durable blocker for an objective that exhausted its budget, only
   * while the exact revision it was armed for is still the current active one.
   * @param agent - the exact live root agent.
   * @param goal - the objective revision that exhausted its budget.
   * @param reason - the concrete condition that repeated.
   * @returns the blocked objective, or undefined when another mutation won.
   */
  function commitBlocked(agent: Agent, goal: SuperGoal, reason: string): SuperGoal | undefined {
    const current = readGoal(agent.session)
    if (current === null || current.revision !== goal.revision || current.phase !== 'active') return undefined
    return commit(agent, {
      ...goal,
      phase: 'blocked',
      reason: `SuperGoal stopped after ${maxConsecutiveFailures} consecutive turns without progress: ${reason}`,
      choices: ['Retry the objective now', 'Pause and inspect the failure'],
    })
  }
  ctx.on('agent/turn-stopping', ({ agent, signal }) => {
    if (signal.aborted || lifetime.signal.aborted || !isArmed(agent)) return
    const goal = currentGoal(agent.session)
    if (goal?.phase === 'active') agent.steer(message(goal))
  })
  // The recorded turn end is what separates a failed turn from a decided stop
  // when the driver converges back to idle.
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (event.type !== 'turn/end') return
    const agent = ctx.agents.get(session.id)
    if (agent === undefined || agent.session !== session) return
    const state = pursuits.get(agent)
    if (state === undefined) return
    state.lastTurn = event.data.reason
  })
  ctx.commands.register({
    name: 'supergoal', description: 'Set or control a persistent long-term objective',
    input: { hint: '[<objective>|show|pause|resume|clear]' },
    async handler(invocation) {
      lifetime.signal.throwIfAborted()
      const agent = root(invocation.agent)
      const input = invocation.rawInput.trim()
      const goal = currentGoal(agent.session)
      if (!input || input === 'show') return { kind: 'success', text: goal
        ? `SuperGoal (${goal.phase}${isArmed(agent) ? '' : '; use /supergoal resume to continue'}): ${goal.objective}${goal.phase === 'blocked' && goal.reason ? '\nBlocker: ' + goal.reason : ''}`
        : 'No SuperGoal. Use /supergoal <objective>.' }
      if (input === 'pause' && goal?.phase === 'complete') return { kind: 'error', text: 'No unfinished SuperGoal to pause.' }
      if (input === 'pause' || input === 'clear') {
        setArmed(agent, false)
        pending.get(agent)?.controller.abort()
        if (!goal) return { kind: 'error', text: 'No SuperGoal is set.' }
        commit(agent, input === 'clear' ? null : { ...goal, phase: goal.phase === 'blocked' ? 'blocked' : 'paused' })
        const cleanup = input === 'clear' ? installed.get(agent)?.() : undefined
        for (const entry of [...agent.inbox.nextStep, ...agent.inbox.nextTurn]) {
          if (entry.source.kind === 'plugin' && entry.source.plugin === name) agent.inbox.remove(entry.id)
        }
        agent.cancel({ kind: 'user' }, { keepInbox: true })
        await cleanup
        return { kind: 'success', text: `SuperGoal ${input === 'clear' ? 'cleared' : 'paused'}.` }
      }
      if (input === 'resume' && (!goal || goal.phase === 'complete')) return { kind: 'error', text: 'No unfinished SuperGoal to resume.' }
      if (input !== 'resume' && goal && goal.phase !== 'complete') return { kind: 'error', text: 'Clear or resume the existing SuperGoal first.' }
      pending.get(agent)?.controller.abort()
      if (input === 'resume' && goal?.phase === 'blocked') {
        const next = await askBlocker(agent, goal, invocation.signal)
        lifetime.signal.throwIfAborted()
        invocation.signal.throwIfAborted()
        active(agent, next.revision, true)
        ensureTools(agent)
        agent.steer(message(next))
        return { kind: 'success', text: `SuperGoal active: ${next.objective}` }
      }
      const next = commit(agent, { ...(input === 'resume' ? goal as SuperGoal : { objective: input }), phase: 'active' })
      ensureTools(agent)
      setArmed(agent, true)
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
    execute: (_args, exec) => Promise.resolve(JSON.stringify(currentGoal(executing(exec).session))),
    presentCall: () => ({ card: 'generic', title: 'Read SuperGoal', kind: 'read' }),
  }))
  definitions.push(defineTool({
    name: 'complete_super_goal', description: 'Complete SuperGoal only after verifying the entire objective; provide concrete evidence.',
    parameters: { revision, evidence: { type: 'string', required: true, description: 'Observed results proving completion.' } }, output,
    execute(args, exec) {
      const agent = executing(exec)
      const goal = active(agent, args.revision)
      const next = commit(agent, { ...goal, phase: 'complete', evidence: args.evidence })
      setArmed(agent, false)
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
      setArmed(agent, false)
      const next = await askBlocker(agent, blocked, exec.signal)
      lifetime.signal.throwIfAborted()
      exec.signal.throwIfAborted()
      active(agent, next.revision, true)
      exec.deferContext(message(next))
      return JSON.stringify(next)
    },
    presentCall: args => ({ card: 'generic', title: 'SuperGoal needs input', kind: 'other', rawInput: args.reason }),
  }))
  for (const agent of ctx.agents.roots()) {
    if (currentGoal(agent.session)) ensureTools(agent)
  }
  ctx.effect(() => async () => {
    lifetime.abort()
    const requests = [...pending.values()]
    const work = [...questionWork.keys()]
    // Only an armed pursuit is this plugin's work: a session it merely observed
    // keeps running through the unload.
    const owned = new Set<Agent>([...questionWork.values()])
    for (const [agent, state] of pursuits) {
      if (state.armed) owned.add(agent)
      setArmed(agent, false)
    }
    for (const request of requests) request.controller.abort()
    for (const agent of owned) agent.cancel({ kind: 'parent' })
    await Promise.allSettled([
      ...work,
      ...[...owned].map(agent => agent.whenIdle()),
    ])
  })
}
