# Agent Note: Declare the sidebar automations slot

Status: implemented

English | [中文](2026-09-07-sidebar-automations-slot-declaration.zh.md)

## Problem

The sidebar component renders an optional automations slot, but a missing child declaration prevents the client TypeScript build and leaves plugins without a runtime declaration to occupy.

## Decision

The [sidebar registration](../../../../packages/client/ui-sidebar/src/client/index.ts) declares `sidebar.automations` as a root-scoped single slot. The shell renders it above the Workspace browser and passes `wide` in both expanded and rail states. Feature plugins own its contents.

## Alternatives considered

**Remove the render call and slot types.** This would remove the intended plugin extension point. Declaring the existing slot preserves it while satisfying the typed registration API.

## Consequences

The shell exposes the same child slot to its component and the runtime registry. Deployments may leave it empty; the sidebar owns no automation state.
