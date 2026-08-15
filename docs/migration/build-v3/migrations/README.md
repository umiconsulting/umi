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

**3 · Handle the append-only tables.** **NINE** tables refuse every UPDATE and
DELETE. Read the list from the database, because the list here would rot:

```sql
select c.relname, t.tgname
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
 where t.tgfoid = 'merchant.tg_append_only'::regproc and not t.tgisinternal
 order by 1;
```

Today: the two money ledgers (`loyalty_stored_value_ledger`,
`loyalty_gift_card_ledger`), plus `audit_event`, `audit_event_internal`,
`financial_event`, `receipt_snapshot`, `pos_committed_sale`,
`offline_replay_command`, and `offline_provisional_mapping`.

A migration that rewrites a row in any of them must disable the trigger and
enable it again IN THE SAME TRANSACTION. Use the helper:

```sql
begin;
select merchant.with_append_only_writable(
  'merchant.loyalty_stored_value_ledger',
  $sql$ update merchant.loyalty_stored_value_ledger set ... $sql$
);
commit;
```

⚠️ Do not disable a trigger with a bare `alter table ... disable trigger`, and do
not set `session_replication_role = replica`. The statement after either one can
fail, and the table then stays writable with nothing to say so. The second is
worse: it silences EVERY trigger in the session.

`with_append_only_writable` restores the previous trigger state on every path,
including the path where the caller traps the error and commits. It accepts only
a table that carries an append-only trigger, and it reads that from the catalog,
so a table added later is covered without an edit here.

Two of the nine hold money. `balance = SUM(delta)`, so a rewritten ledger row
changes a customer balance and leaves no record of the change.

**4 · Carry your own backfill.** A `not null` column needs a value for every row
that already exists. Add the column, fill it, then add the constraint — three
statements, all guarded, in one file.

## What to run before you commit a migration

```bash
# 1. A pristine target, to prove the DDL still applies from scratch.
createdb umi_mig_test && docs/migration/build-v3/00_run.sh umi_mig_test

# 2. Rows, so the migration meets the case that an empty database hides.
psql -d umi_mig_test -f <a seed or a production-shaped sample>

# 3. The migration, TWICE. Both must succeed.
#    No --single-transaction: every statement is guarded, so the file does not
#    need one, and `create index concurrently` cannot run inside a transaction.
psql -v ON_ERROR_STOP=1 -d umi_mig_test -f docs/migration/build-v3/migrations/NNN_*.sql
psql -v ON_ERROR_STOP=1 -d umi_mig_test -f docs/migration/build-v3/migrations/NNN_*.sql

# 4. The invariants, and the security gate.
psql -v ON_ERROR_STOP=1 -d umi_mig_test -f docs/migration/build-v3/99_verify.sql
psql -v ON_ERROR_STOP=1 -d umi_mig_test -f docs/migration/build-v3/security_gate.sql
```

**What CI does for you, and what it does not.**

The `gate` job applies every file here TWICE, against a database that carries
rows, then runs `99_verify.sql` and `security_gate.sql`. `migration-shape.spec.ts`
checks the shape with no database, on every pull request.

⚠️ Rehearse against a copy of PRODUCTION anyway. The CI database holds a few
seeded rows, not your data, and a migration meets its real cases only there.
