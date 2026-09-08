/** Validated SuperGoal snapshots and the session banner projection. */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SuperGoalProjectionState } from './types.ts'

/** Validated durable objective, including evidence and blocker choices. */
export const stateSchema = z.object({
  revision: z.number().int().positive(), objective: z.string().trim().min(1),
  phase: z.enum(['active', 'paused', 'blocked', 'complete']),
  evidence: z.string().trim().min(1).optional(), reason: z.string().trim().min(1).optional(),
  choices: z.array(z.string().trim().min(1)).min(2).max(3).optional(),
  answer: z.string().trim().min(1).optional(),
}).strict().superRefine((goal, context) => {
  if (goal.phase === 'complete' && !goal.evidence) context.addIssue({ code: 'custom', message: 'Completion requires evidence' })
  if (goal.phase === 'blocked' && (!goal.reason || !goal.choices || new Set(goal.choices).size !== goal.choices.length)) {
    context.addIssue({ code: 'custom', message: 'A blocker requires a reason and distinct choices' })
  }
})

/** Accepted version and matching snapshot revision for one committed mutation. */
export const changeSchema = z.object({
  version: z.literal(1), revision: z.number().int().positive(), goal: stateSchema.nullable(),
}).strict().refine(change => change.goal === null || change.goal.revision === change.revision,
  'SuperGoal snapshot revision must match its event')

/** Session projection used by the highlighted SuperGoal banner. */
export const superGoalProjectionDefinition = {
  key: 'superGoal',
  stateVersion: 1,
  stateSchema: z.object({
    revision: z.number().int().nonnegative(), goal: stateSchema.nullable(), failure: z.string().nullable(),
  }).strict().refine(state => state.goal === null || state.goal.revision === state.revision,
    'SuperGoal projection revision must match its goal') as z.ZodType<SuperGoalProjectionState>,
  init: (): SuperGoalProjectionState => ({ revision: 0, goal: null, failure: null }),
  apply(state, event): SuperGoalProjectionState {
    if (event.type !== 'super-goal/change' || state.failure !== null) return state
    const parsed = changeSchema.safeParse(event.data)
    if (!parsed.success || parsed.data.revision !== state.revision + 1) {
      return { ...state, failure: `Invalid SuperGoal event at sequence ${event.seq}` }
    }
    return { revision: parsed.data.revision, goal: parsed.data.goal, failure: null }
  },
  wire: { viewSchema: stateSchema.nullable(), view: state => state.goal },
} satisfies ProjectionDefinition<'superGoal', SuperGoalProjectionState>
