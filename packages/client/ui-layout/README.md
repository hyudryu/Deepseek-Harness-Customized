---
description: "Shell layout for the Web GUI: the four-column AppFrame with drag handles, concession behavior, the panel-geometry service, and theme presentation; for users and maintainers of the window chrome."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-layout

English | [中文](README.zh.md)

## Summary

This package provides the shell layout of the Web GUI: a four-column AppFrame with resizable sidebar, details, and browser panels, a concession chain that shrinks and auto-closes details before the browser when space runs out, and the `ctx.layout` panel-geometry service other plugins call to open, close, or reveal the details and browser columns. It also seats the theme presenter, which projects the resolved color scheme, alias tokens, base background, content font size, and `theme-color` metadata onto the document. Choose it for the standard window chrome; panel geometry is transient and resets on reload.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin at the root slot; it then renders the app frame around whatever occupies the sidebar, conversation, details, and browser columns. Users resize the sidebar by dragging its invisible hit strip and the details panel by dragging its floating pill; when the window narrows, details shrinks and auto-closes before the browser. On desktop widths a closed sidebar retains a 56px control rail; details closes to zero width.

At widths up to 600px, the conversation uses the full frame width without a permanent rail. The upper-left menu opens the sidebar over the conversation; its backdrop dismisses it. `ctx.layout.closeSidebar()` closes navigation idempotently and preserves the preferred desktop width when called on a narrow screen. Explicitly opened details and browser panels overlay the conversation below the top controls, and `ctx.layout.revealBrowser()` declines there: a browser the agent opened is revealed beside the conversation on wider frames, but never on top of the history a phone reader just opened. The mobile frame uses compact content spacing and text while preserving the user's font preference, a 16px floor on editable fields that keeps iOS from zooming the page on focus, and browser zoom. Wide content such as tables retains its own horizontal scrolling without widening the application.

The upper-right `browser.toggle` slot renders the selected session's browser icon. The right-side browser panel stays mounted while hidden; collapsing it changes viewing geometry without closing its browser context.

The details resize handle follows the details column's left edge, including when the browser occupies the rightmost column.

### Theme presentation

The presenter consumes resolved theme snapshots and projects them onto the document: `html { color-scheme }` for native UA chrome, `body[data-ds-dark-theme]` from the active color scheme, the theme's alias tokens and `--dsh-content-font-size` as inline variables on body, the computed base background on the root element, and one owned `<meta name="theme-color">` whose content follows the computed body background. The root background matters on iOS, which paints the safe-area strips outside the layout viewport from the root element rather than from a positioned body. Disposing the presenter removes its metadata node with its other global writes.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One `register()` call contributes `AppFrame` into the runtime's built-in `'root'` slot and, in the same breath, declares the column and overlay slots (`sidebar`, `conversation`, `details`, `browser`, `browser.toggle`, `shell.overlay`), seats the layout store (panel geometry), and wires the `ctx.layout` panel-action service. The transient layout store starts the sidebar at its default width and details closed, and never reads or writes `localStorage`. AppFrame mirrors its two breakpoint readings into that store — `narrow` for the auto-collapsing sidebar and `phone` for the layout where columns cover the conversation — so a cross-plugin reveal can consult the same reading the frame renders from. AppFrame always mounts the conversation and details columns; a connected Session renders through `SessionProvider`. It projects the selected Session title over the build-configured product title or the localized `common.brand.localBuild` fallback, so locale revisions update document metadata with the root entry. The theme presenter is a second effect: pure DOM writes from resolved snapshots — initial state through the getter once, then event-driven only, with no React path. It applies palette, font-size, and token variables before measuring the rendered background as the single color authority, and republishes that color on the root element.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the layout surface is not enough. They move from the frame to the columns it renders and the theme it presents.

- [ui-sidebar](../ui-sidebar/README.md) — occupies the `sidebar` column and its seats.
- [ui-conversation](../ui-conversation/README.md) — occupies the `conversation` and `details` columns.
- [ui-browser](../ui-browser/README.md) — occupies the browser column and its upper-right toggle.
- [ui-theme](../ui-theme/README.md) — the theme seam whose resolved snapshots the presenter consumes.
- [Web client architecture](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the layout shell manages browser viewing state; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current layout behavior. They are current package constraints, not a general window-manager comparison or a task backlog.

- **Panel geometry is transient** — reload restores the sidebar default and details closed; switching between distinct Session ids also closes details and forgets its dragged width, while unselected surfaces render details at zero width without modifying geometry.
- **Concession-chain auto-close derives a zero width without touching the preferred width** — the panel restores itself when the window widens; consumers must not read the stored details width as the rendered truth.
- **No scroll anchoring during squeeze reflow** — layout changes may move the reader's viewport.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The shell viewing-state store behind ctx.layout emits no cordis events; clamp/prune/concession-chain sequencing is asserted directly by this package's columns and service specs.
