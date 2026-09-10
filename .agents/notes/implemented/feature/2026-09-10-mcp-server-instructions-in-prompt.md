# Agent Note: MCP server instructions reach the system prompt

Status: implemented

## Problem

The [MCP client bridge](2026-07-07-mcp-client-plugin.md) bridged tools only. The `initialize` handshake also carries an optional free-form `instructions` string — the server's own statement of how and when to use it — and the bridge discarded it.

That field is where a server puts the guidance a model needs *before* its first tool call. CodeGraph ships a long block telling the model to reach for its single `codegraph_explore` tool instead of running a grep-then-read loop; other servers document ordering constraints, anti-patterns, and which of their tools to prefer. Discarding it costs the deployment the one piece of prompt text the server's own author is best placed to write, and leaves the model inferring usage from tool descriptions alone.

The observed symptom: a server whose entire value proposition is "use me instead of grepping" connected successfully, registered its tool under the expected public name, answered calls correctly, and the model still grepped — because nothing in the request ever said otherwise.

## Decision

`packages/mcp/mcp-client` publishes the connected server's advertised instructions as one system-prompt section per plugin instance.

**Capture.** After a successful `connect()`, the supervisor reads `generation.getInstructions()` and holds the text as connection state beside the live client. Instructions belong to the generation: they are assigned on a successful connect, and cleared by `generationDown()` (connection lost), by the budget-exhaustion path that unregisters the tools, and by disposal. A re-sync failure leaves them in place, because the generation is still connected.

**Publication.** `apply()` registers one section named `mcp:<serverName>` at the centrally allocated `MCP_SERVER_INSTRUCTIONS` placement, with `text: () => connection.instructions() ?? ''`. Reading through a function at assembly time is what keeps the section identity stable: a reconnect that changes the text, or drops it, is reflected in the next assembled request without disposing and re-registering a section. `renderPrompt` already drops empty sections, so a server that advertises nothing contributes no text.

**Requirement.** `inject` gains `systemPrompt`, matching `tool-fs` and `tool-fs-search`, which publish per-tool guidance through the same registry. `@deepseek-ai/dsh-system-prompt` joins the package's peer and dev dependencies and its tsconfig references.

The text renders into `header.system`, which `request/header` already records, so the model-visible/log-reconstructable invariant holds without a new session event.

## Alternatives considered

**A config-supplied guidance string on the plugin row.** Rejected: it duplicates guidance the server already ships, goes stale independently of the server, and makes the operator the maintainer of text the server author owns. The `instructions` field is the designed channel for exactly this.

**Fold instructions into each tool's description.** Rejected: the text is per-server, not per-tool. Repeating it on every definition multiplies its token cost, and some instructions constrain the choice *among* the server's tools, which a single tool's description cannot express.

**Register and dispose a section per connection generation.** Rejected: it churns one section identity across reconnects, and a section name is unique within a scope, so each swap would have to be ordered strictly against `assemble()` rather than read lazily.

**Publish the instructions as a synthetic tool.** Rejected: a tool the model must call to learn which tools to call adds a round-trip and a schema to every request, and competes for attention with the real tools.

## Consequences

- A server teaches the model how to use it before the first tool call, and keeps that guidance current across its own upgrades with no harness or configuration change.
- Every instruction-advertising server in the deployment adds one section to the request header. The content is the server's, so its size is the server's to bound; the bridge imposes no cap.
- Because the text is read at assembly time, a reconnect that delivers changed instructions invalidates provider prefix reuse from that section onward.
- `systemPrompt` is now a hard requirement of the plugin: a composition that mounts `dsh-mcp-client` without the prompt registry fails to load rather than silently dropping the text.
- Servers that advertise no instructions are unaffected — the section resolves to empty and `renderPrompt` drops it.

## Testing

Unit (`tests/apply.spec.ts`, mocked SDK): the advertised text reaches the assembled prompt under the server-namespaced section; a server advertising none resolves that section to empty text and contributes nothing to the rendered prompt; disposing the plugin removes the section, proving effect ownership. E2E (`tests/mcp-client.e2e.ts`, keyless): the stdio fixture server advertises instructions declared in `tests/fixture-manifest.ts`, and the real handshake proves the text reaches the assembled prompt. The value lives in its own module because importing `fixture-server.ts` would start the server. The `inject` expectation in `tests/load-path.spec.ts` and the harness `inject` lists in `tests/reconnect.spec.ts` are updated to the new requirement.

Snapshot: deliberately none, matching the [auto-reconnect note](2026-08-06-mcp-client-auto-reconnect.md)'s rationale. The change adds no new presentation shape — the text renders into `header.system`, which request-header snapshots already pin structurally — and a snapshot composition would have to spawn a server that advertises instructions, making replays depend on a child process.
