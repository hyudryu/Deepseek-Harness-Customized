# Windows web launcher

## Summary

[RUN.bat](RUN.bat) installs dependencies, builds this checkout, and starts the dsh web application from the repository directory. It requires Windows PowerShell and the Node.js and pnpm versions declared in [package.json](package.json), with Node.js and pnpm available on `PATH`.

## Table of Contents

- [Start the application](#start-the-application)
- [Inspect a failure](#inspect-a-failure)
- [Keep custom plugins available](#keep-custom-plugins-available)
- [Dev Note](#dev-note)

## Start the application

Double-click `RUN.bat`. Its three stages run `pnpm install`, `pnpm run build`, and `pnpm dsh web`. Installation and build output appear in the console and append to UTF-8 `run.log` beside the launcher; the build can take several minutes. After a successful build, the launcher stops the previous listener on port 3080 and starts the application. Application output stays in the console.

Open the token-bearing URL printed by dsh. Leave the launcher window open while using the application; press Ctrl+C to stop it.

## Inspect a failure

An installation or build failure preserves the previous running instance, stops the launcher before application startup, and displays the last 40 log lines. Inspect the latest failing stage in `run.log`; a TypeScript diagnostic identifies a build error that must be fixed before rerunning the launcher.

If pnpm is missing, follow [contributor setup](docs/development.md) and reopen the launcher.

## Keep custom plugins available

Keep the source directories of locally installed plugins at their installed paths, including directories outside this checkout. If startup reports a missing plugin path, restore that directory or reinstall the affected plugin from its retained source. Preserve the existing `.dsh` sessions and settings; deleting or resetting the profile is not a plugin repair.

For an installation that survives removal of the source checkout, retain packed plugin `.tgz` archives under `.dsh/plugin-archives` and install them with `pnpm dsh plugin --profile web add "<absolute archive path>"`. Keep those archives for later dependency reinstalls.

If startup rejects a tool output schema, fix the plugin schema before reinstalling it. The QA plugin's schema regression uses the harness validator and runs from the repository root with `node --import tsx/esm --test "Custom Plugins/qa-testing/test/*.test.mjs"`; the static CI job runs the same command.

## Dev Note

None.
