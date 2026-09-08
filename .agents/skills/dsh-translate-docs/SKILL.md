---
name: dsh-translate-docs
description: Translate explicitly requested legacy documentation in the English-only DeepSeek Harness custom fork without imposing repository-wide translation or pairing requirements.
disable-model-invocation: true
user-invocable: true
---

# Translating DeepSeek Harness docs

## Invocation boundary

Run this workflow only when the user explicitly invokes `dsh-translate-docs` by name. Ordinary documentation work maintains English only under [the fork language policy](../../../docs/i18n/README.md). Creating or editing English documentation never requires translation, a language switcher, matching physical line counts, or a sidecar record.

## Explicit translation workflow

1. Identify the documents and target language the user requested. Keep the task scoped to those files.
2. Read the English source and preserve its behavior, failure, ownership, and compatibility facts. Translate prose naturally; preserve code and valid links.
3. Use [terminology](../../../docs/i18n/terminology.md) and [translation guidance](../../../docs/i18n/translation-rules.md) when useful to the requested language. English remains the maintained authority.
4. Review the translated text against the source and on its own. Do not expand the task to unrelated legacy translations or manufacture counterpart files for linked documents.
5. Run relevant Markdown checks and report the translated files and checks run. Translation tooling and consistency records are optional aids, never prerequisites for an English change.
