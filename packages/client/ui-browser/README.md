---
description: "Open a session browser from the upper-right toolbar and view its page frames and action history."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-browser

English | [中文](README.zh.md)

## Summary

The upper-right browser icon starts the selected session's browser and expands its right-side panel. The panel shows page screenshots, the current URL, and browser action history. Navigation failures appear in the panel; hiding the panel does not close the browser.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Web application composition mounts this UI with the [browser controller](../../api/browser-controller/README.md). Select a session, use the upper-right icon, and enter an address in the panel to navigate. The same icon collapses the panel; the panel's Stop browser action closes the browser context.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [client plugin](src/client/index.ts) registers the `browser.toggle` and `browser` slots owned by [ui-layout](../ui-layout/README.md). Remote mutations check their result before updating viewing state. A session-scoped Remote stream delivers replacement snapshots to the panel and is disposed when the session view unmounts.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as this package presents browser state and controls without adding content to model requests.

#### KV Cache effect

None; this package neither assembles nor sends provider requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The page frame is a screenshot view; moving the pointer over it does not send clicks or keyboard input to the browser.
- Panel geometry is transient; it does not persist across reloads.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This package forwards browser state without maintaining a second authoritative copy; its lifecycle behavior is verified through focused tests.
