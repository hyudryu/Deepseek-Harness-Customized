---
description: "Connect external MCP tools to Harness agents, or expose saved sessions and live controls to external MCP clients."
kind: "package-group"
---

# MCP — Model Context Protocol

## Summary

The `mcp/` group connects Harness agents and external Model Context Protocol clients. Attach an external server to give a Harness agent additional tools, or connect an external assistant to the session endpoint to browse saved conversations and control live work. Every shipped profile includes the session endpoint; external tool servers remain opt-in. Package READMEs own configuration and protocol limits.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Choose the package for the direction of the connection.

| Package | What it provides |
|---|---|
| [`mcp-client/`](mcp-client/README.md) | Attach one external MCP server so the model can call its tools as native tools |
| [`session-mcp/`](session-mcp/README.md) | Expose project and session reads plus live-session controls to external MCP clients |

-----

<a id="related-documentation"></a>
## Related documentation

Try the worked example configurations to see the plugin in action, then read the Agent Notes for the behavior decisions behind it.

- [MCP client plugin Agent Note](../../.agents/notes/implemented/feature/2026-07-07-mcp-client-plugin.md) — the bridge's design: server-qualified naming, discovery, execution, and environment scrubbing.
- [MCP client auto-reconnect Agent Note](../../.agents/notes/implemented/feature/2026-08-06-mcp-client-auto-reconnect.md) — the reconnect policy, the per-outage attempt budget, and the opt-out.
- [Third-party memory MCP examples Agent Note](../../.agents/notes/implemented/feature/2026-07-31-third-party-memory-mcp-examples.md) — three default-off memory-server overlays delivered as reference configurations.
- [Third-party memory MCP guide](../../docs/user/guide/mcp-memory.md) — runnable overlay rows and setup instructions.
- [Tools subsystem reference](../../docs/subsystems/tools.md) — the `ToolRuntime` that receives the registered tools.
- [Sessions subsystem reference](../../docs/subsystems/session.md) — the recorded events exposed by session MCP.
- [Session MCP Agent Note](../../.agents/notes/implemented/feature/2026-09-07-session-mcp-endpoint.md) — passive history reads and process-local controls.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
