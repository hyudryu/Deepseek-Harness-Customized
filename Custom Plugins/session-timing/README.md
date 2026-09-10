# dsh-session-timing

Model-facing session timing report for DeepSeek Harness.

The transcript already shows how long each Tool call and thinking block took; that figure is drawn for a human reading the session. This bundle puts the same measurement where the agent can act on it, as the `session_timings` tool.

## What it reports

One call answers "what is taking long?":

- the slowest completed Tool calls and model steps, ranked by wall time;
- anything still open, with how long it has been open;
- per-kind totals, so a session that spends its time in many small calls looks different from one stuck in a single step.

```text
Session timing: 128 completed operations, 4 slowest shown.
  47.9s  tool  ok          pwsh pnpm run test
  12.4s  step  ok          turn 4 step 2
   3.1s  tool  failed      read src/agent.ts
   0.4s  tool  ok          grep toISOString
Still running:
  62.0s  tool  running     pwsh pnpm run build
Totals: Tool calls 3m 12s over 96, model steps 5m 40s over 32.
```

A Tool row carries the tool name plus the argument that best names the work (`command`, `path`, `query`, and so on). A `step` row is one model request: the span from `step/start` to the `assistant/message` that settled it.

## Usage

The tool takes one optional parameter:

| Parameter | Meaning |
|---|---|
| `limit` | Rows shown for each list. Defaults to 8, at most 50. |

Ask for it directly ("which operation has been slowest?") or let the agent reach for it when a session feels stalled instead of re-running work to time it.

## Measurement

Every figure comes from the live session log's own event timestamps, so the report and the transcript cannot disagree:

- a Tool call is `tool/call` → `tool/result`;
- a model step is `step/start` → `assistant/message`, or `step/end` when a request never settled, which is reported as `unfinished`;
- an open operation is aged against the wall clock at the moment of the call.

The report is read-only: nothing is written to the session, and the tool declares itself concurrency-safe.

## Install

```sh
pnpm run install:custom-plugins
pnpm dsh plugin --profile web add "./Custom Plugins/session-timing"
```

The bundle registers one Cordis row (`session-timing`) that injects `tools` and requires no configuration.

## Tests

```sh
node --test "Custom Plugins/session-timing/test/timings.test.mjs"
```
