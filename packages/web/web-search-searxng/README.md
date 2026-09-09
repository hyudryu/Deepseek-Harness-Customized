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

The `web-search-searxng` settings section overrides composition values for the next search without restarting the application. `enabled` defaults to false, `baseURL` to `http://127.0.0.1:8080`, and `timeoutMs` to 30000. The endpoint must use HTTP or HTTPS without embedded credentials, query, or fragment. A path prefix is retained when appending `/search`. The timeout must be an integer from 1 through 2147483647 milliseconds.

Configure the SearXNG server to include `json` in `search.formats` in its `settings.yml`; otherwise JSON search commonly returns HTTP 403. The adapter sends `GET /search?q=...&format=json` as described in the [SearXNG search API](https://docs.searxng.org/dev/search_api.html). The configured instance receives the query.

## Understand the implementation

The provider validates the JSON results array, deduplicates URLs, and maps `title`, `content`, and `publishedDate` to portable source fields. Only HTTP(S) source URLs are emitted. The web service caps sources to the consumer's requested limit. Redirects are rejected; HTTP and malformed response failures use `WEB_PROVIDER_ERROR`, caller cancellation uses `WEB_ABORTED`, and the request deadline uses `WEB_TIMEOUT`.

When enabled and `web_search` is visible in the assembly scope, the provider contributes prompt guidance about SearXNG selection, searches without an API key, snippets and citations, and the difference between disabling the provider and a failed request. The ordinary tool keeps its configured query limit. Disabled providers and unavailable tool scopes contribute no guidance; the normal request header records the assembled instruction.

Registration and settings use context effects and are removed when the plugin unloads. No `./invariant` entry is needed: the adapter owns no independent persisted or derived state whose observations can diverge.

## Further Exploration

- [Web service](../web/README.md) owns provider selection and result limits.
- [Web tool](../tool-web/README.md) owns model-visible rendering and logging.

## Model Experience

Indirectly, through an available `web_search` tool: enabled SearXNG contributes selection and citation guidance, while the tool renders sources and errors; both consume context tokens without an auxiliary model request or an additional tool schema.

#### KV Cache effect

Enabling or disabling SearXNG changes the assembled prompt for scopes exposing `web_search`, which changes that request prefix. Search results enter the existing tool-result history.

## Known Limitations and Deferred Work

- A reachable SearXNG server with JSON output enabled must already exist. This package does not deploy SearXNG, bypass rate limits, or configure its engines.
- Instance authentication, engine selection, pagination, and advanced search filters are not exposed.

### Dev Note

<details>
<summary>Maintainer context</summary>

Instance deployment remains separate from installing the Harness provider. Any future authentication support must preserve redirect rejection and keep credentials out of search results.

</details>
