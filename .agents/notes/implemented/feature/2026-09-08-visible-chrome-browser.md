# Agent Note: Visible Chrome browser control

Status: implemented

## Problem

A screenshot panel permits observation but cannot receive a human login interaction. Browser navigation also needs to accept hostnames entered into its address bar without requiring a URL scheme.

## Decision

The browser provider prefers visible Chrome over a loopback DevTools connection on port 9222. A dedicated persistent Chrome profile retains logins between Harness runs. The agent uses the integrated DSH browser tool and its session tabs, mirrored in the DSH GUI, instead of discovering ports or choosing unrelated desktop windows. The agent can select an isolated Playwright browser explicitly; connection failures never silently switch to that backend. Playwright supplies the existing locator and CDP client implementation for both targets.

Chrome sessions own their newly created tabs and popups, not the shared browser process or preexisting tabs. Closing the panel browser releases only that session's resources. The user interacts directly with the Chrome window to complete logins while the panel displays the same page. The panel and agent tool share stable tab identifiers for listing, creation, selection, and closure; operations cannot target another session or a preexisting user tab.

New browser sessions navigate to the configured homepage, defaulting to `https://www.google.com`. Bare public hostnames use HTTPS; local hostnames and loopback addresses use HTTP. Explicit supported URLs retain their schemes. Successful navigation updates the address bar.

## Alternatives considered

Sending clicks and keyboard events through screenshot coordinates requires a separate remote desktop interaction design. A visible Chrome window provides native input and login dialogs without pretending the screenshot is interactive. Launching an isolated browser automatically after a Chrome connection failure would discard the expected login state.

## Consequences

The persistent debug profile is separate from Chrome's normal profile. Existing browser tabs and user login state remain outside session cleanup. Tests cover default and explicit backend selection, session ownership, local homepage navigation, bare addresses, and rendered page frames.
