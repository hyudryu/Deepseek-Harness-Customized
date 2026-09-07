---
description: "View token history, activity streaks, and model usage in the fifth Settings tab."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-usage

English | [中文](README.zh.md)

## Summary

Usage adds the fifth Settings tab in the standard composition. It shows total tokens, peak daily tokens, longest-session active time, and current and longest activity streaks. A calendar heatmap supports daily, weekly, and cumulative views; token trends and model shares use the selected seven- or thirty-day range.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin as a Loader entry in a composition serving the Web client. It has no configuration fields.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser plugin contributes a `settings.section` entry with order 40 and reads the [usage controller](../../api/usage-controller/README.md). Chart data is derived from UTC daily rows. Typed locale dictionaries own visible labels, and the existing Settings shell owns navigation.

**Runtime invariant:** No companion is published because charts and metrics derive from one query response without independently maintained accounting state.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as this package displays usage to users and registers no prompt, tool, or session event.

#### KV Cache effect

No direct effect; reading usage does not change model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Statistics describe retained local sessions and reported tokens. The page does not estimate billing costs or account-plan quotas. The heatmap covers 364 UTC dates ending today; weekly buckets group seven displayed dates, and cumulative values cover only that displayed period.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
