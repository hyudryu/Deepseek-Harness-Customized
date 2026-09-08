---
description: "Open and close session browsers and stream live browser snapshots through the Remote API."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-browser-controller

English | [中文](README.zh.md)

## Summary

This controller lets the Web client open a session browser, navigate it, and follow its page frames and action history. Browser operations use the same per-session browser owned by the browser-control plugin. Opening requires an existing live Session; unknown and disposed session IDs are rejected before browser resources are allocated. A close acknowledgement means the browser context has finished closing. Disposing a Session starts browser cleanup, including any pending context creation. If the Session disappears during an open request, the request awaits cleanup and fails instead of acknowledging an orphaned browser. Session disposal observers report cleanup failures through the controller logger; explicit close remains available for retry. Session identifiers retain the branded `SessionId` type across service calls. A failed initial navigation closes a newly created context before rejecting the request; existing contexts remain open. Cleanup failures retain the context for explicit close retry.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Web application composition mounts this controller with a provider of `ctx.browserControl`. The [browser panel](../../client/ui-browser/README.md) consumes its generated `remote.browser` API. The controller has no configuration fields. `createTab`, `selectTab`, and `closeTab` require a live session and operate on its owned tabs. Tab identifiers use the opaque `BrowserTabId` type. Snapshots carry ordered tab metadata, the active tab identity, and the provider backend; their page URL, title, and frame describe the active tab. Closing the last owned tab stops the session browser. A tab operation completing after session disposal awaits browser cleanup and rejects its acknowledgement.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [controller](src/index.ts) subscribes before reading the initial snapshot, and retains only the latest pending replacement snapshot, so slow readers skip superseded frames without accumulating screenshots. Subscriptions stay active while the browser is closed and receive later open and reopen updates. Cancellation removes the subscription. The browser-control provider owns session tabs, isolated contexts, and screenshots; the controller forwards its operations and snapshots.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as this package presents browser state and controls without adding content to model requests.

#### KV Cache effect

None; this package neither assembles nor sends provider requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Browser state is live process state and is not a durable session replay.
- The controller requires the browser-control provider; it does not launch a standalone browser implementation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This package forwards browser state without maintaining a second authoritative copy; its lifecycle behavior is verified through focused tests.
