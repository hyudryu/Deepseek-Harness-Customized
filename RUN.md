# Windows web launcher

## Summary

[RUN.bat](RUN.bat) installs dependencies, builds this checkout, and starts the dsh web application from the repository directory. It requires Windows PowerShell and the Node.js and pnpm versions declared in [package.json](package.json), with Node.js and pnpm available on `PATH`.

## Table of Contents

- [Start the application](#start-the-application)
- [Update from the application](#update-from-the-application)
- [Inspect a failure](#inspect-a-failure)
- [Keep custom plugins available](#keep-custom-plugins-available)
- [Dev Note](#dev-note)

## Start the application

Double-click `RUN.bat`. It first checks that port 3080 is free, then runs `pnpm install`, `pnpm run install:custom-plugins`, `pnpm run build`, and `pnpm dsh web`. Installation and build output appear in the console and append to UTF-8 `run.log` beside the launcher; the build can take several minutes. Application output stays in the console.

Open the token-bearing URL printed by dsh. Leave the launcher window open while using the application; press Ctrl+C to stop it.

To restart, press Ctrl+C in the existing dsh console and wait for dsh to exit before rerunning the launcher. The launcher refuses an occupied port without terminating its owner. For another application's listener, use that application's shutdown controls. A port check failure also stops startup. To update the checkout while the application is running, use the sidebar's update control instead of stopping the launcher; see [Update from the application](#update-from-the-application).

## Update from the application

When the tracked `main` branch carries commits this checkout lacks, the sidebar shows an update button beside the Settings trigger. Confirming it stops the server through its own graceful shutdown, then runs a detached helper that fetches, sets local work aside with `git stash --include-untracked`, moves the checkout to `main`, runs `pnpm install`, `pnpm run install:custom-plugins`, and `pnpm run build`, restores the local work, and starts the server again. The browser clears its caches and reloads once the helper reports an outcome.

The helper is a Node script with no dependency beyond the checkout's own Node runtime, so the update path is the same on Windows, macOS, and Linux. It restarts the server by replaying the `dsh` profile invocation that the running server recorded about itself, so a checkout started by this launcher or by any other `dsh` launcher restarts the same way. A server not started through a `dsh` profile is refused rather than replayed.

A failure after the checkout moved returns it to the commit the update started from, rebuilds, and starts the previous server anyway, so a failed update never leaves the machine without a server. Progress, the failing step, and the full command output are written under `%DSH_HOME%\software-update\<checkout-key>\` — `update.log` beside `update.json`; the replacement server's console output goes to `server.log` in that directory because it has no console of its own. `%DSH_HOME%` is `%USERPROFILE%\.dsh` unless the environment overrides it, and `<checkout-key>` is a digest of the resolved checkout path, so a machine serving two checkouts keeps their records apart. List that directory to find the key for this checkout.

## Inspect a failure

An installation or build failure preserves the previous running instance, stops the launcher before application startup, and displays the last 40 log lines. Inspect the latest failing stage in `run.log`; a TypeScript diagnostic identifies a build error that must be fixed before rerunning the launcher.

If pnpm is missing, follow [contributor setup](docs/development.md) and reopen the launcher.

## Keep custom plugins available

The root workspace install does not install standalone packages under `Custom Plugins`. Run `pnpm run install:custom-plugins` after changing their dependencies: it installs every direct subdirectory with a `package.json` using its frozen lockfile and imports its declared entry with Node.js. Missing dependencies or import errors stop startup before the build. The launcher and static CI job run this check automatically; plugin authors must commit manifest and lockfile changes together.

Keep the source directories of locally installed plugins at their installed paths, including directories outside this checkout. If startup reports a missing plugin path, restore that directory or reinstall the affected plugin from its retained source. Preserve the existing `.dsh` sessions and settings; deleting or resetting the profile is not a plugin repair.

For an installation that survives removal of the source checkout, retain packed plugin `.tgz` archives in an absolute directory outside the checkout, such as `%USERPROFILE%\.dsh\plugin-archives`, and install them with `pnpm dsh plugin --profile web add "<absolute archive path>"`. If using a custom `DSH_HOME`, its `plugin-archives` directory is suitable only when that home is outside the checkout. Keep those archives for later dependency reinstalls.

If startup rejects a tool output schema, fix the plugin schema before reinstalling it. The QA plugin's schema regression uses the harness validator and runs from the repository root with `node --import tsx/esm --test "Custom Plugins/qa-testing/test/*.test.mjs"`; the static CI job runs the same command.

## Dev Note

The [launcher ownership decision](.agents/notes/implemented/bug-fix/2026-09-07-windows-launcher-process-ownership.md) records restart safety and archive retention.
