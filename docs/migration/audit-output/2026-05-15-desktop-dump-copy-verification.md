# Desktop Dump Copy Verification - 2026-05-15

## Scope

Verified the encrypted dump on Desktop without printing or copying the passphrase.

Source files:

- `/Users/juanlopez1/Desktop/umi-production-db-dumps-2026-05-13.tar.gz.enc`
- `/Users/juanlopez1/Desktop/umi-db-handoff-passphrase-2026-05-13.txt`

Working directory:

- `/tmp/umi-production-db-dumps-2026-05-13-check`

No raw dump or passphrase was copied into the repository.

## Archive Contents

The encrypted archive contains:

- `umi-platform-and-cash-full.dump`
- `RESTORE.md`

The bundled `RESTORE.md` describes `umi-platform-and-cash-full.dump` as:

- a PostgreSQL custom-format dump
- the full production dump for the shared Umi Platform Supabase project

## Fresh Local Restore

Restored into a separate local database:

- `umi_platform_and_cash_full_local`

Existing local databases were left intact:

- `umi_supabase_dump_local`
- `umi_platform_local`

Restore command used `pg_restore` with:

- `--clean`
- `--if-exists`
- `--no-owner`
- `--no-acl`

Restore log:

- `/tmp/umi-platform-and-cash-full-local-restore.log`

## Expected Local Restore Gaps

The restore exited non-zero because local PostgreSQL does not provide these Supabase-hosted extensions/objects:

- `pg_cron`
- `pg_net`
- `supabase_vault`
- dependent `cron.*` objects
- dependent `vault.secrets`

These match the earlier local restore limitations and do not block application schema/data verification.

## Verified Schemas

The restored database includes:

- `auth`
- `conversaflow`
- `kds`
- `platform`
- `public`
- `realtime`
- `storage`
- `umi_cash`

## Verified Table Counts

Base table inventory:

```txt
auth: 23
conversaflow: 23
kds: 4
public: 22
realtime: 8
storage: 8
supabase_migrations: 1
umi_cash: 12
```

Important row counts:

```txt
conversaflow.businesses: 1
conversaflow.customers: 536
conversaflow.conversations: 535
conversaflow.messages: 3948
conversaflow.transactions: 48
conversaflow.jobs: 3332
conversaflow.job_attempts: 3337
conversaflow.pipeline_traces: 5177
kds.tickets: 48
kds.ticket_items: 70
kds.ticket_events: 151
umi_cash.Tenant: 3
umi_cash.User: 64
umi_cash.LoyaltyCard: 59
umi_cash.Visit: 31
umi_cash.Transaction: 3
umi_cash.RewardConfig: 14
umi_cash.GiftCard: 1
umi_cash.Session: 132
```

## Reconciled Conclusion

The Desktop dump is one combined production dump, not two separate dump files.

It contains the Umi Platform project's schemas, including a copied `umi_cash` schema. After Vercel production env verification on 2026-05-15, that copied `umi_cash` schema is known to be stale and is not the active Cash production database.

The active Cash production database is the separate Supabase project `rrkzhisnadfrgnhntkiz`, copied locally into `umi_cash_production_local_20260515`.

The `conversaflow.customers: 536` count is a raw source count. Some ConversaFlow data is test, mini-harness, or v2 synthetic eval data, so production contact import must classify those rows before canonical import.
