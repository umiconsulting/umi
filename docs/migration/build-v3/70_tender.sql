\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- build-v3 · 70_tender — workstream G, steps 3 and 5: the attempt record, the
-- three outcomes, and the CFDI state machine.
--
-- WHAT THIS ADDS AND WHY EACH PART EXISTS.
--
--   1. An ATTEMPT at taking money ALREADY exists as a row —
--      `merchant.pos_payment_attempt`, created by 20_merchant.sql and given
--      `tender_id` by 32_pos_checkout.sql. This file does NOT create a parallel
--      record. It widens that one with the things the tender path needs and the
--      attempt never carried: WHO owns the attempt (`provider`), what the command
--      that started it WAS (`command_identity`), what the provider ANSWERED
--      (`provider_order_id`, `provider_payment_id`, `provider_status`), WHAT PROVED
--      the outcome (`proof_source`), the clock an unknown is queried on
--      (`query_after`), which tender draft it pays (`tender_draft_id`), WHETHER the
--      provider was asked at all and when (`provider_capture_at`), and how often we
--      have asked it what happened (`provider_query_count`).
--   2. `merchant.fiscal_document` is the fiscal lens on a sale: the CFDI's own
--      state, its SAT folio UUID, the receptor's fiscal identity, the payment form
--      and the payment method. It is a SEPARATE row from the receipt and the order
--      because a stamp, a cancellation and a factura global each move on their own
--      schedule and none of them is a fact about the sale.
--   3. Two columns make the retry guard a FACT IN THE ROW rather than a promise in the
--      service. `tender_draft_id` is the client's own tender draft id, recorded so the
--      commit can link this attempt to the tender it paid, and deliberately NOT a
--      foreign key to `merchant.pos_tender_fact`: the fact is written at commit, and an
--      abandoned attempt must be recorded even though no fact will ever exist for it.
--      `provider_capture_at` is set EXACTLY ONCE, before the provider is called — the
--      claim is `update ... set provider_capture_at = clock_timestamp() where
--      provider_capture_at is null returning ...`, and only the writer that gets a row
--      back is allowed to call the provider. It is what a process crash between persist
--      and call leaves behind: an attempt that can be queried and never silently
--      captured twice.
--
-- `provider` IS A FREE SLUG AND NOT AN ENUM. §8G step 6 says a second terminal brand
-- must not touch checkout, so adding one must not require a migration: an enum on this
-- column would make a new brand a DDL change in every database already carrying the
-- customers, which is the exact cost the slug exists to avoid. A FORMAT check is
-- enough — `^[a-z][a-z0-9_]{1,39}$`, the same shape `TenderProviderId` declares in
-- `packages/contract/src/tender.ts`. The slugs this build knows are 'cash',
-- 'manual_terminal', 'mercado_pago_point' and 'conekta'; they live IN THIS COMMENT
-- ONLY and never in a CHECK, because a CHECK is precisely the migration the slug is
-- there to avoid.
--
-- THE INVARIANTS ARE IN SQL, NOT IN THE API, for the reason 67_table_state.sql gives:
-- an application check is a promise, and a CHECK constraint is enforcement for every
-- writer — a future service, a backfill, and psql. Three of the six new checks on the
-- attempt are about the difference between an outcome and a CLAIM about an outcome; the
-- other three pin its vocabulary and its counter.
--
--   payment_attempt_success_provenance_ck — THE §8G-STEP-3 INVARIANT. A success must
--       name which KIND of proof produced it. §8G step 3 ends with "never record an
--       operator assertion as provider proof", and this is the half of that sentence a
--       machine can enforce: no writer can record `succeeded` and leave the question of
--       proof unanswered. It says nothing yet about WHICH proof; that is the constraint
--       below, and the pair is what makes the two sentences true together.
--   payment_attempt_provider_proof_has_id_ck — the ADR's harder half. Proof a PROVIDER
--       gave us is a payment id; an operator's word is not one. So the operator-attested
--       path has to DECLARE ITSELF (`proof_source = 'operator_attested'`) rather than
--       passing for a capture by leaving `provider_payment_id` empty. A till whose
--       terminal timed out cannot record a paid sale with an empty field and a shrug.
--   payment_attempt_unknown_shape_ck — deliberately worded `provider is null or ...`.
--       An attempt made WITHOUT a provider adapter (the pre-existing manual-terminal and
--       cash paths) keeps working untouched and needs no command identity, while every
--       attempt made THROUGH a provider adapter carries the identity it will be queried
--       by. The ADR: an unknown must be queryable by the same command identity that
--       started it — and an attempt with no provider has nothing to query.
--   payment_attempt_provider_slug_ck — the format check described above. It makes a
--       malformed slug impossible, and nothing more: it is not a closed set.
--   payment_attempt_proof_source_ck — the four kinds of proof the contract declares
--       (`TenderProofSource` in tender.ts). A fifth spelling of the same idea, e.g.
--       'manual', is refused here rather than silently stored.
--   payment_attempt_query_count_ck — the query counter cannot go negative. Cheap, and it
--       is the column a runaway query loop is read from in production, so a value that
--       could not be a count of queries is worth refusing rather than graphing.
--
-- WHAT IS NOT ENFORCED HERE, STATED PLAINLY.
--
--   · WHICH SLUGS EXIST is not a constraint, by design (see above). A provider adapter
--     that is registered in the API and not in the database, or the reverse, is a
--     configuration question, not a schema one.
--   · "A retried payment never charges twice" is TWO mechanisms, and only one of them is
--     here. `pos_payment_attempt_command_identity_uidx` makes a SECOND attempt with the
--     same command identity impossible, and `payment_attempt_tender_draft_uq` does the
--     same for a second attempt against one tender draft, so a retry reads the first
--     attempt's own outcome instead of calling the provider again. What the database
--     cannot enforce is that the service persists the identity BEFORE it calls the
--     provider — a writer that calls first and inserts afterwards has already spent the
--     money. That ordering is the service's, and the stateful test over the attempt
--     sequence is what proves it; `provider_capture_at` is the row-level evidence that
--     the ordering held for any attempt that reached the provider at all.
--   · The RELATION between `fiscal_document.total_minor_units` and the order's total is
--     not a CHECK: it is a snapshot of a committed sale, and the invoice complement may
--     legitimately differ. The API builds it from the receipt snapshot in one transaction
--     and the fiscal integration suite asserts the stored pair.
--   · The DEADLINE IS A CLOCK, NOT A CONSTRAINT. `deadline_at` is stored and visible;
--     "which documents are still inside their clock" is a query against it, because a
--     CHECK cannot read the time. `deadline_kind` records WHICH clock is running, so the
--     owner can tell a per-ticket café from a factura-global one without reading the code.
--   · The cancellation WINDOW (the issuer may cancel without the receiver's acceptance
--     up to $1,000 MXN) is NOT constrained either. It is a business rule with a date and a
--     currency in it, enforced by the API before the PAC call, and the SAT motive is what
--     this table stores.
--   · `fiscal_document` is DELIBERATELY MUTABLE (`pending → stamped → cancelled`), so it
--     gets an `updated_at` touch trigger and NO append-only trigger. Its neighbours in this
--     cluster that are append-only are facts (a receipt, a ledger entry); this row is a
--     state machine, and freezing it would make a cancellation impossible.
--   · The PERIOD ROLL-UP that turns a period's `not_invoiced` rows into one `in_global`
--     document is a job, not a schema shape. The table carries `deadline_kind` and the
--     statuses the roll-up moves between; the aggregation itself is the API's.
--
-- SCOPE, RLS AND GRANTS. `merchant.pos_payment_attempt` ALREADY carries its grants
-- (`api` and `worker` = arwd, `readonly` = r) and its FORCED RLS row-level policy from
-- 90_rls.sql, whose sweep sets the uniform `merchant_isolation` policy plus FORCE on every
-- base table carrying `merchant_id`; that is verified in this build, so this file
-- deliberately does NOT re-grant it and does NOT touch its policies. If it had no RLS,
-- this file would say so rather than change its security posture on the way past.
-- `merchant.fiscal_document` is created AFTER 90_rls swept the catalog, so — like
-- 65_table_reservation, 67_table_state and 69_procurement record — it carries its own
-- forced RLS and its own location-narrowed policy here, and its own grants. The console
-- writes it and the state machine moves, so `api` and `worker` get select/insert/update;
-- NO delete grant at all: a stamped document is a fiscal record and a cancelled one stays
-- readable.
--
-- Idempotent and re-runnable: guarded columns, guarded constraints, a guarded table,
-- guarded indexes, guarded triggers, guarded policies.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · Extending the existing attempt record
--
-- Ten columns, added with `add column if not exists` so the file is re-runnable against
-- a database that already has some of them. Nine are nullable on purpose: the attempts
-- already in the table were written before any provider existed, and a cash attempt
-- today still carries no provider at all. The tenth is the query counter, which is NOT
-- NULL with a default of 0 because "asked zero times" is the truth for every row that
-- predates it and a NULL there would make a counter that cannot be compared.
-- ---------------------------------------------------------------------------
alter table merchant.pos_payment_attempt
  add column if not exists command_identity uuid,
  add column if not exists provider text,
  add column if not exists provider_order_id text,
  add column if not exists provider_payment_id text,
  add column if not exists provider_status text,
  add column if not exists proof_source text,
  add column if not exists query_after timestamptz,
  add column if not exists tender_draft_id uuid,
  add column if not exists provider_capture_at timestamptz,
  add column if not exists provider_query_count integer not null default 0;

comment on column merchant.pos_payment_attempt.command_identity is
  'The identity of the command that started this attempt, persisted BEFORE the provider is called. A retry of the same identity returns THIS attempt''s outcome instead of calling the provider again, and an unknown is queried by it.';
comment on column merchant.pos_payment_attempt.provider is
  'The adapter that owns this attempt, as a FREE SLUG (not an enum — see the header; a second terminal brand must not need a migration). NULL for the pre-existing cash and manual-terminal paths.';
comment on column merchant.pos_payment_attempt.provider_order_id is
  'The provider''s own order id, written when it arrives. Kept so the terminal''s settlement report can be matched to this attempt instead of reconciled by hand.';
comment on column merchant.pos_payment_attempt.provider_payment_id is
  'The provider''s own payment/charge id, written when it arrives. This is the proof a provider gave us, which is why proof_source = ''provider'' cannot be recorded without it.';
comment on column merchant.pos_payment_attempt.provider_status is
  'The provider''s status VERBATIM, kept for the audit trail — e.g. the terminal''s own ''action_required'', which means it did not answer within 40 seconds. Never read as a failure and never as a capture.';
comment on column merchant.pos_payment_attempt.proof_source is
  'What proved the outcome: ''provider'' (a payment id from the provider), ''cash'' (the drawer), ''internal_ledger'' (our own wallet/gift-card transaction) or ''operator_attested'' (a person read a screen or was told). No writer may record a success without naming one, and an operator''s word declares itself.';
comment on column merchant.pos_payment_attempt.query_after is
  'When this attempt became worth asking the provider about again. Set with an unknown or timeout outcome; NULL means there is nothing to query.';
comment on column merchant.pos_payment_attempt.tender_draft_id is
  'The CLIENT''s own tender draft id, recorded so the commit can link this attempt to the tender it paid. Deliberately NOT a foreign key to merchant.pos_tender_fact: the fact is written at commit, and an abandoned attempt must be recorded even though no fact will ever exist for it.';
comment on column merchant.pos_payment_attempt.provider_capture_at is
  'The moment we first ASKED the provider to take the money, set EXACTLY ONCE and set BEFORE the provider is called (only the writer that wins the `where provider_capture_at is null` claim may call it). Makes "asked exactly once" a fact in the row rather than a promise in the service.';
comment on column merchant.pos_payment_attempt.provider_query_count is
  'How many times we have asked the provider WHAT HAPPENED (the query route). Informational, and it is what makes a query loop visible in production.';

-- ---------------------------------------------------------------------------
-- 1b · The rows that already exist, given the provenance they can defend
--
-- THIS SECTION IS WHY THE FILE CAN BE APPLIED TO A DATABASE THAT IS NOT EMPTY, and the
-- fresh build is what hid the need for it: on a database built from the chain the table
-- is empty, so `payment_attempt_success_provenance_ck` applies without complaint. On the
-- shared rehearsal database — and, at cutover, on a production one — the table already
-- holds recorded successes, and every one of them would violate it, rolling the whole
-- transaction back with `check constraint ... is violated by some row`.
--
-- THE RULE WAS NEVER "every success carries a provider token". CASH HAS NO PROVIDER and
-- never will: its proof is the drawer and the count that reconciles it. The rule is that
-- every success NAMES what proved it, and a row written before this model existed can
-- still answer that truthfully, because the method column already says how the money was
-- taken. So the backfill reads the data rather than guessing at it:
--
--   method = 'cash'                          → 'cash'             the drawer
--   method in ('stored_value','gift_card')   → 'internal_ledger'  our own wallet's transaction
--   anything else                            → 'operator_attested' a person read a screen
--
-- `operator_attested` is not a bucket for leftovers: before this file there was no
-- provider adapter in the platform at all, so a non-cash success was recorded by the
-- till from what a person saw. Saying so is the honest record, and it is exactly what
-- the ADR forbids being read as a capture.
--
-- Idempotent by `where proof_source is null`, so a re-run is a no-op, and it runs in the
-- same transaction as the constraint so there is no window in which a row exists that the
-- constraint would refuse.
-- ---------------------------------------------------------------------------
update merchant.pos_payment_attempt
   set proof_source = case
     when method = 'cash' then 'cash'
     when method in ('stored_value','gift_card') then 'internal_ledger'
     else 'operator_attested'
   end
 where status = 'succeeded' and proof_source is null;

-- ---------------------------------------------------------------------------
-- 2 · The attempt's named invariants
--
-- Guarded with the `if not exists (select 1 from pg_constraint ...)` pattern
-- 69_procurement.sql uses, because the table predates this file: the constraint may
-- already be there on a re-run. Each one is named so a reader — and 99_verify.sql —
-- can assert the invariant itself rather than "a constraint of some kind exists".
-- ---------------------------------------------------------------------------
-- Makes IMPOSSIBLE: a recorded success with no proof source. Every writer, including
-- one that never asked the API, has to say which kind of proof produced it.
do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname='merchant' and cl.relname='pos_payment_attempt'
       and c.conname='payment_attempt_success_provenance_ck'
  ) then
    alter table merchant.pos_payment_attempt add constraint payment_attempt_success_provenance_ck
      check (status <> 'succeeded' or proof_source is not null);
  end if;
end $$;

-- Makes IMPOSSIBLE: a provider's proof without a payment id, and — the half that
-- matters on a till — an operator's word passing for a capture. An operator-attested
-- success must declare itself.
do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname='merchant' and cl.relname='pos_payment_attempt'
       and c.conname='payment_attempt_provider_proof_has_id_ck'
  ) then
    alter table merchant.pos_payment_attempt add constraint payment_attempt_provider_proof_has_id_ck
      check (proof_source is distinct from 'provider' or provider_payment_id is not null);
  end if;
end $$;

-- Makes IMPOSSIBLE: an ambiguous attempt made through a provider adapter with no
-- command identity, i.e. an unknown that can never be queried. `provider is null or ...`
-- is deliberate: the pre-existing manual-terminal and cash paths write no provider and
-- keep working untouched.
do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname='merchant' and cl.relname='pos_payment_attempt'
       and c.conname='payment_attempt_unknown_shape_ck'
  ) then
    alter table merchant.pos_payment_attempt add constraint payment_attempt_unknown_shape_ck
      check (status not in ('unknown','timeout') or provider is null or command_identity is not null);
  end if;
end $$;

-- Makes IMPOSSIBLE: a malformed provider slug. A format check, not a closed set: the
-- known slugs are named in a comment above and adding one is not a migration.
do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname='merchant' and cl.relname='pos_payment_attempt'
       and c.conname='payment_attempt_provider_slug_ck'
  ) then
    alter table merchant.pos_payment_attempt add constraint payment_attempt_provider_slug_ck
      check (provider is null or provider ~ '^[a-z][a-z0-9_]{1,39}$');
  end if;
end $$;

-- Makes IMPOSSIBLE: a fifth spelling of proof — the four values the contract
-- declares are the four that can be stored.
do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname='merchant' and cl.relname='pos_payment_attempt'
       and c.conname='payment_attempt_proof_source_ck'
  ) then
    alter table merchant.pos_payment_attempt add constraint payment_attempt_proof_source_ck
      check (proof_source is null or proof_source in
        ('provider','cash','internal_ledger','operator_attested'));
  end if;
end $$;

-- Makes IMPOSSIBLE: a negative query count, i.e. a counter that was decremented or
-- written by hand. Cheap, and it is the column a production query loop is read from.
do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname='merchant' and cl.relname='pos_payment_attempt'
       and c.conname='payment_attempt_query_count_ck'
  ) then
    alter table merchant.pos_payment_attempt add constraint payment_attempt_query_count_ck
      check (provider_query_count >= 0);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · The retry guarantee, and the index deliberately not added
--
-- One command identity is one attempt. This is what makes a retry return the FIRST
-- attempt's own outcome instead of calling the provider a second time — the money
-- half of the sentence "a retried payment never charges twice" (the ordering half is
-- the service's; see the header). Partial, because the attempts written before any
-- provider existed carry no identity and must not collide with each other on NULL.
--
-- Deliberately absent: an index on `(merchant_id, cart_id, status)`. A per-cart
-- lookup is checked first, and `pos_payment_attempt_cart_tender_uq
-- (merchant_id, cart_id, tender_id)` is already a btree on exactly those leading
-- columns, so a second index on the same leading columns would be redundant — it would
-- cost a write on every attempt and buy a prefix scan the unique key already serves.
-- ---------------------------------------------------------------------------
create unique index if not exists pos_payment_attempt_command_identity_uidx
  on merchant.pos_payment_attempt (merchant_id, command_identity)
  where command_identity is not null;

comment on index merchant.pos_payment_attempt_command_identity_uidx is
  'One command identity is one attempt. A retry of the identity finds the first attempt instead of charging again.';

-- One attempt per tender draft, so a second concurrent capture for the SAME draft
-- cannot create a second attempt either. With the command-identity index above this is
-- the money-path race guard: whichever of the two identities a racing writer arrives
-- with, the second one collides and reads the first attempt instead of reaching the
-- provider. Partial for the same reason as its sibling: the attempts written before
-- this column existed carry no draft id and must not collide with each other on NULL.
create unique index if not exists payment_attempt_tender_draft_uq
  on merchant.pos_payment_attempt (merchant_id, cart_id, tender_draft_id)
  where tender_draft_id is not null;

comment on index merchant.payment_attempt_tender_draft_uq is
  'One attempt per tender draft. A second concurrent capture for the same draft collides here and reads the first attempt instead of calling the provider again.';

-- ---------------------------------------------------------------------------
-- 4 · The fiscal document — the fiscal lens on a sale
--
-- `receipt_snapshot_id` is nullable because a document can exist BEFORE its receipt
-- row: the fiscal path is reached from a committed sale, and a cancelled or errored
-- document is still a fiscal record even if the receipt was never issued. The
-- reference is on delete restrict, like every other scope reference in this cluster.
--
-- The three named shape constraints below are the state machine's rails. The two
-- `= ( ... is not null)` pairs each say "this status and its evidence are the same
-- fact": a stamped document has its folio and its timestamp, a cancelled one has its
-- timestamp and its SAT motive, and neither can be recorded without the other.
-- `fiscal_document_global_is_aggregate` says a factura global has no named receptor —
-- the global's receptor is público en general (XAXX010101000), not a party, so a global
-- document carrying a customer RFC is a modelling error rather than a special case.
-- ---------------------------------------------------------------------------
create table if not exists merchant.fiscal_document (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  order_id uuid not null references merchant.customer_order(id) on delete restrict,
  receipt_snapshot_id uuid references merchant.receipt_snapshot(id) on delete restrict,
  kind text not null check (kind in ('nominative','global')),
  status text not null
    check (status in ('not_invoiced','pending_self_invoice','in_global','stamped','cancelled','error')),
  uuid_folio uuid,
  total_minor_units bigint not null check (total_minor_units >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  receptor_rfc text check (receptor_rfc is null or receptor_rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
  receptor_name text,
  receptor_postal_code text check (receptor_postal_code is null or receptor_postal_code ~ '^[0-9]{5}$'),
  regimen_fiscal text check (regimen_fiscal is null or regimen_fiscal ~ '^[0-9]{3}$'),
  uso_cfdi text,
  payment_form text,
  payment_method text,
  provider_document_id text,
  deadline_at timestamptz not null,
  deadline_kind text not null check (deadline_kind in ('operation','period_close')),
  stamped_at timestamptz,
  cancelled_at timestamptz,
  cancellation_motive text check (cancellation_motive is null or cancellation_motive in ('01','02','03','04')),
  cancellation_reason text,
  error_message text,
  command_id uuid,
  idempotency_key uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- THE FOLIO AND THE STAMPING TIME TRAVEL TOGETHER, AND A CANCELLED DOCUMENT KEEPS THEM.
  -- The first draft made this a biconditional on `status = 'stamped'`, which forced any
  -- writer cancelling a stamped document to NULL its `uuid_folio` — and the UUID is the
  -- SAT's folio fiscal, the one thing that identifies WHICH document was cancelled. An
  -- auditor, a credit note and a later cancellation of that cancellation all refer to it.
  -- So the shape says what is actually true:
  --   · a document that is currently `stamped` HAS the pair;
  --   · the pair is present or absent TOGETHER (a folio with no stamping time, or the
  --     reverse, is a half-written stamp);
  --   · a `cancelled` document may carry the pair (it was stamped, then cancelled) or not
  --     (it was cancelled before it ever reached the PAC).
  constraint fiscal_document_stamped_shape
    check ((status <> 'stamped' or (uuid_folio is not null and stamped_at is not null))
           and ((uuid_folio is null) = (stamped_at is null))),
  constraint fiscal_document_cancelled_shape
    check ((status = 'cancelled') = (cancelled_at is not null and cancellation_motive is not null)),
  constraint fiscal_document_global_is_aggregate check (kind <> 'global' or receptor_rfc is null),
  -- One document of a given kind per sale: the same order cannot be stamped twice, and
  -- no order can be pulled into two different global documents. This is the schema half
  -- of the API's "stamping is idempotent by sale".
  unique (merchant_id, order_id, kind),
  -- Present for the same reason every table in this cluster carries it: a future
  -- composite foreign key can then name the merchant and the row together, and UUID
  -- uniqueness alone is not a scope check.
  unique (merchant_id, id)
);

-- ---------------------------------------------------------------------------
-- 5b · The stamped-shape correction, for a database that already has the first draft
--
-- `create table if not exists` above is a no-op on a database where this file already ran,
-- so a constraint that was created with the weaker biconditional would stay weak — and the
-- weaker one is not harmless: it makes a cancelled document's folio IMPOSSIBLE to keep.
-- This block is therefore both a guard and a correction, and it is idempotent in the sense
-- that matters: it does nothing when the constraint is already the right shape.
--
-- It is written as a definition comparison rather than a version check because the only
-- thing that matters is what the server is ENFORCING right now.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace ns on ns.oid = cl.relnamespace
   where ns.nspname='merchant' and cl.relname='fiscal_document'
     and c.conname='fiscal_document_stamped_shape';

  if v_def is null then
    alter table merchant.fiscal_document add constraint fiscal_document_stamped_shape
      check ((status <> 'stamped' or (uuid_folio is not null and stamped_at is not null))
             and ((uuid_folio is null) = (stamped_at is null)));
    -- The MARKER is the folio/stamp-time pairing clause. Only the corrected shape has it, so
    -- its absence is exactly "this database still carries the first draft", which is what the
    -- correction is looking for — and it is a marker rather than a whole-string comparison
    -- because PostgreSQL's rendering of a CHECK is its own business, not ours to predict.
  elsif v_def not like '%uuid_folio IS NULL%' then
    -- Replacing a CHECK revalidates every existing row, which is the point: a row that the
    -- corrected shape would refuse is a row that was already wrong.
    alter table merchant.fiscal_document drop constraint fiscal_document_stamped_shape;
    alter table merchant.fiscal_document add constraint fiscal_document_stamped_shape
      check ((status <> 'stamped' or (uuid_folio is not null and stamped_at is not null))
             and ((uuid_folio is null) = (stamped_at is null)));
    raise notice 'fiscal_document_stamped_shape replaced with the folio-keeping shape';
  end if;
end $$;

comment on table merchant.fiscal_document is
  'The fiscal lens on a sale: the CFDI as a document of its own, with its own state machine. The UUID, the RFC, the payment form and the payment method live HERE rather than being duplicated onto the order, because two copies of a fiscal fact can disagree and this row is the one the PAC and the SAT see.';
comment on column merchant.fiscal_document.status is
  'THE CONTRACT''S OWN VOCABULARY: packages/contract/src/fiscal.ts declares CfdiStatus with exactly these six values (not_invoiced, pending_self_invoice, in_global, stamped, cancelled, error), and matching it is deliberate so no translation layer is needed between the API and this column.';
comment on column merchant.fiscal_document.kind is
  'nominative (a CFDI for a named receptor) or global (the period''s aggregate for public sales, receptor público en general).';
comment on column merchant.fiscal_document.payment_form is
  'SAT c_FormaPago: ''01'' efectivo, ''04'' tarjeta de crédito, ''28'' tarjeta de débito. Stored because the PAC needs it to stamp and the SAT audits it.';
comment on column merchant.fiscal_document.payment_method is
  'SAT c_MetodoPago: ''PUE'' (pago en una sola exhibición) or ''PPD'' (pago en parcialidades o diferido).';
comment on column merchant.fiscal_document.provider_document_id is
  'The PAC''s own invoice id. REQUIRED to cancel a CFDI, which is why it is stored here rather than looked up again at cancellation time.';
comment on column merchant.fiscal_document.deadline_at is
  'The clock, never implied: 24 hours from the operation, or 24 hours after the period closes. Stored so it can be shown before it expires.';
comment on column merchant.fiscal_document.deadline_kind is
  '''operation'' = 24h from the operation; ''period_close'' = 24h after the period closes (factura global). A café may run either, and the owner has to see which one is running.';

-- ---------------------------------------------------------------------------
-- 5 · The fiscal document's indexes
--
-- The SAT folio UUID is unique per merchant and exists only once stamped, so it is a
-- PARTIAL unique index: the pre-stamp rows all carry NULL and must not collide. The
-- deadline index is the owner's view — "which documents are still inside their clock"
-- — and it leads with the merchant and the status because that is the question every
-- read of it asks.
-- ---------------------------------------------------------------------------
create unique index if not exists fiscal_document_uuid_folio_uq
  on merchant.fiscal_document (merchant_id, uuid_folio)
  where uuid_folio is not null;

create index if not exists fiscal_document_deadline_idx
  on merchant.fiscal_document (merchant_id, status, deadline_at);

-- ---------------------------------------------------------------------------
-- 6 · The clock, stated plainly
--
-- `deadline_at` is NOT NULL and never inferred: the row is written with the clock that
-- applies to it, so a document can be shown as approaching its deadline without
-- recomputing the SAT rule from the sale date (the rule differs for a per-ticket café
-- and a factura-global one, and `deadline_kind` is what says which).
--
-- Everything that reads the clock is a query, not a constraint: "still inside its
-- clock", "overdue", and the period roll-up are all things a CHECK cannot express, and
-- the row is mutable precisely so the state machine can move (`pending → stamped →
-- cancelled`). That mutability is also why section 7 attaches the touch trigger and no
-- append-only trigger.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 7 · Triggers
--
-- 60_triggers swept the catalog before this table existed, so the touch trigger is
-- attached by hand — the same reason 65_table_reservation, 67_table_state and
-- 69_procurement record. No append-only trigger: this row is a state machine and
-- deliberately mutable, unlike the receipts and ledger entries it sits beside.
-- ---------------------------------------------------------------------------
drop trigger if exists touch_updated_at on merchant.fiscal_document;
create trigger touch_updated_at before update on merchant.fiscal_document
  for each row execute function public.tg_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 8 · Grants and RLS
--
-- The console is the only writer and the state machine moves forward and back
-- (stamp, cancel), so `api` and `worker` get select/insert/update. NO delete: a
-- stamped document is a fiscal record, and a cancelled one stays readable.
--
-- `merchant.pos_payment_attempt` is NOT granted or re-policied here even though this
-- file widens it. It already carries api=arwd, worker=arwd and readonly=r from
-- 90_rls.sql's uniform `grant ... on all tables in schema merchant`, and forced RLS with
-- the `merchant_isolation` policy from that file's sweep over every base table carrying
-- `merchant_id`. That was verified in this build; re-stating it would be noise, and
-- changing its security posture on the way past would be worse. If it had no RLS, this
-- file would say so instead.
-- ---------------------------------------------------------------------------
grant select,insert,update on merchant.fiscal_document to api,worker;
grant select on merchant.fiscal_document to readonly;

do $$
declare t text;
begin
  foreach t in array array['fiscal_document'] loop
    execute format('alter table merchant.%I enable row level security',t);
    execute format('alter table merchant.%I force row level security',t);
    -- `fiscal_document` carries the location and takes the narrowing
    -- 67_table_state.sql uses, so a location-scoped session cannot read another
    -- branch's documents. Both branches are kept, as in 69_procurement.sql, so a table
    -- added to this loop later lands in the right one without anyone re-reading it.
    if exists (
      select 1 from information_schema.columns
       where table_schema='merchant' and table_name=t and column_name='location_id'
    ) then
      execute format('drop policy if exists %I on merchant.%I', t||'_scope', t);
      execute format(
        'create policy %I on merchant.%I using (merchant_id=(select umi.current_merchant()) and ((select umi.current_location()) is null or location_id=(select umi.current_location()))) with check (merchant_id=(select umi.current_merchant()) and ((select umi.current_location()) is null or location_id=(select umi.current_location())))',
        t||'_scope',t
      );
    else
      execute format('drop policy if exists %I on merchant.%I', t||'_scope', t);
      execute format(
        'create policy %I on merchant.%I using (merchant_id=(select umi.current_merchant())) with check (merchant_id=(select umi.current_merchant()))',
        t||'_scope',t
      );
    end if;
  end loop;
end $$;

insert into runtime.schema_migration(version,status)
values('build-v3-70','applied') on conflict(version) do nothing;

commit;
