---
description: "Read historical token usage and completed-turn activity from locally persisted sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-usage-controller

English | [中文](README.zh.md)

## Summary

Read total tokens, peak daily tokens, and the longest session's active duration across locally persisted sessions. Daily rows separate providers and models using UTC dates. Reads exclude inherited fork events without activating agents.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin as a Loader entry in a composition serving the Web client. It has no configuration fields.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [controller](src/index.ts) opens persisted sessions for reading and closes each handle after aggregation. The [accounting function](src/aggregate.ts) settles each attempt once, retains reported retry usage, and counts attempts lacking usage separately. Tokens include input, output, cache-read, and cache-write counts. Longest-session duration is the maximum per-session sum of completed turn durations, excluding idle gaps and unfinished turns.

**Runtime invariant:** No companion is published because each query derives its result from persistence without retaining an independent accounting store.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as this package displays usage to users and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; reading usage does not change model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Totals cover retained local history, not provider invoices. Missing usage remains uncounted and is reported through `missingUsageAttempts`; unavailable persistence rejects the read. Crash-interrupted turns are excluded from active duration because their closing timestamp includes offline time.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
