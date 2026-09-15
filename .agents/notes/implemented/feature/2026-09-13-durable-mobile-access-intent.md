# Agent Note: Durable mobile access intent

Status: implemented

## Problem

[The desktop-controlled Tailscale listener](../../../../packages/host/mobile-access/README.md) held its enabled state in process memory and started off on every launch. The desktop user therefore re-opened the pairing dialog, re-enabled access, and read a fresh launch URL at every restart — the same network-access decision made repeatedly with no way to record it. The original [mobile-access decision](2026-09-07-tailscale-mobile-access.md) chose that on purpose: automatic re-exposure after a restart makes launching the application itself an access decision, and a process-local off default requires an explicit desktop act.

That default is wrong for a desktop that is expected to stay reachable from its own tailnet. The user owns the machine, the endpoint is already loopback-only and authenticated, and the decision to expose the application is made once, not per launch.

## Decision

The plugin registers the `mobile-access` user-settings namespace with one field, `enabled: boolean`. `enabled` is durable intent, not listener state: it is what this deployment wants, and the listener is reconciled to it.

- **Composition supplies the base.** The plugin's own `enabled` config field (default `false`) is registered through `installSection` as the base layer, so a deployment that never touches the GUI keeps its composed value and a user document overrides it.
- **A toggle is stored before it is served.** `POST /mobile-access {enabled}` writes the namespace first and only then reconciles the listener, so a listener that came up is always backed by a durable record. A rejected store answers `503` with `settings-unwritable` and leaves the listener untouched.
- **The stored value is adopted at load.** `installSection` invokes the change hook once on install, which is the restore, and again after every commit — including an edit made directly in the settings document.
- **A failed restore is not a lost setting.** Tailscale offline, a failed bind, or a non-loopback desktop bind keeps access off, reports `tailscale-unavailable` to the caller, and leaves the stored value in place, so the next load retries.
- **Without a settings service nothing is lost either.** The last requested value lives in the process and the listener starts at the plugin's composition `enabled` — today's behavior, for a composition that mounts no settings provider.

The client copy follows: the pairing dialog now states that access stays on until it is turned off there, and no longer promises that a restart disables it.

## Alternatives considered

**Keep the process-local default.** The previously recorded decision, and the one this note reverses. Its rationale — that launching the application should not itself expose it — is real but underestimated how often the user restarts the desktop. A durable, explicitly written value keeps the exposure decision a decision: it is made once, by an authenticated desktop action, and is revocable from the same control that made it.

**A composition-only `enabled` config field.** Already supported as the base layer, but changing it means editing `cordis.yml` and restarting — the opposite of what "saved setting" asks for. It survives underneath the user document rather than replacing it.

**Browser-local storage in the client.** The listener has to exist before any browser can reach it, and the phone that benefits from it cannot be the one that starts it. Per-browser state would also make the same desktop report different settings in different browsers.

**A private file owned by the plugin.** Duplicates the settings capability's schema validation, redaction, revision, and provider handling for one boolean. The namespace is the capability that already exists for exactly this.

## Consequences

The application can now expose a tailnet listener at load with no desktop action. That is the point of the change, and it is bounded by everything that already protected the listener: the endpoint answers only loopback requests, requires the desktop browser session, and the stored value is written only through it. Turning access off clears the value, so the next load starts off.

The setting is per deployment (`$DSH_HOME/settings.yaml`), not per project or per session, which matches the listener's scope: there is one Tailscale listener for the one Web application.

Model experience and KV cache are unchanged; the plugin still adds no model-visible content.

Real Loader composition tests cover the restore at load without any desktop action, a stored setting whose listener cannot start (kept off, desktop unaffected, value retained), a desktop toggle written through to the settings document, and the next load restoring it. The pre-existing composition tests still cover the no-settings path, authentication, authority and Origin rejection, activation failure, repeated toggles, queued teardown, and desktop continuity.
