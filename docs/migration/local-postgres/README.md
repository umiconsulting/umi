# Local PostgreSQL Platform Draft

This directory contains the local-only PostgreSQL draft created from:

- `docs/migration/2026-05-14-postgresql-platform-integration-plan.md`
- `docs/migration/2026-05-15-optimized-database-transition-plan.md`

It is not a production migration set. Apply only to a disposable local database.

## Current Execution Scripts

- `020_local_source_fdw.sql` links a local execution target to local source copies:
  - `umi_cash_production_local_20260515`
  - `umi_platform_production_local_20260515`
- `030_platform_identity_backfill.sql` performs the local Phase 3 platform identity backfill:
  - active Cash tenants, locations, staff, customer contacts, and phone identities
  - candidate ConversaFlow/KDS tenant mapping to `kalalacafe`
  - production-eligible ConversaFlow contacts only
  - synthetic/eval and unknown ConversaFlow contacts staged as data-quality findings
- `040_cash_product_backfill.sql` performs Phase 4A Cash product backfill:
  - wallet programs, loyalty accounts/cards, visits, wallet transactions, rewards, gift cards, passes, and pass devices
  - Session and OtpVerification rows are excluded from durable product tables and recorded as data-quality findings
- `041_commerce_order_backfill.sql` performs Phase 4B ConversaFlow commerce order backfill:
  - transactions become `commerce.orders`
  - JSON `details.items` become `commerce.order_items`
  - transaction status events become `commerce.order_events`
  - missing contact/location mappings and total mismatches become data-quality findings
- `042_kds_projection_backfill.sql` performs Phase 4C KDS projection history backfill:
  - KDS tickets point at canonical `commerce.orders`
  - KDS ticket items point at canonical `commerce.order_items`
  - KDS event sequence is preserved for idempotent historical import
  - missing source event keys are recorded as data-quality findings
- `043_conversaflow_runtime_backfill.sql` performs Phase 4D ConversaFlow runtime history backfill:
  - production-verified conversations, messages, and turns are imported into production-facing ConversaFlow tables
  - unknown and synthetic/eval conversation histories are excluded from production-facing tables and recorded as findings
  - product/menu facts are imported without vector embeddings
  - completed jobs, job attempts, and delivered/dead outbox rows are imported as inert runtime history
- `044_observability_history_backfill.sql` performs Phase 4E observability history backfill:
  - production pipeline traces are imported into `observability.pipeline_traces`
  - synthetic/evaluation pipeline traces and eval traces are imported into `observability.evaluation_traces`
  - source refs and an integration check are recorded for the observability import

## Apply Locally

```bash
export PG_BIN=/opt/homebrew/opt/postgresql@18/bin
export UMI_LOCAL_DATABASE_URL="postgresql://localhost:5432/umi_platform_local"

"$PG_BIN/pg_ctl" -D /opt/homebrew/var/postgresql@18 -l /tmp/umi_platform_postgresql18.log start
"$PG_BIN/dropdb" --if-exists umi_platform_local
"$PG_BIN/createdb" umi_platform_local

for f in docs/migration/local-postgres/*.sql; do
  "$PG_BIN/psql" "$UMI_LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

## Validation Query

```bash
LOCAL_USER_ID="$("$PG_BIN/psql" "$UMI_LOCAL_DATABASE_URL" -At -c "select id from platform.users where auth_subject = 'local-owner-1'")"

"$PG_BIN/psql" "$UMI_LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -c "
set role umi_app;
set app.user_id = '$LOCAL_USER_ID';
select slug, name, products
from platform.tenant_product_capabilities
order by slug;
reset role;
"
```

Expected tenants:

- `cash-only-cafe`: `cash=active`, `dashboard=active`, `conversaflow=missing`, `kds=missing`, `observability=missing`
- `full-stack-cafe`: all seeded products active
