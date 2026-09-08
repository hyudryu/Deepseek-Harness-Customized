---
description: "Pursue a persistent long-term objective across tasks, verify completion, and request multiple-choice input when a hard blocker prevents progress."
kind: "package-reference"
---

# @deepseek-ai/dsh-super-goal

## Summary

SuperGoal keeps a session working toward one long-term objective. Start it explicitly with `/supergoal <objective>`; the agent reassesses the objective whenever a task is about to finish and continues while useful work remains. A hard blocker opens a multiple-choice question, and the Web session shows a yellow waiting-for-answer indicator. The objective and human decisions survive reloads, while execution resumes only on an explicit command.

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

SuperGoal is separate from the ordinary `/goal` objective. Only the root agent can control it or ask for human input. Delegated agents report their results to that root.

### Completion and blockers

The model must provide concrete verification evidence to complete the entire objective. Completing a task leaves SuperGoal active. A hard blocker requires a concrete explanation and two or three distinct, actionable choices. The selected answer or custom text is recorded before further work proceeds. An unanswered or cancelled question leaves the objective unresolved.

### Composition

Custom compositions mount the plugin beside the agent registry, commands, tools, and user-question service:

```yaml
- id: super-goal
  name: '@deepseek-ai/dsh-super-goal'
```

There are no configuration fields or automatic task-count limits. The composition must supply a question answerer to receive blocker input.

-----

## Understand the implementation

<details>
<summary>Implementation details</summary>

The plugin records versioned state in the Session log and reads it through strict validation. Each mutation advances a revision, including clearing. Tool calls and question answers must match the current revision, so a late answer cannot reactivate a replaced objective.

The public task-stopping event supplies the continuation point. Continuation instructions enter ordinary logged model history. Tool registrations belong to the agent scope and are installed when a SuperGoal is present; ordinary sessions retain their existing tool schemas. Process-local activation ends on manual interruption or plugin disposal and is not restored merely by reading a saved session.

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
- It does not run while the harness process is closed. Reloaded objectives require explicit resumption.
- Provider failures, manual cancellation, or unavailable question providers can interrupt execution. The durable objective remains available for inspection and resumption.
- Token, cost, permission, and provider limits remain owned by their existing policies.

### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
