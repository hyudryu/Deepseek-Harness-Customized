# Agent Note: DeepSeek API peak rates are visible in the composer

Status: implemented

## Problem

The DeepSeek API prices two windows of the week at peak rates — 01:00–04:00 and 06:00–10:00 UTC, Monday through Friday — and everything else off-peak. Nothing in the harness reported that. A user deciding whether to send a long turn now or wait an hour had to leave the app for the provider's pricing page and then convert UTC into an evening or a morning, which is exactly the arithmetic people get wrong: in Pacific time the windows land at 5:00–8:00 PM and 10:00 PM–2:00 AM in winter and an hour later in summer, and the weekday rule is a UTC weekday, so a Monday 01:00 UTC window is a Sunday evening locally.

The fact is knowable inside the app. The session already knows which route serves it, and only one route — the DeepSeek API adapter — prices by these windows; a local endpoint or an aggregator serving a DeepSeek model bills on its own terms.

## Decision

`@deepseek-ai/dsh-client-ui-model-selection` renders a peak badge beside the composer's model seat while the session's selection rides the DeepSeek API. `src/client/peak-hours.ts` owns the schedule and the classification; `src/client/PeakHoursBadge.tsx` renders the chip and a `Tooltip` carrying the windows.

### The badge carries state; the tooltip carries the schedule

The chip reads `Peak` with a lit amber dot inside a window and `Off-peak` in the dimmed caption tone outside one. The two clock spans it reports are in the tooltip rather than on the chip: the composer's trailing control row is already the tightest strip in the UI, and spelling both windows beside the model name would crowd the name itself. The chip sits as a sibling of the trigger button inside the seat's own root, not inside it, so the model control's accessible name stays the selection action ("Select model, current …") and the badge's state stays its own text.

Amber is the app's existing attention family (`--dsw-alias-state-warn-*`), which is what a peak-rate window is; off-peak recedes into the caption tone so the shaded chip does not compete with the model name.

### Peak is classified in UTC, presented in Pacific

`isPeakInstant` reads `getUTCDay`/`getUTCHours`/`getUTCMinutes`: peak is a UTC weekday inside a half-open window, so 04:00 and 10:00 UTC are already off-peak and all of Saturday and Sunday UTC are off-peak whatever the local clock says.

The presented windows are the same two windows formatted through `Intl.DateTimeFormat` against `America/Los_Angeles` and against `UTC`, from the UTC calendar day containing the instant. Formatting each bound as its own instant is what makes the Pacific line follow daylight saving, so the summer line reads an hour later than the winter one instead of pinning a fixed offset that would be wrong for half the year. The badge asks the reader's own locale for the clock convention and pads the hour only where the locale resolved to 24-hour time, whose `numeric` hour drops the leading zero and would spell the second window `23:00–3:00`.

### The badge keys on the provider id, not the model

`DEEPSEEK_API_PROVIDER` is the `deepseek-official` id `@deepseek-ai/dsh-llm-deepseek` registers. A DeepSeek model name reaching the browser through another route is that route's pricing, so the badge is absent there. The id is a wire identity rather than display text, which is why the check does not read the provider's group name.

### The badge runs its own clock

A session left open crosses a window boundary with no model switch and no reload, so the badge holds the current instant in local state and re-reads it on a 30-second interval. Both windows open and close on the minute, so the interval bounds how late a flip can be without waking the composer every second. The instant is component-local presentation state; it is not a projection, a store, or a session event.

## Alternatives considered

**Put the windows on the chip.** Rejected: the chip sits in a row that already caps the model trigger at `min(360px, 45cqw)`, and the model name is the thing that must stay readable there. The schedule is one hover away and the state, which is what a glance needs, stays visible.

**Key the badge on the model id or its name.** Rejected: model ids are provider-owned and a gateway may serve the same ids under its own pricing; a name match would also be matching on display text, which the client rules forbid.

**Render the Pacific windows from a fixed UTC−8 offset.** Rejected: it is wrong for the eight months of daylight saving, and the error is exactly one hour in a schedule the user is reading to decide whether to wait.

**Hardcode the Pacific clock strings in the dictionary.** Rejected for the same reason, and it would also pin the 12-hour spelling on a locale that reads 24-hour time.

**Publish the schedule from the Host as configurable state.** Rejected: the windows are a published provider fact with one value, so a Config field would be a knob with no second setting, and a Host round trip would put a pricing constant on the wire. It would also need a session event to stay reconstructable, for a fact that reaches no model request.

**Derive the state from a session event so it survives a reload.** Rejected: nothing model-visible depends on it. The badge is a reading of the clock, and the clock is reconstructible from nothing but itself.

**Use the anchor's native `title` for the schedule.** Rejected: the house tooltip already exists for this, renders the chip's copy in the app's own material, and a native tooltip would also fight the trigger's own `title` for any badge placed inside the button.

## Consequences

- A user can tell at a glance whether the turn they are about to send is billed at peak rates, and can read both windows in their own time zone without leaving the app.
- The badge appears only on the DeepSeek API route. A gateway proxying the same endpoint under another provider id shows nothing, because the client cannot tell that route's pricing from its id.
- Presentation adds no model-visible input, no request field, and no session event, so no snapshot output and no KV cache behavior changes.
- One 30-second interval runs per mounted model seat. It is bounded by the number of open sessions, and it disappears with the seat on a route that shows no badge, because the parent renders the badge only for the DeepSeek API provider.
- The schedule is a fixed constant in the client. A provider-side change to the windows is a code change, which is the intended cost of not putting it on the wire.

## Testing

Unit: `packages/client/ui-model-selection/tests/peak-hours.client.spec.ts` pins both windows' membership and their closing minutes, the all-weekend rule, the summer and winter Pacific renderings one hour apart, the UTC rendering, and the 24-hour locale's padded spelling.

Component: `packages/client/ui-model-selection/tests/peak-badge.client.spec.tsx` freezes the clock to pin the lit and shaded states, the three-line tooltip in both dictionaries, and the flip across a window boundary on the badge's own interval. `model-select.client.spec.tsx` pins the scoping rule: the badge rides the DeepSeek API route and is absent for another provider.
