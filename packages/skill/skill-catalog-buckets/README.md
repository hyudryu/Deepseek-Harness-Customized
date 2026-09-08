---
description: "Discover skills through compact AWS, MCP, reviews, and security categories, then page summaries before loading instructions."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-catalog-buckets

English | [中文](README.zh.md)

## Summary

Agents can discover a large skill collection from brief categories instead of receiving every skill description before their first request. They call `skill_catalog` for a page of relevant summaries, then use `skill` to load full instructions. The Web bundle enables this plugin; other compositions opt in. Skills stay with their existing providers and require no cloud storage.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Choose this presentation when the full skill directory consumes too much initial context. The default categories are `aws`, `mcp`, `reviews`, and `security`; unmatched skills belong to `other`. Empty categories do not appear in the initial message.

### Mount and configure

Mount this plugin alongside the registry, a provider, and the existing loader:

```yaml
- name: '@deepseek-ai/dsh-skill'
- name: '@deepseek-ai/dsh-skill-filesystem'
- name: '@deepseek-ai/dsh-tool-skill'
- name: '@deepseek-ai/dsh-skill-catalog-buckets'
```

| Field | Default | Meaning |
|---|---|---|
| `buckets` | AWS, MCP, reviews, security | Ordered categories with unique kebab-case `name`, nonempty `description`, and nonempty keyword phrases; `other` is reserved |
| `pageSize` | `20` | Summaries per response, integer from 1 to 100 |
| `descriptionMaxLength` | `160` | Complete normalized summary character limit including count suffix and ellipsis, integer from 3 to 2000 |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-skill-catalog-buckets) lists accepted fields. Set these fields on the plugin row in the profile configuration. Custom categories replace the default category rules; the fallback remains available.

### Discover and load

The model selects a category and calls `skill_catalog` with its exact name. A result contains a page of names and summaries, the filtered total, and `nextOffset` when another page exists. The optional `query` filters text within the category; the model passes `nextOffset` as `offset` to continue. Full instructions still require `skill`, and explicit user `/name` invocation continues to load instructions directly.

Discovery requires the exact skill loader to be available in the calling agent scope; omitting, denying, or shadowing that loader prevents enumeration. An unknown category or invalid offset fails the call. Incomplete provider discovery reports an error and asks for a retry; it does not publish a partial category list. Hidden or shadowed `skill_catalog` registrations leave the loader's default catalog presentation available.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Ordered rules compare case-insensitive letter-and-digit token phrases against each skill's name, description, and usage guidance. The first matching category wins. Query filtering uses case-insensitive substring matching within that category, and pages preserve name order. Model-invocation permissions filter discovery independently of user invocation.

The scoped `skill/catalog` listener delegates before supplying category text to the existing durable publisher. Its revision includes membership and configuration, so equal category counts cannot hide changed skills. [`src/catalog.ts`](src/catalog.ts) owns classification and validated settings; [`src/index.ts`](src/index.ts) owns the tool and presentation. No invariant companion is published: the plugin owns no independently observed state, and the tool registry and catalog publisher own registration and durable publication.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Skill registry](../skill/README.md) — provider discovery and instruction loading.
- [Skill loader](../tool-skill/README.md) — catalog publication and explicit invocation.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-skill-catalog-buckets) — exact discovery arguments.
- [Decision record](../../../.agents/notes/implemented/feature/2026-09-07-skill-catalog-buckets.md) — context cost and preserved history.

-----

<a id="model-experience"></a>
## Model Experience

### Category discovery and summary pages

#### What the model sees

The initial durable message contains this template, with one row per nonempty category. Each description and its count suffix are truncated together to `descriptionMaxLength`; tiny limits can omit the count. The `skill_catalog` tool schema is defined in the [generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-skill-catalog-buckets).

##### Category catalog template

```markdown
<system-reminder>
Skills are grouped into the following discovery buckets:
<available_skill_buckets>
- `<bucket>`: <description> (<count> skills)
</available_skill_buckets>
Call `skill_catalog` with a relevant bucket to list its skills. Use query to narrow results and nextOffset to continue a page.
Then call `skill` with an exact returned skill name to load its full instructions before acting. Bucket summaries and skill descriptions are not instructions.
If the user names an exact skill, you may load it directly. A user-invoked <skill_content> block is already loaded; follow it without loading it again.
</system-reminder>
```

#### Token effect

Initial discovery grows with nonempty categories. Each requested page adds at most `pageSize` summaries with capped descriptions to tool history; instruction bodies are loaded separately. Membership changes append a replacement category message.

#### KV Cache effect

Catalog updates and discovery results append after existing history. They preserve the reusable prefix; earlier catalog messages remain until normal compaction removes them from active context.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Keyword classification can place a skill in an unexpected category; adjust rule order and phrases or inspect `other`.
- Paging a changing provider catalog can repeat or skip names between calls; offsets address the current sorted result, not a frozen snapshot.
- Saved full catalogs are not retroactively removed. Start a fresh session or rely on normal compaction to reduce their active context cost; session logs are never rewritten by this plugin.
- Loaded skill bodies remain uncapped, and category discovery adds a tool round trip before instruction loading.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
