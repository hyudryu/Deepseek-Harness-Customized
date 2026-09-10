# Browser Control

Use this skill whenever you need to operate or inspect a browser-based application.

## Core rules

1. Use the integrated `browser` tool for browser interaction. It controls the current DSH session browser shown in the DSH GUI browser panel; its session-owned tabs are the same tabs the user sees there. Chrome runs hidden, and the user clicks, types, and scrolls directly in that panel, so never instruct the user to find a separate browser window; when a step needs the user (sign-in, 2FA, CAPTCHA), navigate the active tab to it and say what to do in the panel. Do not scan local ports, inspect debugging endpoints, discover browser processes through shell commands, attach an external MCP browser, or select unrelated Chrome windows while this tool is available. Running a repository-owned Playwright test suite is a separate validation task, not a way to choose the interactive session browser.
2. Start with `tabs` to identify this session's tabs, or `open` with the target URL to begin browsing, then take a semantic snapshot. The provider manages Chrome connectivity; no debugging address or browser-window discovery is needed. Only set `backend: "playwright"` on `open` when the user explicitly asks for Playwright; never switch backends or attach another browser to bypass an integrated browser failure. Report the failure through the existing session flow. Omitting the URL opens Google (or the configured homepage).
3. Prefer semantic locators in this order: role + accessible name, label, placeholder, visible text, test id. Use CSS selectors only as a last resort.
4. After an interaction that materially changes UI state, take another semantic snapshot or use a deterministic assertion. Never infer success merely because a click/fill call returned successfully.
5. Use `browser` action `assert` for pass/fail decisions. A browser action completing is not itself a QA pass.
6. Clear diagnostics before an isolated test flow. Inspect diagnostics after the flow and treat unexpected page errors, console errors, failed network requests, and relevant HTTP 4xx/5xx responses as evidence to investigate.
7. Capture a screenshot on visual checks and failures. Do not generate screenshots after every routine interaction.
8. For responsive behavior, set the viewport explicitly and repeat the relevant assertion at each required size.
9. Keep the session browser alive through a coherent flow. Chrome uses a persistent profile; closing session tabs does not clear cookies or stop Chrome. Use `tabs` to list session-owned tabs, `new_tab` with an optional URL to create one, and `switch_tab` or `close_tab` with a returned `tab_id`. Closing the last tab stops the session browser. Never attempt to control or close another session's tabs or preexisting user tabs.
10. Never use arbitrary JavaScript evaluation to force the application into a passing state. Exercise the public UI like a user unless the QA plan explicitly calls for lower-level verification.
11. Expect panel input to interleave with tool actions. User clicks and typing arrive as the same page events your actions produce, so re-read state with `snapshot` or `tabs` after asking the user to do something instead of assuming the page is unchanged.

## DeepSeek Harness optimization

The browser capability is intentionally one compact tool instead of many MCP tools. In Code Mode, visible registered tools are callable through `tools.browser(...)`. When several deterministic browser operations can be performed together without model judgment between them, batch them in Code Mode and return only the concise findings needed for the next decision. Do not hide a failed assertion or diagnostics inside the batch.

## Typical flow

- `open` the app.
- `snapshot` to understand the current accessible UI.
- `clear_diagnostics`.
- perform semantic `click`, `fill`, `press`, `select`, `check`, or `uncheck` actions.
- use `assert` for the expected state.
- call `diagnostics`.
- call `screenshot` if the check is visual or failed.

When a locator is ambiguous, take another snapshot and choose a more specific semantic locator rather than guessing a brittle selector.
