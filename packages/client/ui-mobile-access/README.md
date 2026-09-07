---
description: "Settings-adjacent phone controls and QR pairing for Tailscale mobile access."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mobile-access

English | [中文](README.zh.md)

## Summary

This plugin adds a phone icon to the right of Settings in the desktop sidebar. Its dialog displays a boolean mobile-access switch and, when enabled, a QR code and link to the authenticated Tailscale application URL.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The Web bundle mounts these controls with the [mobile access host plugin](../../host/mobile-access/README.md). Open the phone icon beside Settings from the loopback desktop application. Enable access, then scan the QR code using a phone connected to the same tailnet. The dialog also displays the Tailscale address and an authenticated link. Treat the QR code and link as application credentials.

The switch reflects the host's confirmed state, remains unavailable while an update is pending, and retains its last confirmed value if the update fails. Reopening the dialog refreshes the state. Closing the dialog does not disable access. The dialog explains that access starts off after an application restart.

Phones use the [mobile application layout](../ui-layout/README.md#use-this-package): the conversation fills the available width, and the upper-left menu opens session navigation when needed. Selecting a session returns directly to the conversation. Compact spacing and text leave browser zoom available for accessibility.

<a id="understand-the-implementation"></a>
## Understand the implementation

The plugin contributes to `sidebar.settings.action` only when the remote host reports a loopback browser origin. Requests use the existing same-origin browser session. QR encoding happens locally in the browser; no URL is sent to an external QR service. English and Chinese copy belongs to the `mobileAccess` locale namespace. The dialog fits narrow viewports and keeps its toggle and link available independently of QR rendering.

<a id="further-exploration"></a>
## Further Exploration

- [Mobile access decision](../../../.agents/notes/implemented/feature/2026-09-07-tailscale-mobile-access.md)
- [Sidebar](../ui-sidebar/README.md)

<a id="model-experience"></a>
## Model Experience

None, as the pairing dialog adds no model-visible content or tools.

#### KV Cache effect

None; pairing and listener state do not change model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The controls appear only on the local desktop origin. A phone can use the application but cannot enable or disable network access. QR generation failure leaves the authenticated link available; a host request failure requires reopening the dialog or retrying the switch. Network reachability and browser secure-context restrictions remain owned by the host deployment.


<a id="dev-note"></a>
### Dev Note

No runtime invariant companion is published: the locale and slot registrations are reversible contributions, and the host owns authoritative listener state. Component tests exercise confirmed state, request errors, QR errors, and dialog lifecycle.
