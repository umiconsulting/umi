# Phase 0C — Data and RLS Readiness

## Result

The build-v3 data design is PARTIAL. The migration authority is CONTRADICTORY.

## Positive evidence

- Build-v3 separates `umi`, `tenant`, and `runtime`.
- The API uses parameterized SQL and separate app and worker pools.
- The app pool sets tenant context inside one transaction.
- A boot guard rejects incorrect pool roles.
- RLS, pooled reuse, schema parity, SQL preflight, and security gates exist.
- Several read views use `security_invoker`.

## Blocking findings

- Root `supabase/migrations` does not exist as the sole ordered ledger.
- `apps/umi-cash/prisma` retains a second schema and migration history.
- Deployed role guidance conflicts between `api`/`worker` and `umi_app`/`umi_worker`.
- Some request-adjacent reads use the BYPASSRLS worker pool.
- Branch context is not a complete database authorization input.
- POS checkout, payment, receipt, refund, inventory, cash, approval, and command tables are absent.
- A backup and restore rehearsal has not proved the final schema and roles.

## Required data controls

- Enable and force RLS on each tenant table.
- Use a NOBYPASSRLS request role and transaction-local business, branch, user, and device context.
- Give worker access only to bounded machinery. Require explicit predicates and tests.
- Seal privileged functions. Fix `search_path`, validate callers, and revoke `PUBLIC`.
- Use explicit table and column grants. Do not use `GRANT ALL`.
- Index every foreign key and RLS predicate.
- Use one lock order and short statement and lock timeouts.
- Keep provider calls outside database transactions.
- Store financial facts as append-only records. Use compensating records.

## Client boundary

Flutter, dashboard, and KDS must not:

- receive service-role credentials;
- write authoritative tables or financial RPCs;
- bypass UMI API, RLS, permission, device, or audit checks;
- calculate authoritative financial values;
- edit immutable history.

## Required proof

Run a clean reset, role fingerprint, cross-tenant and cross-branch negatives, pooled reuse, direct
client denial, concurrent financial tests, and a measured restore drill.
