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
<summary><b>SuperGoal: pursue a long-term objective</b></summary>

Start `/supergoal <objective>` to keep the session working toward a long-term result. A highlighted banner at the top of the session shows the objective with its current status underneath. SuperGoal checks the objective whenever a task is about to finish and continues while work remains. Completion requires recorded evidence; a hard blocker opens a multiple-choice question and gives the session a yellow waiting-for-answer indicator. Your answer is recorded before work resumes.

SuperGoal is included in the standard harness. Use `/supergoal` to inspect it, `/supergoal pause` to stop unfinished work, `/supergoal resume` to continue, or `/supergoal clear` to remove it and its tools. Completed objectives stay complete. The objective survives session reloads; resuming execution requires `/supergoal resume`. See the [SuperGoal reference](packages/goal/super-goal/README.md) for behavior and limitations.

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
<summary><b>On-demand skill category catalogs (`skill-catalog-buckets`)</b> — click to expand</summary>

Reduces the initial skill context by replacing the full skill list with compact, user-configurable category catalogs. The model calls the `skill_catalog` tool to list names and summaries one category (`aws`, `mcp`, `reviews`, `security`, plus `other`) at a time with paginated results, then loads full instructions with `skill`.

Configure `buckets` (ordered routing categories), `pageSize`, and `descriptionMaxLength` on the plugin row in the profile's `cordis.yml`. Discovery only registers when the exact scoped `skill` loader is live, so a preset that omits or denies that loader never exposes an orphan catalog tool.

</details>

### Plugins

These bundles live in [`Custom Plugins/`](Custom Plugins/). They are intentionally kept outside the core `packages/` tree and are installed per profile via `dsh plugin --profile <name> add <path>`.

#### 1. `dsh-browser-control`

<details>
<summary><b>Compact Playwright browser-control plugin</b> — click to expand</summary>

A compact native Playwright browser-control plugin. It intentionally exposes one `browser` tool rather than a large MCP tool catalog, plus a progressively loaded `browser-control` skill containing interaction policy.

Capabilities include:

- persistent Chromium context per Harness agent/session;
- semantic role/label/text/test-id locators;
- AI-oriented ARIA snapshots;
- click/fill/press/select/check/uncheck;
- deterministic assertions with polling;
- console/page/network/HTTP diagnostics;
- screenshots and responsive viewport changes;
- popup/tab listing and switching.

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

A global personal-assistant supervisor (one per Harness profile). It owns a dedicated control session titled "Personal Assistant" and watches every coding session through a Strands Agents SDK reasoning loop: it surfaces completions, failures, and questions from your sessions, routes your answers back to the right session, operates interactive TUI menus cross-session, and keeps persistent GitHub/Codex PR review watches. It is a control plane, not a coding worker — it never writes or edits code itself.

Capabilities include:

- session discovery with deterministic friendly names (derived from the first task, repo, or branch; explicit renames win forever);
- completion classification — idle is never equated with done; a deterministic classifier distinguishes COMPLETED / INPUT_REQUIRED / FAILED / BLOCKED from the session's own output;
- cross-session messaging: followup when idle, inject when running, steer when urgent;
- an owner-fenced TUI bridge (`tui_snapshot` / `tui_select` / `tui_keypress`, named keys only, ambiguous menus refused rather than guessed);
- a compact `github_pr_review_state` tool: Codex thumbs-up detection on the main post, timeline-aware latest activity;
- persistent review watches riding on durable Harness schedules, with an in-process timer fallback;
- dedupe everywhere, so nothing is ever announced twice — including across restarts;
- Level-2 permissions enforced outside the prompt: every supervisor tool is policy-wrapped, and destructive or unlisted actions refuse with `approval_required` until an approval UI exists;
- personality presets (`friendly`/`playful`/`professional`/`serious`/`minimal`/`custom`) that change phrasing only, never behavior.

**Prerequisites:**

- the GitHub CLI (`gh`), installed and authenticated, for PR review watches;
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
- a progressively loaded `project-secrets` skill that tells the agent to read first, never echo secrets into the conversation, commits, or logs, write authoritatively, and respect the project boundary;
- safely handles a missing file as empty.

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
