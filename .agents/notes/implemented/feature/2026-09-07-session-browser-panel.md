# Agent Note: Session browser panel

Status: implemented

English | [中文](2026-09-07-session-browser-panel.zh.md)

## Problem

A browser action needs visible page state so a user can follow navigation and inspect failures. A control beside the message composer obscures its relationship to the application's side panels. Successful server startup alone does not establish that browser creation, Remote delivery, and client rendering work together.

## Decision

The [layout](../../../../packages/client/ui-layout/README.md) owns a top-right `browser.toggle` slot beside a session-scoped browser column. The [browser UI](../../../../packages/client/ui-browser/README.md) checks Remote results and displays operation failures. Panel visibility and browser context lifetime remain separate: hiding the panel leaves the browser available for agent actions.

The [controller](../../../../packages/api/browser-controller/README.md) subscribes before reading its opening snapshot and awaits context closure before acknowledging a close. The browser-control provider tracks Playwright context closure through its close event and shares in-progress context creation between callers. Snapshot frames and action history come from that same context.

The optional browser-control bundle composes its provider, controller, and UI together; the default Web profile has no browser control without that provider. The renderer subscribes to a stable session observable through the inject hooks compartment and releases its stream when the final consumer unmounts. Browser components export no runtime values through the public client entrypoint.

Failed context closure remains visible and retryable. Initial navigation failure still publishes the successfully opened context, so the UI reflects the browser that actually exists.

## Alternatives considered

**Keep the composer control.** The browser is application viewing state, so its toggle belongs with panel controls rather than message input.

**Treat server startup as browser verification.** Startup cannot reveal a Playwright method mismatch or a missing client module. Verification includes real Chromium navigation and visible page frames in the Web client.

## Consequences

The user can keep a session browser running while hiding its panel. The displayed frame is a screenshot, not an interactive remote desktop; pointer movement over it does not dispatch browser input. Tests cover creation sharing, frame delivery, and close/reopen behavior, while browser verification exercises the composed application.
