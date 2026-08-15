# Forward migrations — everything AFTER the cutover

**Status:** open from the cutover date · **Before that date:** edit the numbered
DDL files instead.

## The rule

There are two regimes, and the cutover is the boundary between them.

| Regime                 | How the schema changes                            | Why                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BEFORE the cutover** | Edit `00_foundation.sql` … `90_rls.sql` directly. | No production database carries this schema. The DDL is applied from scratch to an empty database on every CI round, so an edit is free and a migration is ceremony. |
| **AFTER the cutover**  | Add a file here. NEVER edit a numbered DDL file.  | A production database carries the schema and the data. An edit to the DDL changes what a NEW database gets and does nothing to the one that holds the customers.    |

The numbered files freeze at the version the cutover applies. After that they are
a record of what was applied that day, not a description of production.

⚠️ Do not edit a numbered DDL file after the cutover, even to correct a mistake.
The correction must reach the live database, and only a migration does that.

## Naming

    NNN_short_description.sql

`NNN` counts up from `001` and never repeats. The number is the apply order.

## What every migration must do

**1 · Be re-runnable.** The same file applied twice either succeeds, or fails with
a message that says what is wrong. It never leaves half of its work applied.

Use the guarded forms:

```sql
create table if not exists ...
alter table ... add column if not exists ...
drop policy if exists <name> on <table>;   -- then create it
create or replace function ...
create index concurrently if not exists ...
```

`create policy` has no `if not exists`, and `90_rls.sql` shows the working form:
drop it first, then create it. That file used to fail on a second apply with
`policy "merchant_isolation" for table "merchant" already exists`.

**2 · Apply to a POPULATED copy, not only to an empty one.** An empty database
accepts a `not null` column with no default. A populated one does not. Test
against a copy that holds rows.

**3 · Handle the append-only ledgers.** Two tables refuse every UPDATE and DELETE:

| Table                                  | Trigger                           | Where                 |
| -------------------------------------- | --------------------------------- | --------------------- |
| `merchant.loyalty_stored_value_ledger` | `stored_value_ledger_append_only` | `20_merchant.sql:597` |
| `merchant.loyalty_gift_card_ledger`    | `gift_card_ledger_append_only`    | `20_merchant.sql:740` |

A migration that rewrites rows in either one must disable the trigger and enable
it again IN THE SAME TRANSACTION. Use the helper:

```sql
begin;
select merchant.with_ledger_writable(
  'merchant.loyalty_stored_value_ledger',
  $sql$ update merchant.loyalty_stored_value_ledger set ... $sql$
);
commit;
```

⚠️ Do not disable a trigger with a bare `alter table ... disable trigger`. If the
statement after it fails, and you are not in a transaction, the ledger stays
writable. `with_ledger_writable` runs inside one transaction, so a failure rolls
the disable back with everything else.

The money is in these two tables. `balance = SUM(delta)`, so a rewritten row
changes a customer's balance and leaves no record that it changed.

## What to run before you commit a migration

```bash
# 1. A pristine target, to prove the DDL still applies from scratch.
createdb umi_mig_test && docs/migration/build-v3/00_run.sh umi_mig_test

# 2. Rows, so the migration meets the case that an empty database hides.
psql -d umi_mig_test -f <a seed or a production-shaped sample>

# 3. The migration, TWICE. Both must succeed.
psql -v ON_ERROR_STOP=1 -d umi_mig_test -f docs/migration/build-v3/migrations/NNN_*.sql
psql -v ON_ERROR_STOP=1 -d umi_mig_test -f docs/migration/build-v3/migrations/NNN_*.sql

# 4. The invariants, and the security gate.
psql -v ON_ERROR_STOP=1 -d umi_mig_test -f docs/migration/build-v3/99_verify.sql
psql -v ON_ERROR_STOP=1 -d umi_mig_test -f docs/migration/build-v3/security_gate.sql
```

`migration-rerun.integration.ts` runs steps 3 and 4 for every file in this
directory, in the `gate` CI job. A migration that is not re-runnable fails the
build.
