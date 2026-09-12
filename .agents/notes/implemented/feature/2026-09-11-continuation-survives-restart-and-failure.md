# Agent Note: Autonomous continuation survives a restart and a failed turn

Status: implemented

## Problem

A session with an armed objective could stop with nothing continuing it and nothing recording why, in three independent ways.

An armed goal or SuperGoal was still disarmed by any non-running status edge, so one transient provider failure ended pursuit permanently. The durable phase stayed `active`, the banner kept showing the objective, and only a human `/supergoal resume` or a goal-tool `resume` could restart it.

A restored session disarmed its own objective. Every `agent/session-start` edge set activation to `disarmed`, and a driver loaded over live agents disarmed them too. A process restart therefore ended every running objective, which matters because the Web host is restarted by killing its listener process.

The background-job completion notice was the only remaining wake for an idle owner, and `maxConsecutiveWakes` degraded it to a silent injection once the budget was spent. Claiming a user-authored message was the only thing that refilled the budget, so a goal round (`kind: 'goal'`) and a SuperGoal message (`kind: 'plugin'`) never did. In one recorded session the assistant ended its turn with "I'll report as soon as the run settles"; the job settled 51 minutes later into a `next-step` injection on an idle agent, and nothing ran again for 21 hours until the human asked why it had stopped.

The three failures share one shape: automatic authority was withdrawn, or its input was withheld, without a durable record of the reason and without anything left to continue the work.

## Decision

An objective a human armed keeps running until it completes, a human stops it, or it records a durable reason that it cannot continue.

### Standing authority is queryable, and it exempts the wake bound

`@deepseek-ai/dsh-goal` answers a `goal/activation` bail event and `@deepseek-ai/dsh-super-goal` keeps answering `super-goal/activation`. `tool-jobs` consults both before degrading a completion notice: an owner that holds an armed goal or SuperGoal is woken past `maxConsecutiveWakes`, while every other owner keeps the bound. The objective already carries its own round cap, which is the bound that applies instead.

The alternative — a delivery bit the continuation plugins set on the job registry — would put the decision in the producer rather than in the plugin that owns the objective, and the registry has no such field today.

### A failed turn spends a budget instead of withdrawing authority

SuperGoal keeps pursuit armed across a turn that ends without completing work, retries it, and counts consecutive failures. `Config.maxConsecutiveFailures` (default 3) bounds the retries; past it the objective is committed to `blocked` with the concrete condition and two choices, and the existing blocker question asks for a decision. Only a deliberate stop — a cancellation caused by `user`, `parent`, or `disposed` — still ends pursuit immediately.

The goal-round driver applies the same budget to rounds that end on a provider failure (`LlmError`) or on `max-tokens`, retries them, and blocks the goal with the code `round-failure` and the reported condition once the budget is spent. Failures that are not provider failures keep the old fail-closed behavior: a rejected log write, a plugin failure, or a lost durability checkpoint still disarms, because a round whose record cannot be trusted must not be retried.

### A reopened session resumes the objective it was already pursuing

On `agent/session-start`, SuperGoal re-arms an `active` objective and steers its continuation message, and the goal-round driver records a durable `resume` mutation through the existing compare-and-set boundary. The mutation is the visible record of the activation edge; it advances the revision, so a revision the model read before the restart is rejected rather than trusted.

A seeded session is excluded. A fork and an inherited child log carry the objective without the authority to pursue it, because the session they came from may still be running it. The driver also still never adopts agents that are already live when it loads: continuation attaches at the session start of agents that start while it is loaded, matching the rule the Schedule runtime owners follow.

## Alternatives considered

**Persist activation durably and treat the phase as the permission.** The phase is already durable, so this reads as the smaller change. It was rejected because it cannot distinguish a reopened session from a fork: both replay the same `goal/change` prefix, and auto-resuming a fork would run the same objective in two sessions at once.

**Remove `maxConsecutiveWakes`.** The bound exists because a woken turn can start the job whose completion wakes it again with nobody watching. That chain is real in a session with no standing authority, so the bound stays and the exemption is scoped to an armed objective.

**Retry every failure kind within the budget.** A durability failure would then be retried against a log that just refused a write, and a rejected step proposal would loop against the hook that rejected it. Only provider failures and `max-tokens` retry; everything else still fails closed.

**Keep disarming and surface the stop in the interface instead.** The sessions this matters for are unattended. A parked session and a working session look identical from outside, and the recorded evidence is a 21-hour silence rather than a visible stop, so the durable blocker and the bounded retry replace the silent withdrawal.

## Consequences

- `dsh-tool-jobs` declares a type-only project reference to the goal packages for the activation queries; the queries are unanswered when no continuation plugin is mounted, and the bound then applies unchanged.
- `dsh-super-goal` and `dsh-goal-round-driver` gain `Config.maxConsecutiveFailures` (default 3), which the shipped compositions leave at its default.
- The model-facing goal guidance distinguishes the two restore cases: a resumed session rearms its own active goal, while a fork keeps it disarmed until a human asks to continue. Recorded system-prompt sidecars were updated with the sentence.
- A restored objective spends a model request sooner than it did: it resumes as the session starts rather than waiting for a human. A round that fails repeatedly now ends in a durable `blocked` phase with the condition recorded, which is visible in the goal strip and the SuperGoal banner.
- Teardown still cancels only the pursuits and questions this plugin instance owns, so a session it merely observed keeps running through an unload.
- The restart path is pinned end to end by [`goal-restart.spec.ts`](../../../../packages/goal/goal-round-driver/tests/goal-restart.spec.ts), which stores a session through the production JSONL backend, loads it again with `AgentLoop.resume`, and observes the resumed round with no human action; a seeded session in the same suite stays disarmed. The Loader-boot harness cannot carry this case today: its headless profile fails to activate `@deepseek-ai/dsh-session-mcp`, which waits for a `headlessStartup` service the fixture does not provide.
