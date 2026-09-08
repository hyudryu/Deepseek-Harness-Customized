/** English-owned SuperGoal banner dictionary. */
export const en = {
  title: 'SuperGoal',
  'status.ready': 'Ready to resume: Use /supergoal resume',
  'status.active': 'Not yet achieved',
  'status.paused': 'Paused: Resume when you are ready',
  'status.blocked': 'Needs your input: Answer the question to continue',
  'status.complete': 'Achieved',
} satisfies Record<string, string>

/** Typed SuperGoal dictionary keys. */
export type SuperGoalKey = keyof typeof en
