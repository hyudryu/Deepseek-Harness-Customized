---
description: "Browse saved Harness sessions and control live conversations through a local MCP endpoint."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-mcp

## Summary

Connect an external MCP client to inspect Harness projects, saved conversations, transcripts, and live status. Find sessions by project directory or title, then read their events without resuming an agent. Queue or steer a message and request cancellation when the target agent is already active in the same process. Every shipped profile includes the endpoint; standalone profiles use port `3080`, and Web shares the UI's HTTP port.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Point an MCP client that supports Streamable HTTP at `http://127.0.0.1:3080/MCP`. The path is case-sensitive. With the Web profile, a CLI `--port` override changes the UI and MCP port together. Shipped standalone profiles take their port from `DSH_SESSION_MCP_PORT` when set, or use `3080`; a profile patch can replace that configuration.

### Configuration

The shipped profile already mounts the `session-mcp` row. Change its configuration through a profile patch; do not mount a second copy. A custom composition mounts the plugin as a `cordis.yml` entry:

```yaml
- id: session-mcp
  name: '@deepseek-ai/dsh-session-mcp'
  config:
    transport: standalone
    port: 3080
    path: /MCP
```

A custom composition selecting `transport: web-server` must add `inject: [webServer]` to the `session-mcp` entry so the listener is available before the plugin starts. The shipped Web entry already declares this dependency.

| Field | Default | Meaning |
|---|---|---|
| `transport` | `standalone` | Own a listener or use `web-server` to share the Web server |
| `host` | `127.0.0.1` | Standalone loopback address; `::1` selects IPv6 loopback |
| `port` | `3080` | Standalone listener port; Web uses its server's port |
| `path` | `/MCP` | Exact endpoint path |
| `maxPageSize` | `100` | Maximum items or events requested per page |
| `maxResponseBytes` | `65536` | Maximum complete tool response, including protocol wrappers |
| `maxRequestBytes` | `65536` | Maximum incoming request body |
| `requestTimeoutMs` | `30000` | Maximum time allowed for a request |
| `maxConcurrentRequests` | `32` | Maximum simultaneous requests |
| `allowControl` | `true` | Permit live-session message and cancellation tools |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-session-mcp) lists every accepted field and validation limit.

The endpoint accepts loopback connections. Keep it local: it exposes saved conversation content and, when controls are enabled, can submit work with the running Harness agent's permissions. A conflicting standalone port fails startup; configure a distinct port for each simultaneous process.

### Discover and read conversations

Use `list_projects` to obtain project directories, then `list_sessions` with an optional `projectDirectory` or `query`. Lists return `items`, `total`, and `nextOffset`; pass `nextOffset` as the next request's `offset` until it is `null`. Project directories identify the recorded working directory, not a folder the MCP server creates or opens.

A null title denotes no recorded title unless `titleUnavailable: true` signals that the title could not be read. Session IDs remain the precise lookup key.

Call `get_session` with exactly one of `sessionId` or `title`, optionally narrowed by `projectDirectory`. A title must match exactly; duplicate titles return candidates so the client can choose a session ID. The result contains recorded events, `capturedThroughSeq`, `nextAfterSeq`, and `hasMore`. Pass `nextAfterSeq` as `afterSeq` to continue; the initial `afterSeq` is `-1`. An event too large for the response is represented by an explicit truncated preview with its original byte count.

Status is `running` or `idle` only for an agent observed in this process. `not_active_here` means there is no local agent to control; it does not prove that another Harness process is idle. Reads preserve saved logs and never resume a session.

### Control a live conversation

`send_message` accepts `sessionId`, `text`, and optional `mode`: the default `queue` submits the next message, while `steer` uses the agent's steering behavior. Acceptance means the message entered that agent's input path; it does not mean the resulting work has finished. `stop_session` requests cancellation and preserves pending messages. Both tools reject saved-only sessions and subagent-owned sessions. Set `allowControl: false` to expose reads without permitting either operation.

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin combines an MCP HTTP transport with the existing persistence and live-agent services. Read handles expose durable events without publishing a live Session. The agent registry supplies process-local status and control ownership. The `ctx.sessionMcp` service exposes an endpoint getter for consumers that need the bound address. Transport disposal releases its route or owned listener and settles active requests.

| Source | Responsibility |
|---|---|
| [index.ts](src/index.ts) | Configuration, service lifecycle, and listener ownership |
| [http.ts](src/http.ts) | HTTP admission and request disposal |
| [mcp.ts](src/mcp.ts) | MCP tool schemas and bounded responses |
| [sessions.ts](src/sessions.ts) | Passive session reads and live-agent control |

No invariant companion is published because the package has no independently maintained projection to reconcile with its persistence or agent providers.

</details>

## Further Exploration

- [MCP package group](../README.md) — incoming session access and outgoing tool connections.
- [Sessions](../../../docs/subsystems/session.md) — recorded events and in-memory sessions.
- [Persistence](../../../docs/subsystems/persistence.md) — durable log providers and read handles.
- [Session MCP decision](../../../.agents/notes/implemented/feature/2026-09-07-session-mcp-endpoint.md) — passive reads and process-local control ownership.

## Model Experience

### External MCP client tools and results

#### What the model sees

An external MCP client can expose `list_projects`, `list_sessions`, and `get_session`, plus `send_message` and `stop_session` when controls are enabled. Results contain project directories, session identities and titles, status, and requested event pages. This plugin does not add tools or prompt text to the Harness agent's own request.

#### Token effect

An external client chooses how to place tool schemas and result pages in its model context. The plugin limits response bytes and page sizes; it does not control that client's retention or compaction.

#### KV Cache effect

External-client prefix reuse depends on that client's tool registration and history management. Passive reads leave the Harness agent's request history unchanged.

### Accepted live-session messages

#### What the model sees

An accepted `send_message` enters the target agent's ordinary input path with the caller's `text`. Queue and steering behavior determine when the agent incorporates the message. The ordinary session events record model-visible input.

#### Token effect

Submitted text adds input tokens when the target agent consumes it and remains subject to the session's normal compaction policy.

#### KV Cache effect

Consumed messages append to the target conversation. This plugin does not replace earlier prompt or tool definitions; subsequent compaction and provider cache availability remain outside its ownership.

## Known Limitations and Deferred Work

- **Process-local controls** — saved-only sessions and subagents cannot be controlled through this endpoint; another process's liveness is not inferred from storage.
- **Process lifetime** — the endpoint is available only while its selected profile is running; a one-shot headless task does not leave an MCP daemon behind.
- **Local access only** — the endpoint has no remote authentication or cross-host control protocol.
- **Bounded transcript pages** — oversized individual events return explicit previews, so a page is not always a lossless export of every event payload.
- **Tools only** — MCP Resources and Prompts are not exposed.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
