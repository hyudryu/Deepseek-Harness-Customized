# Agent Note: Terminal request failures and the session failure dot

Status: implemented

## Problem

The default retry policy treated every transport failure as transient, so a request to an endpoint that was not listening — a stopped or crashed local inference server, or a local model that had been torn down — was retried on the same schedule as a dropped connection. No retry can change that answer: nothing is listening, and the next attempt meets the same refusal. The user paid the whole backoff budget to learn what the first attempt already knew.

A turn that exhausts its retries then ends in error, but that outcome was visible only inside the conversation that produced it. A session that failed while the reader was looking at a different session showed no durable trace in the sidebar: the row settled back to the same idle dot every completed session shows. Nothing in the list distinguished "this session's last turn died" from "this session is finished".

## Decision

Two classification facts decide whether a failure is worth repeating, and one folded session fact makes an exhausted failure visible outside the conversation that produced it.

**A refused connection is terminal.** `isConnectionRefused` in `@deepseek-ai/dsh-llm` walks a thrown value's `cause` chain for the `ECONNREFUSED` errno, and also recognizes the wording in flattened provider error text, because pi-ai discards the original error and its cause before a failure reaches the harness. The DeepSeek adapter classifies a refused `fetch` as `CONNECTION_REFUSED`; the pi-ai adapter classifies a refused connection before its `ECONNREFUSED` text pattern reaches the general transport arm. `CONNECTION_REFUSED` is deliberately absent from `DEFAULT_RETRYABLE_CODES`, so the first attempt is the last. `TRANSPORT` keeps its retryable meaning for a connection that was accepted and then dropped, which is the case a repeat genuinely can fix.

**A model the endpoint does not serve was already terminal.** `httpErrorCode` maps an unserved model to `INVALID_REQUEST` (400) or `HTTP_404`, and neither code was ever in the default retryable set. This decision records that as intent rather than leaving it as an accident of the status mapping: "the model was torn down" and "the model name is wrong" produce the same 400/404 and both must fail on the first attempt.

**Retries that exhaust leave a durable red dot.** The `sessionListMetadata` projection folds one more field, `lastTurnFailed`, from each `turn/end` reason: `reason.kind === 'error'` sets it, and every other closed-turn reason — completed, aborted, blocked, max-tokens, interrupted — clears it. Because the fold reads the session log, the fact survives a reload and a cold listing serves it from the projection cache without activating an Agent. The projection's `stateVersion` moved to 2, so persisted rows written by the previous fold are discarded rather than forward-applied into state missing a required field.

The client derives `SessionNode.lastTurnFailed` from `SessionSummary.projectionValues.sessionListMetadata` — the same projection-values channel the Schedule marker uses — and `sessionStatuses` renders a red error dot labelled **Failed**. Precedence is pending interaction (amber), running turn (blue), failed turn (red), descendant activity (blue), completed (green), idle. A running turn therefore hides the failure of an earlier one, because the live state is the more useful fact; the failure reappears if that running turn also ends in error.

## Alternatives considered

**Keep retrying a refused connection, and let the schedule cover a server that starts during backoff.** Rejected because it is the wrong default for the common case. A local server that is starting up is a deliberate operator action with an operator watching it; a server that crashed is the case users actually hit, and it pays six minutes of backoff for nothing. A deployment that wants startup patience can set `retryPolicy.retryableCodes` to include `CONNECTION_REFUSED` explicitly, which makes the intent local to that route.

**Distinguish "crashed" from "still starting" at classification time.** Rejected as unavailable: a single refusal carries no evidence of why the listener is absent, so any such split would need timing heuristics or a probe of the endpoint's intent that the harness cannot observe.

**Treat every `ECONN*` errno as terminal.** Rejected because it over-reaches. `ECONNRESET` and `ECONNABORTED` describe an accepted connection that was then lost mid-exchange — often a rolling restart or an idle-reaping proxy — and repeating those is the retry policy's whole purpose. Only the errno that proves no listener exists is terminal.

**Clear the failure dot when the reader selects the session.** Rejected because it would make the dot an unread-notification badge rather than a statement about the session's last outcome. The dot describes durable state; the next turn's outcome owns when it changes, and a reader who has not looked has lost nothing by still seeing it.

**Store the failure as a separate projection unit rather than a field on `sessionListMetadata`.** Rejected because the two facts share a fold, a wire view, a state version, and a cold-cache row, and splitting them would add a registration and a cache row to carry one boolean that is already read on the same list projection.

**Push the failure through a live list mutation instead of the projection.** Rejected because the client's list mutations describe lifecycle edges (`status`, `activity`, `engaged`) and are reconciled against the pull baseline, while a projection value arrives from the same frames that already carry the Schedule marker and works for cold rows that have no live mutation at all.

## Verification

Resolver tests pin the shared default schedule, `maxRetries` derived from a configured schedule's length, `maxDelayMs` defaulted to its longest entry, and rejection of a simultaneous schedule and backoff. LLM service tests prove a route that omits its policy receives that default. Adapter tests prove a genuinely unbound loopback port classifies as `CONNECTION_REFUSED` with the endpoint in the message and the cause intact, a droppable connection stays `TRANSPORT`, and a refusal nested inside a `cause` chain is still recognized; the reserved port 1 is deliberately not used, because Node rejects it as a bad port before any connection is attempted. Real-composition tests through the mock wire-fault server prove a refused connection reaches `turn/end` with `CONNECTION_REFUSED`, one `step/start`, and no `llm/retry` event. A scheduled-policy unit test pins the exact five-second, one-minute, and five-minute waits, the budget ending after the last entry, and acceptance of a provider `Retry-After` that exceeds the exponential cap. Session-controller tests fold a failed turn into `lastTurnFailed: true` and prove a later successful turn clears it, and that the projection push frames carry the field. Workspace-browser tests prove the red dot appears for a failed turn, outranks the completion reminder, and yields to a running turn and to a pending interaction.

## Consequences

A crashed or torn-down local endpoint now fails in one attempt instead of holding the turn for the full backoff budget, at the cost of giving up on the case where an operator restarts that endpoint during the backoff window. The default schedule spends roughly six minutes before a terminal failure on a genuinely transient outage, so a rate limit that clears in seconds is now retried after a delay longer than the outage — the trade is deliberate, since the previous sub-second ramp exhausted five attempts before a typical provider incident resolved. The failure dot is derived client-side from projection values, so a row whose cached metadata predates this fact reads as not failed until the projection catches up; that matches the Schedule marker's best-effort contract for cold rows.

The recovery machinery itself is unchanged: this decision adjusts which failures enter it and what an exhausted budget leaves behind. Scheduling, durability, cancellation, and serving-registration capture remain as [per-provider request retry policies](2026-07-24-provider-retry-policies.md) and [bounded recovery for transient LLM request failures](../architecture/2026-06-21-bounded-llm-request-recovery.md) define them.
