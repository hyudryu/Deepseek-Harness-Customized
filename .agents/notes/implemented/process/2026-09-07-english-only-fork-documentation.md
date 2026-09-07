# Agent Note: English-only custom fork documentation

Status: implemented

## Problem

Upstream documentation policy requires Chinese counterparts, synchronized translation records, and matching bilingual structure for routine English changes. This personal custom fork is maintained in English, so those obligations add unrelated work and prevent new English documents from passing documentation checks independently.

## Decision

English is the authoritative maintained language for READMEs, documentation, instructions, templates, Agent Notes, and contributor communication in this fork. New files and English edits require no Chinese translation, language switcher, matching line count, or translation sidecar. [The language policy](../../../../docs/i18n/README.md) owns the standing rule.

Documentation checks validate English independently, excluding legacy translations from source links, package references, Mermaid parsing, wrapping, and unavailable-repository checks. Existing Chinese files and translation records are optional legacy material; their presence does not make an English change incomplete. The documentation website projects English sources into both the root and `/en/` compatibility routes without requiring Chinese sources; its machine-readable index labels both route trees in English. Archived Agent Notes retain their existing frozen bytes and seals; new English-only notes can be archived without creating a translation.

This decision supersedes bilingual obligations in the [original pairing decision](2026-07-02-bilingual-docs-and-pairing-gate.md), [routine translation workflow](2026-08-08-lightweight-routine-documentation-translation.md), and [archive policy](2026-07-26-frozen-agent-note-archive.md). Those records retain their original rationale and optional tooling context. Runtime localization and non-English test data remain separate product behavior.

## Alternatives considered

**Keep mandatory translation pairing.** Rejected because the maintainer has explicitly chosen English-only documentation; automatic translation still adds maintenance and review obligations unrelated to this fork's audience.

**Delete every Chinese file and translation tool.** Rejected because removing the maintenance obligation does not require erasing upstream reference material or frozen archives. Existing translations can remain without blocking English work.

Hook installation still probes the shared `tsx` runtime before publishing the hook path; only translation-specific integration is removed. Contributor policy errors are English.

## Consequences

English documentation can change and new READMEs or Agent Notes can be added without Chinese companions or sidecars. Legacy translations may become stale and are not authoritative. Explicitly requested translation work remains possible through the manual skill. English structural, link, metadata, and archive-integrity checks remain applicable; focused gate regressions verify that missing translations do not reject English documents while invalid English documents still fail their owning checks.
