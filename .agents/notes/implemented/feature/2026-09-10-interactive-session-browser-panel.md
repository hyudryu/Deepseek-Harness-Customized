# Agent Note: Interactive session browser panel

Status: implemented

## Problem

A visible Chrome window was the only way to reach a page that needs a human: the panel streamed screenshots and forwarded no input. That window is a second surface beside the DSH page — it occupies a taskbar slot, it can disappear behind other windows, and on this machine it could not be raised at all, so login, 2FA, and CAPTCHA steps had no usable target. The panel also stayed collapsed whenever the agent's `browser` tool opened a browser, because only the panel's own Start action expanded the column.

## Decision

The panel is the session's browser. Pointer, wheel, and keyboard input over the streamed frame is forwarded to the active page through one `browser/input` Remote method, and an opening snapshot expands the panel whether the agent or the user started the browser.

`BrowserInputEvent` is one flat record discriminated by `kind` (`move`, `down`, `up`, `wheel`, `key`, `text`) carrying page CSS-pixel coordinates and only the fields its kind uses, so the generated zod schema validates the wire payload and the provider validates per kind before Playwright sees it. Coordinates are page pixels, not panel pixels: the panel inverts the same contained-frame mapping it uses to place the agent cursor, ignores points in the letterbox, and sends `down`/`up` separately so drags work and `clickCount` doubles as double-click. Plain characters travel as `text` (inserted at the selection) while named keys, `Space`, and anything with Control/Alt/Meta travel as a key combination; keys the panel cannot express are left to the desktop. Movement is throttled to one event per 50ms, and input publishes one coalesced frame refresh per 120ms burst instead of one screenshot per event.

Chrome launched with the dedicated persistent profile runs hidden: `chromeHeadless` defaults to true and passes `--headless=new` with `--window-size=1280,800`, so the panel is the only browser surface and nothing appears in the taskbar. `chromeHeadless: false` restores a visible window for anyone who wants to watch it. A Chrome already listening on `chromeEndpoint` is used as-is, visible or not, and connection failures still never fall back to Playwright.

The agent-facing skill now states that the browser runs hidden, that the user interacts in the panel, and that panel input interleaves with tool actions, so a step needing the user is answered by navigating the active tab and saying what to do in the panel.

## Alternatives considered

**Keep the visible Chrome window and add a remote-desktop protocol.** A VNC-style channel would carry every frame and input shape, including video and clipboard, but it duplicates a transport the provider already has over CDP, needs its own authentication story on a loopback port, and would still leave the taskbar window as the only surface during a native dialog.

**Forward input with `page.evaluate`-level synthetic DOM events.** Dispatching `MouseEvent`/`KeyboardEvent` through script would avoid coordinates entirely, but it bypasses real hit-testing, trusted-event checks, focus behavior, and IME, so pages that depend on trusted input would behave differently from a real user and the tool would be driving the page rather than mirroring a browser.

**Make the panel an iframe of the page instead of a frame stream.** An iframe would give native input for free, but cross-origin pages cannot be framed, framing changes what the page sees (and can be refused by `X-Frame-Options`), and it would not cover the agent's own screenshots.

**Reveal the panel only from the toggle.** Expanding on an opening snapshot can undo a deliberate collapse when a browser reopens; that trade is accepted because a hidden browser with no visible entry point is the failure this change exists to fix, and hiding the panel during an open browser still sticks.

## Consequences

The visible-window rationale in [Visible Chrome browser control](2026-09-08-visible-chrome-browser.md) no longer holds and that note is superseded in part: it keeps ownership of endpoint configuration, homepage normalization, tab ownership, and explicit Playwright selection. Anyone who wants to watch the launch sets `chromeHeadless: false`.

Input is trusted by the session's own GUI: any page the agent or user navigates to can be clicked and typed into from the panel, and the provider applies only kind, coordinate, and size validation, not an allowlist of gestures. Frame latency is separate from input latency — a forwarded click reaches the page immediately while its visible result arrives with the next captured frame — and clipboard paste, file drops, and modifier combinations the desktop claims are not forwarded. Clipboard and drag-and-drop payloads, and per-user input authorization, remain deferred.

`pnpm --filter @deepseek-ai/dsh-client-ui-browser run bundle` must be rerun for the panel changes and `pnpm run build:lib:host` for the generated `browser/input` Remote artifact; the browser-control provider itself is plain JavaScript under `Custom Plugins/browser-control` and loads from source. Verification: `packages/client/ui-browser/tests/components.client.spec.tsx` covers reveal transitions, coordinate inversion, letterbox rejection, movement throttling, key translation, and input failures; `packages/api/browser-controller/tests/controller.host.spec.ts` covers the Remote's live-session guard and forwarding; `Custom Plugins/browser-control/test/chrome.test.mjs` covers hidden launch flags, config rejection, and real Chrome input dispatch, validation, and a closed-browser rejection.
