# Agent Note: In-place software update with session continuation

Status: implemented

## Problem

Keeping this checkout current required stopping the server, running `git pull`, rebuilding, and starting again by hand, so an update was something a user did instead of something the application did. The launcher's ownership rule forbids the obvious shortcut — a listener's PID does not establish ownership, and terminating one skips asynchronous plugin disposal — so an automatic update needed a real shutdown path and a durable record of what to restart.

The restart also ends every turn in flight. A running turn exists only in the process executing it; the durable session log keeps an open `turn/start` and the harness closes it as `interrupted` when the session is resumed, but nothing continues the work. Every `ctx.agents.resume()` call site in the tree is caller-driven, and no store anywhere records which sessions were mid-turn when the process died.

## Decision

**A profile bundle serves `/software-update` and renders a sidebar control beside the mobile-access action.** The control is present only while `refs/remotes/<remote>/<branch>` carries commits the checkout lacks. The route authenticates for itself through `connection.requestRejection` before it reads any git state, because named routes are dispatched ahead of the authenticated fallback.

**Stopping the server is the server's own graceful exit.** A `POST` writes a request record, starts a detached helper, waits for the helper's first written record, answers `202`, and only then asks the launcher to exit through the `appExit` service — after the response has flushed, so the browser has its answer before the listener closes. The helper terminates the process itself only when the recorded exit does not complete inside `gracefulStopMs`.

**Restart replays a recorded identity, never a guessed one.** At load the plugin writes `launch.json` carrying `execPath`, `execArgv`, the resolved entry module, the working directory, and the listen address, and rewrites it whenever it names a different process, because several profiles can share one harness home. The helper starts the successor from that record, so a checkout launched by `RUN.bat`, another launcher, or a direct `node` entry restarts the same way. This is the authenticated stop endpoint and the durable process identity record the [launcher ownership note](../bug-fix/2026-09-07-windows-launcher-process-ownership.md) identified as the missing prerequisites for automating a restart.

**The update is transactional about the checkout, and never leaves the machine without a server.** Local work is set aside with `git stash push --include-untracked` and restored with `git stash pop`; the branch moves with `merge --ff-only`, so a diverged branch fails instead of merging. A failure after the checkout moved resets it to the commit the update started from, rebuilds, and starts the previous server anyway. A stash that cannot be replayed is kept, reported, and does not fail the update.

**The plugin records the sessions the restart will interrupt, and the successor continues them.** Immediately before starting the helper the plugin reads `ctx.agents.roots()` for agents whose status is `running` and writes them to `resume.json`. Roots only: a running child always has a running parent waiting on it, so the parent's continuation re-establishes the child's work through a delegation it already owns. After startup is committed — through `ctx.get('appReady')?.onReady()`, which fires immediately when startup already committed — the successor acts only if the record names a different process and was captured inside `resumeWindowMs`. It resolves each session through the same Typert `agent` lookup the RPC gateway uses, which resumes a cold session with its own preset composition, and opens one continuation turn with `followup`.

**The continuation is a plugin-source notice that describes the restart.** Rebuilding it locally keeps this standalone package free of a runtime import of a harness package. It names the interrupted calls rather than asking the model to "continue", because the synthetic repair has already recorded them as failures and a call that now reports an error may still have taken effect before the process died.

**The helper is one Node script with no dependency beyond the checkout's Node runtime**, so Windows, macOS, and Linux run the identical path: `execFile` argument arrays with no shell for git, `windowsHide`, detached and unref'd spawns, and `0.0.0.0` mapped to `127.0.0.1` for the readiness probe. It resolves the package manager from `npm_execpath`, mirroring `scripts/install-custom-plugins.mjs`, and falls back to a shelled `pnpm` only on Windows where the shim requires one.

## Alternatives considered

**Patch the running tree instead of restarting.** Adding the row to the live patch layer would duplicate it against the same row in the profile bundle at the next boot and is not version-controlled, so the bundle is the only registration.

**Infer ownership from the port owner.** This is the shortcut the [launcher ownership note](../bug-fix/2026-09-07-windows-launcher-process-ownership.md) rejects and this note keeps rejecting: the helper stops the process identified by `serverPid` in its own request record, never whatever currently holds the port.

**Resume sessions inside the helper.** The helper is outside the tree and cannot reach the agent registry; the successor is the only process with both the record and the services.

**Detect interrupted sessions at boot instead of recording them.** The log's open tail turn proves a turn was interrupted, but nothing enumerates sessions with an open tail turn, and the empty set cannot distinguish a session that was running from one the user had merely left open. Recording the live set before exit is the only available discriminator.

**Continue every session, including subagents.** A resumed child would start a turn no parent is waiting on, duplicating work the parent's continuation already re-establishes through its own delegation.

**Restore local work with `git stash apply` and drop.** Keeping the stash on success would accumulate entries the user did not ask for; `pop` leaves residue only in the conflict case that already needs their attention.

## Consequences

An update no longer requires the console, and a user who walks away returns to a running, updated application with the sessions that were working still working. The browser clears its caches and reloads itself once the helper reports an outcome.

The checkout ends on the tracked branch rather than the branch it started from; the previous branch and both commit ids are recorded and shown, but work committed elsewhere is not in the working tree afterwards. The replacement server has no console, so its output goes to `server.log`.

A continued session's interrupted turn remains in its transcript as a failure with synthetic tool errors, followed by the continuation as a new turn. That record is honest and nothing rewrites it, so a resumed session's first `turn/end` reason is `interrupted`, not `completed` — which any failure-budget logic reading that edge must account for.

The captured session set describes one process. A session running under a different `dsh` process, or one whose update helper never started the server down, is not continued: the first is not visible to this registry, and the second is excluded deliberately by the process-identity and age checks.

## Verification

`Custom Plugins/software-update/test/` runs 33 tests with `node --test`. Checkout comparison, configuration validation, the record projections, and the route's authentication and refusal contract run against real git fixtures; the helper's end-to-end tests build a real repository behind its origin and assert the full path — pull, pipeline, stash restoration, restart — plus a failed build returning the checkout to its starting commit and starting the previous server anyway, and a stash conflict being kept and reported. The continuation tests drive the boot path directly: the successor continues every recorded session, ignores a record its own process wrote, discards a record outside the window, honours `resumeOnRestart: false`, and continues the healthy sessions when one fails to resolve.
