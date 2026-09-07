# Documentation language policy

This custom fork maintains its READMEs, documentation, Agent Notes, and contributor instructions in English only. English is authoritative. New documents and edits do not require Chinese text, translated counterparts, language switchers, matching physical line counts, or translation consistency records.

## The pairing contract

There is no mandatory pairing contract in this fork. Existing `foo.zh.md` translations and `foo.i18n.yaml` records are optional legacy material and may be outdated. An English document can change independently of both. A missing or stale translation does not block a commit, pull request, build, or documentation check.

## The gate: verify-translation-pairing

Translation pairing is excluded from the normal contributor, Git hook, and CI requirements. Retained translation tools are optional utilities for explicitly requested translation work; their checks do not establish a repository-wide requirement to maintain translations. Run the ordinary documentation checks for English changes as described in [development.md](../development.md).

## Scope and exclusions

This policy applies to current and future first-party Markdown, including root documents, package READMEs, documentation, Python guides, skills, and active Agent Notes. Generated English references retain their source generators and freshness checks. Their regeneration does not require a translated update.

Vendored upstream material and frozen archived Agent Notes retain their historical content. Existing translated pages, terminology resources, and translation examples are retained for reference; their upstream bilingual instructions do not override this policy.

## Division of labor

Routine work updates English documentation only. Use [translation-rules.md](translation-rules.md), [terminology.md](terminology.md), and the [dsh-translate-docs skill](../../.agents/skills/dsh-translate-docs/SKILL.md) only when the user explicitly requests translation. Translation quality guidance applies to that requested work and does not create ongoing synchronization duties for other changes.
