---
description: "Adjacent Session migration that preserves v2 events as v3, including valid skill-catalog presentation digests emitted under v2 headers."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-format-v2-to-v3

English | [中文](README.zh.md)

## Summary

`dsh-session-format-v2-to-v3` rereleases a complete released-v2 Session as released v3 without changing its event model. The writer version bump is needed because released v3 admits an optional `presentationDigest` identity on the durable `skill-catalog` message source, which the frozen v2 source validator rejects as an unknown member. The migration validates the v2 header, stamps the logical and physical header as v3, leaves every event and reference untouched, and validates the exact v3 target. It also accepts a valid digest emitted by an early skill-catalog writer under a v2 header. `releasedV3SessionFormatCodec` then encodes or decodes the current physical representation.

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

### When to use it

Persistence obtains this edge through `dsh-session-format-catalog`; feature compositions do not mount it. Import it directly only when assembling or testing the static released-format catalog or inspecting the exact v2-to-v3 rerelease. No runtime invariant companion is published because every codec and migration call validates its complete source or target artifact and retains no runtime state.

### Entry point

```text
const decodedV2 = releasedV2SessionFormatCodec.decodeArtifact(header, rows)
const migratedV3 = sessionFormatV2ToV3.migrate(decodedV2)
```

`releasedV2SessionFormatCodec` reads the frozen v2 physical language. `sessionFormatV2ToV3` validates the v2 header and the complete v3 result, including digests in direct messages and queued inbox messages. `releasedV3SessionFormatCodec` then encodes or decodes the current physical representation.

The v3 source semantics match the v2 inventory except that the durable `skill-catalog` source admits an optional `presentationDigest` lowercase SHA-256 string alongside `kind`, `form`, and `entries`. v0, v1, and v2 validators continue to reject that member. The v3 physical header, one-event-per-row encoding, provenance ranges, and recoverable prefix decoding are unchanged from v2.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The edge validates the released-v2 header and returns the unchanged events with the header version set to 3. Exact released-v3 validation retains the v2 event inventory and semantics except for the optional validated digest. Unknown fields, malformed digests, invalid event relationships, and unknown event types still refuse migration. Frozen older validators remain unchanged; the compatibility allowance belongs only to this adjacent migration.

| File | Role |
|---|---|
| [`src/migration.ts`](src/migration.ts) | Released-v2 header validation and exact-v3 identity migration |
| [`src/codec.ts`](src/codec.ts) | Released-v3 header, one-event-per-row encoding, provenance ranges, and recoverable prefix decoding |
| [`src/validation.ts`](src/validation.ts) | Physical v3 envelope/cut validation, exact migration-target policy, and vocabulary-neutral current restoration |
| [`src/dispositions.ts`](src/dispositions.ts) | Frozen released-v3 event and payload-member inventory |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Released v1 to v2 edge](../session-format-v1-to-v2/README.md) — the source codec and frozen vocabulary reused here.
- [Static catalog](../session-format-catalog/README.md) — build-owned codec and migration ordering.
- [Session persistence subsystem](../../../docs/subsystems/persistence.md) — immutable generation selection and publication.

-----

<a id="model-experience"></a>
## Model Experience

### Historical restoration

#### What the model sees

Restored v3 Sessions present precisely the same derived message history as their v2 source. The `presentationDigest` is durable catalog identity for non-model consumers and does not appear in `deriveMessages()`.

#### Token effect

The migration adds no model-visible content and preserves the derived message history exactly.

#### KV Cache effect

The restored model-message sequence stays unchanged, so the migration alone does not alter request-prefix cache identity.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Closed first-party source inventory** — an unknown v2 event refuses migration, including an event marked `ignorable: true`.
- **Whole-artifact transformation** — the edge materializes the source and target in memory; it does not stream the rerelease.
- **No publication or compatibility fallback** — persistence owns exclusive successor publication, and retained v2 generations are not automatic downgrade or restore inputs.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
