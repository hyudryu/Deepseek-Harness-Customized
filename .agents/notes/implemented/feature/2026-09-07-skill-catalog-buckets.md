# Agent Note: On-demand skill catalog buckets

Status: implemented

English | [中文](2026-09-07-skill-catalog-buckets.zh.md)

## Problem

A full catalog of installed skill names and descriptions consumes model input even when a task needs only one subject. Large collections can dominate the first request and remain in every later request until compaction. Loading instruction bodies on demand does not bound this initial discovery cost.

## Decision

[Skill catalog buckets](../../../../packages/skill/skill-catalog-buckets/README.md) publishes brief category descriptions and counts through the scoped `skill/catalog` presentation extension in [tool-skill](../../../../packages/skill/tool-skill/README.md). The `skill_catalog` tool returns a bounded page of summaries for a category, optionally filtered by a query. The existing `skill` tool loads full instructions, and explicit `/name` invocation remains independent of category discovery.

The Web bundle enables this presentation. Other compositions opt in by mounting the plugin. Configurable ordered keyword rules assign each model-invocable skill to its first matching category, with `other` as the fallback. This groups provider metadata without moving files or requiring AWS storage; the AWS category describes a topic.

The catalog publisher retains append-only session history and publishes replacement discovery text through its existing lifecycle. A saved full catalog remains historical input until a fresh session or normal compaction removes it from the active request. Enabling the plugin never deletes or rewrites session logs, provider files, or prior tool results.

## Alternatives considered

- Shortening every description retains input cost proportional to every installed skill and can remove the clues needed to choose one.
- Selecting skills through a model or remote classifier adds latency, credentials, and nondeterministic discovery. Ordered local rules keep classification configurable and reproducible, at the cost of imperfect matches.
- Rewriting saved catalogs would immediately reduce resumed context, but would alter durable history and its replay semantics.

## Consequences

Initial discovery scales with configured categories instead of installed skills. Agents pay an extra tool call to retrieve summaries and can search within a category before loading instructions. Broad keywords can misclassify a skill; users can adjust the ordered rules or inspect `other`. Providers and invocation permissions continue to own availability, and loaded instruction bodies remain uncapped.

Focused provider and real-Loader tests cover pagination, filtering, visibility, replacement catalogs, and unchanged body loading. A keyless recorded-session snapshot verifies the category message and paged results that actually reach the model.
