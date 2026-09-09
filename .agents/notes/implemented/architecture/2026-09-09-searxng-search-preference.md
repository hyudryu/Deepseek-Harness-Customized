# Agent Note: Prefer enabled SearXNG search in standard profiles

Status: implemented

## Problem

The standard profile pins DeepSeek search, which requires a provider credential. Users need an installable SearXNG provider and a persistent enable control in Plugin configuration that selects their instance even without a DeepSeek search key.

## Decision

The base bundle mounts the SearXNG provider disabled by default. Its settings section owns the enable flag, instance URL, and request timeout; the settings card commits changes through the existing settings service. Each search reads the committed settings.

The web service accepts an explicit ordered list of preferred search provider IDs before its existing configured fallback. The base bundle names SearXNG in that list and keeps DeepSeek as its fallback. Disabled preferred providers are skipped. Missing preferred registrations fail configuration resolution. Registration order does not select a provider, and failed SearXNG requests do not silently send the query to another service.

## Alternatives considered

**Mutate the web service from the provider.** This hides selection state and makes teardown dependent on plugin ordering.

**Teach DeepSeek search to call SearXNG.** That couples independent providers and prevents standalone SearXNG composition.

**Replace profile files whenever the switch changes.** The existing settings service already persists committed values and makes them available to providers without restarting the application.

## Consequences

The ordinary web_search tool and its logged result format remain the consumer. SearXNG uses its JSON HTTP search endpoint, forwards cancellation, limits request duration, rejects redirects, and validates remote results. It requires an operator-provided instance with JSON enabled; installing the harness provider does not provision a server. Local HTTP regressions and a keyless shipped-profile session exercise search without external credentials.
