# Phase 4F Execution — Audit/No-Import Gate (2026-06-10)

Executed per `2026-05-23-api-backend-centralization-execution-checklist.md` Phase 1, using
`2026-05-16-public-compatibility-legacy-audit.md` as the source checklist.
Program driver: `2026-06-09-workspace-integration-implementation-plan.md` step S1.2.

## Environment

- Database: `umi_platform_transition_exec_v2_20260515` (local PostgreSQL 18.3, port 5233)
- FDW servers repointed from port 5432 to 5233 (local config only; Homebrew `postgresql@18`
  listens on 5233 on this machine)

## Delta re-verification (matches 2026-05-16 audit exactly)

| table | public-only rows |
|---|---|
| businesses / customers / conversations / transactions | 0 |
| messages | 12 |
| jobs | 30 (2 pending) |
| job_attempts | 30 |
| outbox | 6 |

Snapshot unchanged since the 05-16 audit; zero public-only canonical rows.

## Actions taken

1. **No import executed.** `public.*`/`src_platform_public.*` rows were not promoted into any
   production-facing product table.
2. Recorded all 78 public-only runtime rows in `legacy.public_compat_imports` with
   `action = 'archived_only'`, reason `evaluation_archive` (synthetic_eval context), under
   import batch `phase-4f-public-compat-no-import-gate` (status `completed`).
3. The 2 pending public-only jobs carry `metadata.replay = 'do_not_replay'`.
4. `conversaflow.*` remains source of truth for all common rows.

## Validation (`validation/001_core_validation.sql`)

- Kalala product contract violations: **0**
- Product tables missing `tenant_id`: **0**
- `tenant_id` columns without FK to `platform.tenants`: **0**
- Verified duplicate contact identities: **0**
- Replay rows requiring operator approval: **0**
- RLS: local owner sees 3 tenants; no user context sees **0**
- Non-blocking: 1 unverified duplicate phone candidate (+526672296855) — pre-existing,
  expected under the non-blocking phone policy (see 2026-05-15 phase review §"unverified duplicate")

**Zero blocking validation violations.**

## Final local row counts

Full per-table counts: `2026-06-10-phase-4f-final-local-row-counts.csv` (67 tables across
`platform`, `commerce`, `cash`, `conversaflow`, `kds`, `observability`, `legacy`).
Key production-facing counts in the transition database post-4F (unchanged by 4F, as required —
note the transition model is normalized, so these are not 1:1 with the legacy source schema):

- `platform.contacts` 302, `platform.contact_identities` 395, `platform.tenants` 6
- `conversaflow.messages` 2146, `conversaflow.conversations` 93,
  `conversaflow.workflow_jobs` 3357, `conversaflow.outbox` 401, `conversaflow.products` 136
- `commerce.orders` 50, `kds.tickets` 50
- `cash.loyalty_accounts` 208, `cash.loyalty_cards` 208, `cash.passes` 193

Source-schema reference (FDW `src_platform_conversaflow`, unchanged): messages 3958,
jobs 3357, outbox 401, customers 536, conversations 535 — public-only deltas (12/30/30/6)
remain excluded.

Exit criterion met: local transition database passes validation and is ready to reproduce in staging.
