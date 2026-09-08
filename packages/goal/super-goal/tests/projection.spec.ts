/** Durable banner projection and checkpoint validation. */
import { describe, expect, it } from 'vitest'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { superGoalProjectionDefinition as projection } from '../src/projection.ts'

function change(revision: number, goal: unknown): SessionEvent {
  return { type: 'super-goal/change', seq: SessionSeq(revision), data: { version: 1, revision, goal } } as SessionEvent
}

const goal = { revision: 1, objective: 'Verify the result', phase: 'active' as const }

describe('SuperGoal projection', () => {
  it('retains clear tombstones and admits the next objective revision', () => {
    const created = projection.apply(projection.init(), change(1, goal))
    expect(projection.wire.view(created)).toEqual(goal)
    const cleared = projection.apply(created, change(2, null))
    expect(cleared).toEqual({ revision: 2, goal: null, failure: null })
    const replaced = projection.apply(cleared, change(3, { ...goal, revision: 3 }))
    expect(replaced.revision).toBe(3)
    expect(replaced.failure).toBeNull()
  })

  it.each([
    { ...goal, revision: 2, phase: 'complete' },
    { ...goal, revision: 2, phase: 'blocked', reason: 'Need credentials', choices: ['Provide access', 'Provide access'] },
    { ...goal, revision: 7 },
  ])('retains the last valid banner and first failure for malformed data %j', (invalid) => {
    const created = projection.apply(projection.init(), change(1, goal))
    const failed = projection.apply(created, change(2, invalid))
    expect(failed.goal).toEqual(goal)
    expect(failed.failure).toBe('Invalid SuperGoal event at sequence 2')
    expect(projection.apply(failed, change(3, null))).toBe(failed)
  })

  it('rejects event revision gaps and unsupported versions', () => {
    expect(projection.apply(projection.init(), change(2, null)).failure).not.toBeNull()
    const unknownVersion = { ...change(1, goal), data: { version: 2, revision: 1, goal } } as unknown as SessionEvent
    expect(projection.apply(projection.init(), unknownVersion).failure).not.toBeNull()
  })

  it('validates restored checkpoint revisions and completion evidence', () => {
    const valid = { revision: 1, goal, failure: null }
    expect(projection.stateSchema.safeParse(valid).success).toBe(true)
    expect(projection.stateSchema.safeParse({ ...valid, revision: 2 }).success).toBe(false)
    expect(projection.stateSchema.safeParse({ ...valid, goal: { ...goal, phase: 'complete' } }).success).toBe(false)
    expect(projection.stateSchema.safeParse({ revision: 2, goal: null, failure: null }).success).toBe(true)
  })

  it('leaves unrelated session events untouched', () => {
    const state = projection.init()
    expect(projection.apply(state, { type: 'turn/start', seq: SessionSeq(0), data: { turn: 1 } } as SessionEvent)).toBe(state)
  })
})
