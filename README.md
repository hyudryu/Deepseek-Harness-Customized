# DeepSeek Harness

This personal fork maintains documentation in English only. Existing translations are legacy material and may be outdated; updates do not require translated counterparts. See the [documentation language policy](docs/i18n/README.md).

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Custom Updates & Plugins

> **⚠️ Disclaimer:** These are **not** official DeepSeek features or plugins. They are personal additions to this fork, built for coding-agent workflows. Use them at your own discretion.

This fork adds custom updates to DeepSeek Harness plus a set of installable plugin bundles. Expand each entry below for details.

### Updates to DeepSeek Harness

<details>
<summary><b>Accurate context meter and working recovery when a session exceeds its context window</b> — click to expand</summary>

A session that had grown past its model's context window showed `0% of context used` and `~0 / 300K` in the composer's context meter while every further turn failed with `CONTEXT_WINDOW_EXCEEDED`. Two separate defects caused it. The meter's occupancy numerator was overwritten by a zero-filled usage object that providers return on a bodiless `400`, so the one condition the badge exists to report was displayed as empty. Separately, automatic recovery could never succeed: it summarizes the conversation by replaying it to the model, so the summarization call was itself built from the context that had just overflowed and was answered with the same rejection on every attempt. `maxOverflowRetries` bounded the retries, but nothing could make progress.

Both are fixed. A failed attempt that reports zero prompt tokens no longer replaces a real reading, so the badge shows the true figure — `100%` for a session at 317K against a 300K window — instead of `0%`. The summarizer now budgets its own request against the routed model's advertised window, dropping the oldest messages and then the tool schemas (which it cannot use anyway) until the request fits, so overflow recovery condenses the newest portion of the conversation and the turn continues. A route advertising no capacity is left unbudgeted rather than being given an invented limit. See the [token meter reference](packages/llm/token-meter/README.md) and the [compaction backend reference](packages/compaction/compaction-basic/README.md).

</details>

<details>
<summary><b>Per-row operation durations in the transcript</b> — click to expand</summary>

Every Tool-call row and every thinking (`Think`) row now carries how long that operation took, drawn as `45.2s` under a minute and `2m 42s` from there on. A settled Tool row takes its span from the paired `tool/call` and `tool/result` event times; a running row shows nothing until it settles. A thinking row counts up live while the model is still streaming that block — including across a quiet stretch where no new token has arrived — and freezes at its recorded end once the step settles.

The label is a measurement, so it sits in the caption tone at the row's trailing edge and never truncates the path, command, or thinking text beside it. Model steps already reported their own total on the statistics line under the composer; this adds the per-operation figure that line cannot show.

</details>

<details>
<summary><b>SearXNG web search without a provider API key</b></summary>

Open Settings > Plugins > Plugin configuration, enter your SearXNG instance URL in the SearXNG card, enable it, and save. Enabled SearXNG takes precedence over DeepSeek search, including when no DeepSeek search API key is configured. Disabling it restores the existing search selection. The provider ships with the standard harness; your SearXNG instance must allow JSON search responses. See the [SearXNG setup and provider reference](packages/web/web-search-searxng/README.md).

</details>

<details>
<summary><b>Restore saved skill-catalog session history</b></summary>

Opening a saved v2 session preserves valid skill-catalog presentation digests while migrating its history to v3. This restores sessions written before the format version caught up with that metadata. Migration creates a successor file beside the unchanged original log; no manual history edits or setup are needed. See the [session migration reference](packages/session/session-format-v2-to-v3/README.md).

</details>

<details>
<summary><b>SuperGoal: pursue a long-term objective</b></summary>

Start `/supergoal <objective>` to keep the session working toward a long-term result. A highlighted banner at the top of the session shows the objective with its current status underneath. SuperGoal checks the objective whenever a task is about to finish and continues while work remains. Completion requires recorded evidence; a hard blocker opens a multiple-choice question and gives the session a yellow waiting-for-answer indicator. Your answer is recorded before work resumes. A turn that fails on the provider side is retried a few times and then reports the concrete blocker instead of going quiet.

SuperGoal is included in the standard harness. Use `/supergoal` to inspect it, `/supergoal pause` to stop unfinished work, `/supergoal resume` to continue, or `/supergoal clear` to remove it and its tools. Pause preserves unanswered blockers and queued user work. Completed objectives stay complete. The objective survives session reloads, and reopening a session resumes the objective it was already pursuing; a forked session waits for `/supergoal resume`. See the [SuperGoal reference](packages/goal/super-goal/README.md) for behavior and limitations.

</details>

<details>
<summary><b>Autonomous goals keep running to the end</b></summary>

An armed `/goal` or `/supergoal` no longer stops quietly. Reopening a session resumes the objective it was already pursuing instead of waiting for a human resume, a turn that fails on the provider side is retried a few times before the objective records a durable blocker naming the condition, and a settled background job always wakes an owner that is still pursuing an objective — the completion-notice wake budget no longer applies to it. A forked session still waits for an explicit resume, and failures that are not provider failures, such as a rejected log write or a plugin failure, still stop the objective rather than retrying it. See the [continuation durability decision](.agents/notes/implemented/feature/2026-09-11-continuation-survives-restart-and-failure.md).

</details>

<details>
<summary><b>Session MCP endpoint for external assistants</b> — click to expand</summary>

Connect an MCP client to `http://127.0.0.1:3080/mcp` to browse projects, find saved sessions by title or ID, and read their transcripts and current status. Reading a saved session does not resume it. External clients can also queue or steer a message and request cancellation for a session already active in the same Harness process.

Every shipped profile includes the endpoint, including Web launched through `RUN.bat`. The Web profile shares its HTTP port with the UI, so `--port` changes both addresses; other profiles use a configurable standalone listener. See the [session MCP reference](packages/mcp/session-mcp/README.md) for configuration, pagination, and control limits.

</details>

<details>
<summary><b>English-only documentation for this custom fork</b> — click to expand</summary>

Maintain READMEs, documentation, and contributor templates in English without creating Chinese counterparts or translation records. Documentation checks and website publishing accept English sources independently; existing translations remain optional legacy references. Every feature, improvement, and plugin is documented in an expandable entry in this section so users can find this fork's additions and their usage or setup.

</details>

<details>
<summary><b>ui-workspace: `sidebar.workspaces.actions` slot for feature plugins</b> — click to expand</summary>

Declares a new `sidebar.workspaces.actions` list slot (root scope) on the workspace browser, exposed as a `workspaceMenuItems` hook, so feature plugins can contribute extra items to a workspace row's 3-dots menu. `ProjectRowItem` merges contributed items before the built-in Rename/Delete and dispatches each item's `onSelect(workspaceId)`. Adds tests and keeps `Rows.tsx` at 100% coverage.

</details>

<details>
<summary><b>Workspace sections follow the latest session in Last updated order</b> — click to expand</summary>

With **Group by: Workspace** and **Order by: Last updated** (the default), the Workspace sections themselves now rank by their newest session, so a project you prompted 30 seconds ago rises above one untouched for weeks instead of staying wherever manual order put it. A Workspace showing no session follows every Workspace that shows one, and the Ungrouped bucket stays last. Section rows keep their drag handle in **Manual** order only, where the arrangement is yours to make; Last updated derives it from session activity.

</details>

<details>
<summary><b>Failed turns retry three times, then show a red dot on the session</b> — click to expand</summary>

A model request that fails on a transient error — a lost connection, a rate limit, a 5xx, an idle timeout, or a degenerate empty completion — now waits **5 seconds**, then **60 seconds**, then **5 minutes** before giving up, instead of the previous five sub-second retries. The waits are configurable per provider: set `retryPolicy.retryDelaysMs` on a `llm-deepseek` or `llm-pi-ai` route in your profile's `cordis.yml` (or the Web Models page settings) to replace the schedule, `maxRetries` to use fewer of its entries, or `retryPolicy.backoff` to restore the exponential ramp. Retries are unchanged in kind: each one re-runs the failed step inside the same turn, and the `llm/retry` events stay in the session log.

Failures a retry cannot fix are no longer retried at all. A connection the endpoint **refuses** — a stopped or crashed local server, or a torn-down model — now reports `CONNECTION_REFUSED` and fails immediately rather than burning six minutes of backoff; a model the endpoint does not serve fails as `INVALID_REQUEST`/`HTTP_404`, which was already outside the retryable set.

When the retries are exhausted, the sidebar session row shows a **red dot labelled Failed**, so a session that died while you were looking elsewhere is visible at a glance. The fact is folded from the session log, so it survives a reload, and the next successful turn clears it. See the [retry executor](packages/llm/llm-retry/README.md) and [workspace browser](packages/client/ui-workspace/README.md) references.

</details>

<details>
<summary><b>On-demand skill category catalogs (`skill-catalog-buckets`)</b> — click to expand</summary>

Reduces the initial skill context by replacing the full skill list with compact, user-configurable category catalogs. The model calls the `skill_catalog` tool to list names and summaries one category (`aws`, `mcp`, `reviews`, `security`, plus `other`) at a time with paginated results, then loads full instructions with `skill`.

Configure `buckets` (ordered routing categories), `pageSize`, and `descriptionMaxLength` on the plugin row in the profile's `cordis.yml`. Discovery only registers when the exact scoped `skill` loader is live, so a preset that omits or denies that loader never exposes an orphan catalog tool.

</details>

<details>
<summary><b>MCP server instructions in the system prompt</b> — click to expand</summary>

An MCP server can advertise a free-form `instructions` string during the protocol handshake — its own statement of how and when to use it. `@deepseek-ai/dsh-mcp-client` previously discarded that field. It now publishes the text into the system prompt as one section per server (`mcp:<serverName>`), so the model reads the server's guidance before choosing a tool.

This matters for servers whose value depends on being chosen over general-purpose tools: CodeGraph ships instructions routing the model to its own `codegraph_explore` tool instead of a grep-and-read loop, and with the field discarded the model kept grepping even though the tool was connected and working. The text belongs to the server, so it follows the server's own releases; nothing in the plugin config controls it, and a server that advertises none contributes no text.

</details>

<details>
<summary><b>DeepSeek API peak-hour badge in the composer</b> — click to expand</summary>

While the session's model rides the DeepSeek API, a small badge sits beside the model in the chat box. Inside a peak-rate window it reads **Peak** with a lit amber dot; outside one it reads **Off-peak** in the dimmed caption tone, so a glance tells you whether this turn is billed at peak rates. Peak is 01:00–04:00 and 06:00–10:00 UTC, Monday through Friday; every other hour, including all weekend UTC, is off-peak.

Hovering the badge, or focusing it from the keyboard, shows both windows as clock times in Pacific time and in UTC, with the Pacific weekdays named because the UTC windows open on the previous Pacific day: `Pacific time (Sunday–Thursday, second window ending the next morning): 5:00 PM–8:00 PM, 10:00 PM–2:00 AM` in winter, an hour later in summer. The badge reads the clock on its own, so a session left open crosses a window boundary without a reload or a model switch.

The badge appears only where the DeepSeek API's own rates apply: the route must be `deepseek-official` *and* still reach the public API, as the `dsh-llm-deepseek` adapter reports. Pointing that route at a proxy, or running a gateway that serves DeepSeek models under its own provider name, shows nothing, because neither bills at this schedule. No setup is needed. See the [model selection reference](packages/client/ui-model-selection/README.md#deepseek-api-peak-hours).

</details>

<details>
<summary><b>Automatic compaction sizes the model you just switched to</b> — click to expand</summary>

Automatic compaction now measures token pressure against the model the next request will actually use, not the model that served the previous one. Before this change, switching a long conversation onto a smaller-context model dispatched one request under the new model before any threshold could fire: that request failed with a context-window error, and the recovery compaction then tried to summarize through the same too-small model and failed too. Switching between a local 300K model and a 1M API model mid-session was the common way to hit it.

Pressure sizing now reads the live model selection installed for the agent, falling back to the latest routed request only when no selection is installed. Switching to a smaller model compacts before that model's first request. A summarization call still replays on the conversation's own model unless you configure `summarizationProvider`/`summarizationModel`; see the [compaction reference](packages/compaction/compaction-basic/README.md) and the [route-sizing decision](.agents/notes/implemented/bug-fix/2026-09-13-compaction-sizes-the-selected-route.md).

</details>

### Plugins

These bundles live in [`Custom Plugins/`](Custom Plugins/). They are intentionally kept outside the core `packages/` tree and are installed per profile via `dsh plugin --profile <name> add <path>`.

#### 1. `dsh-chrome-browser` / `dsh-browser-control`

<details>
<summary><b>Hidden Chrome browser with an interactive session panel</b> — click to expand</summary>

The [Chrome bundle](<Custom Plugins/chrome-browser/README.md>) and [browser-control bundle](<Custom Plugins/browser-control/README.md>) install the same provider, controller, and DSH browser panel; choose one per profile. Run `pnpm run install:custom-plugins`, then `pnpm dsh plugin --profile web add "./Custom Plugins/chrome-browser"` to install the Chrome bundle.

Chrome is the default backend, using local debugging on port 9222 and a dedicated persistent profile for login. The dedicated-profile Chrome is launched hidden (`chromeHeadless: false` shows its window), so the panel is the only browser surface. Opening a browser expands the panel, including when the agent's `browser` tool started it — except on a phone, where the panel would cover the conversation and the upper-right browser icon is the entry point instead. Clicks, drags, the wheel, and typing over the panel frame are forwarded to the active page, so sign-in and manual checks happen in the page instead of a taskbar window. New sessions open Google. The integrated `browser` tool and panel list, create, select, and close only the current session's tabs; preexisting tabs and other sessions' tabs are excluded. Playwright is available only by explicit selection. See the provider README for endpoint, profile, and backend configuration.

Capabilities include semantic locators, ARIA snapshots, click/fill/press/select/check/uncheck, polling assertions, browser diagnostics, screenshots, and viewport changes.

</details>

#### 2. `dsh-qa-testing`

<details>
<summary><b>PR-aware QA orchestration plugin</b> — click to expand</summary>

A PR-aware QA orchestration plugin. It exposes `qa_pr` plus a progressively loaded `qa-testing` skill.

The QA skill instructs DeepSeek to:

1. inspect the PR to see whether it already has a QA/testing section (loose match: `## QA Testing`, `QA section`, `QA test`, `Test steps`, `Testing`, etc. all count; code blocks are ignored);
2. only if the PR has no *usable* QA/testing section, inspect the PR body, diff, changed files, and adjacent code, then derive a concrete QA checklist;
3. if the PR already has a usable QA/testing section, reuse/translate it into the machine-managed `## QA Testing` block instead of re-deriving from scratch;
4. update each item live as PENDING/RUNNING/PASS/FAIL/BLOCKED;
5. on FAIL, call a foreground `subagent_fork` coding agent with the exact failure evidence;
6. retest the failed item after the coding agent fixes it;
7. repeat the repair loop up to the configured per-check limit;
8. after any fixes, rerun the *entire* checklist against the final head;
9. only mark overall PASS when every item passes in one uninterrupted final sweep.

The PR body block stores hidden JSON state between markers so updates are deterministic and preserve the rest of the PR body. Failure/pass attempt history remains visible to reviewers.

</details>

#### 3. `dsh-vision-router`

<details>
<summary><b>Two-stage vision router</b> — click to expand</summary>

A transparent model router that selects which model handles vision-capable requests versus text-only requests.

How it routes every model request:

1. If the request has **no image**, it is routed to the configured **text model** (or the session's selected model if none is configured).
2. If the request **contains an image**, the router first sends the image to the configured **vision model**, which returns a written analysis; that analysis is then handed to the **text model** along with the original request. The text model never sees raw image bytes, so you can pair a strong text-only model with a separate vision model.

Configuration is settings-level: add a `vision-router:` section to `$DSH_HOME/settings.yaml` (hot-reloaded, no restart):

```yaml
vision-router:
  visionProvider: pi-ai          # provider of the vision-capable model
  visionModel: pi-vision-2       # vision-capable model id
  textProvider: deepseek         # optional; unset inherits the session model
  textModel: deepseek-v4-flash   # optional; unset inherits the session model
  visionPrompt: ''               # optional; empty = built-in default
  maxAnalysisChars: 20000        # cap on the vision analysis injected as text
```

The same fields can be set in `cordis.patch.yml` as composition defaults. Routing activates once a `visionProvider`/`visionModel` is configured; until then the router is off — text requests pass through unchanged, but a request that contains an image **fails loudly** because the router cannot analyze it without a configured vision target. Invalid router settings fail any request with an actionable error rather than silently disabling routing. This is a router, not a tool — there is no `vision_router` tool to call.

</details>

#### 4. `dsh-personal-assistant`

<details>
<summary><b>Global personal-assistant supervisor plugin</b> — click to expand</summary>

A global personal-assistant supervisor (one per Harness profile). It owns a dedicated control session titled "Personal Assistant" and watches every coding session through a Strands Agents SDK reasoning loop: it surfaces completions, failures, and questions from your sessions, routes your answers back to the right session, operates interactive TUI menus cross-session, and keeps persistent GitHub watches on pull requests and Actions runs. It is a control plane, not a coding worker — it never writes or edits code itself.

Capabilities include:

- session discovery with deterministic friendly names (derived from the first task, repo, or branch; explicit renames win forever);
- completion classification — idle is never equated with done; a deterministic classifier distinguishes COMPLETED / INPUT_REQUIRED / FAILED / BLOCKED from the session's own output;
- cross-session messaging: followup when idle, inject when running, steer when urgent;
- an owner-fenced TUI bridge (`tui_snapshot` / `tui_select` / `tui_keypress`, named keys only, ambiguous menus refused rather than guessed);
- a compact `github_pr_review_state` tool: Codex thumbs-up detection on the main post, timeline-aware latest activity;
- persistent watches riding on durable Harness schedules, with an in-process timer fallback. `watch_create` takes an explicit `kind`: `github_codex_review` watches a PR for Codex review activity and ends on a Codex thumbs-up on the main post or a merge, and `github_actions_run` watches one workflow run and ends when the run reports a conclusion, whatever that conclusion is;
- watches that report when they stop watching. A watch keeps its own liveness evidence — when it last polled, when it last succeeded, and how many polls have failed in a row — and raises a `WATCH_UNHEALTHY` event once per outage. Two detectors cover it: a poll-failure streak crossing `watches.failureThreshold` (default 3), and a stall watchdog that runs on its own timer, because a watch whose schedule stopped firing never ticks and so nothing inside a poll could notice. A successful poll closes the outage and reports the recovery; `watch_list` exposes the same evidence directly;
- an unreadable watch record is quarantined on recovery instead of aborting it, and its orphaned recurring reminder is deleted with it — one bad record no longer strands every other watch or keeps the plugin from loading;
- dedupe everywhere, so nothing is ever announced twice — including across restarts;
- Level-2 permissions enforced outside the prompt: every supervisor tool is policy-wrapped, and destructive or unlisted actions refuse with `approval_required` until an approval UI exists;
- personality presets (`friendly`/`playful`/`professional`/`serious`/`minimal`/`custom`) that change phrasing only, never behavior.

**Prerequisites:**

- the GitHub CLI (`gh`), installed and authenticated, for watches;
- an OpenAI-compatible model endpoint for the supervisor loop (configured via `strands.baseUrl` / `strands.model`; the API key is read at runtime from the env var named by `strands.apiKeyEnv`, never stored in config).

</details>

#### 5. `dsh-mcp-servers`

<details>
<summary><b>MCP servers manager</b> — click to expand</summary>

A plugin that manages MCP servers for the deployment: you add, remove, enable, disable, and test servers from **Settings → Plugins → MCP servers**, and every enabled server is mounted into each agent session on start.

Capabilities include:

- two transports — `stdio` (`command`/`args`/`env`/`cwd`) and streamable HTTP (`scheme`/`host`/`port`/`path`/`headers`);
- a host-side connection test with a default 15s timeout that counts the server's tools and persists the result back to settings as `lastTest` (state, tool count, tool list, message, timestamp);
- auto-mounting of every enabled server onto a session as it starts, so that server's tools appear to the agent as `mcp__<serverName>__<toolName>`; a server that fails to mount is logged and skipped rather than blocking the session;
- an `mcp_servers` tool (`action=list`) that reports which servers are configured, whether each is enabled, and its last connection-test result — never assume a server or its tools are reachable without reading it;
- a progressively loaded `mcp-servers` skill that governs discovery, test-result interpretation, and the management page;
- server definitions stored in the `mcp.servers` settings namespace, so they persist in the DSH settings document on disk.

</details>

#### 6. `dsh-project-secrets`

<details>
<summary><b>Project-scoped secrets note-pad</b> — click to expand</summary>

A plugin that keeps a per-project secrets block — credentials, API keys, tokens, or other values that belong to one project only. It stores the block as a plain-text file in the project directory and surfaces it in the web GUI plus a tool for the agent.

Capabilities include:

- a secrets file scoped to the project's working directory, defaulting to `.dsh/project-secrets` (configurable via `secretsFile`, `maxBytes`, and `root`);
- a **Project Secrets** item on each project's 3-dots menu that opens a modal to paste/edit the block, backed by HTTP `GET`/`PUT` on `/project-secrets/<workspaceId>`;
- a `project_secrets` tool (`action: read`/`write`) for the agent, with byte-limit validation and atomic writes (temp file plus rename);
- a model-visible runtime-context snapshot of the block's **key names only** — never a value — contributed once the block has content, so the agent knows the project keeps e.g. `Node 4` and reads the block instead of answering that it does not know;
- a progressively loaded `project-secrets` skill that tells the agent to read the block before reporting that it does not know a project-specific value, never echo secrets into the conversation, commits, or logs, write authoritatively, and respect the project boundary;
- safely handles a missing file as empty.

</details>

#### 7. `dsh-browser-use`

<details>
<summary><b>browser-use agent driving the integrated browser</b> — click to expand</summary>

The [browser-use bundle](<Custom Plugins/browser-use/README.md>) adds the open-source [browser-use](https://github.com/browser-use/browser-use) agent as the driver of the integrated browser. The harness model sends one concrete task per run; browser-use executes it in the visible session Chrome (over CDP, default `http://127.0.0.1:9222`) and every run returns a screenshot. Install it alongside the `dsh-chrome-browser` (or `dsh-browser-control`) bundle so the panel and the `browser` tool are present.

A standing rule in the registered skill makes **browser mode mandatory for web actions**: site interactions go through `browser_use` or the integrated `browser` tool, never through fetch/curl substitutes. The same rule defines the supervision loop — after every run the model inspects the returned screenshot with the `read_image` tool, compares it with the task's success criteria, and either confirms completion or sends a revised task; `stop` cancels a wayward run and `screenshot` captures the current tab on demand.

The bundle vendors the browser-use Python source (MIT, pinned upstream commit in `vendor/browser-use/VENDOR.md`) so the library travels with the plugin. On first use it builds a Python >= 3.11 virtual environment under `~/.dsh/browser-use` from that vendored source in a private staging directory published with atomic renames (safe when two Harness processes share the root; one-time network access for the pinned dependencies; a version marker rebuilds automatically after a vendor sync). The sidecar child gets an allowlisted environment rather than the full Harness environment. The executor LLM defaults to DeepSeek via the harness's `DEEPSEEK_API_KEY` and is configurable (`llmProvider`, `llmModel`, `llmBaseUrl`, `llmApiKeyEnv`).

</details>

#### 5. `dsh-qwen-tool-adapter`

<details>
<summary><b>Qwen tool-call adapter</b> — click to expand</summary>

Some Qwen-family models (and Qwen behind certain OpenAI-compatible or proxied routes) emit tool calls as literal text in the assistant reply, most often:

```
<tool_call>
<function=read>
<parameter=file_path> src/a.ts </parameter>
</function>
</tool_call>
```

or the JSON form Qwen also uses:

```
<tool_call>
{"name": "read", "arguments": {"file_path": "src/a.ts"}}
</tool_call>
```

The harness only dispatches tools that arrive as structured `tool-call` blocks, so an unwrapped reply carrying that markup yields no tool call and the turn ends with nothing executed. This plugin registers an `llm/stream` listener (the model-stream waterfall) that detects that markup in each assistant text block, re-emits the preamble as text plus one `tool-call` block per call, and rewrites the terminal finish reason to `tool-calls` so the agent loop dispatches them.

Install it with the custom-plugin installer, then add the bundle to your profile:

```sh
pnpm run install:custom-plugins
pnpm dsh plugin --profile web add "./Custom Plugins/qwen-tool-adapter"
```

Configuration lives in the bundle's `cordis.patch.yml` (or your profile patch):

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Whether the adapter is active |
| `providers` | `[]` | Provider routes to translate; empty = any provider |
| `models` | `[]` | Model ids to translate; empty = any model on a matched provider |

Empty `providers`/`models` translate every request, which is safe because ordinary providers never emit Qwen markup and the transform is a pass-through for text that has none. The translation only touches outgoing stream chunks, never the frozen request, so the session log still records the assembled assistant message.

</details>

#### 8. `dsh-session-timing`

<details>
<summary><b>Session timing report for the agent</b> — click to expand</summary>

Adds a `session_timings` tool that reports how long the current session's operations took: the slowest completed Tool calls and model steps, anything still open and how long it has been open, and per-kind totals. It is the same measurement the transcript draws next to each row, put where the agent can act on it, so a stalled session can be diagnosed instead of re-run to be timed.

Install it with the custom-plugin installer, then add the bundle to your profile:

```sh
pnpm run install:custom-plugins
pnpm dsh plugin --profile web add "./Custom Plugins/session-timing"
```

Every figure comes from the session log's own event timestamps, so the report and the transcript cannot disagree. The tool takes one optional `limit` (rows per list, default 8, maximum 50), is read-only, and declares itself concurrency-safe. See the [bundle README](<Custom Plugins/session-timing/README.md>).

</details>

#### 9. `dsh-project-system-prompt`

<details>
<summary><b>Project-level system prompt override</b> — click to expand</summary>

Replaces the system prompt for every session in one project, so a repository can carry its own agent instructions instead of sharing the deployment's.

Each project row in the sidebar gains a **System prompt override…** item on its 3-dots menu. The editor's field holds that project's saved prompt; saving non-empty text makes it the entire system prompt for sessions whose working directory is that project, and an empty field removes the override. **Restore DeepSeek default** copies the prompt the deployment would otherwise assemble — prompt variables already interpolated — into the field, so an override starts from the shipped text rather than a blank page.

The override is a plain-text file at `<project>/.dsh/system-prompt.md`, so it can be committed and reviewed beside the code it applies to. The replacement is applied on the `system-prompt/assemble` waterfall, which runs on every model step: it takes effect on the next step with no session restart, and the Chat transcript's system-prompt row shows the override text. Tool schemas, runtime contexts, and prompt variables still assemble normally, so the model's tool set is unchanged.

Because an override replaces the whole prompt, it also drops the deployment's own persona and per-tool guidance sections; start from **Restore DeepSeek default** to keep them. A composition that registers a `complete` prompt section still wins over an override. `/compact` does not interact with it: compaction replaces a span of the message surface, while the system prompt is re-assembled each step.

Install it with the custom-plugin installer, then add the bundle to your profile:

```sh
pnpm run install:custom-plugins
pnpm dsh plugin --profile web add "./Custom Plugins/project-system-prompt"
```

See the [bundle README](<Custom Plugins/project-system-prompt/README.md>) for the storage path, the `promptFile`/`maxBytes`/`root` config fields, and the known limitations.

</details>

#### 10. `dsh-software-update`

<details>
<summary><b>One-click software update from the sidebar</b> — click to expand</summary>

A button beside the Settings trigger updates this checkout to the latest commit on `origin/main`, rebuilds it, and restarts the server — so a user who walks away comes back to a running, updated application.

The button **appears only while the tracked branch carries commits this checkout lacks**. Opening it lists those commits, the branch the checkout will move to, and how many uncommitted changes will be set aside; confirming asks nothing further of the user.

Applying the update shuts the server down through its own graceful exit, then runs a detached helper that fetches, sets local work aside with `git stash --include-untracked`, moves the checkout to the branch, runs `pnpm install` → `pnpm run install:custom-plugins` → `pnpm run build`, puts the local work back, and starts a replacement server using the executable, arguments, and working directory the running server recorded about itself. Once the helper reports an outcome, the browser drops its caches and reloads.

A failure after the checkout moved returns it to the commit the update started from, rebuilds, and **starts the previous server anyway**: an update that left nothing listening would be worse than one that did not happen. A stash that cannot be replayed is kept and reported rather than discarded, and the update still counts as applied.

The control contributes to `sidebar.settings.action` at order 1, immediately right of the mobile-access action. The helper is a single Node script with no dependency beyond the repository's own Node runtime, so the update path is identical on Windows, macOS, and Linux.

Install it with the custom-plugin installer, then add the bundle to your profile:

```sh
pnpm run install:custom-plugins
pnpm dsh plugin --profile web add "./Custom Plugins/software-update"
```

See the [bundle README](<Custom Plugins/software-update/README.md>) for the config fields, the `/software-update` route, and the known limitations.

</details>

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
