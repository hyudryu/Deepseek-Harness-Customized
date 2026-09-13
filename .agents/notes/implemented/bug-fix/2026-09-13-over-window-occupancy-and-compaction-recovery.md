# Agent Note: an over-window session could neither show its pressure nor compact it

Status: implemented

## Problem

A `dsh web` session that had grown past its routed model's window reported `0% of context used` and `~0 / 300K` in the composer's [context meter](../feature/2026-08-05-composer-context-meter-breakdown.md) while every further turn failed with `400 status code (no body)` / `CONTEXT_WINDOW_EXCEEDED`. The two symptoms came from different defects that compounded: the meter lost the reading, and the recovery path could not reduce the context it was reacting to.

**The numerator was zeroed by a failed attempt.** A provider that rejects a request without a body still produces an `error` event carrying a usage object, and `llm-pi-ai`'s `toStreamChunks` emits it as a usage chunk (`stream.ts`). For a bodiless 400 that object is zero-filled, not absent. `contextPressure` treated any present sample as last-wins, so `pressureFrom(usage)` = `input + cacheRead + cacheWrite` = 0 replaced the last real reading. Replaying the affected session's own log shows the transition exactly:

```
seq 2091  assistant/message  pressure=317137  window=400000   <- last real sample
seq 2121  assistant/attempt  pressure=0       window=400000   <- first bodiless 400
seq 2183  request/context                     window=300000   <- model switch
final:    pressureTokens=0  contextWindow=300000  -> "0% of ~0 / 300K"
```

The session was in fact at 317K against a 300K window, so the badge understated the one condition it exists to report. The composition rows kept reading correctly (`system ~3.4K`, `tools ~9.6K`, `messages ~270K`), because they fold the surface rather than the sample — which is why the panel showed a header and rows disagreeing by an order of magnitude.

**The summarizer could not fit its own request.** `compaction-basic` recovers a `CONTEXT_WINDOW_EXCEEDED` failure by summarizing the conversation through a direct `ctx.llm.stream()` call that replays the conversation's system prompt, its tool schemas, and the messages being shadowed, then appends the compaction instruction. That auxiliary call was therefore built from the very prefix that had just overflowed. Across the affected session the replayed input was roughly 385K tokens against a 262K–300K window, and the summarizer is the only lever that can reduce it — the tool-result pruner is model-free but only rewrites results over `thresholdChars`, and here freed about 18K of 317K. Every attempt was answered with the same rejection, so the session could never compact:

```
compaction/start -> compaction/end {"error":"400 status code (no body)"}   (x8, every attempt)
```

`maxOverflowRetries` bounded the retries, so the failure was reported rather than looping, but the bound could not make progress possible.

## Decision

**A zero prompt-side sample never replaces an existing non-zero reading.** `contextPressure` keeps the previous `pressureTokens` and its `sampledSurfaceTokens` anchor when a sample reports zero prompt tokens while a non-zero reading already exists. A zero cannot be a real prompt-side measurement once one was taken: every routed request carries at least a system prompt and tool schemas, which are never free. A session whose first prompt is genuinely empty still reports zero, because no reading exists to protect.

**The summarizer budgets its own request.** `summarizeWithLlm` resolves the routed model's advertised `contextWindow` through `ctx.llm.resolveModelInfo`, derives a prompt budget of `(contextWindow - maxTokens) * SUMMARY_WINDOW_RATIO`, and fits the replayed region to it. The oldest region messages are dropped first, keeping the newest — those describe the work in progress. The conversation's tool schemas are dropped before any message is, because the compaction instruction forbids tool use, so the schemas are replayed for prefix-cache alignment only and are pure overhead once the request must fit. A route advertising no capacity leaves the request unbudgeted: inventing a limit would silently truncate a conversation the provider would have accepted.

Both facts are stated in the durable log, so both fixes are pure folds or pure request assembly with no new session events.

## Alternatives considered

**Ignore a usage sample from any event whose finish is an error.** Would drop the placeholder at its source, but the projection sees only the folded event and reconstructing the finish reason there duplicates adapter classification. It would also discard genuinely useful usage: providers do report real token counts on some failures, and the failed attempt's prompt is still the conversation's prompt size. Rejecting only the impossible value — a zero prompt-side total — keeps the informative case.

**Treat a zero-filled usage object as absent in the adapter.** `toStreamChunks` could suppress a zero usage chunk entirely. That erases a distinction the rest of the pipeline uses: `tokenUsage` legitimately counts a zero settlement, and the replay and usage-controller paths test for it. The adapter reports what the provider sent; deciding what a sample may overwrite belongs where the reading is published.

**Prune harder instead of budgeting the summarizer.** Lowering `thresholdChars` or `headChars` frees more, but the pruner cannot reduce a conversation made of many modest messages — the shape that overflows in practice — and it cannot touch non-`tool/result` content at all. It also cannot make the auxiliary call fit, which is the actual blocker.

**Summarize without the conversation prefix.** Sending only the instruction would fit trivially, but the checkpoint would contain nothing to condense. The prefix is the input; the budget decides how much of it survives.

**Compress the replayed region instead of dropping messages.** Slicing middle content would keep every message's identity while shrinking it, which is closer to what the pruner does. It was not taken because partial messages change the replayed prefix, giving up the KV-cache reuse that motivates replaying the conversation's own system prompt and tools in the first place.

## Consequences

The badge now reports the truth for a session that is over its window — `100%` at 317K/300K in the replayed case — instead of `0%`. A user sees the condition rather than an empty meter, and the automatic recovery that condition triggers can now succeed.

Overflow recovery costs a bounded conversation: the checkpoint describes the messages that fit the summarization budget, so a context far over its window is condensed from its newest portion. This is the intended trade — a partial checkpoint that lets work continue beats a complete one that can never be produced. The dropped oldest messages are still in the durable log and still visible in the transcript; only the summary's own input is bounded.

`SUMMARY_WINDOW_RATIO` (0.75) reserves headroom below the advertised window for the estimator's known under-pricing of CJK text and JSON schemas plus provider-side framing. It is a module constant rather than a `Config` field because it guards the estimator's error, which is fixed, not a deployment-varying choice.

A session already at the point of overflow now recovers on the next attempt instead of failing forever, but the underlying condition — a conversation allowed to grow past its routed model's window before any compaction ran — is unchanged. Tuning the pressure threshold is the lever against reaching this state; this note only ensures the state is survivable and visible.

## Testing

`packages/llm/token-meter/tests/token-usage-projection.spec.ts` pins that a zero-filled failed attempt does not replace a real reading, and that a genuinely empty first prompt still reports zero. `packages/compaction/compaction-basic/tests/summarizer-budget.spec.ts` covers the budget directly: oldest messages dropped, tool schemas dropped before any message, schemas kept when the request already fits, and the unbounded route. `packages/compaction/compaction-basic/tests/compaction-loop-repro.spec.ts` drives the real loop against an adapter that rejects an over-window summarization request the way a provider does, asserting recovery completes; the pre-existing cases in that file use a mock summarizer that accepts any input, which is why they did not catch this.

The end-to-end figures above came from decompressing `session-9b54b9f3`'s durable log and folding it through the projection, and from measuring the replayed summarization input against the routed window.
