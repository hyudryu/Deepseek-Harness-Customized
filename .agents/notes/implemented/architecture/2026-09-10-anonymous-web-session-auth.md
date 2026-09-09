# Agent Note: Anonymous-by-default browser-session authentication for the Web GUI

Status: implemented

## Problem

The Web Host runs tool-capable Sessions with the current operating-system user's authority. Its browser-session authentication required a process launch token in the startup URL, exchanged for an authority-bound signed cookie, before the GUI served the index or any Host API route. That gate made `dsh --profile web` reachable only by a caller holding the printed token, and the shipped command additionally refused `--host 0.0.0.0` for safety, so the GUI could only be reached on the loopback interface. Operators who run the harness inside a trusted tailnet (Tailscale, or a private LAN) could not expose the GUI to another computer or browser at `http://<ip>:<port>` without a login token, because no such posture existed.

## Decision

`dsh-client-connection` now accepts an anonymous posture as its default: `requireAuth` defaults to `false`, so the GUI serves any caller on the bound host by IP and port alone, with no launch token and no cookie. In anonymous mode `BrowserAuth` admits every index request (`authorizeIndex` returns true) and every browser session (`isAuthenticated` returns true), and `authenticatedUrl` returns the clean root URL without appending `?token=...`. The signing-secret grant record is not created, so no durable credential is written to `$DSH_HOME/.credentials.yaml`.

The shipped `dsh web` command accepts `--host 0.0.0.0` (all interfaces) so a LAN or Tailscale IP can reach it, and `resolveLanTrust` trusts and advertises a specific non-loopback bind such as a Tailscale address. The `/api` browser-trust fence keeps its Host/Origin checks: an untrusted Host still returns 403, independent of authentication.

Operators who need the previous token/cookie gate set `connection.requireAuth: true`. That restores the launch-token exchange, signed authority-bound cookie, and uniform 401 before RPC dispatch exactly as before.

## Verification

`BrowserAuth` unit coverage pins the anonymous path: no token in the authenticated URL, every session admitted, every index request served. Node-half, gateway, gateway-stream, mobile-access, authenticator, frontend-static, and remotes suite tests that assert the token exchange opt in with `requireAuth: true`. The web-app bundle tests pin the anonymous URL line (no `?token=`) and the now-accepted `0.0.0.0` bind plus the explicit non-loopback bind trust sampling. `gen-config-catalog` regenerates the `requireAuth` config field.

## Alternatives considered

**Keep the token gate and add an explicit `--allow-lan` opt-in flag.** This preserves the authenticated default and makes remote exposure an explicit operator choice. It was the recommended posture, but the operator selected always-open: the deployment lives on a private tailnet where proving reachability is the goal, so a token would only obstruct access without an operator needing the extra authentication.

**Delete the browser-session auth code entirely.** The token/cookie machinery still serves real deployments that expose the GUI over an untrusted network. Removing it would force a complete re-implementation to regain that posture; keeping it behind `requireAuth: true` retains both modes at one config surface.

**Trust every Host in anonymous mode.** The Host/Origin fence still defends DNS rebinding and cross-site browser requests in both modes, and an IP-literal bind is already synthesized into the fence for the tailnet address. Trusting every Host would discard that defense for no benefit to the anonymous tailnet use case.

## Consequences

The default `dsh --profile web` is now anonymous, so anyone who can reach the bound socket can drive the tool-capable GUI and run commands with the operating-system user's authority. `--host 0.0.0.0` exposes that to every reachable computer; pinning the bind to a trusted tailnet/LAN interface, or setting `connection.requireAuth: true`, is the owner's responsibility. The client-connection and web-app READMEs and the web-server subsystem page document the anonymous default and the exposed-posture limitation.

This decision partially supersedes the shipped [browser launch-token authentication](2026-08-24-browser-token-authentication.md): that note remains active authority for the token/cookie mechanism and its `requireAuth: true` posture, while the wait-state "requires one browser session" and "rejects `--host 0.0.0.0`" facts become conditional on the opt-in posture. The [browser-trust decision](2026-07-28-api-browser-trust-boundary.md) remains active for the Host/Origin fence.
