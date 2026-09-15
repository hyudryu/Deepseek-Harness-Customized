# dsh-software-update

One-click software update for this DeepSeek Harness checkout.

A sidebar button appears beside the Settings trigger **only while the tracked branch carries commits this checkout lacks**. Confirming an update starts a detached helper that stops the server, sets local work aside, updates the checkout, runs the refresh pipeline, puts the local work back, and starts a replacement server. The browser clears its caches and reloads itself once the helper reports an outcome, so a user who walks away comes back to a running, updated session.

## Model Experience

The plugin adds no tools and no prompt sections. It does contribute model-visible content in one case: when an update restarts the server, each session whose turn it interrupted receives one continuation prompt as a user-role message with a `plugin` source, so it is logged and replayed like any other turn input. Its wording is [`resumeMessage`](#configuration) plus a line naming the interrupted calls; nothing else the plugin does reaches a model request.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `remote` | `origin` | Git remote the update tracks. |
| `branch` | `main` | Branch the update compares against and moves to. |
| `checkout` | `''` | Checkout to update. Empty discovers the enclosing repository from the server's working directory. A present but non-string value fails the load rather than falling back to discovery. |
| `fetchTtlMs` | `60000` | Shortest interval between two `git fetch` runs. |
| `commandTimeoutMs` | `300000` | Timeout for one git command, applied in the plugin and in the helper. |
| `buildTimeoutMs` | `1800000` | Timeout for one refresh-pipeline command. |
| `gracefulStopMs` | `15000` | Time the helper waits for the server to exit before it terminates the process. |
| `relaunchTimeoutMs` | `1800000` | Time the helper waits for the replacement server's listen address. |
| `commitListLimit` | `20` | Commits reported by the status route. |
| `buildCommands` | `[['install'], ['run', 'install:custom-plugins'], ['run', 'build']]` | Arguments appended to the launcher's package manager, run in order after the update. |
| `resumeOnRestart` | `true` | Continue the sessions whose turns the restart interrupts. |
| `resumeMessage` | A paragraph naming the interrupted calls | The instruction those sessions receive. |
| `resumeWindowMs` | One pipeline and relaunch budget | How long a captured session list stays actionable. Derived from `buildCommands.length × buildTimeoutMs + relaunchTimeoutMs + commandTimeoutMs`, so a slow update cannot outlive it. |
| `discoveryPollMs` | `45000` | How often the control re-reads the comparison while nothing is running. |
| `outcomePollMs` | `3000` | How often the control asks the restarted server whether the update finished. |
| `slowAfterMs` | `2700000` | How long a normal update may take before the dialog says it is slow. |
| `waitTimeoutMs` | `2700000` | How long the dialog waits before it stops expecting an answer. |

An invalid value stops the plugin from loading rather than silently taking a default. The four polling fields are reported to the browser with every status read, so the control's cadence follows the configured budget instead of duplicating it as client constants.

## HTTP route

`/software-update` is authenticated like every other named route: the plugin calls `connection.requestRejection(request)` and answers its status code before reading any git state.

- `GET` returns the checkout comparison — state, branch, both commit ids, the commit list, and the count of local changes — plus the most recent update record, the resolved polling cadence, and how many sessions a restart would interrupt.
- `POST` starts an update. It waits out any in-flight status read, performs a **forced fetch** of its own (a cached poll must not answer a confirmation), refuses unless an update still exists, writes the request, starts the helper, and waits for the helper's first record before answering `202`. The response is flushed, the sessions to continue are captured, and only then does the plugin ask the launcher to exit.

## How the server is stopped and restarted

The plugin records the running server's identity — executable, `execArgv`, entry module, working directory, listen address, and start time — in `launch.json` before any update can be requested, and rewrites it whenever it names a different process. The helper replays that command line, so a checkout started by any `dsh` profile launcher restarts the same way, with no package manager needed to start it.

A launch record that is not a `dsh` profile invocation is refused rather than replayed. The repository permits a supported Node application to be launched only through the `dsh` CLI and a named profile, and that launch is what owns the composition and the graceful shutdown this update depends on.

Shutdown is the server's own graceful exit: the plugin calls the launcher-provided `appExit` after the response flushes, which disposes the tree through the same path a signal uses. The helper terminates the process only when that exit does not complete inside `gracefulStopMs`, and it identifies the process by the recorded id **and** the recorded start time — a bare pid is reused once the original exits, and signalling whatever inherited that number would kill an unrelated process. Where the platform cannot report a start time the helper says so in the log and falls back to the id alone.

State lives under `$DSH_HOME/software-update/<checkout-key>/`, where the key is a digest of the resolved checkout path. Several profiles can share one harness home while serving different checkouts, and a shared directory would let one profile's poll overwrite another's relaunch identity, or a request written for one checkout be executed against another. The directory is created `0700` and every record `0600`, because they carry session identities and titles, the checkout path, and complete build output.

A launch that asked the operating system for its port (`--port 0`) cannot be updated in place: replaying that command line would bind a different port, so the browser could never find the replacement again. The control says so instead of offering an update that cannot work.

## Continuing the sessions it interrupts

A turn in flight exists only in the process running it. The durable session log keeps the open `turn/start`, and the harness closes that turn as `interrupted` when the session is resumed, but nothing in the harness continues the work — every resume call site in the tree is caller-driven.

This plugin is the one component that knows a restart is coming, so it accepts that responsibility. Immediately before the helper is started it reads the live agent registry, takes the **roots** whose status is `running`, and writes them to `$DSH_HOME/software-update/resume.json`. Roots only: a running child always has a running parent waiting on it, so the parent's continuation re-establishes the child's work through the delegation it already owns, and resuming children as well would open turns in sessions no user is watching and no parent is waiting on.

Once startup is committed, the successor process reads that record. It acts only when the record names a **different process** and was captured inside `resumeWindowMs`, which is what separates a real restart from a helper that never started, or a much later unrelated boot. It then resolves each session — reusing a live agent, or resuming a cold one through the same Typert `agent` lookup the RPC gateway uses, so the session comes back with its own preset composition — and opens one continuation turn through `followup`. The record is removed either way, so it can never fire twice.

The continuation is submitted as a plugin-source notice, not as a user prompt, and it tells the model what happened rather than asking it to "continue": the synthetic repair has already recorded the in-flight tool calls as failures, and a call that now returns an error may still have taken effect before the process died. Naming that is what stops the model from repeating a side effect.

## Failure behaviour

A failure after the checkout moved returns it to the commit the update started from, restores the local work, runs the pipeline once more, and starts the previous server anyway. A failed build that left nothing listening would be worse than an update that did not happen. When the checkout started on another branch, recovery restores that branch **and** the tracked branch's previous tip, so neither is left moved. The outcome, the failing step, and the full command output are written to `update.json` and `update.log`; the recorded message reports what recovery actually achieved, including the steps that failed.

A `running` record whose helper is no longer alive is concluded as failed and the update can be retried. Without that, a helper killed by a crash or a power loss would leave a record that rejected every later request forever.

## Known Limitations and Deferred Work

- **Local work is restored with `git stash pop`, and a conflict is not an update failure.** The new code is built and the stash is kept; the record reports `stashKept` and the dialog tells the user to resolve it. The checkout is left with conflict markers.
- **The update moves the checkout to the tracked branch.** Work committed on another branch is not lost, but it is not in the working tree afterwards, and the dialog names the branch for that reason.
- **A diverged branch fails rather than merging.** The update uses `merge --ff-only`; local commits that are not on the tracked branch stop the update and the checkout is returned.
- **The replacement server has no console.** Its output goes to `server.log` in the state directory.
- **The update runs the refresh pipeline of this fork.** `buildCommands` names a different pipeline for a checkout whose build entry point differs.
- **A continued session's interrupted turn stays in its transcript as a failure.** The harness closes it as `interrupted` with synthetic tool errors, and the continuation is a new turn after it. The record is the honest account; nothing rewrites it.
- **Only root sessions are captured.** A running subagent is continued through its parent's delegation rather than resumed on its own, so a subagent whose parent finished before the restart is not continued.
- **A session running in another `dsh` process is not captured.** The registry answers for this process only.
- **The session set is captured at the shutdown boundary, not fenced there.** The plugin photographs the running roots as the response flushes, which is the last moment they exist, but the server still accepts a new turn for the fraction of a second before its exit request runs. Fencing admission would need a seam the harness does not expose.
- **Two `dsh web` instances on the same checkout still share one state directory.** Namespacing separates different checkouts, not two servers pointed at the same one; the last to write `launch.json` owns the update identity. Run one server per checkout.
- **The update is refused for a launch it cannot replay.** A server started without a `dsh` profile, or one started with `--port 0`, reports that instead of offering an update that cannot work.
- **A refresh command runs without credential environment variables.** Variables whose names look like a secret are dropped, so a build script that reads one from the environment — rather than from `.npmrc` or a config file — must be given it another way.

## Layout

| Path | Role |
|---|---|
| `index.js` | Cordis plugin: route, status cache, launch identity, helper hand-off. |
| `src/update/git.js` | Checkout comparison and the fetch into the tracking ref. |
| `src/update/records.js` | Durable launch, request, and outcome records. |
| `src/update/home.js` | Harness-home resolution, matching `@deepseek-ai/dsh-home-paths`. |
| `src/update/exec.js` | Bounded, shell-free child-process invocation. |
| `scripts/apply-update.mjs` | The detached helper. |
| `src/client/` | The sidebar control. |
