# Agent Note: Keep iOS WebKit working across the JSON helpers and the phone layout

Status: implemented

## Problem

On a phone, tapping a session in the sidebar opened it with its header, statistics, and composer intact but an **empty transcript** — no message rows, no error. The same session rendered normally in desktop Chrome. Reproduction in WebKit (the engine behind Safari and every browser on iOS) at an iPhone viewport and with touch input showed the failure exactly: 0 rendered turns against Chromium's 70 for the same session, plus one console error, `[session-controller] event feed subscriber failed: TypeError: Assistant stream raw chunk must be a lossless JSON object`.

The [lossless-JSON walk](../../../../packages/util/values/src/index.ts) accepts a container only when its prototype is backed by that realm's native constructor, and it recognized that constructor by comparing `Function.prototype.toString` output against the literal `function Object() { [native code] }`. Engines do not agree on that text: V8 returns it on one line, while JavaScriptCore returns `function Object() {\n    [native code]\n}`. On WebKit every plain object and array was therefore rejected, `snapshotJsonValue` returned `undefined` for valid data, the Assistant-stream record failed validation, and the folding subscriber died before it produced any transcript node.

Three further phone-only defects share the same surface. The browser column revealed itself whenever a session's browser was already open (the agent's `browser` tool), and at phone widths that column covers the conversation instead of sharing the row, so the reveal hid the history the reader had just opened. The root element carried no background, so iOS painted the safe-area strips outside the layout viewport light above the dark shell. Finally, editable surfaces outside the composer kept their compact sizes on phones — the session search field at 13px and the browser address bar at 12px — and iOS zooms the page when a focused editable renders below 16px, leaving the frame wider than the screen.

## Decision

Recognize the native marker for its content, not its layout: [`isNativeConstructorSource`](../../../../packages/util/values/src/index.ts) tests the constructor source against `^function\s+<name>\s*\(\s*\)\s*\{\s*\[native code\]\s*\}$` instead of one engine's exact text. Both engine layouts match, `constructor.name` and `constructor.prototype` identity still gate the check, and a forged function named `Object` still fails because its source carries a real body instead of the marker. Container acceptance stays realm-independent, which is what lets plain data from another realm pass. The [worker's dependency-free mirror](../../../../packages/code-runtime/code-runtime-worker-thread/src/worker-json.ts) carries the same rule.

The remaining three fixes keep each decision with its owner:

- The layout owns whether a browser reveal is allowed. `AppFrame` mirrors its phone reading (`viewport <= PHONE_MAX_WIDTH`, the twin of the stylesheet's `@media (max-width: 600px)` block) into the layout store, and the new [`revealBrowser`](../../../../packages/client/ui-layout/src/client/stores.ts) action declines while that mirror is set. ui-browser asks for a reveal instead of opening the panel, so the upper-right icon still opens it on a phone while an agent-opened browser never covers the conversation.
- The [theme presenter](../../../../packages/client/ui-layout/src/client/theme-presenter.ts) republishes the computed base background on the root element beside the `theme-color` metadata it already derives from the same measurement, and retracts it on dispose. The color stays the rendered palette's, not a second literal.
- The shell's phone block in [`base.css`](../../../../packages/client/web/src/base.css) floors every editable at `max(16px, 1em)` under `:root`-qualified selectors, so the guarantee outranks a component's own class selector. The composer already carried that floor for its own card; the search field and address bar kept their 13px and 12px sizes until the shell owned the rule. A larger user font-size preference still wins, and user-initiated pinch zoom stays available: only the automatic focus zoom is removed.

## Alternatives considered

**Compare prototypes against the local realm's `Object.prototype` and `Array.prototype`.** Simpler, but it rejects plain data from another realm, which the JSON helpers must accept and which an existing case covers.

**Match the native marker with a JavaScriptCore-specific alternative literal.** Two literals encode one rule and a third engine layout breaks both; matching the marker's content is the rule itself.

**Have ui-browser read `matchMedia('(max-width: 600px)')` directly.** That would add a third copy of a breakpoint the frame already renders from, and it would put a shell-geometry decision in a feature plugin.

**Disable page zoom with `maximum-scale=1`.** That removes user pinch zoom for every reader to fix an automatic zoom with a known cause.

**Keep the browser overlay opaque and non-dismissible on phones.** The owner asked for the reveal not to happen at all on a phone, and a covered conversation is what the reader lost.

## Consequences

iOS readers get their transcript: the WebKit reproduction goes from 0 to 70 rendered turns with the console error gone, and the same run reports the dark base on the root element. Any other consumer of `snapshotJsonValue`/`isJsonValue` — session-format validation, settings documents, projections, tool results — now works on WebKit, where it previously rejected all plain objects and arrays. Because the JSON rejection also governed client-side projection reads, parts of the phone UI beyond the transcript (for example the token and cache-hit groups of the statistics line) recover with the same change.

The reveal decline is phone-only: wider frames keep revealing a browser the agent opened, and an explicit gesture always opens it. The 16px floor changes the editing size of those compact fields on phones only, which is the deliberate cost of a stable viewport; measured in WebKit at 390px with the shell's content font forced to 14px, every reachable editable — composer, session search, address bar, file input — computes 16px, while a 1280px frame keeps 14px. Pinch zoom remains enabled.

The supersession check leaves no note fully superseded, so none is archived. [Interactive session browser panel](../feature/2026-09-10-interactive-session-browser-panel.md) stays current and now states the phone exception to its reveal decision. [Resolved theme color metadata](../feature/2026-08-06-resolved-theme-color-metadata.md) still owns `theme-color` derivation; the root-background write beside it is recorded here. [PTC typed tool returns](../feature/2026-07-20-ptc-typed-tool-returns.md) describes the worker mirror's native function-source check, whose rule now matches the canonical helper.
