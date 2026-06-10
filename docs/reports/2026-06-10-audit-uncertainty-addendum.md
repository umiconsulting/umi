# Audit Uncertainty Burn-Down — Addendum (2026-06-10)

Executes plan step S1.6 of `docs/migration/2026-06-09-workspace-integration-implementation-plan.md`.
Resolves uncertainties from `docs/reports/workspace-integration-audit.md` §Uncertainties.

## Uncertainty 1 — Live production state: RESOLVED (low drift)

Ran the Phase-3 inventory (row counts) against live production (Umi Platform project
`xbudknbimkgjjgohnjgp`, via session pooler). Full counts:
`docs/migration/audit-output/2026-06-10-production-row-counts.csv`.

Drift vs the 2026-05-15 snapshot (`supabase-local-row-counts.csv`), 26 days:

| table | 2026-05-15 | 2026-06-10 live | delta |
|---|---|---|---|
| conversaflow.messages | 3948 | 3980 | +32 |
| conversaflow.jobs | 3332 | 3412 | +80 |
| conversaflow.outbox | 390 | 412 | +22 |
| conversaflow.customers / conversations | 536 / 535 | 536 / 535 | 0 |
| kds.tickets | 48 | 51 | +3 |
| umi_cash.User (platform project schema) | 64 | 64 | 0 |
| public.* (legacy) | — | identical to FDW source (859 messages, 382 jobs…) | frozen |

Also confirmed: production `platform` schema exists but is **empty** — the 7-schema model
is local-only; staging (S3.1) will be its first hosted reproduction. Implication: a cheap
re-dump before the staging load is worthwhile, but the 05-15 snapshot remains structurally
valid for mapping. (Cash-project drift — audit uncertainty 6 — is separate and still owned
by the S4.3 mandatory re-dump.)

## Uncertainty 2 — Dashboard KDS pairing path: RESOLVED (local path is live)

`apps/umi-dashboard/server.js:1474-1478` dispatches to the `kds-pairing` edge function only
when `SUPABASE_URL`/`VITE_SUPABASE_URL` **and** `SUPABASE_SERVICE_ROLE_KEY` are both set.
Neither `.env` nor `.env.local-postgres` sets `SUPABASE_SERVICE_ROLE_KEY` (and
`.env.local-postgres` sets no Supabase URL at all) → **`callKdsPairingLocal` executes** in
every current configuration. H3's duplication is live, not latent. S4.2 consequence: the
cutover to canonical `kds-pairing` requires provisioning the dashboard with the (post-rotation,
see S1.4) service-role key, then deleting the local implementation.

## Uncertainty 3 — Canonical adapter layer: RESOLVED (owner decision, 2026-06-10)

`.agents/` declared canonical; `.claude/` is a generated mirror. Executed in S1.5; sync rule
documented in `docs/architecture/agent-operating-system.md` §Maintenance rule and root `CLAUDE.md`.

## Uncertainty 4 — Landing page Vercel state: RESOLVED (not deployed; H5 latent)

Vercel CLI (account `juanclpzq`, sole scope `juans-projects-1d7e9ef2`) reports **zero projects**.
`apps/umi-landing-page` has no `.vercel/` link and no `vercel.json`; `data/` is empty;
`.env.production` is a template. The SQLite lead-loss risk (H5) is **latent** — it goes live
only at first deploy, so S4.6 (leads → PostgreSQL) must land before any production deploy of
the landing app. Caveat for S2.1: if umi-cash's Vercel crons are deployed, they live under a
different Vercel identity — another argument for the single-org consolidation.

## Uncertainty 5 — umi-conversaflow pre-reset history: RESOLVED (does not exist)

`git ls-remote --heads origin` shows only `main` (= `e6140b3`, "Initial commit") and
`architecture-v2` (= `c2defa9`, current). The local `architecture-v1` branch is rooted at the
same initial commit. The 7-commit history **is** the entire history; there is no pre-reset
history to preserve for the Phase 5 import.

## New findings surfaced (debt-register candidates before Phase 3 locks scope)

1. **Legacy edge functions deployed but absent from the repo:** `zettle-sync`, `embed-backfill`,
   `order-status-webhook`, `slack-actions`, `kds-board`(repo)/(deployed list mismatch) — the
   deployed function set and `supabase/functions/` have drifted. Inventory and reconcile before
   S4.4 (crons → job queue) deletes or repoints any of them.
2. **`zettle-sync-daily` cron embeds the anon key** (hardcoded in `cron.job` SQL). Not part of the
   service_role rotation blast radius, but should move to vault-backed auth when S4.4 touches it.
3. **`eval_traces` stopped 2026-04-30 and `public.ai_turn_logs` stopped 2026-04-16** — turn
   telemetry moved to `conversaflow.ai_turn_logs`; umi-logs consumers should be checked against
   the tables that are actually written (relevant to S6.2).
4. **`embed-backfill` cron fails every 20 minutes** (HTTP 500, `"Voyage API batch call failed"`,
   ≥30h of history predating the 2026-06-10 vault-auth conversion — auth is fine, the function
   body fails). Cause hypothesis: it selects the same 50 unembedded messages each run, which are
   synthetic `+1555` rows whose content the batch call chokes on, so it can never make progress.
   Real-message embedding is unaffected (per-turn `message.embed` jobs complete). Recommendation:
   leave scheduled or pause per operator preference; permanently resolved by S4.5 synthetic
   deletion, after which the backfill clears the ~30 real-customer stragglers.
5. **`zettle-sync` daily cron fails** with `"ZETTLE_API_KEY not configured"` — the deployed legacy
   function expects an env name the secrets list doesn't contain (secrets have
   `ZETTLE_CLIENT_ID`/`ZETTLE_CLIENT_SECRET`). Product sync presumably stale; fold into the
   legacy-function reconciliation (finding 1).
