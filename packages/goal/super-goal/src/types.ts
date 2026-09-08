/** Browser-safe durable SuperGoal and projection values. */

/** Long-term objective, human decision, and completion evidence. */
export interface SuperGoal {
  readonly revision: number
  readonly objective: string
  readonly phase: 'active' | 'paused' | 'blocked' | 'complete'
  readonly evidence?: string | undefined
  readonly reason?: string | undefined
  readonly choices?: readonly string[] | undefined
  readonly answer?: string | undefined
}

/** Versioned full snapshot; null is a retained clear tombstone. */
export interface SuperGoalChange {
  readonly version: 1
  readonly revision: number
  readonly goal: SuperGoal | null
}

/** Checkpoint state retaining the latest revision and any invalid event. */
export interface SuperGoalProjectionState {
  readonly revision: number
  readonly goal: SuperGoal | null
  readonly failure: string | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    superGoal: SuperGoalProjectionState
  }
  interface SessionProjectionMap {
    /** Long-term objective displayed above the session conversation. */
    superGoal: SuperGoal | null
  }
}
