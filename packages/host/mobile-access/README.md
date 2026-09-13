---
description: "Authenticated Tailscale access to the Web application, controlled from the local desktop."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-mobile-access

English | [中文](README.zh.md)

## Summary

This plugin lets an authenticated desktop user enable mobile access through Tailscale. It serves the existing application on the computer's Tailscale IPv4 address at the desktop port, using the same sessions, settings, routes, and browser authentication.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The Web bundle composes this plugin with [mobile access controls](../../client/ui-mobile-access/README.md). Connect the computer and phone to the same tailnet with an access policy that permits the application port. Open the phone icon beside Settings on the desktop, enable access, and scan its QR code. The code contains an authenticated application URL; opening it establishes the phone's browser session.

Access is a durable setting. Enabling it stores the intent in the `mobile-access` user-settings namespace and starts the listener; the plugin restores the listener from that stored value at every later load, so access survives an application restart without the desktop dialog. Turning it off closes the Tailscale listener and its open HTTP and upgraded connections while preserving the desktop listener, and clears the stored value; closing the dialog leaves the listener's state unchanged. Without a mounted settings service the intent lives in the process only, and the listener starts at `enabled` from this plugin's composition entry. A stored `enabled` whose listener cannot start — Tailscale offline, a failed bind, a non-loopback desktop bind — keeps access off, reports the failure to the controls, and remains stored for the next load. No session is copied, reset, or migrated.

The desktop listener must bind to loopback. Discovery uses an active Tailscale-named interface or the official CLI's locally assigned IPv4 result. `tailscaleExecutable` configures that executable; `discoveryTimeoutMs` bounds CLI discovery. Missing Tailscale, an invalid local address, or a failed bind keeps access off and reports failure to the controls.

<a id="understand-the-implementation"></a>
## Understand the implementation

The desktop-only `/mobile-access` endpoint accepts authenticated GET state reads and POST boolean updates. A POST stores the requested state in the `mobile-access` settings namespace before it touches the listener, so a listener that started is always backed by a durable record; a rejected store answers 503 with `settings-unwritable` and leaves the listener unchanged, and a listener that cannot start answers 503 with `tailscale-unavailable` while keeping the stored value. Listener updates are serialized, and successful replies describe committed listener state. The additional listener shares the [Web server](../webserver/README.md) dispatcher. The advertised authority follows URL canonicalization, omitting the default HTTP port 80. It checks the exact Tailscale Host and same-origin browser headers before dispatch, and requires [browser authentication](../../client/connection/README.md) for assets, API calls, and upgrades; only the root token exchange precedes cookie authentication. Its authority grant applies only to requests received on that interface and is revoked on disable or plugin unload.

<a id="further-exploration"></a>
## Further Exploration

- [Mobile access decision](../../../.agents/notes/implemented/feature/2026-09-07-tailscale-mobile-access.md)
- [Web server subsystem](../../../docs/subsystems/web-server.md)

<a id="model-experience"></a>
## Model Experience

None, as this plugin exposes an existing browser application without adding model-visible content or tools.

#### KV Cache effect

None; listener state does not change model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Access uses IPv4 and HTTP within Tailscale's encrypted network. The plugin does not configure Tailscale, HTTPS certificates, public forwarding, or network access policies. The launch URL grants access to the existing application and does not create a restricted mobile account. Browser APIs requiring a secure context are subject to the browser's HTTP restrictions. A restored listener serves new URLs at the next load, but a previously paired phone keeps its own stored browser session and needs no re-pairing.


<a id="dev-note"></a>
### Dev Note

No runtime invariant companion is published: the listener's state and disposer share one owner rather than independent observations. Real Loader composition tests verify authentication, disable, failed activation, and disposal through HTTP and upgraded sockets.
