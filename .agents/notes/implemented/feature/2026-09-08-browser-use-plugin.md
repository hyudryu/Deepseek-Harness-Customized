# Agent Note: browser-use plugin bundle

Status: implemented

## Problem

The integrated browser was driven only through manual per-action tool calls (`browser` click/fill/assert), so goal-directed web flows needed the harness model to plan every step. The user wanted the [browser-use](https://github.com/browser-use/browser-use) agent as the driver of the integrated browser, packaged so installation carries the library itself, with a standing rule that the harness always uses browser mode for web actions, and with a supervision loop where the harness takes screenshots, analyzes them, and issues revised instructions.

## Decision

The [browser-use bundle](../../../../Custom%20Plugins/browser-use/README.md) registers one `browser-use` plugin beside the existing browser-control provider bundle. It vendors the browser-use Python source (upstream commit and sync procedure in `vendor/browser-use/VENDOR.md`, MIT license preserved) and builds a plugin-managed virtual environment from it on first use, gated by a `.ready` marker that records the vendored version, so a vendor sync rebuilds the environment. The library's pinned dependencies still install from PyPI; only the library itself is vendored, because vendoring the full dependency closure does not fit the repository.

A Python sidecar (`python/sidecar.py`) speaks newline-delimited JSON-RPC on stdio with three methods: `run` (browser-use `Agent` against a `BrowserSession`), `screenshot`, and `stop`. Requests are answered while stdin remains open (a reader thread feeds the request loop; EOF only triggers shutdown after in-flight requests drain). The sidecar attaches over CDP to the same integrated Chrome the browser-control bundle manages (`chromeEndpoint`, default `http://127.0.0.1:9222`); an empty endpoint makes browser-use launch its own local browser. The executor LLM defaults to `ChatDeepSeek` with the `DEEPSEEK_API_KEY` already required by the harness; an unset `llmBaseUrl` keeps the chat client's vendored default endpoint. The session is created with `keep_alive=True` because `Agent.run()` resets a non-keep-alive session in its finally block, which would break the post-run screenshot; the sidecar stops that session explicitly at shutdown (an attached Chrome is only disconnected, a self-launched browser is killed). One sidecar process serves one DSH session, enforces one `run` at a time, and omits absent reply fields rather than emitting `null`, so every reply validates against the tool's output schema. Launches are promise-cached so concurrent first calls share one process, dead sidecars are replaced on the next call, and disposal kills every sidecar.

The sidecar child receives an allowlisted environment (operational variables and proxy settings) rather than all of `process.env`, so unrelated Harness credentials never reach the third-party runtime; the selected API key travels only as `DSH_BU_API_KEY`, never through argv or logs. An exclusive `setup.lock` directory serializes venv setup across Harness processes before staging and publication; lock waits expire with an actionable error under `setupTimeoutMs`; the version marker lives inside the venv, and abandoned staging directories from crashed builds are swept after a day. Unknown or non-object config fields fail at load. An aborted or failed run waits for `stop` acknowledgement, falling back to killing and awaiting the sidecar when stop fails, and stdin-pipe failures reject only the pending tool request instead of crashing the Harness process.

The browser-mode rule and the supervision loop live in the registered skill and the tool description: web actions go through `browser_use` or the integrated `browser` tool instead of fetch/curl substitutes, and after every run the model must inspect the returned `screenshot_path` with the `read_image` tool (the `read` tool is text-only and cannot display PNG evidence), compare it with the task's success criteria, and either confirm completion or send a revised task. `useVision` defaults to false because the default executor model is text-only; harness-side screenshot analysis provides the vision step.

## Alternatives considered

**Mount browser-use through the dsh-mcp-servers plugin.** An MCP mount would expose its tools but carries no standing browser-mode rule, no supervision loop, and no lifecycle tie to the session's integrated Chrome.

**Reuse the manual `browser` tool only.** Per-action driving keeps every step in the harness loop; browser-use exists precisely to execute a concrete task autonomously and report back with evidence.

**Vendor the full Python dependency closure.** Hundreds of megabytes of pinned wheels do not fit a git repository; the first-use network install of pinned dependencies is the compromise that keeps the vendored library itself self-contained.

## Consequences

First use on a machine needs Python >= 3.11 and network access once (venv creation plus dependency install); failures surface as actionable tool errors with the command output tail. A browser-use run is bounded by `maxSteps` and one run at a time per session; `stop` cancels it. The GUI browser panel continues to list browser-control session tabs, while browser-use works in its own tab of the same visible Chrome window. Tests cover configuration validation, protocol framing against a stub sidecar, tool routing, output schema, runtime build single-flight, and disposal, without Python or Chrome. The end-to-end path (real LLM run against Chrome) was validated up to the LLM call — venv build from the vendored source, sidecar startup, and protocol round-trips — but not with a live model, which requires `DEEPSEEK_API_KEY` in the harness environment.

The keyless `snapshots/session/browser-use/` scenario mounts the real plugin through the shipped headless profile with a deterministic executor fixture. It records the skill catalog, skill load, assembled tool schema, and run/screenshot/stop results. JavaScript tests additionally cover shared venv setup in independent processes, bounded lock contention, and stop acknowledgement before failed calls settle. Python protocol tests run with `python "Custom Plugins/browser-use/test/python_sidecar_test.py"`.
