# Agent Note: Session MCP endpoint

Status: implemented

## Problem

External assistants need to find Harness conversations by project, title, or session ID and inspect their recorded work without starting an agent. They also need explicit controls for conversations already running in the Harness process. Opening history through an agent-resume path couples inspection to execution and can repair or append session events.

## Decision

The [session MCP plugin](../../../../packages/mcp/session-mcp/README.md) exposes saved session reads and live-session controls through MCP Tools. Every shipped profile mounts the plugin. Web serves the endpoint on the UI's HTTP server so a port override applies to both; other profiles own a standalone listener. The package owns protocol validation and result bounds while existing session persistence and live-agent services remain authoritative.

History reads open persistence in read mode and never resume an agent. Live status reports only the serving process's observation; a saved conversation outside its agent registry is `not_active_here`. Exact title lookup returns candidates when several conversations match. Pagination and explicit oversized-event previews let clients inspect long transcripts without receiving an unbounded response.

Control calls require membership in the agent registry's runtime root set and reject durably classified subagents; an extension-owned child remains ineligible when its durable origin is unset. Sending a message uses the agent's queue or steering behavior and records the distinct `session-mcp` source, which grants no direct-human goal authority. The released Session reader already accepts merge-extensible source kinds, so these messages remain readable without changing a frozen migration. Stopping requests cancellation and preserves pending messages. Neither operation creates or resumes a saved conversation. Disabling control prevents execution even if a client calls a known control tool directly.

The SDK server announces child lineage before forwarding the child's first event, including events appended by creation listeners registered before the server. Waiting for the MCP listener can change plugin registration order; lineage must already be visible when either SDK filters a child's initial events. [SDK server regressions](../../../../packages/sdk/server/tests/server.spec.ts) cover creation-time events and nested descendants without changing the recorded SDK outputs.

## Alternatives considered

**Resume a conversation to read it.** This creates live state and can change the durable log during crash recovery. A passive reader must preserve the recorded evidence.

**Use one standalone listener for every profile.** Web already owns the user's chosen HTTP port. Sharing that server keeps the UI and MCP endpoint under the same port selection and avoids two listeners competing for the default port.

**Treat saved sessions as remotely controllable.** A persisted record does not identify an agent owned by this process. Requiring a live registry entry prevents a control request from silently launching new work.

## Consequences

External clients can inspect historical work without changing its lifecycle. Clients distinguish unavailable local control from an idle local agent, select an exact ID after title ambiguity, and follow pagination to retrieve longer histories. Simultaneous standalone processes need distinct configured ports. MCP Resources and Prompts are outside this plugin's operation set.

## Verification

The [recorded MCP protocol scenario](../../../../apps/web/tests/session-mcp-protocol.snapshot.ts) exercises the shipped Web composition's tool catalog, project discovery, title lookup, transcript pagination, and rejection of saved-session controls. Its committed session remains detached and its persisted events remain unchanged after those calls. [Package tests](../../../../packages/mcp/session-mcp/tests) cover the reader and transport operations independently.
