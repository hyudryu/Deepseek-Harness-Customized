---
description: "Open a session browser from the upper-right toolbar and view its page frames and action history."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-browser

English | [中文](README.zh.md)

## Summary

The upper-right browser icon starts the selected session's browser and expands its right-side panel. The panel shows session-owned tabs, the active page screenshot and URL, and browser action history. Navigation failures appear in the panel; hiding the panel does not close the browser.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The optional `Custom Plugins/browser-control` bundle mounts its provider, this UI, and the [browser controller](../../api/browser-controller/README.md). Select a session, use the upper-right icon, and enter an address in the panel to navigate. The same icon collapses the panel; the panel's Stop browser action closes the session's owned tabs or isolated context. The address bar follows successful navigation and accepts bare domains through the provider. New sessions use the provider's configured homepage, which defaults to Google. The Chrome provider opens a visible window for direct login interaction; the panel remains a screenshot view and displays a reminder to interact in Chrome. The tab strip creates, selects, and closes tabs through the same session-scoped operations used by the agent. Left and right arrow keys select adjacent tabs. Closing the final tab stops the session browser; unrelated Chrome tabs are excluded.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [client plugin](src/client/index.ts) registers the `browser.toggle` and `browser` slots owned by [ui-layout](../ui-layout/README.md). Remote mutations check their result before updating viewing state. A [React-free observable](src/client/browser-state.ts) owns each Session stream; the renderer binds it to the panel's injected `useBrowser` hook. The last subscriber releases the stream and cached frames, and plugin disposal awaits outstanding cleanup. The panel keeps only viewing state and positions the agent cursor inside the contained image, including any letterbox offsets. Snapshot references remain stable between publications. The default Web bundle mounts neither the controller nor this UI.

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
