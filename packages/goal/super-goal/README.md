---
description: "Pursue a persistent long-term objective across tasks, verify completion, and request multiple-choice input when a hard blocker prevents progress."
kind: "package-reference"
---

# @deepseek-ai/dsh-super-goal

## Summary

SuperGoal keeps a session working toward one long-term objective. Start it explicitly with `/supergoal <objective>`; the agent reassesses the objective whenever a task is about to finish and continues while useful work remains. A hard blocker opens a multiple-choice question, and the Web session shows a yellow waiting-for-answer indicator. The objective and human decisions survive reloads, and reopening a session resumes the objective it was already pursuing; a forked session stays disarmed until someone resumes it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

The standard harness includes SuperGoal. It remains inactive until a user sets an objective. A highlighted banner above the session conversation displays the objective and a smaller status line; blocked objectives also show their reason.

### Commands

| Command | Result |
|---|---|
| `/supergoal <objective>` | Start a long-term objective. |
| `/supergoal` | Show the objective and its state. |
| `/supergoal pause` | Stop its execution while retaining the objective. |
| `/supergoal resume` | Continue an unfinished objective. |
| `/supergoal clear` | Clear the objective. |

SuperGoal is separate from the ordinary `/goal` objective. Only the root agent can control it or ask for human input. Delegated agents report their results to that root. Activation during a running turn steers that turn. Completed objectives reject pause and resume; clear removes the objective and its scoped tools. Pause and clear remove only SuperGoal continuation input and preserve queued user requests.

### Completion and blockers

The model must provide concrete verification evidence to complete the entire objective. Completing a task leaves SuperGoal active. A hard blocker requires a concrete explanation and two or three distinct, actionable choices. The selected answer or custom text is recorded before further work proceeds. An unanswered or cancelled question leaves the objective unresolved. Cancelling a resume command cancels its question. Pausing a blocked objective dismisses the question but preserves the blocker; resuming asks for an answer again. Command output shows blocker reasons only while the objective is blocked.

### Composition

Custom compositions mount the plugin beside the agent registry, commands, tools, and user-question service:

```yaml
- id: super-goal
  name: '@deepseek-ai/dsh-super-goal'
```

There is one configuration field, `maxConsecutiveFailures` (default 3): the consecutive turns that may end without completing work before the objective reports a durable blocker instead of being retried. The composition must supply a question answerer to receive blocker input.

-----

## Understand the implementation

<details>
<summary>Implementation details</summary>

The plugin records versioned state in the Session log and reads current state through the incremental session projection. A retained validation failure rejects reads and mutations. Each mutation advances a revision, including clearing. Tool calls and question answers must match the current revision, so a late answer cannot reactivate a replaced objective.

The public task-stopping event supplies the continuation point. Continuation instructions enter ordinary logged model history. Tool registrations belong to the agent scope and are installed when a SuperGoal is present; ordinary sessions retain their existing tool schemas. Process-local activation is dropped by a deliberate stop — a human cancellation, teardown, or disposal — and by a pause, clear, or completion. A session start instead re-arms an active objective in a session that was loaded as itself and steers its continuation message, so a restarted process keeps pursuing it; a seeded session (a fork, or a log inherited from a parent) re-arms nothing, because the session it came from may still be running that objective.

A turn that ends without completing work — a provider failure, a token-ceiling stop, a rejected step, or an interrupted turn — spends the consecutive-failure budget and is retried. Past the budget the objective is committed to `blocked` with the concrete condition and two choices, and the existing blocker question asks for a decision, so an objective that cannot make progress records why instead of going quiet.

The invariant companion compares the banner projection with the durable objective before model steps. Parsing and mutation validation belong to [`src/index.ts`](src/index.ts) and [`src/projection.ts`](src/projection.ts).

</details>

-----

## Further Exploration

- [Goal subsystem](../../../docs/subsystems/goal.md) — ordinary goal state and related continuation mechanisms.
- [User questions](../../interaction/user-questions/README.md) — question presentation and answerer requirements.
- [SuperGoal decision](../../../.agents/notes/implemented/feature/2026-09-08-super-goal.md) — persistence, continuation, and human-input decisions.

-----

## Model Experience

### Objective and decisions

#### What the model sees

An active SuperGoal contributes its objective and continuation instructions to logged user-role messages. The model can read its current revision, report completion evidence, or ask for a blocker decision. Human decisions are retained with the objective and returned before the next model request. The [generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-super-goal) owns the exact tool descriptions and argument schemas.

#### Token effect

Each task-ending assessment adds the objective and fixed continuation instructions. The three tools add schemas only to sessions that have a SuperGoal. History grows until the configured compaction policy reduces it.

#### KV Cache effect

Continuation appends to the existing conversation. Activating SuperGoal adds scoped tool schemas and may change the request prefix; subsequent tasks retain the same tool definitions.

## Known Limitations and Deferred Work

SuperGoal relies on the configured model and running harness:

- Completion evidence is required text; the plugin does not independently certify the model's interpretation of that evidence.
- It does not run while the harness process is closed. A session reopened as itself resumes its objective; a fork needs an explicit resumption.
- Provider failures are retried up to `maxConsecutiveFailures` consecutive turns, after which the objective is blocked with the recorded condition. Manual cancellation and disposal stop execution at once. The durable objective remains available for inspection and resumption.
- Token, cost, permission, and provider limits remain owned by their existing policies.

### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
