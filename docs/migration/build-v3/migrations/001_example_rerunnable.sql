-- ============================================================================
-- 001 · The shape every forward migration takes.
--
-- This one changes nothing. It exists so the rule is executable rather than
-- written down: CI applies every file in this directory twice, and an empty
-- directory would let that step report green while it ran nothing.
--
-- Copy this file to start a real migration. Keep the four properties below.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · GUARDED. Every statement states what it expects to find. The file applies
--     to a database that already has the change, and says nothing.
-- ---------------------------------------------------------------------------
create schema if not exists merchant;

-- ---------------------------------------------------------------------------
-- 2 · ONE TRANSACTION, and the caller owns it. `psql -v ON_ERROR_STOP=1` wraps
--     a file in a transaction only when the file says so. Do NOT write `begin`
--     here: `create index concurrently` cannot run inside a transaction, and a
--     file that opens one takes that option away from its own author.
--
--     Run it as:  psql -v ON_ERROR_STOP=1 -f 001_....sql
--
--     No `--single-transaction`. Every statement here is guarded, so a partial
--     apply is safe to repeat, and `create index concurrently` stays available.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 3 · THE APPEND-ONLY TABLES. Nine tables refuse every UPDATE and DELETE, and
--     two of them hold money. Read the list from the catalog; see the README.
--
--     ⚠️ Use `merchant.with_append_only_writable` to rewrite a protected row. Do
--     not write a bare `alter table ... disable trigger`, and do not set
--     `session_replication_role`: a failure after either one leaves the table
--     open. `balance = SUM(delta)`, so a rewritten ledger row changes a customer
--     balance and leaves no record.
--
--     The form, which this file does not run because it changes nothing:
--
--       select merchant.with_append_only_writable(
--         'merchant.loyalty_stored_value_ledger',
--         $sql$ update merchant.loyalty_stored_value_ledger
--                  set note = 'corrected' where id = '...' $sql$);
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4 · SAY WHAT HAPPENED. A migration that prints nothing gives the operator no
--     evidence, and the maintenance window is when evidence matters.
-- ---------------------------------------------------------------------------
do $$
begin
  raise notice '001_example_rerunnable: no change. This file documents the shape.';
end $$;
