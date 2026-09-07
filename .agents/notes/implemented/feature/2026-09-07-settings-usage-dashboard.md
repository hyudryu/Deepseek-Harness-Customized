# Agent Note: Settings usage dashboard

Status: implemented

English | [中文](2026-09-07-settings-usage-dashboard.zh.md)

## Problem

Users need a historical view of token activity and model usage without collecting a second copy of their conversations or consulting provider billing pages.

## Decision

The [usage controller](../../../../packages/api/usage-controller/README.md) derives accounting from retained session events through the existing persistence service. The [Usage settings plugin](../../../../packages/client/ui-settings-usage/README.md) contributes the fifth tab in the standard composition and renders summary metrics, a heatmap, daily trends, and model shares.

UTC dates keep aggregation consistent across browsers. Fork-inherited events are excluded because the source session already owns their usage. Attempt settlement retains reported retry usage without counting an attempt and its final message twice. Missing usage is reported separately instead of estimated.

Longest-session time measures the sum of completed turn durations within one session. A session's idle lifetime does not represent active work.

## Alternatives considered

**A separate usage store.** Deriving values from retained events avoids synchronization and duplicate durable accounting. The cost is reading history when the dashboard requests it.

**Provider billing totals.** Local records support multiple providers without provider-specific account access. They cannot establish invoices, prices, or plan quotas.

## Consequences

Deleted history disappears from the dashboard, and attempts without usage cannot contribute token totals. The dashboard remains read-only and does not change model-visible inputs. Chart ranges affect trends and shares; all-time summary metrics retain their historical scope.
