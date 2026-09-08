# Agent Note: Session browser panel

Status: implemented

English | [中文](2026-09-07-session-browser-panel.zh.md)

## Problem

A browser action needs visible page state so a user can follow navigation and inspect failures. A control beside the message composer obscures its relationship to the application's side panels. Successful server startup alone does not establish that browser creation, Remote delivery, and client rendering work together.

## Decision

The [layout](../../../../packages/client/ui-layout/README.md) owns a top-right `browser.toggle` slot beside a session-scoped browser column. The [browser UI](../../../../packages/client/ui-browser/README.md) checks Remote results and displays operation failures. Panel visibility and browser context lifetime remain separate: hiding the panel leaves the browser available for agent actions.

The [controller](../../../../packages/api/browser-controller/README.md) subscribes before reading its opening snapshot and awaits context closure before acknowledging a close. The browser-control provider tracks Playwright context closure through its close event and shares in-progress context creation between callers. Snapshot frames and action history come from that same context.

The optional browser-control bundle mounts the provider, controller, and UI together. Opening requires a live Session; the stream retains only the latest pending replacement snapshot. A framework-bound observable owns client subscriptions across closed and reopened browser contexts. Failed context closure propagates and retains retryable provider state. Screenshot cursor coordinates account for letterboxing, and each resize handle follows its own panel edge.

Initial navigation failure awaits closure of a newly created context before rejecting, because a failed open leaves the panel collapsed. The provider serializes service and tool open and close requests per Session in issue order so rollback settles before a later caller can reuse the context. Existing contexts survive navigation failures; failed cleanup retains the context for an explicit retry. The default Web profile has no browser controls without the optional provider, and internal presentation components remain private.

## Alternatives considered

**Keep the composer control.** The browser is application viewing state, so its toggle belongs with panel controls rather than message input.

**Treat server startup as browser verification.** Startup cannot reveal a Playwright method mismatch or a missing client module. Verification includes real Chromium navigation and visible page frames in the Web client.

## Consequences

The user can keep a session browser running while hiding its panel. The displayed frame is a screenshot, not an interactive remote desktop; pointer movement over it does not dispatch browser input. The [visible Chrome provider](2026-09-08-visible-chrome-browser.md) supports direct human interaction in its window and exposes owned session tabs in the panel. Tests cover creation sharing, frame delivery, and close/reopen behavior, while browser verification exercises the composed application.
