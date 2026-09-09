---
description: "The browser GUI for dsh: interactive chat, model and settings management, and session history, for users running the dsh web surface."
kind: "package-bundle"
---

# @deepseek-ai/dsh-web-app

English | [中文](README.zh.md)

## Summary

Run `dsh --profile web` and the interface opens in your default browser, ready for interactive chat with the agent. You get the conversation view, model and settings management, and session history, backed by the same model access, tools, and safety defaults as every other surface. By default the GUI is anonymous ("always open"): it serves any caller on the bound host by IP and port alone, with no login token. The startup URL line prints the clean root. You can change the port, suppress the browser handoff, allow extra hosts, and bind all network interfaces (`--host 0.0.0.0`) so a LAN or Tailscale IP can reach it. Choose it for interactive work in the browser; `dsh-headless` is the one-shot command-line sibling.

The [session MCP server](../../mcp/session-mcp/README.md) starts automatically at `/mcp` on the Web server's port (3080 by default). App help exits before the MCP listener starts.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Start the GUI, open your browser, and start talking to the agent. The flags fine-tune the invocation.

Session browser controls are optional. The `dsh-browser-control` bundle mounts its provider, Remote controller, and client controls together; the standard Web profile has no browser controls until that bundle is enabled. The optional bundle declares its controller and UI dependencies.

### Starting the Web GUI

```sh
dsh --profile web
dsh --profile web --no-open --port 8080
dsh --profile web --host 0.0.0.0   # serve every interface, reachable by a LAN or Tailscale IP
```

After startup you see a clean `dsh web:` URL line naming the root page (with a LAN/tailnet variant when an all-interface or IP bind is active). Unless `--no-open` or an SSH session suppresses it, the default browser opens that URL. The GUI is anonymous by default, so no token handoff is needed. You know it worked when the page loads and you can chat with the agent. Two failures to expect: if the frontend is not built, startup stops with a build hint (`pnpm run build` in a checkout); if the browser cannot be opened, a credential-free diagnostic prints to stderr while the server keeps running — open the printed startup URL yourself.

### Configuration

Most users never set these; the command-line flags feed the four settings below — `--host`, `--port`, and `--trusted-host` come from the invocation, and `--no-open` turns the browser handoff off for that invocation:

| Field | Default | Meaning |
|---|---|---|
| `openBrowser` | `true` | Open the default browser after startup; SSH launches suppress it |
| `printUrl` | `true` | Print the `dsh web:` URL line at startup |
| `surfaceContext` | `true` | Give the agent GUI-orientation context and expose `DSH_WEB_URL` to its shell commands |
| `trustedHosts` | `[]` | Extra hosts allowed to reach the GUI from the network |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-app) is the exhaustive source for every accepted field and its JSDoc.

### LAN access and trusted hosts

By default the GUI accepts connections from any caller on the bound host — it is anonymous and needs no token. A deployment that binds all network interfaces (`--host 0.0.0.0`) allows browsers from the LAN or tailnet, and the printed URL then includes a LAN address; binding a specific non-loopback IP (such as a Tailscale address) trusts and advertises that IP itself. `--trusted-host` adds extra hosts in either case. Host and Origin checks still control reachability (the DNS-rebinding fence), while authentication is off by default. The LAN addresses are sampled once at startup, so a network change later is not picked up — restart the GUI to re-advertise. Operators that need the previous token-session gate can enable it on the `connection` plugin (`requireAuth: true`).

### Running over SSH

When you launch `dsh --profile web` over SSH, the URL line still prints but the browser is not opened for you: the SSH client or editor owns the local forwarding address. Open the forwarded URL on your machine yourself; the printed URL names the remote host's loopback endpoint.

### Per-session agent setup

Each browser session composes its own agent from the shipped presets (the `standard` preset by default), instead of sharing one process-wide tool set. You can change the default preset or add your own presets under `$DSH_HOME/.agent-presets`.

The Web bundle enables [skill catalog buckets](../../skill/skill-catalog-buckets/README.md): agents discover brief categories, request a page of summaries with `skill_catalog`, and load full instructions with `skill`. Configure category keywords and page limits on the plugin row in the profile configuration. Skill providers keep their existing files; no cloud storage is required.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle is one patch plus one runtime glue plugin. The storage stack and projection cache come from `dsh-base`; the web overlay's workspace and message-feedback rows consume that shared `storageDomain` service. The patch restates the surface-specific values the base deliberately omits, inserts the web-only host rows and browser roster, then moves the agent plane behind presets. The glue plugin owns dist serving, trust sampling, prompt sections, the bash variable, and the readiness announcements.

### Patch semantics

A patch replaces the targeted row's whole `config`, so each web row restates every key it owns: the persona, the `DSH_TOOLS_MODE` PTC mode opt-in, and the `session-query-sqlite` values on the base rows, then `insert` adds the web host rows, transport, and browser roster. The per-agent tool rows the base mounts process-wide are disabled here and the preset roster takes over; the reasoning for each host-plane versus preset-plane decision is inline in the patch.

### Readiness

The URL line and browser handoff are readiness signals: supervisors RPC as soon as they observe the line, and a browser requests the page as soon as it opens, so both run only after the Loader tree settles and Connection authentication is available — or immediately in a hand-built tree without a Loader. A tree disposed mid-boot announces nothing.

### LAN trust sampling

`resolveLanTrust` samples the network once at boot: a loopback bind (`127.0.0.1`) derives no LAN addresses, an all-interfaces bind adds every non-internal IPv4 literal, and a specific non-loopback IP bind (a LAN or Tailscale address) trusts and advertises that IP itself. The derived literals plus the explicit `--trusted-host` authorities form the `/api` browser-trust fence, and the printed LAN URL always matches that fence.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The `web-app` glue plugin: dist resolution, LAN trust sampling, prompt sections, bash variable, URL line, browser handoff |
| [`src/startup.ts`](src/startup.ts) | The `web-startup` provider: `--host`, `--port`, `--trusted-host`, `--no-open`, `--help` |
| [`cordis.patch.yml`](cordis.patch.yml) | The web patch: restated base values, web host rows, browser roster, agent plane behind presets |
| — | No runtime invariant companion is published; every contribution (frontend-static child plugin, prompt section, bashEnv registration) is registry-disposed with the fiber, and each owning registry's package carries that relation's invariant; the package holds no mutable state of its own to audit. |
| [`tests/web-app.spec.ts`](tests/web-app.spec.ts) | Dist resolution, fallback seat, prompt sections, readiness |
| [`tests/startup.spec.ts`](tests/startup.spec.ts) | Command-line parsing over a real Loader tree |
| [`tests/trusted-hosts.spec.ts`](tests/trusted-hosts.spec.ts) | LAN-trust sampling |
| [`tests/browser-open.spec.ts`](tests/browser-open.spec.ts) | Default-browser handoff after the page is reachable |

### Invariant ownership

No invariant companion is published because every contribution — the frontend-static child plugin, the prompt sections, and the bash variable registration — is registry-disposed with the fiber, and each owning registry package carries that relation's invariant.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when you want to go deeper into the shared core, the browser reload pipeline, or the built frontend.

- [Bundle package map](../README.md) — the surfaces built on the same core.
- [dsh-base](../base/README.md) — the shared core the GUI runs on.
- [dsh-client-hmr](../../client/hmr/README.md) — how client-plugin changes reload during development.
- [frontend-static](../../host/frontend-static/README.md) — how the built frontend is served.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-app) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### Harness-source and Web-surface context

#### What the model sees

When `surfaceContext` is true, the `harness:source` section identifies the on-disk Harness implementation without claiming it is the working directory, and the `app:web-surface` global section (first-party order −800) orients the model to the GUI: the canonical local URL, the "this page" referent, the update contract (the reload receiver is always on; no-refresh reloads additionally need the `pnpm run dev:web` watcher), and the instruction not to start replacement servers. `DSH_WEB_URL` additionally appears in the managed bash environment with its description, resolved per invocation from the live server. When it is false, neither section nor the variable is registered.

#### Token effect

One source line and one prompt paragraph per session plus two managed-environment variable lines; constant per process.

#### KV Cache effect

The prompt section sits near the system prompt's head and is stable for the life of the process (the port is a boot fact), so it does not invalidate the cache across turns.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits tell you what to expect in unusual setups — a source checkout, SSH sessions, or strict networks. They are current package constraints, not a general browser comparison or a task backlog.

- **The frontend must be built** — a source checkout needs `pnpm run build` first; startup stops with a build hint when the dist is missing, and there is no source-serving fallback.
- **LAN addresses are sampled once at startup** — interface changes after boot are not re-advertised; the printed LAN URL always matches what was sampled.
- **Only the handoff start is observable** — the GUI reports that the browser was asked to open, not that it actually opened; a later browser exit is never reported, and the printed URL is your manual fallback.
- **SSH sessions keep the URL but skip the browser handoff** — the printed URL names the remote host's loopback endpoint; the SSH client or editor must expose and open the local forwarded address.
- **`BROWSER` overrides only come from the environment** — a discovered `.env` cannot set `BROWSER`; only an inherited value can choose the executable for the automatic handoff.
- **Anonymous by default means anyone on the bound host can act** — `--host 0.0.0.0` exposes the GUI (and its tool access) to every reachable computer without a login; pin the bind to a trusted tailnet/LAN interface, or set `connection.requireAuth: true`, when that is not acceptable.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
