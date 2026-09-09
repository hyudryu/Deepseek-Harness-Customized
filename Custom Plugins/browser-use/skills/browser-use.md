# Browser Use

Use this skill whenever a task requires acting on a website through the integrated browser.

## Core rules

1. **Browser mode is mandatory for web actions.** Any action on a website — navigating, clicking, typing, submitting forms, downloading through the UI, verifying rendered behavior — goes through `browser_use` (goal-directed flows) or the integrated `browser` tool (one precise interaction). Never substitute `fetch`, `curl`, shell commands, or web-search tools for operating a site while browser tools are available. Fetch-style tools remain appropriate only for plain content retrieval the user did not ask to be performed in a browser.
2. **browser-use is the executor; you are the supervisor.** Send exactly one concrete task per `browser_use` run, stating the target site, the steps you expect, and explicit success criteria. browser-use drives the visible session Chrome on its own; do not interleave `browser` tool actions into an active run.
3. **After every run, inspect the evidence.** Read the returned `screenshot_path` with the Read tool and compare the page state against the task's success criteria. Never claim success from `final_result` text alone. If the screenshot shows a mismatch, an error page, a paywall, a consent dialog, or an incomplete flow, send a revised task that names exactly what is wrong and what to do next.
4. **Iterate with revised instructions.** Keep each run small (a few steps) and iterate: run → screenshot → analyze → revised task. Stop when the screenshot confirms the success criteria, and report what the final screenshot shows.
5. **Cancel wayward runs.** If a run is clearly pursuing the wrong goal, call `browser_use` action `stop` before issuing corrections.
6. **Interim evidence.** Use `browser_use` action `screenshot` for an on-demand capture of the current tab between runs when you need fresh visual state.
7. **Credentials stay out of task text.** Never include passwords, API keys, or tokens in the `task` argument. The integrated Chrome keeps a persistent profile; ask the user to log in manually when a site requires authentication.
8. **Report infrastructure failures, never route around them.** If the tool reports a setup, Chrome connection, or API-key failure, surface the error message. Do not fall back to non-browser tooling for a browser task; a fallback silently breaks the browser-mode rule.
9. **Step budget.** `max_steps` is capped by configuration; a task that needs more steps must be split into several supervised runs.

## Typical flow

- `browser_use` action `run` with the first concrete task (for example: open the pull requests page of a repository and report open PR titles).
- Read the returned `screenshot_path`.
- Compare against success criteria; on mismatch, `run` a revised task naming the observed problem.
- On success, report the result and cite the final screenshot.
- Use `stop` for a wrong-headed run and `screenshot` for a fresh capture of the current state.
