# Agent Note: browser-use plugin bundle

Status: implemented

## Problem

The integrated browser was driven only through manual per-action tool calls (`browser` click/fill/assert), so goal-directed web flows needed the harness model to plan every step. The user wanted the [browser-use](https://github.com/browser-use/browser-use) agent as the driver of the integrated browser, packaged so installation carries the library itself, with a standing rule that the harness always uses browser mode for web actions, and with a supervision loop where the harness takes screenshots, analyzes them, and issues revised instructions.

## Decision

The [browser-use bundle](../../../Custom%20Plugins/browser-use/README.md) registers one `browser-use` plugin beside the existing browser-control provider bundle. It vendors the browser-use Python source (upstream commit and sync procedure in `vendor/browser-use/VENDOR.md`, MIT license preserved) and builds a plugin-managed virtual environment from it on first use, gated by a `.ready` marker that records the vendored version, so a vendor sync rebuilds the environment. The library's pinned dependencies still install from PyPI; only the library itself is vendored, because vendoring the full dependency closure does not fit the repository.

A Python sidecar (`python/sidecar.py`) speaks newline-delimited JSON-RPC on stdio with three methods: `run` (browser-use `Agent` against a `BrowserSession`), `screenshot`, and `stop`. The sidecar attaches over CDP to the same integrated Chrome the browser-control bundle manages (`chromeEndpoint`, default `http://127.0.0.1:9222`); an empty endpoint makes browser-use launch its own local browser. The executor LLM defaults to `ChatDeepSeek` with the `DEEPSEEK_API_KEY` already required by the harness, and the key travels to the sidecar through the environment, never through argv or logs. One sidecar process serves one DSH session; launches are promise-cached so concurrent first calls share one process, dead sidecars are replaced on the next call, and disposal kills every sidecar while Chrome and its tabs survive.

The browser-mode rule and the supervision loop live in the registered skill and the tool description: web actions go through `browser_use` or the integrated `browser` tool instead of fetch/curl substitutes, and after every run the model must read the returned `screenshot_path`, compare it with the task's success criteria, and either confirm completion or send a revised task. `useVision` defaults to false because the default executor model is text-only; harness-side screenshot analysis provides the vision step.

## Alternatives considered

**Mount browser-use through the dsh-mcp-servers plugin.** An MCP mount would expose its tools but carries no standing browser-mode rule, no supervision loop, and no lifecycle tie to the session's integrated Chrome.

**Reuse the manual `browser` tool only.** Per-action driving keeps every step in the harness loop; browser-use exists precisely to execute a concrete task autonomously and report back with evidence.

**Vendor the full Python dependency closure.** Hundreds of megabytes of pinned wheels do not fit a git repository; the first-use network install of pinned dependencies is the compromise that keeps the vendored library itself self-contained.

## Consequences

First use on a machine needs Python >= 3.11 and network access once (venv creation plus dependency install); failures surface as actionable tool errors with the command output tail. A browser-use run is bounded by `maxSteps` and one run at a time per session; `stop` cancels it. The GUI browser panel continues to list browser-control session tabs, while browser-use works in its own tab of the same visible Chrome window. Tests cover configuration validation, protocol framing against a stub sidecar, tool routing, output schema, runtime build single-flight, and disposal, without Python or Chrome. The end-to-end path (real LLM run against Chrome) was validated up to the LLM call — venv build from the vendored source, sidecar startup, and protocol round-trips — but not with a live model, which requires `DEEPSEEK_API_KEY` in the harness environment.
