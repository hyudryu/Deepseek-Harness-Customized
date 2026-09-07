# Agent Note: Session MCP endpoint

Status: implemented

## Problem

External assistants need to find Harness conversations by project, title, or session ID and inspect their recorded work without starting an agent. They also need explicit controls for conversations already running in the Harness process. Opening history through an agent-resume path couples inspection to execution and can repair or append session events.

## Decision

The [session MCP plugin](../../../../packages/mcp/session-mcp/README.md) exposes saved session reads and live-session controls through MCP Tools. Every shipped profile mounts the plugin. Web serves the endpoint on the UI's HTTP server so a port override applies to both; other profiles own a standalone listener. The package owns protocol validation and result bounds while existing session persistence and live-agent services remain authoritative.

History reads open persistence in read mode and never resume an agent. Live status reports only the serving process's observation; a saved conversation outside its agent registry is `not_active_here`. Exact title lookup returns candidates when several conversations match. Pagination and explicit oversized-event previews let clients inspect long transcripts without receiving an unbounded response.

Control calls accept only live, top-level agents. Sending a message uses the agent's queue or steering behavior; stopping requests cancellation and preserves pending messages. Neither operation creates or resumes a saved conversation. Disabling control prevents execution even if a client calls a known control tool directly.

## Alternatives considered

**Resume a conversation to read it.** This creates live state and can change the durable log during crash recovery. A passive reader must preserve the recorded evidence.

**Use one standalone listener for every profile.** Web already owns the user's chosen HTTP port. Sharing that server keeps the UI and MCP endpoint under the same port selection and avoids two listeners competing for the default port.

**Treat saved sessions as remotely controllable.** A persisted record does not identify an agent owned by this process. Requiring a live registry entry prevents a control request from silently launching new work.

## Consequences

External clients can inspect historical work without changing its lifecycle. Clients distinguish unavailable local control from an idle local agent, select an exact ID after title ambiguity, and follow pagination to retrieve longer histories. Simultaneous standalone processes need distinct configured ports. MCP Resources and Prompts are outside this plugin's operation set.

## Verification

The [recorded MCP protocol scenario](../../../../apps/web/tests/session-mcp-protocol.snapshot.ts) exercises the shipped Web composition's tool catalog, project discovery, title lookup, transcript pagination, and rejection of saved-session controls. Its committed session remains detached and its persisted events remain unchanged after those calls. [Package tests](../../../../packages/mcp/session-mcp/tests) cover the reader and transport operations independently.
