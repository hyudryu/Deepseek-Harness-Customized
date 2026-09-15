# Agent Note: Automatic compaction sizes the route the next request will use

Status: implemented

## Problem

A session that switches to a model with a smaller context window keeps the previous model's route in its durable request header until the next request is built. The automatic pressure check ran before that request, resolved capacity from the header, and therefore compared current pressure against the *previous* model's window. Switching a 427,000-token conversation from a 1M-token model onto a 300,000-token model let that first request go out at 427,000 tokens: the provider rejected it with `CONTEXT_WINDOW_EXCEEDED`, and the request-error recovery then pruned tool results and summarized through the same too-small model — the summarizer replays the shadowed region verbatim for prefix-cache reuse, and that region alone was over the window — so the summary call failed too and the turn ended in the original error. The session continued only after the user switched back to the wider model.

Writing the header earlier cannot repair this. `request/header` is appended while a request is built, which is after the pre-step check that has to act on it, so any reader of the header is one request behind a selection change.

## Decision

### The Agent scope answers the route its next request will use

`installModelSelection` (`packages/core/agent/src/model-selection.ts`) records the `ModelSelectionRef` it installs against the Agent's own scoped context, and `selectedRouteFor(agentCtx)` returns a detached snapshot of `assembled ?? current`: the selection prompt assembly captured for the step in flight, else the selection pending for the next one. It answers `undefined` when no entry point installed a selection. The record is a module-private `WeakMap` keyed by that context, so an entry dies with the scope, an install that supersedes another on the same scope survives the earlier disposer, and the disposer removes the entry only while it still owns it.

### Pressure policy sizes from that route

`BasicCompactionEngine.compactIfNeeded` resolves its target through `requestTarget(agent)`: a durable routed request must exist, and its route is then the installed selection's when that names a provider and model, else the latest durable request header. Both the pressure trigger and the context-overflow trigger use it. Exact-target policy overrides, the summarization policy, and the summarization call target are unchanged: a summary still replays on the last routed request target unless `summarizationProvider`/`summarizationModel` name another pair, which keeps the prefix-cache reuse the summarizer depends on.

## Testing

- `dsh-agent` covers the reader: no install, the pending route before the first assembly, the assembled route after it, the detached snapshot, retirement on disposal, and a superseding install on the same scope.
- `dsh-compaction-basic` covers the threshold switch (a session routed to a wide model compacts only once the selection names a narrow one), the fallback to the header for a selection that names no route, and the initial boundary staying inert while a selection is installed.
- A real-loop test drives an agent whose selection switches mid-turn while the header still names the wide route: the pressure summary must land before the first `request/header` naming the narrow one. Without this change it lands after (observed: summary at seq 19, narrow request at seq 12).

## Alternatives considered

- **Read the durable `model/selection` event from the session log** — rejected because its payload type is declared by `dsh-api-session-controller`, and a compaction backend running in the Agent's preset scope must not depend on the API layer; it would also duplicate state the installing entry point already holds.
- **Ask `ctx.agentDefaultModel.currentSelection()`** — rejected because that value is the deployment default for new sessions: the model picker saves it independently of any one session's pending route, and it is wrong for a subagent that inherited its own route.
- **Use the smaller threshold across the header and `AgentOptions`** — rejected because a model picker, ACP `set`, and `selectForNextRequest` all deliver a change through `installModelSelection`'s `agent/request` override rather than through agent options, so the reported failure would remain.
- **Compact inside the `agent/request` waterfall, where the final config is known** — rejected because the loop derives `boundaryMessages` before `buildRequest`, so a compaction there cannot change the request being built, only a later one.
- **Fix only the overflow path** — rejected as the primary fix: it recovers after a request that cannot succeed has already been dispatched, where the pressure check can act before it.

## Related

- [After-call compaction pressure and context-overflow recovery](../architecture/2026-07-10-after-call-compaction-pressure-and-overflow-recovery.md) keeps its rule that automatic pressure needs a completed routed request; this note changes which route supplies the capacity, not whether that gate exists.
- [Routed model context and compaction policy](../architecture/2026-07-20-routed-model-context-and-compaction-policy.md) keeps its capacity ownership: adapters still own exact-route capacity and compaction-basic still owns the policy.

## Consequences

A switch to a smaller-context model compacts before that model's first request, and one resolution now serves both automatic triggers. The cost is one extra model call when a selection qualifies against the threshold and the user switches back before the request is sent; the check itself remains a measurement, so a conversation below the threshold is untouched.

The pressure check now depends on a runtime export of `dsh-agent` where it previously imported types only; `dsh-agent` was already a declared peer dependency, and a scope that installs no selection keeps the previous behavior exactly.

Summarization is deliberately unchanged, so a conversation already over the summarization target's window still cannot be condensed until `summarizationProvider`/`summarizationModel` name a wider route. The package README records that limit.
