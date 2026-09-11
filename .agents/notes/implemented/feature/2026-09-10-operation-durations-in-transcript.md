# Agent Note: operation durations reach the transcript rows and the agent

Status: implemented

## Problem

The transcript showed that a Tool call or a thinking block happened, but never how long it took. The statistics line under the composer reported summed LLM and Tool wall time for the whole session, and the trajectory view carried per-step latency for inspection; neither answers the question a reader actually has while watching a turn stream — *which of these took forty seconds?*

Two costs followed from that. A reader could not tell a 200ms `grep` from a 45s `pwsh` without opening the trajectory view, and the agent could not tell at all: the durations existed only as event timestamps the model never sees. A session that spent its time in one slow command looked identical, in both surfaces, to one that spent it in a hundred fast ones.

## Decision

Measure each operation once, from the timestamps the session log already carries, and publish it in both directions: a trailing label on the row, and a `session_timings` Tool for the agent.

### Bucketing is shared, wording is not

`packages/client/ui-primitives/src/duration.ts` exports `rowDuration(ms)`, the one place the seconds/minutes cut lives: one decimal under a minute (`45.2s`), whole minutes plus seconds zero-padded to two digits above it (`2m 42s`). It sits beside `relative-time.ts` for the same reason that file gives — two surfaces naming the same span must agree — and returns structured parts rather than text, because each client plugin owns its own dictionary under the [locale-owned copy rule](../architecture/2026-08-23-locale-owned-client-ui-copy.md).

Rounding happens before the minute split, so `59.96s` reads `1m 00s` rather than `60.0s` in a bucket one tick away from the minute template.

### A Tool row reports its settled span

`toolRowModel` derives `durationMs` from the paired `tool/call` and `tool/result` event times (`block.time - block.callTime`), clamped at zero; it is null while the call runs and on a settled result whose call head fell outside the loaded window, where there is nothing to difference. `ToolRow` renders the localized label as a trailing span outside `.summary`, so a long path or command clips the summary rather than the measurement. The seven `ui-tool` toolviews pass `durationMs` through. Three renderers build their own row DOM rather than using `ToolRow` — `bash-sample.tsx` (`bash`), `ui-skill`, and `ui-cordis` — and each derives and renders the same span through its own dictionary; a toolview that bypasses `ToolRow` therefore has to add the label itself, and `bash-abort-row`'s golden is what proves Bash carries it.

### A thinking row counts up while it streams

Text and Tool-call heads already get timing from the row that presents them, so only a reasoning block needs its own span. `assistant.ts` records a `BlockSpan` per block index as chunks arrive — first instant on `block-start` or the first delta, close on `block-end` — and `withTiming` attaches it to the reasoning variant when blocks are projected. Spans are read at the block's own index, not its position in the compacted list: a streamed `block-start` may name an index ahead of the ones already seen, leaving holes.

A settled node closes an unterminated span at its own instant (the `assistant/message` time, or the closing boundary for an interrupted turn), so a row can never keep counting after its step settled. A streaming block is still open, and `ReasoningRow` ticks it on its own one-second interval rather than waiting for the next delta: the quiet stretch is exactly what the label exists to show.

Running rows deliberately show nothing for Tool calls — a call's outcome is what matters and it arrives in seconds — and a live count only where the model is visibly working.

### The agent asks for the same numbers

`Custom Plugins/session-timing` registers the `session_timings` Tool: the slowest completed Tool calls and model steps, anything still open with how long it has been open, and per-kind totals. It folds the live Session log (`tool/call` → `tool/result`, `step/start` → `assistant/message`, with `step/end` closing a request that never settled), so the figure the model gets is the figure the transcript drew.

## Alternatives considered

**Add elapsed time to every Tool result the model receives.** Rejected: it is a model-visible text change to every result in every session, priced on every request, to answer a question the model asks rarely.

**Report only the session-wide totals the statistics line already computes.** Rejected: totals cannot name the operation that consumed the time, which is the whole diagnosis.

**Derive the reasoning span from the step boundaries.** Rejected: a step's start-to-message span includes every Tool call the step dispatched, so a thinking block would be credited with time spent in `pwsh`.

**Tick the label from streamed deltas alone.** Rejected: deltas stop exactly when a model goes quiet, which is the case the counter is for.

**Persist a duration field on the session events.** Rejected: every event already carries `time`, and a stored duration would be a second source of truth that can disagree with the timestamps a replay reads.

## Consequences

- A reader sees how long each operation took without leaving the transcript, and the agent can find the slow one with one call.
- Tool rows and thinking rows keep one format across locales because the cut lives in `ui-primitives` while the wording lives in each dictionary.
- The accessible name of a row now includes its duration, because the label is part of the row's text. Specs that pin an exact row name updated with it.
- One interval runs while a thinking block streams. It is bounded by the number of simultaneously streaming reasoning blocks — at most one per running step — and stops the moment the block settles.
- `session_timings` adds one Tool schema to every request in a profile that installs it. It is a custom bundle, not a shipped default, so a profile that does not install it pays nothing.

## Testing

Unit: `packages/client/ui-primitives/tests/duration.client.spec.ts` pins both buckets, the clamp, the zero-padding, and the pre-split rounding. `tool-row.client.spec.tsx` covers the model derivation (running, zero-length, window-truncated, negative skew) and the rendered span on both buckets. `reasoning-row.client.spec.tsx` covers a settled span, a live count that advances with no further delta, and a block whose stream recorded no start. `conversation-node-definitions.client.spec.ts` drives real `assistant/live-chunk` entries to pin spans across a hole in the sparse block array, the live-block case with no end, the settled message closing an unterminated span, and a stream with no recorded chunk time leaving the block untimed. `Custom Plugins/session-timing/test/timings.test.mjs` covers the fold, the ranking, the empty and still-running reports, and the parameter bounds.

Snapshot: `snapshots/web/bash-abort-row/ui.expected.md` was refreshed, because that spec passed beforehand and its only diff is the appended `{{duration}}` on both settled Bash rows. Seven further web goldens carry tool-row lines (`cordis-tool-round`, `message-actions`, `minimal-preset`, `ptc-round`, `skill-tool-row`, `web-search-round`, `workflow-run`) and will each gain `{{duration}}` on those lines, but they cannot be refreshed from this checkout: every one of those specs already fails in replay here for reasons unrelated to this change — a recorded `clientTimeZone` of `Asia/Shanghai` against a local `America/Los_Angeles`, an extra `<system-reminder>` skill-catalog injection from the profile's `skill-catalog-buckets` plugin shifting every `{{message:N}}` token, an extra sidebar `button "Mobile access"`, and a Windows path spelling (`C:\\…\\.dsh/skills/…`) the scaffold's `split(workspaceCwd).join('{{cwd}}')` normalizer does not match. Refreshing them here would bake that drift into committed goldens, so the `{{duration}}` addition belongs to the next `DSH_SNAPSHOT=refresh pnpm run test:web` run in the environment the goldens were recorded in.
