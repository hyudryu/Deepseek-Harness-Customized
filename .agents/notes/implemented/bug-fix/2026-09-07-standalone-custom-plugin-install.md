# Agent Note: Install standalone custom plugin dependencies

Status: implemented

English | [中文](2026-09-07-standalone-custom-plugin-install.zh.md)

## Problem

The root pnpm workspace excludes standalone custom plugins. A successful workspace install and build therefore cannot prove that their runtime imports resolve; a missing personal-assistant MCP SDK dependency prevents application startup.

## Decision

[The custom plugin installer](../../../../scripts/install-custom-plugins.mjs) installs each direct directory under `Custom Plugins` that contains a package manifest, using `--ignore-workspace --frozen-lockfile` and `CI=true`. Each package declares its entry and commits its own lockfile. A fresh Node.js process imports that entry after installation; any install or import failure stops the command. The Windows launcher runs this command before building, and the static CI job runs the same check.

## Alternatives considered

**Rely on the workspace install.** It does not cover these standalone packages and cannot detect missing runtime dependencies in them.

**Test with mocked imports only.** A mocked MCP client can exercise plugin behavior while hiding a missing SDK dependency. Importing the actual entry verifies dependency resolution without activating a profile.

## Consequences

Startup preparation includes separate dependency installations and native imports for the custom plugins. Frozen lockfiles reject unrecorded dependency changes. The installer prepares checkout packages without resetting existing profile sessions or settings; successful import alone does not verify plugin activation or external services.
