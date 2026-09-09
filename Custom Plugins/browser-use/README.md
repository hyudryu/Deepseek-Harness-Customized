# Browser Use

English only (this fork keeps documentation in English).

This optional bundle adds the [browser-use](https://github.com/browser-use/browser-use) agent as the driver of the integrated browser: the harness model sends a concrete task, browser-use executes it in the visible session Chrome, and every run returns a screenshot the harness model analyzes before confirming completion or sending revised instructions. Install it alongside the `dsh-chrome-browser` (or `dsh-browser-control`) bundle so the panel and the `browser` tool are present; this bundle registers only the `browser-use` plugin.

Run `pnpm run install:custom-plugins`, then `pnpm dsh plugin --profile <name> add "./Custom Plugins/browser-use"`.

## Browser mode rule

The `browser-use` skill and the tool description instruct the model that **browser mode is mandatory for web actions**: site interactions go through `browser_use` or the integrated `browser` tool, never through fetch/curl-style substitutes. The supervision loop is part of the same rule: after every run the model must read the returned screenshot, compare it with the task's success criteria, and either confirm done or send a revised task.

## Self-contained runtime

The bundle vendors the browser-use Python source under `vendor/browser-use/` (upstream commit and sync procedure in `vendor/browser-use/VENDOR.md`; MIT license preserved). On first use the plugin creates a Python virtual environment under `~/.dsh/browser-use/venv` and installs the vendored source plus its pinned dependencies; this one-time setup needs Python >= 3.11 and network access. A `.ready` marker records the vendored version, so replacing the vendor directory rebuilds the environment automatically. Invalid configuration fails at load; setup failures fail the tool call with the command output.

## Configuration (`cordis.patch.yml`)

| Key | Default | Meaning |
| --- | --- | --- |
| `chromeEndpoint` | `http://127.0.0.1:9222` | CDP endpoint of the integrated Chrome. Chrome is launched (visible, persistent profile) when the endpoint is down. Empty string makes browser-use launch its own local browser instead. |
| `chromeUserDataDir` / `chromeExecutablePath` / `chromeConnectTimeoutMs` | `~/.dsh/chrome-profile` / auto / `10000` | Chrome launch settings, shared semantics with the browser-control bundle. |
| `headless` | `false` | Applies only when `chromeEndpoint` is empty (browser-use-launched browser). |
| `pythonExecutable` | auto (`python`, `python3`, `py`) | Python >= 3.11 used to build the venv. |
| `venvRoot` | `~/.dsh/browser-use` | Root holding the venv and the `.ready` marker. |
| `maxSteps` | `25` | Step budget cap per run; requests can ask for less. |
| `llmProvider` | `deepseek` | `deepseek` or `openai` (any OpenAI-compatible endpoint via `llmBaseUrl`). |
| `llmModel` | `deepseek-chat` | Model browser-use uses as its executor. |
| `llmBaseUrl` | unset | Optional base URL override. |
| `llmApiKeyEnv` | `DEEPSEEK_API_KEY` | Environment variable the Harness process must export; runs fail loudly when it is unset. |
| `useVision` | `false` | Send page screenshots to the executor model; enable only with a vision-capable `llmModel`. Screenshot-based supervision works without this. |
| `artifactDir` | `.dsh/browser-use-artifacts` | Screenshot directory; relative paths resolve against the session workspace. |
| `maxHistoryChars` / `setupTimeoutMs` / `startTimeoutMs` / `requestTimeoutMs` / `shortRequestTimeoutMs` | `12000` / `600000` / `120000` / `1800000` / `60000` | Reply size cap and timeout budgets. |

## Tool

`browser_use` exposes three actions:

- `run` — `{ task, max_steps?, use_vision? }`: executes the task, returns `{ done, final_result, errors, steps, url, elapsed_s, screenshot_path }`. One run at a time per session.
- `screenshot` — `{ path?, full_page? }`: saves a capture of the current tab and returns `{ screenshot_path, url, title }`.
- `stop` — cancels the active run and returns `{ stopped }`.

The sidecar keeps one browser-use `BrowserSession` per DSH session, attached over CDP to the integrated Chrome. Chrome, its persistent profile, and the tab browser-use opened survive session close and plugin disposal; only the sidecar process ends. A self-launched browser (empty `chromeEndpoint`) is closed at disposal.

## Credentials

The `DSH_BU_API_KEY` value is passed to the sidecar through the environment and never logged or written to results. Task text must not contain secrets; the model rule forbids it.

## Tests

Run `node --test "Custom Plugins/browser-use/test/*.test.mjs"`. Tests cover configuration validation, protocol framing, tool routing against a stub sidecar, output schema shape, and skill registration; no Python or Chrome is required.
