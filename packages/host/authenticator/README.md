---
description: "Local authenticator account storage, authenticated administration, and TOTP tools for sessions and MCP clients."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-authenticator

English | [中文](README.zh.md)

## Summary

Reference for local six-digit TOTP accounts. The plugin mounts in the Web profile and supplies the account operations used by the Authenticator MCP card under Settings → Plugins → Plugin configuration.

## Table of Contents

- [Configuration and storage](#configuration-and-storage)
- [Authenticated operations](#authenticated-operations)
- [Runtime invariants](#runtime-invariants)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="configuration-and-storage"></a>
## Configuration and storage

`path` selects a dedicated account document. When omitted, storage is `<dshHome>/authenticator/accounts.json`; `dshHome` follows `DSH_HOME` and `~/.dsh` defaults. The directory is private to the current Windows account through an explicit ACL, or created with mode 0700 on POSIX. Atomic file replacements use mode 0600, and mutations acquire a cross-process writer lock. Invalid existing data fails without replacement. Provisioning secrets remain in this local file; neither settings documents nor API responses contain them.

Imports accept standard `otpauth://totp/` URIs with six digits, SHA1/SHA256/SHA512 and a positive period of at most 3600 seconds. Duplicate secrets or issuer/label pairs are rejected. Deletion removes the account from the committed document; it does not promise forensic erasure from backups or filesystem history.

`maxAccounts` (100 by default) bounds every account list; `maxMetadataBytes` (256 by default) bounds each label and issuer in UTF-8 bytes. Both must be positive safe integers. Imports enforce these limits under the writer lock, and reads reject oversized existing documents without overwriting or truncating them. The combined count and metadata limits bound complete native-tool, MCP and Settings account projections, including JSON escaping and fixed metadata. Raise the configured limits to access an existing larger store.

<a id="authenticated-operations"></a>
## Authenticated operations

The existing Connection cookie and origin checks protect every route. `GET /authenticator` returns account ids, labels, issuers, periods, current codes and `validUntil` in Unix milliseconds. `POST /authenticator/import` accepts `{uri}` and returns account metadata. `POST /authenticator/delete` accepts `{id}` and returns `{removed}`. Responses disable caching. Provisioning input is never reflected in diagnostics.

`POST /authenticator/mcp` implements stateless MCP Streamable HTTP through the official SDK. A client must supply the application's authenticated cookie and an accepted origin/authority; the endpoint does not offer a separate bearer token or public server. It exposes account discovery and code retrieval using the same store as Settings. Account import and deletion remain administrative UI operations.

<a id="runtime-invariants"></a>
## Runtime invariants

No invariant companion is published: account projections and codes are computed directly from the durable document, with no independent cache whose facts can diverge.

<a id="model-experience"></a>
## Model Experience

### Session tools when the authenticator plugin is composed

#### What the model sees

`authenticator_list_accounts` discovers account ids and labels without provisioning secrets. `authenticator_get_code` returns one current six-digit code and its expiration. Codes requested by a session become ordinary tool results in that session's log and model context. Every composed session may request every imported account; importing an account grants that access.

#### Token effect

Two tool definitions add a fixed prompt cost. Account discovery grows within the configured account and metadata limits; code retrieval returns one account. The plugin adds no system prompt section and performs no background model requests.

#### KV Cache effect

Tool definitions remain stable across account changes. Requested codes enter tool-result history; changing codes do not mutate previous messages or prompt prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- HOTP, non-six-digit tokens and multi-account migration exports are unsupported. Local clock accuracy determines code validity.
- Storage is permission-protected plaintext, not encryption; processes running as the same OS user can read it.
- External MCP clients must arrange the existing browser cookie authentication. Per-session account grants and an independent MCP authentication flow are not implemented.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Storage and authentication decisions are recorded in the [local authenticator Agent Note](../../../.agents/notes/implemented/architecture/2026-09-07-local-authenticator-mcp.md).

</details>
