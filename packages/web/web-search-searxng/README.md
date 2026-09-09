---
description: "SearXNG JSON search with live enablement, endpoint settings, and no API key."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-searxng

## Summary

Search a user-selected SearXNG instance through the existing `web_search` tool. The provider needs no DeepSeek API key. The base bundle installs it disabled; Settings > Plugins > Plugin configuration contains its enable, endpoint, and timeout controls.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount the provider beside `dsh-web`. Set `preferredSearchProviders: [searxng]` on the web service to select enabled SearXNG before its normal search pin. Disabling SearXNG restores that pin. A failed SearXNG request returns its error without sending the query to another provider.

```yaml
- name: '@deepseek-ai/dsh-web'
  config:
    preferredSearchProviders: [searxng]
- name: '@deepseek-ai/dsh-web-search-searxng'
  config:
    enabled: true
    baseURL: http://127.0.0.1:8080
    timeoutMs: 30000
```

The `web-search-searxng` settings section overrides composition values for the next search without restarting the application. `enabled` defaults to false, `baseURL` to `http://127.0.0.1:8080`, `timeoutMs` to 30000, and `maxResponseBytes` to 1000000. The endpoint must use HTTP or HTTPS without embedded credentials, query, or fragment; surrounding whitespace and any trailing query or fragment marker are stripped so the accepted value always dispatches. A path prefix is retained when appending `/search`. The timeout and the response byte bound must each be an integer from 1 through 2147483647.

Configure the SearXNG server to include `json` in `search.formats` in its `settings.yml`; otherwise JSON search commonly returns HTTP 403. The adapter sends `GET /search?q=...&format=json` as described in the [SearXNG search API](https://docs.searxng.org/dev/search_api.html). The configured instance receives the query.

## Understand the implementation

The provider validates the JSON results array, canonicalizes and deduplicates URLs by their parsed `href`, and maps `title`, `content`, and `publishedDate` to portable source fields. Only HTTP(S) source URLs are emitted. The web service caps sources to the consumer's requested limit. The response body is read under the `maxResponseBytes` byte bound and refused when larger, so one search cannot buffer an unbounded payload into the model-facing result. Redirects are rejected; HTTP, oversized, and malformed response failures use `WEB_PROVIDER_ERROR`, caller cancellation uses `WEB_ABORTED`, and the request deadline uses `WEB_TIMEOUT`.

When enabled and `web_search` is visible in the assembly scope, the provider contributes prompt guidance about SearXNG selection, searches without an API key, snippets and citations, and the difference between disabling the provider and a failed request. The ordinary tool keeps its configured query limit. Disabled providers and unavailable tool scopes contribute no guidance; the normal request header records the assembled instruction.

Registration and settings use context effects and are removed when the plugin unloads. No `./invariant` entry is needed: the adapter owns no independent persisted or derived state whose observations can diverge.

## Further Exploration

- [Web service](../web/README.md) owns provider selection and result limits.
- [Web tool](../tool-web/README.md) owns model-visible rendering and logging.

## Model Experience

### SearXNG selection system prompt

#### What the model sees

When SearXNG is enabled and `web_search` is visible in the assembly scope, the `provider:web_search:searxng` section contributes the guidance below; a disabled provider or a scope without `web_search` contributes nothing, and the ordinary tool keeps its configured query limit.

##### Verbatim section text

```markdown
SearXNG is enabled for web_search. When selected by this profile, it searches the configured SearXNG instance without an API key and returns source URLs with snippets rather than a generated answer. Use the same queries array and query limit described by web_search, and cite relevant source URLs as Markdown links. A profile that prefers SearXNG selects it ahead of its configured fallback, such as DeepSeek search. Disabling SearXNG restores that fallback; a failed SearXNG request returns an error without automatically retrying through DeepSeek.
```

#### Token effect

The section contributes its fixed guidance tokens only while enabled and `web_search` is visible in the scope. Search-result sources and snippets enter history through the existing `web_search` tool-result host rather than an auxiliary model request.

#### KV Cache effect

Enabling or disabling SearXNG changes the assembled prompt for scopes exposing `web_search`, which changes that request prefix and invalidates the provider prefix cache from that point. Search results enter the existing tool-result history.

## Known Limitations and Deferred Work

- A reachable SearXNG server with JSON output enabled must already exist. This package does not deploy SearXNG, bypass rate limits, or configure its engines.
- Instance authentication, engine selection, pagination, and advanced search filters are not exposed.

### Dev Note

<details>
<summary>Maintainer context</summary>

Instance deployment remains separate from installing the Harness provider. Any future authentication support must preserve redirect rejection and keep credentials out of search results.

</details>
