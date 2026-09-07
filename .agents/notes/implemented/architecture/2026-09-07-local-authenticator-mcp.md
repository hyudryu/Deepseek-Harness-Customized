# Agent Note: Local authenticator accounts and MCP tools

Status: implemented

English | [中文](2026-09-07-local-authenticator-mcp.zh.md)

## Problem

Sessions need current verification codes from user-imported authenticator accounts, and the Settings configuration card needs account import and deletion. Provisioning secrets must not become settings values or tool output.

## Decision

The [authenticator plugin](../../../../packages/host/authenticator/README.md) owns one local account document shared by Settings, native session tools and an authenticated MCP endpoint. QR images decode in the browser; only the standard TOTP URI crosses the existing authenticated application connection. Responses project account identity and current codes without provisioning secrets. Import and deletion are administrative operations, while native and MCP tools only discover accounts and request current codes.

## Rationale

Using the existing application cookie and origin checks keeps mobile access and desktop access under the same authentication mechanism. A separate unauthenticated MCP process would expose account codes outside that mechanism and introduce another launcher. The official MCP SDK implements stateless Streamable HTTP on the Web server; the maintained OTPAuth library parses standard provisioning URIs and generates TOTP values.

Secrets belong in a dedicated local document rather than the settings namespace, whose values are projected to configuration clients. Atomic replacements and cross-process writer locks prevent partial files and lost concurrent imports. Windows ACLs or POSIX owner-only modes restrict other OS accounts. This does not isolate agents running as the same user or encrypt storage.

## Alternatives considered

Storing provisioning secrets in the shared settings document would expose them through configuration projections. Launching a separate public MCP process would require a new authentication and application launch mechanism. Keeping one private account store behind the existing authenticated Web application avoids both costs.

## Consequences

Importing an account permits every composed session to request its current code. Returned codes become ordinary session tool results and may reach the configured model provider; provisioning secrets do not. Six-digit TOTP is the supported scope, so HOTP, migration exports and other digit lengths receive explicit errors.

Behavior verification covers RFC-derived codes with leading zeroes, restart persistence, concurrent imports, duplicate rejection, deletion, private projections, and malformed durable data preservation. Real Loader compositions exercise cookie and origin rejection, administrative routes, native tool handlers, and official MCP list/call responses. A model-facing snapshot records the two tool definitions; browser verification owns image upload and the expanded Settings card.
