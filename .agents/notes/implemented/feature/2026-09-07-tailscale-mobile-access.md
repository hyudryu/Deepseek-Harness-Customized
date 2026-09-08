# Agent Note: Desktop-controlled Tailscale mobile access

Status: implemented

English | [中文](2026-09-07-tailscale-mobile-access.zh.md)

## Problem

A loopback-only Web application cannot accept a phone connection. Binding the entire application to every interface exposes it beyond the intended tailnet, while a separate mobile installation separates the user's sessions and settings. Pairing also needs to preserve the existing application's browser authentication.

## Decision

[The host plugin](../../../../packages/host/mobile-access/README.md) owns a second listener on a discovered, locally assigned Tailscale IPv4 address at the desktop port. It shares the existing Web dispatchers and browser-authentication owner. URL canonicalization keeps the advertised authority consistent with browser Host and Origin headers, including the implicit HTTP port 80. The listener applies its exact Host and Origin policy before every route, and its authority grant applies only to requests received on that interface. The root launch-token exchange establishes an authority-bound browser cookie; assets, API requests, and upgrades require authentication.

[The client plugin](../../../../packages/client/ui-mobile-access/README.md) contributes a phone icon beside Settings on the loopback desktop origin. Its switch reflects acknowledged host state. QR encoding stays in the browser and encodes the existing authenticated launch URL rather than publishing it through an external service. The phone opens the same application and durable data.

Access starts off with each process. Activation and deactivation are serialized. Disabling or unloading the plugin revokes interface trust and waits for the additional listener's HTTP and upgraded sockets to close. Desktop requests retain their independent listener.

The mobile frame gives conversation content the full width and opens sidebar navigation as an overlay from an upper-left menu. Session selection closes that overlay through the layout's idempotent close action. Touch does not activate hover previews or replace row content on hover, so the first tap reaches the Session action. Desktop mouse hover remains available, and browser zoom stays enabled.

## Alternatives considered

**Bind every interface.** A wildcard listener also accepts LAN traffic and cannot make the mobile switch revoke only Tailscale access without disrupting the desktop.

**Run a separate mobile application or reverse proxy.** A second application creates another session and configuration lifetime. A proxy adds a second HTTP and upgrade path whose authority rewriting must remain consistent with authentication. Sharing the existing dispatchers keeps the same route owners and authenticated application.

**Persist enabled access.** Automatic re-exposure after every restart makes launching the desktop app a network-access decision. Process-local off defaults require an explicit desktop action.

**Keep the desktop rail and hover interactions on phones.** A permanent rail consumes scarce conversation width. Hover-triggered content changes can cause touch browsers to reveal hover state before dispatching a click, requiring another tap. The mobile overlay and stable touch rows preserve one-tap navigation without removing desktop affordances.

## Consequences

Phones need Tailscale connectivity and a tailnet policy permitting the application port. Pairing grants the existing application's access, not a restricted mobile role. HTTP uses Tailscale's encrypted transport but does not satisfy every browser secure-context requirement. The feature does not configure Tailscale, certificates, public access, or network policies.

Real Loader composition tests cover disabled state, authentication, authority and Origin rejection, protected API and assets, upgraded socket closure, activation failure, repeated toggles, queued teardown, and desktop continuity. Discovery tests cover named interfaces, official CLI results, local assignment, and platform executable defaults. Browser verification remains necessary for navigation, responsive layout, and QR pairing; HTTP success alone does not establish a working client.
