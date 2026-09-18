\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- build-v3 · 73_mp_refund — workstream G, step 1 of Phase 4 of the Mercado Pago
-- Point plan (`docs/plans/2026-09-17-mercadopago-point-integration-plan.md`,
-- §4 Phase 4: "Add the refund as a second attempt with the same model").
--
-- The plan's sentence this file serves is decision D6: "A refund is its own
-- command, with its own attempt. A partial refund needs `transactions.payments[].id`,
-- not the order id, and the vendor says to save both. … So the order id and the
-- payment id are both persisted on the attempt, and the refund is a second row
-- with the same shape, not a mutation of the sale."
--
-- THE REFUND IS A ROW, NOT AN EDIT. Everything below is in service of that one
-- sentence. A capture is proven by `provider_payment_id` (70_tender's
-- `payment_attempt_provider_proof_has_id_ck`); a refund is a second act with its
-- OWN amount, its OWN command identity and its OWN provider answer, and the thing
-- that proves it is the vendor's REFUND id — a different id from the payment it
-- gives back. Mutating the capture would destroy the fact that money came in and
-- the separate fact that money went out, and it would make a partial refund
-- unrepresentable: a $100 capture refunded by $30 is two amounts, and one row
-- cannot hold both without one of them being a lie.
--
-- WHAT THIS ADDS AND WHY EACH PART EXISTS.
--
--   1. `refund_of_attempt_id` — WHICH CAPTURE THIS REFUND GIVES BACK. A refund
--      without a capture to refund is not a thing this schema should be able to
--      express, so the column is a SELF-REFERENCE and the foreign key says so.
--      `on delete restrict` is the half that keeps the capture from being deleted
--      out from under it: a refunded capture is not the ledger's to erase. It is
--      NULLABLE because the overwhelming majority of attempts are captures; the
--      column is a marker of the refund case, and `is null` is "this attempt took
--      money", not "we forgot".
--      The PARTIAL index on `(merchant_id, refund_of_attempt_id) where
--      refund_of_attempt_id is not null` is what answers the one question a
--      support screen asks — "what has this capture given back?" — without paying
--      a write on every ordinary capture for an entry that is NULL for almost
--      every row. Same reasoning, and same form, as 72's partial index over the
--      open-terminal predicate: index the rows that carry the fact, not the ones
--      that are null.
--   2. `provider_refund_id` — THE PROOF OF THE REFUND. The vendor's own
--      `transactions.refunds[].id` (research note 01, §4.3). `provider_payment_id`
--      is the payment being refunded; THIS is the act of giving back, and the
--      distinction is exactly what makes a partial refund possible at all — the
--      two ids are two different objects at the vendor, with two different
--      lifecycles, and collapsing them into one column would make "how much of
--      this payment has come back?" a question with no answer.
--   3. `provider_paid_minor_units` and `provider_tip_minor_units` — WHAT THE
--      CUSTOMER ACTUALLY PAID. §4 Phase 4 step 3: "Reconcile on `paid_amount`,
--      because the terminal adds a tip and `paid_amount` can exceed the requested
--      `amount`." `paid_amount` is the vendor's `transactions.payments[].paid_amount`
--      and `tip_amount` is the tip the terminal added on the customer's side; both
--      are stored because the vendor's read window is three months (research note
--      01, §2.1), so a reconciliation that does not record them has to ask the
--      vendor again while it still can, and then never again. NULL means "the
--      vendor did not say" and is DELIBERATELY DISTINCT FROM ZERO: a payment with
--      no tip and a payment whose tip we were never told are different facts, and
--      only the first one is a zero. A refund's ceiling is the PAID amount rather
--      than the requested one for exactly this reason, and these two columns are
--      what a tip reconciliation reads.
--
-- WHAT IS NOT ENFORCED HERE, STATED PLAINLY.
--
--   · THE REFUND'S CEILING IS NOT A CHECK. "A refund never exceeds the capture it
--     gives back" needs the capture's amount and its own already-refunded total,
--     which is a query across rows and not a constraint on one of them. The vendor
--     is the authority on how much it will give back (it answers 403
--     partial_refund_forbidden_with_tips, and refuses beyond the paid amount), and
--     the refund command is where the ceiling is decided. What the schema
--     guarantees is that the ceiling's two ingredients are both stored: the amount
--     this attempt is for, and the `provider_paid_minor_units` the customer
--     actually paid.
--   · A REFUND'S STATUS IS NOT A SECOND STATE MACHINE. The refund attempt uses the
--     same statuses the capture does (`pending` → `succeeded`/`declined`/`cancelled`),
--     because a refund that the provider has not answered yet is the same kind of
--     question as a capture it has not answered yet, and the query path that
--     resolves one already resolves the other. No new status vocabulary is
--     introduced here, deliberately.
--   · THE 90-DAY REFUND WINDOW IS NOT A CHECK EITHER. It is a rule with a date in
--     it ("a refund is allowed inside 90 days" — D6), the vendor enforces it, and a
--     CHECK cannot read the clock.
--
-- SCOPE, RLS AND GRANTS. `merchant.pos_payment_attempt` ALREADY carries its grants
-- (`api` and `worker` = arwd, `readonly` = r) and its FORCED RLS policy from
-- 90_rls.sql; 70_tender and 72_mp_point both deliberately do not re-grant it or
-- touch its policies, and this file does not either. Nothing here is a new table
-- and nothing here is a new policy: the refund is a row in the table that already
-- has them, which is the point of D6.
--
-- Idempotent and re-runnable: guarded columns, guarded constraints, a guarded
-- foreign key, a guarded index, and a version row inserted with `on conflict do
-- nothing`. Applying this file twice in a row is a no-op that ends green (proved;
-- see 99_verify's build-v3-73 block).
--
-- THAT CLAIM IS ABOUT THIS FILE, the same caveat 72_mp_point states for itself: a
-- second FULL `00_run.sh` over an existing database does not get past `10_umi`,
-- whose `create table umi.user` has no `if not exists`. A fresh database is the
-- supported way to re-run the whole build.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · The refund's link to what it gives back
--
-- Added with `add column if not exists` so the file is re-runnable against a
-- database that already carries them, following 70_tender and 72_mp_point. The
-- foreign key is added in a SEPARATE guarded block for the reason 72 guards its
-- column CHECK: `add column if not exists` does nothing on the second run, so an
-- inline `references` would leave a half-applied database — the column there and
-- the constraint not — with no way back.
-- ---------------------------------------------------------------------------
alter table merchant.pos_payment_attempt
  add column if not exists refund_of_attempt_id uuid,
  add column if not exists provider_refund_id text,
  add column if not exists provider_paid_minor_units bigint,
  add column if not exists provider_tip_minor_units bigint;

comment on column merchant.pos_payment_attempt.refund_of_attempt_id is
  'The capture this attempt gives back (D6: a refund is its OWN attempt row, not a mutation of the sale). A SELF-REFERENCE, so a refund without a capture to refund is not expressible, and `on delete restrict`, so a refunded capture cannot be deleted out from under its refund. NULL for every ordinary capture: `is null` means "this attempt took money", not "we forgot".';
comment on column merchant.pos_payment_attempt.provider_refund_id is
  'The vendor''s own refund id (`transactions.refunds[].id`, research note 01 §4.3). This is the thing that PROVES the giving-back, exactly as provider_payment_id proves the capture — two different objects at the vendor, which is what makes a partial refund possible at all. Provider-proofed refunds cannot be recorded without it (payment_attempt_refund_proof_has_id_ck).';
comment on column merchant.pos_payment_attempt.provider_paid_minor_units is
  'The vendor''s `transactions.payments[].paid_amount` in minor units: what the customer ACTUALLY paid, which may be MORE than amount_minor_units when the terminal added a tip (§4 Phase 4 step 3). A refund''s ceiling is this, not the requested amount. NULL means the vendor did not say, which is DELIBERATELY DISTINCT FROM ZERO — read by the tip reconciliation, and stored because the vendor''s read window is three months.';
comment on column merchant.pos_payment_attempt.provider_tip_minor_units is
  'The tip the terminal added on the customer''s side (`transactions.payments[].tip_amount`) in minor units. NULL means the vendor did not say, which is deliberately distinct from zero. The other half of the tip reconciliation: paid = amount + tip when the vendor reports a tip, and the pair is what lets a later report tell a tipped sale from a mismatched one.';

do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname='merchant' and cl.relname='pos_payment_attempt'
       and c.conname='pos_payment_attempt_refund_of_fk'
  ) then
    alter table merchant.pos_payment_attempt add constraint pos_payment_attempt_refund_of_fk
      foreign key (refund_of_attempt_id) references merchant.pos_payment_attempt(id) on delete restrict;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2 · The index the refund's one question is asked through
--
-- Partial, and the predicate is the reason: almost every row is a capture with
-- `refund_of_attempt_id is null`, so a full index over the column would carry an
-- entry for every attempt ever written and be read for none of them. "What has
-- this capture given back?" is the query this index answers, and it only ever
-- looks at refund rows.
--
-- Deliberately NOT unique: a capture may legitimately be given back in more than
-- one refund (two partial refunds are two rows), and a unique index here would
-- make the second one impossible — which is the exact shape D6 exists to allow.
-- ---------------------------------------------------------------------------
create index if not exists pos_payment_attempt_refund_of_idx
  on merchant.pos_payment_attempt (merchant_id, refund_of_attempt_id)
  where refund_of_attempt_id is not null;

comment on index merchant.pos_payment_attempt_refund_of_idx is
  'Partial: only refund rows are indexed, because every ordinary capture carries a NULL refund_of_attempt_id and indexing those would cost a write per attempt for an entry nothing reads. Answers "what has this capture given back?" and is NOT unique, on purpose — a capture may be given back by more than one partial refund, and each of them is its own row (D6).';

-- ---------------------------------------------------------------------------
-- 3 · The refund's proof is a fact, not a hope
--
-- This is the refund half of 70_tender's `payment_attempt_provider_proof_has_id_ck`
-- (`proof_source is distinct from 'provider' or provider_payment_id is not null`).
-- Together the two constraints say one thing: NO PROVIDER-PROOFED OUTCOME EXISTS
-- WITHOUT THE ID THAT PROVES IT — a capture by its payment id, a refund by its
-- refund id. A row that claims a provider proved the giving-back and carries no
-- refund id is claiming an answer nobody can point at.
--
-- The existing constraint still applies to a refund row too, and that is not an
-- oversight to be "simplified" away: a provider-proofed refund carries
-- `provider_payment_id` as well, because the refund was made AGAINST that payment.
-- `provider_payment_id` says which money came back; `provider_refund_id` says the
-- giving-back happened. Both are needed, and neither substitutes for the other.
--
-- `proof_source is distinct from 'provider'` rather than `<> 'provider'`, the same
-- NULL-safe form 70_tender uses: a row with no proof_source at all must not slip
-- past the refund guard by being uncomparable.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname='merchant' and cl.relname='pos_payment_attempt'
       and c.conname='payment_attempt_refund_proof_has_id_ck'
  ) then
    alter table merchant.pos_payment_attempt add constraint payment_attempt_refund_proof_has_id_ck
      check (proof_source is distinct from 'provider'
             or refund_of_attempt_id is null
             or provider_refund_id is not null);
  end if;
end $$;

-- The two amounts cannot be negative, for the reason payment_attempt_query_count_ck
-- gives about its counter: a money column that cannot be a money value is worth
-- refusing rather than graphing, and a negative `paid_amount` would silently invert
-- a reconciliation. Only "not negative" is enforced — the amount may legitimately
-- be zero (a fully discounted sale that the terminal still recorded), and whether
-- the tip is consistent with the paid total is the vendor's arithmetic, not ours.
do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname='merchant' and cl.relname='pos_payment_attempt'
       and c.conname='payment_attempt_paid_minor_units_ck'
  ) then
    alter table merchant.pos_payment_attempt add constraint payment_attempt_paid_minor_units_ck
      check (provider_paid_minor_units is null or provider_paid_minor_units >= 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname='merchant' and cl.relname='pos_payment_attempt'
       and c.conname='payment_attempt_tip_minor_units_ck'
  ) then
    alter table merchant.pos_payment_attempt add constraint payment_attempt_tip_minor_units_ck
      check (provider_tip_minor_units is null or provider_tip_minor_units >= 0);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4 · Bookkeeping
--
-- The same trailing statement 70_tender, 71_immutable_delete_fix and 72_mp_point
-- perform: one version row, guarded so a re-run is a no-op. 99_verify asserts it,
-- so a database that took these objects without the version — or the reverse —
-- fails the build rather than passing on a half-applied shape.
-- ---------------------------------------------------------------------------
insert into runtime.schema_migration(version,status)
values('build-v3-73','applied') on conflict(version) do nothing;

commit;
