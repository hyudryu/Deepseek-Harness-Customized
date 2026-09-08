# Agent Note: SuperGoal continuation and blocker decisions

Status: implemented

## Problem

A long-term objective can remain unfinished after the agent completes an individual task. Requiring another user prompt at every task boundary loses the distinction between finishing a task and achieving the overall objective. An unresolved blocker also needs an actionable session notification rather than a final message that silently stops work.

## Decision

[SuperGoal](../../../../packages/goal/super-goal/README.md) owns one explicit long-term objective per root session, separately from ordinary goals. The command creates or resumes it. The public task-stopping event supplies repeated objective assessment without changing the agent loop or imposing an arbitrary round cap.

Completion requires concrete evidence. Blocking requires a reason and two or three actionable choices presented through the existing user-question service. Its Web adapter supplies the yellow pending-question indicator. Answers are recorded before continuation, and a revision comparison prevents a stale answer from reviving an objective changed while the question was open.

Durable state resides in versioned Session events. Execution activation remains process-local: opening or forking a transcript grants no new execution authority. Manual stop and plugin disposal end execution and preserve the objective. Scoped tools appear only in sessions containing a SuperGoal.

## Alternatives considered

**Reuse the ordinary goal's round cap.** That policy can stop because a task count was reached even while useful work remains. SuperGoal's objective is independent of that task policy.

**Add another notification type.** The existing multiple-choice question adapter already marks the session as waiting for an answer. Reusing it keeps answer delivery and notification dismissal under one owner.

**Automatically restart persisted work on load.** Reading a session is not an instruction to execute it. Explicit resumption avoids unexpected work when a user opens historical sessions.

## Consequences

The agent continues until the objective is complete or requires human input, subject to manual interruption and runtime failures. The plugin requires evidence but relies on the model to judge whether that evidence proves the objective. Retaining all objective changes and decisions makes the continuation reconstructable; repeated task assessments consume additional context until compaction.
