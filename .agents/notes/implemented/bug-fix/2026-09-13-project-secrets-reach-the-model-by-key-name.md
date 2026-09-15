# Agent Note: Project secrets reach the model by key name

Status: implemented

## Problem

The [project-secrets plugin](<../../../../Custom Plugins/project-secrets/index.js>) registered a `project_secrets` tool on every request and a `project-secrets` skill, but nothing ever told the model that the project keeps a block at all. The tool was pull-only and self-effacing: its description said what it reads, not when it is the answer, and the skill surfaced only as one line in a bucketed catalog.

The failure was observed directly. In a project whose block defines `Node 4: …`, the question "Do you know the SSH info of node 4?" produced a workspace grep, a glob, two directory listings, two file reads, and the answer "I don't have any SSH connection details for node 4 in this session" — followed by an unrelated answer assembled from `~/.ssh/config`. The session's own `request/header` shows `project_secrets` in the tool list. The block that held the answer was never read.

## Decision

The plugin contributes runtime context naming the block's keys, and nothing else about it.

- **Key names, never values.** `secretsKeys` takes the label before the first `=` or `:` on each non-empty line. Only those labels reach context, so the block stays out of the conversation and out of the durable session log — the constraint that rules out simply injecting the block.
- **Runtime context, not a pre-step injection.** `ctx.systemPrompt.context({ name, order, text })` is the seam for exactly this: `AssembleContext` carries the `agent`, so the text provider reads the right project's working directory, and the agent loop materializes the assembled contexts into one durable `snapshot`-form `user/message`. The loop's `RuntimeContextProjection` owns the publication rules the plugin would otherwise have to reimplement — it emits a message only when the text changed, and it tracks the retained snapshot against the surface so a compaction that dropped it makes the next assembly publish again.
- **Bounded.** At most 40 keys, each truncated at 60 characters, so a stray long line or a large free-form block cannot flood the prompt.
- **Failure is contained.** An unreadable, oversized, or invalid block contributes an empty string; a missing block and a session without a working directory do the same. The tool still reports the failure when the model asks for the values.
- **The descriptions answer the question the model is asked.** The tool and skill descriptions now name what the block holds — hostnames, SSH targets, usernames, passwords, tokens, connection details — and say to read it before reporting that such a value is unknown.

The contribution sits at context order 130, behind the shipped sandbox, approval, and delegation contributions (110-120).

## Alternatives considered

**Inject the whole block.** Maximum reliability and no reliance on the model choosing to call the tool. It also writes every credential into the durable session log and into every subsequent request, on a plugin whose entire purpose is to keep those values out of the transcript. Rejected.

**Push a message from an `agent/pre-step` listener.** The first implementation, and it looked equivalent to what the time-context plugin does. It is not: `agent/pre-step` receives only the messages claimed for that step, not the request history, so a "have I already said this" check against them never matches after the first step and the same snapshot is appended again on every step of every turn. `RuntimeContextProjection` already answers the question correctly, from the durable surface. Rejected once that was established, before the change shipped.

**A system-prompt section instead of runtime context.** `text` providers receive the same `agent`, so this works, and it would put the pointer in the cached request prefix rather than in a per-step snapshot. It loses the publication rules: a section is re-rendered into the prefix on every request with no notion of superseding an earlier one, and any change to the block invalidates the cached prefix rather than appending one superseding snapshot.

**Strengthen the tool description alone.** Cheap, and it removes the "what is this for" ambiguity, but it cannot make the model aware that *this* project has a block, and it cannot name `Node 4`. The observed run shows the model searching the workspace instead — a description does not redirect that.

**Rely on the skill.** The catalog is bucketed and shows a name and a single line. The model did not load it for an infrastructure question, and needing a round trip to learn that the answer is one call away makes the fix slower than the problem.

## Consequences

The block's key names are model-visible and therefore durable in the session log. That is deliberate and is the smallest disclosure that makes the tool discoverable; the values remain behind an explicit call.

The contribution reads the block synchronously during prompt assembly, because a context `text` provider is synchronous. The read is bounded by `maxBytes` and the file is one small project note, so it sits next to the request it belongs to rather than paying for a second asynchronous path.

The plugin is outside `packages/`, so it is outside the per-file coverage gate. Behavior is pinned by `node --test` cases under `Custom Plugins/project-secrets/test/`: label extraction and its bounds, no value reaching the context text, empty, missing, and oversized blocks contributing nothing, a changed block contributing different text, each project contributing its own block, and the registered tool and skill copy. The publication, supersession, and compaction rules are the agent loop's and are covered by `RuntimeContextProjection`'s own tests.
