# Browser control

English | [中文](README.zh.md)

This optional profile bundle provides a shared Playwright Chromium context for each session's browser tool and browser panel. Install its dependencies with the repository's `install:custom-plugins` command before adding the bundle to a profile.

`frameQuality` controls the panel's JPEG frames. It defaults to `60` and accepts integers from `0` through `100`, inclusive. Invalid values fail when the plugin loads.

Closing a browser reports Playwright shutdown failures to the caller and retains the context for retry. A successful close removes the session's browser state. Subscriptions remain active across close and reopen. Plugin disposal attempts every context and then the shared browser, awaits shutdown, and reports cleanup failures.

A failed initial navigation closes a newly created context before rejecting the open request. Navigation failure preserves an existing context. If rollback cleanup also fails, the request reports both failures and retains the context for explicit cleanup retry.

Run the behavior suite with `node --test "Custom Plugins/browser-control/test/browser.test.mjs"` from the repository root. It includes a real Chromium navigation, interaction, frame capture, close, and reopen check, plus configuration and shutdown failure regressions. Chromium must be installed through the plugin's Playwright CLI; CI installs it and runs this suite explicitly.
