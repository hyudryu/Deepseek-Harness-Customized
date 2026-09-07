# Agent Note: Windows launcher process ownership

Status: implemented

English | [中文](2026-09-07-windows-launcher-process-ownership.zh.md)

## Problem

A TCP listener's PID does not establish that the Windows launcher owns its process. Forcefully terminating a listener can destroy unrelated application state or bypass dsh's asynchronous plugin disposal. Plugin archives inside the source checkout also disappear when that checkout is removed.

## Decision

[RUN.bat](../../../../RUN.bat) refuses startup before installation or build when port 3080 is occupied or listener inspection fails. It never terminates a listener. Restart requires the user to press Ctrl+C in the existing dsh console and wait for exit, allowing the [profile boot signal handlers](../../../../apps/cli/src/profile-boot.ts) to await disposal. Checking before installation also avoids rebuilding files used by the existing instance.

[RUN.md](../../../../RUN.md) requires retained plugin archives to live at an absolute path outside the checkout. A custom dsh home is suitable only if it also satisfies that condition.

## Alternatives considered

**Kill the port owner.** A port number proves neither ownership nor readiness for termination, and forced termination skips asynchronous cleanup.

**Automate graceful restart.** The launcher has no authenticated stop endpoint or durable process identity record. Adding a cross-process shutdown protocol is a separate lifecycle feature; manual shutdown uses the existing disposal path without inventing ownership from a PID.

## Consequences

Restart requires an explicit stop in the existing console. The launcher cannot repair abandoned or hung processes, but preserves unrelated services and avoids forced cleanup bypass. A listener can appear after the availability check; application startup still owns bind failure handling.

## Verification

[Launcher tests](../../../../scripts/run-launcher.spec.ts) exercise occupied-port refusal and preserve the independently owned listener, a successful preflight with no listeners, and listener enumeration failure. The occupied-port regression rejects the force-killing launcher, and independent concurrent test runs verify resource isolation. Plugin schema validation remains covered by the [QA plugin regression](../../../../Custom%20Plugins/qa-testing/test/output-schema.test.mjs).
