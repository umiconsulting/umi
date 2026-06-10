---
name: owner-insights-migration
description: "Move Umi Logs-only customer, conversation, memory, integration, WhatsApp health, Voyage embedding health, and conversation triage surfaces into owner-facing Dashboard views. Use when adapting Logs views into Dashboard, designing owner-facing insights, or deciding which diagnostics stay internal-only."
---

# Owner Insights Migration

## Overview

Use this skill to migrate useful operational visibility from `apps/umi-logs` into `apps/umi-dashboard` without exposing internal diagnostics, service-role data, or raw AI traces to owners.

## Workflow

1. Inventory the source surface in `apps/umi-logs` and the target Dashboard route or screen.
2. Classify each surface:
   - Owner-facing: business health, customer context quality, failed sends, active conversations, integration status, memory coverage, action-needed rows.
   - Admin-gated: configuration health, reconnect flows, limited diagnostics, cost/category summaries, data-quality review queues.
   - Internal-only: raw traces, request IDs, full tool-call payloads, prompt/debug internals, parser details, service-role-only views, security forensics, synthetic eval traces.
3. Keep runtime ownership in `apps/umi-conversaflow` for WhatsApp ingress, messages, jobs, memory, embeddings, and normalization.
4. Keep Dashboard as a consumer:
   - Use tenant-first owner APIs.
   - Return owner-safe summaries, counts, labels, status, and drill-down IDs.
   - Do not expose service-role secrets or raw observability payloads to browser code.
5. Translate labels and actions for owners:
   - Prefer "WhatsApp healthy", "messages need attention", "memory coverage", "embedding backlog", "reconnect integration", "review duplicate".
   - Avoid raw implementation names unless the user is in an internal/debug route.
6. Tie every insight to rows or an action. Do not ship dead-end vanity metrics.
7. Preserve `apps/umi-logs` as the internal debugging app after owner-safe surfaces move.

## Migration Rules

- Customers list and customer detail can move to Dashboard after identity and entitlement rules are explicit.
- Conversation detail can move as an owner-readable thread with diagnostics collapsed or omitted by default.
- Memory health and Voyage embedding health should become quality/status panels, not raw vector or token screens.
- Integration health should show owner impact and next action; raw provider payloads stay internal.
- If a view requires service-role access to render, redesign the API boundary before moving it.

## References

- Read `references/surface-classification.md` when auditing Logs screens or writing a move/keep/retire inventory.
