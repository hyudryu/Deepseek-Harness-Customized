# Browser control

English | [中文](README.zh.md)

This optional profile bundle provides a shared Playwright Chromium context for each session's browser tool and browser panel. Install its dependencies with the repository's `install:custom-plugins` command before adding the bundle to a profile.

`frameQuality` controls the panel's JPEG frames. It defaults to `60` and accepts integers from `0` through `100`, inclusive. Invalid values fail when the plugin loads.

Closing a browser reports Playwright shutdown failures to the caller and retains the context for retry. A successful close removes the session's browser state. Subscriptions remain active across close and reopen. Plugin disposal awaits context and browser shutdown and reports failures.

Run the behavior suite with `node --test "Custom Plugins/browser-control/test/browser.test.mjs"` from the repository root. It includes a real Chromium navigation, interaction, frame capture, close, and reopen check, plus configuration and shutdown failure regressions. Chromium must be installed through the plugin's Playwright CLI; CI installs it and runs this suite explicitly.
