# Agent Note: SDK transport waits for Loader settlement

Status: implemented

## Problem

The SDK transport accepted an `initialize` request while the Loader was importing sibling plugins. A startup failure could dispose that server context before its request resumed. The client then received an inactive-context error instead of the Loader's import failure. Both the existing text-turn fixture and the new SuperGoal fixture reproduced this failure with SuperGoal disabled.

## Decision

The SDK serving effect leaves input buffered until the Loader settles. Disposal cancels that effect's pending transport start. A failed Loader never admits input; application boot reports its failure. Contexts without a Loader continue serving immediately.

The startup waiter is not part of disposal quiescence because Loader settlement itself can await disposal of transient plugin instances. Its continuation only starts the transport while its effect remains active.

## Alternatives considered

**Wait only inside initialize.** The transport can already have consumed input when its plugin is disposed during Loader settlement. Delaying the transport keeps that input available for the settled instance.

**Await Loader settlement during disposal.** Loader settlement can itself await disposal, so this introduces a circular wait.

## Consequences

SDK clients can send initialization immediately, but processing begins only after the application finishes loading. Disposal prevents a pending transport start without delaying Loader teardown.

## Validation

The SDK transport tests cover delayed adapter registration and ordinary initialization, prompt execution, and shutdown. The SuperGoal SDK snapshot runs through the shipped SDK profile and pins notifications, results, and persisted events. Python SDK coverage preserves those recorded SuperGoal changes in the public run result.

The SDK snapshot harness also escapes Windows paths when hydrating JSONL, compares complete request-prompt sequences, and preserves command identities across command-start and command-completion notifications. The SuperGoal fixture resolves its test-only replay adapter from the repository rather than requiring that adapter in the installed SDK bundle.
