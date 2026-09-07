# Windows web launcher

## Summary

[RUN.bat](RUN.bat) installs dependencies, builds this checkout, and starts the dsh web application from the repository directory. It requires Windows PowerShell and the Node.js and pnpm versions declared in [package.json](package.json), with Node.js and pnpm available on `PATH`.

## Table of Contents

- [Start the application](#start-the-application)
- [Inspect a failure](#inspect-a-failure)
- [Dev Note](#dev-note)

## Start the application

Double-click `RUN.bat`. Its three stages run `pnpm install`, `pnpm run build`, and `pnpm dsh web`. Installation and build output appear in the console and append to UTF-8 `run.log` beside the launcher; the build can take several minutes. Application output stays in the console.

Open the token-bearing URL printed by dsh. Leave the launcher window open while using the application; press Ctrl+C to stop it.

## Inspect a failure

An installation or build failure stops the launcher before application startup and displays the last 40 log lines. Inspect the latest failing stage in `run.log`; a TypeScript diagnostic identifies a build error that must be fixed before rerunning the launcher.

If pnpm is missing, follow [contributor setup](docs/development.md) and reopen the launcher. If the web port is occupied, stop the application that owns it before retrying.

## Dev Note

None.
