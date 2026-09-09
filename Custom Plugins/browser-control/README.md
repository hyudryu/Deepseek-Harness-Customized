# Browser control

English | [中文](README.zh.md)

This optional bundle shares a session's browser tools and panel. Chrome is the default: it connects to `http://127.0.0.1:9222`, or launches installed Chrome visibly with a dedicated persistent profile when that port is unavailable. The Playwright client supplies CDP transport and semantic locators; Chrome mode does not launch an isolated browser. Connection failures never fall back to Playwright.

Install dependencies with `install:custom-plugins`, then add this bundle or the `dsh-chrome-browser` alias to a profile. Both register the same provider, controller, and panel IDs; install one in the profile. `backend: playwright` explicitly selects an isolated Playwright Chromium context; the tool accepts that backend on `open` only when the user requests it. Switching backend closes the session's previous tabs first.

`homepage` defaults to `https://www.google.com/`. Opening without a URL navigates a new session to its homepage; reopening an existing session preserves its location. Bare domains such as `jackandjill.com` use HTTPS. Bare loopback addresses use HTTP; explicit HTTP and HTTPS URLs are preserved. `about:blank` supports local fixtures. Invalid addresses reject before browser allocation.

`chromeEndpoint` must be an HTTP loopback origin with an explicit port. IPv6 loopback endpoints such as `http://[::1]:9222` retain their address for both the availability probe and CDP connection. `chromeUserDataDir` defaults to `~/.dsh/chrome-profile`; `chromeExecutablePath` optionally names an absolute installed-Chrome executable. `chromeConnectTimeoutMs` defaults to `10000`. `headless` applies only to Playwright. Chrome credentials and cookies persist. Preexisting tabs, the shared context, and Chrome survive session close and plugin disposal; only session-created tabs and their popups are closed.

The panel and tool create, select, and close session-owned tabs. Tool actions `tabs`, `new_tab`, `switch_tab`, and `close_tab` use opaque `tab_id` values returned by `tabs`. IDs remain stable when other tabs close; foreign IDs reject. Closing the last tab stops the session browser. Legacy `pages` and `switch_page` retain positional indexes. Serialized tab results exceeding `maxSnapshotChars` reject before model delivery.

`frameQuality` controls JPEG frames, defaults to `60`, and accepts integers from `0` through `100`. Invalid configuration fails at load. CDP screenshots use visible viewport dimensions when no emulated viewport exists.

Initial navigation failure awaits cleanup of newly created resources before rejecting; existing contexts survive navigation failure. Session lifecycle mutations run in issue order. If navigation and rollback both fail, initial opens and new-tab requests report both errors in an `AggregateError`; retained resources remain available for cleanup retry. Disposal awaits owned cleanup and disconnects from Chrome, leaving its process alive.

Run `node --test "Custom Plugins/browser-control/test/*.test.mjs"`. Tests cover URL/configuration validation, lifecycle concurrency, isolated Playwright behavior, Chrome tab ownership, and preservation of existing tabs after disposal. Chrome fixtures use temporary profiles and ephemeral ports and close their own processes. Real-provider cases require installed Chrome and Playwright Chromium.
