# Agent Note: Project-level system prompt override

Status: implemented

## Problem

The assembled system prompt is a property of the whole process. `harness:identity` and the deployment persona are registered once by [`dsh-system-prompt`](../../../../packages/core/system-prompt/README.md), tool guidance is registered per tool plugin, and every session in the deployment therefore reads the same prompt. The [prompt-ownership decision](../architecture/2026-07-05-prompt-variables-and-tool-guidance-ownership.md) made that single-owner rule deliberate, but it also means one repository cannot carry its own agent instructions without editing the profile for every other repository sharing the process.

The nearest existing controls are all per something else. The deployment persona is config, so it is process-wide. An agent preset's scoped `deployment:persona` is per session. Agent-scoped prompt sections are per agent. None of them is keyed by the project directory a session runs in, which is the unit a repository actually owns.

The practical symptom: an operator working across a harness checkout, a product repository, and a scratch directory gets one set of instructions aimed at the average of the three, and the only lever that changes it changes it for all of them at once.

## Decision

A new standalone custom plugin, [`dsh-project-system-prompt`](../../../../Custom%20Plugins/project-system-prompt/README.md), publishes a project directory's saved text as that project's complete system prompt.

**Storage.** The override is the plain-text file `<project>/.dsh/system-prompt.md`. Keeping it in the project makes it committable, reviewable, and diffable beside the code it applies to, and mirrors the per-project file convention the project-secrets plugin already established. `promptFile`, `maxBytes`, and `root` are validated config fields; clearing the editor deletes the file rather than leaving an empty one, so "no override" has exactly one durable representation.

**Mechanism.** The plugin registers one listener on the `system-prompt/assemble` waterfall, from its own unscoped plugin context. `dsh-scope` admits an untagged listener to every assembly ([routing rule](../../../../packages/core/scope/src/index.ts)), so one registration covers every agent scope, and the assembly context's typed `agent` field names the agent. The listener resolves `context.agent.session.header.cwd`, reads that project's file, and returns the assembly with `sections` replaced by a single `project:system-prompt-override` section. The waterfall's return value is authoritative, which is what makes the replacement take effect on the next model step with no session restart and no change to the running agent.

Tool schemas, runtime contexts, and prompt variables still assemble normally: only the section list that renders the request's `system` field is replaced, so the model's offered tool set is unchanged. Because the rendered prompt is written to `request/header`, the override is reconstructable from the session log exactly like the default prompt and needs no new session event.

**Reading.** The file is read through an mtime/size stamp, so an unchanged file is not re-read on every model step, and an external edit is observed on the next step, which emits a `request/header` change exactly as any other prompt change does.

**Presentation.** A **System prompt override…** item on each project row's 3-dots menu — the `sidebar.workspaces.actions` slot — opens an editor hosted in `sidebar.footer.action`. The editor reads and writes `GET`/`PUT /project-system-prompt/<workspaceId>` over the plugin's own prefix route. **Restore DeepSeek default** fills the field from the same route's `defaultText`, which is `renderPrompt(await ctx.systemPrompt.assemble())`: assembling with no scope keeps the plugin's own listener inert, so that is the prompt the deployment would otherwise send, with `{{model}}`, `{{provider}}`, and `{{cwd}}` already interpolated.

**Packaging.** The plugin is a standalone project with its own committed lockfile and declares `@deepseek-ai/dsh-system-prompt` as a `link:` dependency, so [the custom-plugin installer](../../../../scripts/install-custom-plugins.mjs) resolves its runtime import under `--ignore-workspace` and proves it by importing the entry in a fresh process ([rationale](2026-09-07-standalone-custom-plugin-install.md)).

## Alternatives considered

**Register a scoped `complete: true` prompt section on each agent's scope.** Rejected: `complete` is a registration-time property, so the plugin would have to hook agent creation, decide the override's existence before the agent ran, and re-register to pick up an edit. An override added or changed mid-session would not reach the running agent — the exact interaction the feature exists to support.

**Register one global `complete: true` section whose text reads the project at assembly time.** Rejected: `complete` is not conditional on its text. A global complete section is the sole section for *every* scope, so a project with no override would render an empty prompt rather than the deployment's.

**Shadow `deployment:persona` in a per-project scope.** Rejected: it does not replace the whole prompt (tool guidance and identity survive), and registration is still not conditional on the project, so it collapses into the same agent-creation hook the previous alternative needs.

**Keep overrides in `$DSH_HOME` keyed by project path.** Rejected: the text is a property of the repository and belongs in it, where it can be reviewed with the change that needs it, and where a clone carries it.

**Re-implement `renderPrompt` locally to keep the plugin dependency-free.** Rejected: the baseline the Restore button offers must be byte-identical to what the harness would send, and a second copy of the strict `{{variable}}` interpolator is a divergence waiting to happen on a model-visible string.

**Append the override instead of replacing the prompt.** Rejected by the requested behavior: the editor is presented as "override", the field is offered pre-filled with the default, and an appended section would leave the operator unable to remove shipped guidance they do not want.

## Consequences

- A repository can own its agent instructions. The prompt changes on the next step, is recorded in `request/header`, and shows up in the Chat transcript's system-prompt row.
- An override replaces the *whole* prompt, so it also drops the deployment persona and the per-tool guidance sections. This is the requested semantics and the reason the Restore button exists; the plugin's README states it as the first limitation.
- A composition that registers a `complete: true` section — a `minimal` agent preset, for instance — is restored after the waterfall and therefore still wins over an override. No shipped web-profile composition does this, but the ordering is the registry's, not the plugin's, and the limitation is recorded rather than worked around.
- The override is keyed by directory, not by workspace record: two workspaces pointing at one directory share it, and a session started in a subdirectory reads that subdirectory's file.
- Compaction is unaffected. Compaction replaces a span of the message surface (`user/message`, `assistant/message`, `tool/result`); the system prompt is re-assembled every step and is not part of that surface, so `/compact` leaves the override in force.
- Every assembly in the process now evaluates one `stat` per session step once a project could have an override. The mtime/size cache bounds this to one read per actual change.
- An unreadable or oversized override file throws during assembly, which ends that turn loudly rather than silently sending a different prompt than the log claims.

## Testing

`Custom Plugins/project-system-prompt/test/project-system-prompt.test.mjs` runs 28 keyless `node:test` cases. Path resolution, the byte bound, and project resolution are covered directly. The assembly listener is covered twice: against a context double for the replacement, whitespace, missing-file, edited-file, and deleted-file cases, and against the **real** `@deepseek-ai/dsh-system-prompt` service booted through a real Cordis context — which is what proves the mechanism this decision rests on, that an unscoped listener receives an agent-scoped assembly and that its return value is what `assemble()` produces. Every browser route is covered for its success and each rejection path, including a failed write reported as a message rather than a broken request, and one case pins that `defaultText` interpolates a `{{cwd}}` section.

No recorded-session snapshot is added. The plugin lives outside the workspace, so the repository's snapshot lane does not cover it, and the change adds no new presentation shape: the override renders into `header.system`, which request-header snapshots already pin structurally.
