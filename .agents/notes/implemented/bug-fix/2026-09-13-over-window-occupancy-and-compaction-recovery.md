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

**An attempt never supplies a zero reading.** `contextPressure` refuses a zero prompt-side sample from an `assistant/attempt` unconditionally, and refuses one from any event that would replace an existing non-zero reading. A zero cannot be a real prompt-side measurement: every routed request carries at least a system prompt and tool schemas, which are never free. The unconditional half matters for a session that overflows on its *first* request — a huge pasted message, an oversized configured prompt — where there is no earlier reading to protect and every retry of the unchanged request fails identically, so accepting that zero would hold the badge at `0%` for exactly the overflow it exists to report. A settled `assistant/message` may still report zero when nothing was sampled before it, which keeps the last-wins contract for a real settlement.

**The summarizer budgets its own request.** `summarizeWithLlm` resolves the routed model's advertised `contextWindow` through `ctx.llm.resolveModelInfo`, derives a prompt budget of `(contextWindow - maxTokens) * SUMMARY_WINDOW_RATIO`, and fits the replayed region to it. Three rules decide what survives:

- **The conversation outranks the tool schemas.** The compaction instruction forbids tool use, so the schemas are replayed for prefix-cache alignment only. The region is fitted first and the schemas are admitted only from what is left over, because keeping them whenever they merely fit on their own would displace the work in progress for pure overhead.
- **A retained span never begins at a tool result.** Trimming at an arbitrary index can start the span at a `tool/result` whose assistant tool-call was dropped; the serializer then emits a `role: 'tool'` entry naming an absent call, which providers reject, leaving recovery stuck. The cut moves forward to the next balanced start, dropping the pair rather than orphaning it.
- **An image occurrence is charged the routed adapter's price.** The fixed text estimator prices an image block's structural JSON, orders of magnitude below the visual tokens a provider bills, so a route that declares request-image pricing has those figures added — otherwise an image-heavy region is retained on a price that understates the request actually sent. A route advertising text-only input cannot retain an image-bearing message at all: it rejects the whole request, so retaining one would fail the summarization the recovery depends on. A route whose image support is unknown keeps the estimator's structural price, which is what the token meter itself charges for that route, and the image is replayed as before.

A route advertising no capacity leaves the request unbudgeted: inventing a limit would silently truncate a conversation the provider would have accepted.

The context-pressure projection moves to `stateVersion` 5. A row folded by version 4 can already carry the zero pressure the rejection now prevents, and hydration of a version-matching row skips its log prefix — so a stale row would keep serving the wrong reading for the whole session rather than being refolded.

Both facts are stated in the durable log, so both fixes are pure folds or pure request assembly with no new session events.

## Alternatives considered

**Bind budgeting and dispatch to one `prepareCall()` handle.** Resolving capacity and dispatching separately can pair one adapter generation's window with another's endpoint, which is the [prepared-call rationale](../architecture/2026-07-29-terminal-llm-stream-failures.md) that `prepareCall()` exists to serve. It was not taken because `ctx.llm.stream()` runs the `llm/stream` waterfall, which may reroute the request in place — the summary path pins that behavior, and the same note records that a route served entirely by `llm/stream` middleware has no prepared registration at all. `PreparedLlmCall.stream()` rejects a config that changed before dispatch (`INVALID_PREPARED_CALL`), so binding would forbid the extension point. The budget is therefore advisory whenever a listener reroutes, and the recorded envelope is read after dispatch so the `compaction/summary` event still names the route that actually received the call.

**Ignore a usage sample from any event whose finish is an error.** Would drop the placeholder at its source, but the projection sees only the folded event and reconstructing the finish reason there duplicates adapter classification. It would also discard genuinely useful usage: providers do report real token counts on some failures, and the failed attempt's prompt is still the conversation's prompt size. Rejecting only the impossible value — a zero prompt-side total from an attempt — keeps the informative case.

**Treat a zero-filled usage object as absent in the adapter.** `toStreamChunks` could suppress a zero usage chunk entirely. That erases a distinction the rest of the pipeline uses: `tokenUsage` legitimately counts a zero settlement, and the replay and usage-controller paths test for it. The adapter reports what the provider sent; deciding what a sample may overwrite belongs where the reading is published.

**Prune harder instead of budgeting the summarizer.** Lowering `thresholdChars` or `headChars` frees more, but the pruner cannot reduce a conversation made of many modest messages — the shape that overflows in practice — and it cannot touch non-`tool/result` content at all. It also cannot make the auxiliary call fit, which is the actual blocker.

**Summarize without the conversation prefix.** Sending only the instruction would fit trivially, but the checkpoint would contain nothing to condense. The prefix is the input; the budget decides how much of it survives.

**Compress the replayed region instead of dropping messages.** Slicing middle content would keep every message's identity while shrinking it, which is closer to what the pruner does. It was not taken because partial messages change the replayed prefix, giving up the KV-cache reuse that motivates replaying the conversation's own system prompt and tools in the first place.

**Drop every image-bearing message that lacks declared pricing.** Safe, and it is what a route advertising text-only input requires, but it discards replayable context for a route that does accept images and simply does not bill them separately. Keeping the estimator's structural price matches the token meter's own treatment of that same route.

## Consequences

The badge now reports the truth for a session that is over its window — `100%` at 317K/300K in the replayed case — instead of `0%`. A user sees the condition rather than an empty meter, and the automatic recovery that condition triggers can now succeed.

Overflow recovery costs a bounded conversation: the checkpoint describes the messages that fit the summarization budget, so a context far over its window is condensed from its newest portion. This is the intended trade — a partial checkpoint that lets work continue beats a complete one that can never be produced. The dropped oldest messages are still in the durable log and still visible in the transcript; only the summary's own input is bounded.

`SUMMARY_WINDOW_RATIO` (0.75) reserves headroom below the advertised window for the estimator's known under-pricing of CJK text and JSON schemas plus provider-side framing. It is a module constant rather than a `Config` field because it guards the estimator's error, which is fixed, not a deployment-varying choice.

The image rule prices only what the routed adapter declares. A route that accepts images without declaring pricing keeps the structural estimate, so an image-heavy session on that route can still be retained on a price below what the provider bills — the same gap the token meter has for that route, and not one the summarizer can close without a price to use.

A session already at the point of overflow now recovers on the next attempt instead of failing forever, but the underlying condition — a conversation allowed to grow past its routed model's window before any compaction ran — is unchanged. Tuning the pressure threshold is the lever against reaching this state; this note only ensures the state is survivable and visible.

## Testing

`packages/llm/token-meter/tests/token-usage-projection.spec.ts` pins the four sample rules: a zero-filled failed attempt does not replace a real reading, a failed *first* attempt supplies no numerator at all (capacity is published alone rather than `0%`), and a settled zero from a completed message is still accepted, both when nothing was sampled and when zero is already the established reading. It also pins the `stateVersion` 5 checkpoint round-trip.

`packages/compaction/compaction-basic/tests/summarizer-budget.spec.ts` covers the budget directly: oldest messages dropped, schemas kept when the request already fits, the conversation retained when schemas would otherwise displace it, the unbounded route, a span that never begins at an orphaned tool result, an image charged its routed visual tokens, and an image dropped for a text-only route instead of failing the call.

`packages/compaction/compaction-basic/tests/compaction-loop-repro.spec.ts` drives the real loop against an adapter that rejects an over-window summarization request the way a provider does, asserting recovery completes; the pre-existing cases in that file use a mock summarizer that accepts any input, which is why they did not catch this. `compaction-basic.spec.ts` continues to pin that a `llm/stream` listener may reroute the summary call and that the `compaction/summary` event records the route that actually served it, which is what keeps dispatch on the reroutable path.

The end-to-end figures above came from decompressing `session-9b54b9f3`'s durable log and folding it through the projection, and from measuring the replayed summarization input against the routed window.
