---
description: "Keep a SuperGoal visible above the session transcript and see when it needs human input."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-super-goal

## Summary

Keep the current SuperGoal visible in a highlighted card above the session transcript. A smaller status line shows progress, a pause, a blocker, or completion. Blocked goals also display the reason that needs your decision. Saved or manually stopped active goals show resume guidance, including while an unrelated task is running.

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

The Web bundle mounts this plugin with the SuperGoal capability. Enter `/supergoal <objective>` in a session to display its objective. Use `/supergoal pause`, `/supergoal resume`, or `/supergoal clear` to control pursuit. When a hard blocker requires input, select an answer in the question composer; the sidebar shows a yellow waiting-for-answer indicator until the question settles.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals - click to expand</summary>

The browser plugin contributes to `conversation.session.banner` below the header. It reads the durable `superGoal` projection and the process-local SuperGoal activation flag through framework hooks. It owns no state store or RPC methods. No invariant companion is published: this presentation reads one authoritative projection and owns no independent runtime relationship to reconcile.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages explain the goal controls and the session surfaces that present them.

- [SuperGoal](../../goal/super-goal/README.md) - continuation and blocker decisions.
- [Conversation](../ui-conversation/README.md) - session banner and composer slots.
- [User questions](../ui-user-questions/README.md) - multiple-choice input.

-----

<a id="model-experience"></a>
## Model Experience

### Banner presentation

#### What the model sees

Nothing from this package: the banner reads the `superGoal` projection for humans. The SuperGoal host plugin owns continuation messages and blocker answers.

#### Token effect

Rendering the banner adds no model input or tool schemas.

#### KV Cache effect

The browser presentation leaves model request prefixes unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The banner presents the current objective with these constraints.

- Goal controls use the session command composer; the banner contains no action buttons.
- English copy is used in both supported locale seats.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers - click to expand</summary>

None.

</details>
