# Browser Use

English only (this fork keeps documentation in English).

This optional bundle adds the [browser-use](https://github.com/browser-use/browser-use) agent as the driver of the integrated browser: the harness model sends a concrete task, browser-use executes it in the visible session Chrome, and every run returns a screenshot the harness model analyzes before confirming completion or sending revised instructions. Install it alongside the `dsh-chrome-browser` (or `dsh-browser-control`) bundle so the panel and the `browser` tool are present; this bundle registers only the `browser-use` plugin.

Run `pnpm run install:custom-plugins`, then `pnpm dsh plugin --profile <name> add "./Custom Plugins/browser-use"`.

## Browser mode rule

The `browser-use` skill and the tool description instruct the model that **browser mode is mandatory for web actions**: site interactions go through `browser_use` or the integrated `browser` tool, never through fetch/curl-style substitutes. The supervision loop is part of the same rule: after every run the model must read the returned screenshot, compare it with the task's success criteria, and either confirm done or send a revised task.

## Self-contained runtime

The bundle vendors the browser-use Python source under `vendor/browser-use/` (upstream commit and sync procedure in `vendor/browser-use/VENDOR.md`; MIT license preserved). On first use the plugin builds a Python virtual environment under `~/.dsh/browser-use` and installs the vendored source plus its pinned dependencies; this one-time setup needs Python >= 3.11 and network access. An exclusive `setup.lock` directory serializes setup across Harness processes sharing `venvRoot`; each build uses private staging before publication. Lock waits use `setupTimeoutMs`. After a crashed setup, remove the lock only after verifying no installer is running. The `.ready` marker inside the venv records the vendored version, so replacing the vendor directory rebuilds the environment automatically; abandoned staging directories from crashed builds are swept after a day. Invalid or unknown configuration fields fail at load; setup failures fail the tool call with the command output.

## Sidecar environment and credentials

The sidecar child process receives an allowlisted environment (PATH, PATHEXT, SYSTEMROOT, COMSPEC, TEMP, TMP, HOME, USERPROFILE, LANG, LOCALAPPDATA, PROGRAMDATA, PROGRAMFILES, and HTTP(S)_PROXY/NO_PROXY variants), not the full Harness environment, so unrelated Harness credentials never reach the third-party runtime. The selected API key travels only as `DSH_BU_API_KEY` and is never logged or written to results. Task text must not contain secrets; the model rule forbids it.

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

- `run` — `{ task, max_steps?, use_vision? }`: executes the task, returns `{ done, final_result?, errors, steps, url?, elapsed_s, screenshot_path }`. One run at a time per session; a second concurrent run is rejected. An aborted tool call forwards `stop`, so the browser-use run actually stops instead of only stopping the wait. Absent values are omitted from results, never `null`.
- `screenshot` — `{ path?, full_page? }`: saves a capture of the current tab and returns `{ screenshot_path, url?, title? }`.
- `stop` — cancels the active run and returns `{ stopped }`.

Inspect returned screenshots with the harness `read_image` tool; the `read` tool is text-only and cannot display PNG evidence.

The sidecar keeps one browser-use `BrowserSession` per DSH session, attached over CDP to the integrated Chrome, alive across runs (`keep_alive`). At sidecar shutdown an attached Chrome is merely disconnected (its process and tabs survive); a browser browser-use launched itself (empty `chromeEndpoint`) is killed. A closed or broken stdin pipe rejects only the pending tool request. With `llmBaseUrl` unset, the chat client keeps its own default endpoint (`https://api.deepseek.com/v1` for the deepseek provider).

## Tests

Run `node --test "test/*.test.mjs"` (JavaScript: configuration validation, protocol framing, tool routing including abort and relaunch, output schema, runtime build) and `python test/python_sidecar_test.py` (sidecar protocol regression with fakes, including live-stdin request processing, exclusive runs, and stop). No Chrome is required; the Python suite needs only a Python interpreter. `pnpm run test:snapshot -- -t "headless.*browser-use"` at the repository root replays the skill catalog, loaded skill, tool schemas, and run/screenshot/stop results through the shipped headless profile using a deterministic executor fixture. It does not validate live browser or LLM behavior.
