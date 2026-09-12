# Agent Note: SuperGoal command cancellation and live activation

Status: implemented

## Problem

A goal's durable phase alone cannot express whether this process is executing it. User commands also share a session inbox with unrelated accepted work, and a dismissed blocker question still represents an unresolved decision.

## Decision

Resume questions inherit command cancellation. Pause preserves the blocked phase so a later resume must obtain a recorded answer. Pause and clear remove plugin-owned continuation input and retain other inbox messages. Displayed blocker reasons depend on the blocked phase.

Host reads use the incremental SuperGoal projection and propagate its retained validation failure. Repeated assessments do not fold the entire growing transcript.

The banner subscribes to process-local activation independently of generic agent execution. Opening a durable active objective arms it in a non-seeded session, while a seeded session — a fork or an inherited child log — keeps it disarmed. The [continuation durability decision](../feature/2026-09-11-continuation-survives-restart-and-failure.md) supersedes this fact.

## Alternatives considered

**Use agent running status for the banner.** An unrelated turn can run while SuperGoal remains disarmed.

**Clear the whole inbox on pause.** The inbox also contains accepted user requests that the goal command does not own.

**Convert blocked goals to paused.** This loses the requirement for a human decision on resume.

## Consequences

Cancellation cannot reactivate an objective through a late answer. Resumption preserves the decision requirement, and goal commands retain unrelated queued work. Focused command and projection regressions cover cancellation, blocker pause/resume, stale reason output, inbox preservation, and invalid-history rejection. SDK snapshots record mid-run steering and completion within one turn.
