---
description: "Import authenticator QR images and manage current TOTP codes in plugin configuration."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-authenticator

English | [中文](README.zh.md)

## Summary

The Authenticator MCP card in Settings → Plugins → Plugin configuration imports TOTP accounts from QR images, displays current six-digit codes, and deletes stored accounts after confirmation.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open the Authenticator MCP card, choose Import QR code, and select a PNG, JPEG, or WebP image up to 8 MB. The image is decoded in the browser; only the TOTP provisioning URI reaches the authenticated [authenticator host](../../host/authenticator/README.md). Each account displays its label, issuer, current code, and remaining validity. Delete requires confirmation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [client plugin](src/client/index.ts) contributes the keyed `authenticator` card to `settings.plugin.item`. Its slot injects account read, import, and deletion callbacks; the presentation component owns expansion, polling, and status messages without calling browser transport. The callbacks validate authenticated responses before the card displays them. Account reads run only while the card is expanded. The host owns account persistence and code generation; the browser retains no provisioning image or secret after import.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as this package presents account state and controls without adding content to model requests.

#### KV Cache effect

None; this package neither assembles nor sends provider requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Imports accept ordinary `otpauth://totp/` QR codes; HOTP and authenticator-specific bulk export formats are unsupported.
- Account operations require a connection to the running Harness server.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The host owns account data and code generation; this package displays authenticated responses.
