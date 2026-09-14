# dsh-software-update

One-click software update for this DeepSeek Harness checkout.

A sidebar button appears beside the Settings trigger **only while the tracked branch carries commits this checkout lacks**. Confirming an update starts a detached helper that stops the server, sets local work aside, updates the checkout, runs the refresh pipeline, puts the local work back, and starts a replacement server. The browser clears its caches and reloads itself once the helper reports an outcome, so a user who walks away comes back to a running, updated session.

## Model Experience

No model-visible content. The plugin adds no tools, prompt sections, or session events; it reaches the application only through the authenticated HTTP route below and the sidebar slot.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `remote` | `origin` | Git remote the update tracks. |
| `branch` | `main` | Branch the update compares against and moves to. |
| `checkout` | `''` | Checkout to update. Empty discovers the enclosing repository from the server's working directory. |
| `fetchTtlMs` | `60000` | Shortest interval between two `git fetch` runs. |
| `commandTimeoutMs` | `300000` | Timeout for one git command. |
| `buildTimeoutMs` | `1800000` | Timeout for one refresh-pipeline command. |
| `gracefulStopMs` | `15000` | Time the helper waits for the server to exit before it terminates the process. |
| `relaunchTimeoutMs` | `1800000` | Time the helper waits for the replacement server's listen address. |
| `commitListLimit` | `20` | Commits reported by the status route. |
| `buildCommands` | `[['install'], ['run', 'install:custom-plugins'], ['run', 'build']]` | Arguments appended to the launcher's package manager, run in order after the update. |
| `resumeOnRestart` | `true` | Continue the sessions whose turns the restart interrupts. |
| `resumeMessage` | A paragraph naming the interrupted calls | The instruction those sessions receive. |
| `resumeWindowMs` | `3600000` | How long a captured session list stays actionable. |

An invalid value stops the plugin from loading rather than silently taking a default.

## HTTP route

`/software-update` is authenticated like every other named route: the plugin calls `connection.requestRejection(request)` and answers its status code before reading any git state.

- `GET` returns the checkout comparison — state, branch, both commit ids, the commit list, and the count of local changes — plus the most recent update record.
- `POST` starts an update. It re-reads the status with a forced fetch, refuses unless an update still exists, writes the request, starts the helper, and waits for the helper's first record before answering `202`. The response is flushed before the plugin asks the launcher to exit.

## How the server is stopped and restarted

The plugin records the running server's identity — executable, `execArgv`, entry module, working directory, and listen address — in `$DSH_HOME/software-update/launch.json` before any update can be requested, and rewrites it whenever it names a different process. The helper replays that identity, so a checkout started as `pnpm dsh web`, a direct `node` entry, or an installed binary restarts the same way, with no package manager needed to start it.

Shutdown is the server's own graceful exit: the plugin calls the launcher-provided `appExit` after the response flushes, which disposes the tree through the same path a signal uses. The helper terminates the process only when that exit does not complete inside `gracefulStopMs`, and it identifies the process by the recorded id rather than by the port owner.

## Continuing the sessions it interrupts

A turn in flight exists only in the process running it. The durable session log keeps the open `turn/start`, and the harness closes that turn as `interrupted` when the session is resumed, but nothing in the harness continues the work — every resume call site in the tree is caller-driven.

This plugin is the one component that knows a restart is coming, so it accepts that responsibility. Immediately before the helper is started it reads the live agent registry, takes the **roots** whose status is `running`, and writes them to `$DSH_HOME/software-update/resume.json`. Roots only: a running child always has a running parent waiting on it, so the parent's continuation re-establishes the child's work through the delegation it already owns, and resuming children as well would open turns in sessions no user is watching and no parent is waiting on.

Once startup is committed, the successor process reads that record. It acts only when the record names a **different process** and was captured inside `resumeWindowMs`, which is what separates a real restart from a helper that never started, or a much later unrelated boot. It then resolves each session — reusing a live agent, or resuming a cold one through the same Typert `agent` lookup the RPC gateway uses, so the session comes back with its own preset composition — and opens one continuation turn through `followup`. The record is removed either way, so it can never fire twice.

The continuation is submitted as a plugin-source notice, not as a user prompt, and it tells the model what happened rather than asking it to "continue": the synthetic repair has already recorded the in-flight tool calls as failures, and a call that now returns an error may still have taken effect before the process died. Naming that is what stops the model from repeating a side effect.

## Failure behaviour

A failure after the checkout moved returns it to the commit the update started from, restores the local work, runs the pipeline once more, and starts the previous server anyway. A failed build that left nothing listening would be worse than an update that did not happen. The outcome, the failing step, and the full command output are written to `$DSH_HOME/software-update/update.json` and `update.log`.

## Known Limitations and Deferred Work

- **Local work is restored with `git stash pop`, and a conflict is not an update failure.** The new code is built and the stash is kept; the record reports `stashKept` and the dialog tells the user to resolve it. The checkout is left with conflict markers.
- **The update moves the checkout to the tracked branch.** Work committed on another branch is not lost, but it is not in the working tree afterwards, and the dialog names the branch for that reason.
- **A diverged branch fails rather than merging.** The update uses `merge --ff-only`; local commits that are not on the tracked branch stop the update and the checkout is returned.
- **The replacement server has no console.** Its output goes to `$DSH_HOME/software-update/server.log`.
- **The update runs the refresh pipeline of this fork.** `buildCommands` names a different pipeline for a checkout whose build entry point differs.
- **A continued session's interrupted turn stays in its transcript as a failure.** The harness closes it as `interrupted` with synthetic tool errors, and the continuation is a new turn after it. The record is the honest account; nothing rewrites it.
- **Only root sessions are captured.** A running subagent is continued through its parent's delegation rather than resumed on its own, so a subagent whose parent finished before the restart is not continued.
- **A session running in another `dsh` process is not captured.** The registry answers for this process only.

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
