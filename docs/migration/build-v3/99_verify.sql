-- ============================================================================
-- build-v3 · 99_verify — build sanity assertions (RAISE on failure)
-- ============================================================================
do $$
declare n int;
begin
  -- schemas
  if not exists (select 1 from information_schema.schemata where schema_name='umi')     then raise exception 'missing schema umi';     end if;
  if not exists (select 1 from information_schema.schemata where schema_name='merchant')  then raise exception 'missing schema merchant';  end if;
  if not exists (select 1 from information_schema.schemata where schema_name='runtime') then raise exception 'missing schema runtime'; end if;
  if not exists (select 1 from information_schema.schemata where schema_name='kds')     then raise exception 'missing schema kds';     end if;

  -- roles
  if not exists (select 1 from pg_roles where rolname='api')      then raise exception 'missing role api'; end if;
  if not exists (select 1 from pg_roles where rolname='worker' and rolbypassrls) then raise exception 'worker must be BYPASSRLS'; end if;
  if not exists (select 1 from pg_roles where rolname='readonly') then raise exception 'missing role readonly'; end if;

  -- Append-only triggers on the two money ledgers, PRESENT AND ENABLED.
  --
  -- ⚠️ Test `tgenabled`, and do not test only for the row. `pg_trigger` keeps the
  -- row when a trigger is disabled, so `not exists (...)` reported OK while
  -- `alter table ... disable trigger` had left the ledger writable. That is the
  -- exact state a half-applied migration leaves behind, and this check exists to
  -- find it. Measured 2026-08-14: verify said OK with tgenabled = 'D'.
  --
  -- 'D' is disabled. 'O', 'R' and 'A' all fire on an ordinary write.
  if not exists (select 1 from pg_trigger where tgname='stored_value_ledger_append_only') then raise exception 'missing append-only trigger: stored_value_ledger'; end if;
  if not exists (select 1 from pg_trigger where tgname='gift_card_ledger_append_only')    then raise exception 'missing append-only trigger: gift_card_ledger';    end if;
  if exists (select 1 from pg_trigger where tgname='stored_value_ledger_append_only' and tgenabled='D') then raise exception 'append-only trigger DISABLED: stored_value_ledger — the money ledger is writable'; end if;
  if exists (select 1 from pg_trigger where tgname='gift_card_ledger_append_only'    and tgenabled='D') then raise exception 'append-only trigger DISABLED: gift_card_ledger — the money ledger is writable';    end if;

  -- views exist (derive, don't cache)
  if not exists (select 1 from information_schema.views where table_schema='umi'    and table_name='effective_entitlement')  then raise exception 'missing view umi.effective_entitlement'; end if;
  if not exists (select 1 from information_schema.views where table_schema='merchant' and table_name='conversation_analytics') then raise exception 'missing view merchant.conversation_analytics'; end if;

  -- RLS enabled on a representative merchant money table
  if not exists (
    select 1 from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='loyalty_stored_value_ledger' and cl.relrowsecurity
  ) then raise exception 'RLS not enabled on merchant.loyalty_stored_value_ledger'; end if;

  -- UmiPOS integration authorities must exist in the build-v3 chain.
  if not exists (
    select 1 from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='cash_ledger_entry'
      and cl.relrowsecurity and cl.relforcerowsecurity
  ) then raise exception 'Gate 3 cash ledger RLS is incomplete'; end if;
  if not exists (
    select 1 from pg_trigger where tgname='cash_ledger_immutable'
  ) then raise exception 'missing append-only trigger: cash_ledger'; end if;
  if not exists (
    select 1 from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='pos_sale_exception'
      and cl.relrowsecurity and cl.relforcerowsecurity
  ) then raise exception 'Gate 3D sale exception RLS is incomplete'; end if;
  if not exists (
    select 1 from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='kitchen_order'
      and cl.relrowsecurity and cl.relforcerowsecurity
  ) then raise exception 'Gate 4A kitchen order RLS is incomplete'; end if;
  if not exists (
    select 1 from pg_trigger where tgname='kitchen_event_append_only'
  ) then raise exception 'missing append-only trigger: kitchen_event'; end if;
  if not exists (
    select 1 from information_schema.views
    where table_schema='kds' and table_name='station_order'
  ) then raise exception 'missing Gate 4A station order view'; end if;
  if not exists (
    select 1 from pg_trigger where tgname='pos_sale_exception_append_only'
  ) then raise exception 'missing append-only trigger: pos_sale_exception'; end if;
  if not exists (
    select 1 from pg_trigger where tgname='pos_exception_receipt_append_only'
  ) then raise exception 'missing append-only trigger: pos_exception_receipt'; end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema='runtime' and table_name='device_pairing_session'
  ) then raise exception 'missing UmiPOS device pairing session'; end if;
  if not exists (
    select 1 from runtime.schema_migration
    where version='build-v3-45' and status='applied'
  ) then raise exception 'missing Gate 6A schema version'; end if;

  -- observability must NOT exist (killed 2026-07-11)
  if exists (select 1 from information_schema.schemata where schema_name='observability') then raise exception 'observability schema should not exist'; end if;

  -- Workstream D · floor plan and table map. merchant.floor_plan is stamped
  -- build-v3-62 by its own file, and for a while that file was missing from this
  -- chain while every real database had it: the version said 62 and a database
  -- built here had no such table. Nobody noticed because nothing here asked.
  if not exists (
    select 1 from information_schema.tables
    where table_schema='merchant' and table_name='floor_plan'
  ) then raise exception 'missing merchant.floor_plan'; end if;

  -- The double-booking guarantee must be PRESENT, not merely intended. A
  -- reservation table without its exclusion constraint accepts every overlap,
  -- and nothing else in this file would say so.
  if not exists (
    select 1 from information_schema.tables
    where table_schema='merchant' and table_name='table_reservation'
  ) then raise exception 'missing merchant.table_reservation'; end if;
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
    where ns.nspname='merchant' and cl.relname='table_reservation'
      and c.conname='table_reservation_no_double_booking' and c.contype='x'
  ) then raise exception 'missing exclusion constraint merchant.table_reservation_no_double_booking'; end if;

  -- Workstream D · steps 3 to 5: the live state of a table. The TABLE is not the
  -- interesting half — the CONSTRAINTS are. A table_state without its presence
  -- rules accepts `state='seated'` with no seated_at, which is a turn timer with
  -- no origin, and every count downstream inherits the lie. So each named
  -- constraint is asserted by name, and so is the trigger that keeps the turn
  -- timer from restarting while a party stays.
  if not exists (
    select 1 from information_schema.tables
    where table_schema='merchant' and table_name='table_state'
  ) then raise exception 'missing merchant.table_state'; end if;
  if not exists (
    select 1 from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='table_state'
      and cl.relrowsecurity and cl.relforcerowsecurity
  ) then raise exception 'merchant.table_state RLS is not forced'; end if;
  if not exists (
    select 1 from pg_policy p join pg_class cl on cl.oid=p.polrelid
      join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='table_state' and p.polname='table_state_scope'
  ) then raise exception 'missing policy merchant.table_state.table_state_scope'; end if;
  if not exists (
    select 1 from pg_constraint c join pg_class cl on cl.oid=c.conrelid
      join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='table_state' and c.contype='c'
      and c.conname in ('table_state_party_presence','table_state_party_size_present',
                        'table_state_party_size_range','table_state_group_requires_party')
    group by cl.relname having count(*) = 4
  ) then raise exception 'merchant.table_state is missing one of its party invariants (party_presence, party_size_present, party_size_range, group_requires_party)'; end if;
  if not exists (
    select 1 from pg_trigger
    where tgname='table_state_turn_timer_immutable' and not tgisinternal
  ) then raise exception 'missing trigger: table_state_turn_timer_immutable — a move could restart the turn timer'; end if;
  if exists (
    select 1 from pg_trigger
    where tgname='table_state_turn_timer_immutable' and tgenabled='D'
  ) then raise exception 'trigger DISABLED: table_state_turn_timer_immutable — a move could restart the turn timer'; end if;

  -- Workstream E · step 3 (build-v3-69): purchase orders, suppliers and receiving.
  --
  -- The TABLE list is the least interesting half here, and asserting only it is
  -- how a half-applied migration passes: a `purchase_order_line` without
  -- `purchase_order_line_not_over_received` accepts a delivery larger than the
  -- order, which is the one thing this increment exists to prevent, and a
  -- `stock_ledger_entry` whose CHECK lost `purchase_received` makes receiving
  -- impossible while every table still exists. So the named constraints and the
  -- ledger's accepted entry types are asserted by NAME and by DEFINITION.
  if not exists (
    select 1 from information_schema.tables
    where table_schema='merchant'
      and table_name in ('supplier','purchase_order','purchase_order_line',
                         'purchase_order_receipt','purchase_order_receipt_line')
    group by table_schema having count(*) = 5
  ) then raise exception 'build-v3-69 is incomplete: one of merchant.supplier, purchase_order, purchase_order_line, purchase_order_receipt, purchase_order_receipt_line is missing'; end if;
  if not exists (
    select 1 from pg_constraint c join pg_class cl on cl.oid=c.conrelid
      join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='purchase_order_line'
      and c.conname='purchase_order_line_not_over_received' and c.contype='c'
      and pg_get_constraintdef(c.oid) like '%received_quantity <= ordered_quantity%'
  ) then raise exception 'merchant.purchase_order_line has no over-receipt guard — a purchase order could be received twice over'; end if;
  if not exists (
    select 1 from pg_constraint c join pg_class cl on cl.oid=c.conrelid
      join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='purchase_order'
      and c.conname='purchase_order_sent_shape' and c.contype='c'
  ) then raise exception 'merchant.purchase_order is missing purchase_order_sent_shape — a draft could carry a sent_at, or a sent order could lose one'; end if;
  if not exists (
    select 1 from pg_constraint c join pg_class cl on cl.oid=c.conrelid
      join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='stock_ledger_entry'
      and c.conname='stock_ledger_entry_entry_type_check'
      and pg_get_constraintdef(c.oid) like '%purchase_received%'
      and pg_get_constraintdef(c.oid) like '%purchase_ordered%'
      and pg_get_constraintdef(c.oid) like '%purchase_order_cancelled%'
  ) then raise exception 'merchant.stock_ledger_entry rejects the procurement entry types — a receipt that cannot be posted is not a receipt'; end if;
  -- The ledger FUNCTION has to know the types too. A CHECK that accepts
  -- `purchase_received` while the function's CASE falls through to
  -- INVENTORY_ENTRY_TYPE_INVALID is the exact half-applied shape that a
  -- constraint-only assertion would call OK.
  if not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='merchant' and p.proname='append_stock_ledger'
      and pg_get_functiondef(p.oid) like '%purchase_received%'
      and pg_get_functiondef(p.oid) like '%v_in_transit := -p_quantity%'
  ) then raise exception 'merchant.append_stock_ledger has no purchase_received branch — the ledger would refuse a real receipt'; end if;
  if not exists (
    select 1 from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname in ('supplier','purchase_order')
      and cl.relrowsecurity and cl.relforcerowsecurity
    group by ns.nspname having count(*) = 2
  ) then raise exception 'build-v3-69 RLS is not forced on merchant.supplier and merchant.purchase_order'; end if;

  -- Workstream G · step 3 (build-v3-70): the attempt record and its three outcomes,
  -- plus step 5's fiscal document. The proof constraints are asserted by DEFINITION, not
  -- by existence, because each one can be dropped and re-added with a weaker expression
  -- and still "exist": a success-provenance guard that no longer mentions `proof_source`
  -- accepts a paid sale with no proof at all, which is the whole invariant this increment
  -- exists to hold. The same story on the query side: an unknown attempt whose command
  -- identity is optional cannot be asked about, and it still verifies as "a constraint is
  -- present". The two retry guards are asserted as indexes for the same reason — what
  -- makes a retry safe is the uniqueness, not the object's name.
  if not exists (
    select 1 from information_schema.tables
    where table_schema='merchant' and table_name='fiscal_document'
  ) then raise exception 'missing merchant.fiscal_document'; end if;
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
    where ns.nspname='merchant' and cl.relname='pos_payment_attempt'
      and c.conname='payment_attempt_success_provenance_ck' and c.contype='c'
      and pg_get_constraintdef(c.oid) like '%proof_source%'
  ) then raise exception 'merchant.pos_payment_attempt has no success-provenance guard — a success could be recorded without saying what proved it'; end if;
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
    where ns.nspname='merchant' and cl.relname='pos_payment_attempt'
      and c.conname='payment_attempt_provider_proof_has_id_ck' and c.contype='c'
      and pg_get_constraintdef(c.oid) like '%provider_payment_id%'
  ) then raise exception 'merchant.pos_payment_attempt has no provider-proof guard — an operator''s word could pass for a capture'; end if;
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
    where ns.nspname='merchant' and cl.relname='pos_payment_attempt'
      and c.conname='payment_attempt_unknown_shape_ck' and c.contype='c'
      and pg_get_constraintdef(c.oid) like '%command_identity%'
  ) then raise exception 'merchant.pos_payment_attempt has no unknown-shape guard — a provider attempt could be recorded ambiguous with no identity to query it by'; end if;
  -- The retry guarantee itself, asserted as an index rather than inferred from the
  -- constraint list: it is the object that makes a second attempt with the same command
  -- identity impossible.
  if not exists (
    select 1 from pg_indexes
    where schemaname='merchant' and tablename='pos_payment_attempt'
      and indexname='pos_payment_attempt_command_identity_uidx'
  ) then raise exception 'missing pos_payment_attempt_command_identity_uidx — a retry could charge twice'; end if;
  -- The second half of the race guard, and it has to be UNIQUE to be one: a plain
  -- index of the same name would let two concurrent captures write two attempts for one
  -- draft and verify as "the index is there". So the assertion reads pg_index.indisunique
  -- rather than pg_indexes by name.
  if not exists (
    select 1
      from pg_class i
      join pg_index ix on ix.indexrelid = i.oid
      join pg_class t on t.oid = ix.indrelid
      join pg_namespace ns on ns.oid = t.relnamespace
    where ns.nspname='merchant' and t.relname='pos_payment_attempt'
      and i.relname='payment_attempt_tender_draft_uq' and ix.indisunique
  ) then raise exception 'missing UNIQUE index payment_attempt_tender_draft_uq — two concurrent captures for one tender draft could both reach the provider'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='merchant' and table_name='pos_payment_attempt'
      and column_name in ('tender_draft_id','provider_capture_at')
    group by table_schema, table_name having count(*) = 2
  ) then raise exception 'merchant.pos_payment_attempt is missing tender_draft_id or provider_capture_at'; end if;
  -- The proof vocabulary itself, asserted by the values the constraint ENFORCES rather
  -- than by its name. `internal_ledger` is the one that is easy to lose: it is the proof
  -- for a stored-value or gift-card success, which rests on our own wallet's transaction
  -- — and dropping it would make those rows storable only as an operator's word, which is
  -- the one thing the ADR says a non-provider success must not be confused with.
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
    where ns.nspname='merchant' and cl.relname='pos_payment_attempt'
      and c.conname='payment_attempt_proof_source_ck' and c.contype='c'
      and pg_get_constraintdef(c.oid) like '%internal_ledger%'
      and pg_get_constraintdef(c.oid) like '%operator_attested%'
      and pg_get_constraintdef(c.oid) like '%provider%'
      and pg_get_constraintdef(c.oid) like '%cash%'
  ) then raise exception 'merchant.pos_payment_attempt.proof_source does not accept the four declared proof sources'; end if;
  -- Every recorded success, including the ones that predate this file, can name its
  -- proof. This is the assertion that would have caught the upgrade failure on a fresh
  -- build: the constraint can apply cleanly to an empty table and still be unsatisfiable
  -- on a database that has been trading.
  if exists (
    select 1 from merchant.pos_payment_attempt
    where status = 'succeeded' and proof_source is null
  ) then raise exception 'a recorded success cannot name what proved it — the 70_tender backfill did not cover every row'; end if;
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
    where ns.nspname='merchant' and cl.relname='pos_payment_attempt'
      and c.conname='payment_attempt_query_count_ck' and c.contype='c'
      and pg_get_constraintdef(c.oid) like '%provider_query_count%'
  ) then raise exception 'merchant.pos_payment_attempt is missing payment_attempt_query_count_ck'; end if;
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
    where ns.nspname='merchant' and cl.relname='fiscal_document'
      and c.conname='fiscal_document_cancelled_shape' and c.contype='c'
  ) then raise exception 'merchant.fiscal_document is missing fiscal_document_cancelled_shape — a cancelled CFDI without its SAT motive is not a cancellation'; end if;
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
    where ns.nspname='merchant' and cl.relname='fiscal_document'
      and c.conname='fiscal_document_stamped_shape' and c.contype='c'
  ) then raise exception 'merchant.fiscal_document is missing fiscal_document_stamped_shape — a stamped CFDI must carry its folio and its timestamp together'; end if;
  if not exists (
    select 1 from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='fiscal_document'
      and cl.relrowsecurity and cl.relforcerowsecurity
  ) then raise exception 'merchant.fiscal_document RLS is not forced'; end if;
  if not exists (
    select 1 from runtime.schema_migration
    where version in ('build-v3-70','build-v3-71') and status='applied'
  ) then raise exception 'missing build-v3-70 schema version'; end if;

  -- build-v3-71 rebuilt two conditional immutability triggers so their DELETE
  -- branch returns OLD instead of NEW (returning NEW in a delete trigger is NULL
  -- and CANCELS the delete silently). Assert the shape, not just the version row:
  -- a database that took the version bump without the new body would still swallow
  -- the writes the guard is meant to refuse, and that is the defect this file fixed.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='merchant'
       and p.proname in ('tg_pos_checkout_terminal_immutable','tg_pos_tender_committed_immutable')
       and p.prosrc like '%return old;%'
       and p.prosrc like '%tg_op = ''DELETE''%'
    group by n.nspname having count(*) = 2
  ) then
    raise exception 'build-v3-71: an immutability trigger still returns NEW on DELETE';
  end if;

  -- Workstream D's follow-through (build-v3-68): a register held by a terminal
  -- that is gone has to be reclaimable, and the reclaim must land on `blocked`
  -- WITHOUT consuming a drawer count. The second half is the part that would
  -- rot silently: the constraint is dropped and re-added by a later migration,
  -- and a shape that no longer mentions `orphan_reclaim` still verifies as
  -- "a check constraint exists". So the branch itself is asserted.
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
    where ns.nspname='merchant' and cl.relname='cash_shift_custody_event'
      and c.conname='cash_custody_shape'
      and pg_get_constraintdef(c.oid) like '%orphan_reclaim%'
  ) then raise exception 'merchant.cash_shift_custody_event.cash_custody_shape has no orphan_reclaim branch — a reclaimed drawer could be recorded as counted'; end if;
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
    where ns.nspname='merchant' and cl.relname='cash_shift_custody_event'
      and c.conname='cash_shift_custody_event_event_type_check'
      and pg_get_constraintdef(c.oid) like '%orphan_reclaim%'
  ) then raise exception 'merchant.cash_shift_custody_event rejects the orphan_reclaim event type'; end if;
  -- The two guards the reclaim has to pass. `pg_get_expr` reads the policy the
  -- server is actually enforcing, which is the only way to tell a WITH CHECK that
  -- gained a clause from one that still says "the opening terminal, or nothing".
  if not exists (
    select 1 from pg_policy p
      join pg_class cl on cl.oid = p.polrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
    where ns.nspname='merchant' and cl.relname='cash_shift' and p.polname='device_scoping'
      and p.polpermissive = false
      and pg_get_expr(p.polwithcheck, p.polrelid) like '%device_is_usable%'
  ) then raise exception 'merchant.cash_shift.device_scoping has no orphan-reclaim clause — a till could never free a dead terminal''s drawer'; end if;
  if not exists (
    select 1 from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
    where ns.nspname='merchant' and pr.proname='device_is_usable'
  ) then raise exception 'missing merchant.device_is_usable — the one definition of a terminal that can still authenticate'; end if;
  if not exists (
    select 1 from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
    where ns.nspname='merchant' and pr.proname='tg_closed_cash_shift_immutable'
      and pg_get_functiondef(pr.oid) like '%device_is_usable%'
  ) then raise exception 'merchant.tg_closed_cash_shift_immutable has no orphan-reclaim branch — the transition would be refused after the policy allowed it'; end if;

  -- Workstream G · step 5 (build-v3-72): the Mercado Pago Point surface — the terminal an
  -- attempt holds, the D4 one-open-order-per-terminal guard, the per-merchant credential,
  -- the terminal bound to a register, and the realtime nudge.
  --
  -- The D4 index is the one assertion here that CANNOT be reduced to "the object exists".
  -- A plain (non-unique) index, or a unique one whose predicate lost a status, still
  -- "exists" by name and still lets two open attempts share a terminal — which is the one
  -- thing this increment exists to refuse. So the assertion reads pg_index.indisunique and
  -- the SERVER'S OWN rendering of the predicate, the same way the build-v3-68 block reads
  -- pg_get_expr for the cash-shift policy. And because a terminal id is copied verbatim and
  -- never rebuilt, the shape guard is asserted by the expression the server enforces, not
  -- by the constraint's name.
  if not exists (
    select 1 from information_schema.columns
    where table_schema='merchant' and table_name='pos_payment_attempt'
      and column_name='terminal_id'
  ) then raise exception 'build-v3-72: merchant.pos_payment_attempt has no terminal_id — the till could not say which terminal an attempt is holding'; end if;
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid=c.conrelid
      join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='pos_payment_attempt'
      and c.conname='payment_attempt_terminal_id_ck' and c.contype='c'
      and pg_get_constraintdef(c.oid) like '%terminal_id ~%'
      -- `\_` is LIKE's escaped literal underscore, so this is the `type__serial`
      -- separator itself and not the two-character wildcard `__` would be.
      and pg_get_constraintdef(c.oid) like '%\_\_%'
  ) then raise exception 'build-v3-72: merchant.pos_payment_attempt.terminal_id has no vendor-shape guard — a hand-rebuilt terminal id could be stored where a verbatim one is required'; end if;
  if not exists (
    select 1
      from pg_class i
      join pg_index ix on ix.indexrelid = i.oid
      join pg_class t on t.oid = ix.indrelid
      join pg_namespace ns on ns.oid = t.relnamespace
    where ns.nspname='merchant' and t.relname='pos_payment_attempt'
      and i.relname='pos_payment_attempt_open_terminal_uq'
      and ix.indisunique
      and ix.indpred is not null
      and pg_get_expr(ix.indpred, ix.indrelid) like '%terminal_id IS NOT NULL%'
      and pg_get_expr(ix.indpred, ix.indrelid) like '%pending%'
      and pg_get_expr(ix.indpred, ix.indrelid) like '%unknown%'
      and pg_get_expr(ix.indpred, ix.indrelid) like '%timeout%'
  ) then raise exception 'build-v3-72: missing PARTIAL UNIQUE index pos_payment_attempt_open_terminal_uq over (merchant_id, terminal_id) — one terminal could take two open orders, so the till would learn it was busy from the vendor''s 409 instead of refusing with our own named reason'; end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema='merchant'
      and table_name in ('mp_point_credential','device_point_terminal')
    group by table_schema having count(*) = 2
  ) then raise exception 'build-v3-72 is incomplete: one of merchant.mp_point_credential, merchant.device_point_terminal is missing'; end if;
  -- THE HARD RULE OF THE CREDENTIAL TABLE: there is no plaintext token column. A future
  -- `access_token text` added beside the cipher columns would verify as "the table is there"
  -- and would quietly make a readable token possible, so the names it must never carry are
  -- refused here by name.
  if exists (
    select 1 from information_schema.columns
    where table_schema='merchant' and table_name='mp_point_credential'
      and column_name in ('token','access_token','refresh_token','mp_access_token','mp_refresh_token')
  ) then raise exception 'build-v3-72: merchant.mp_point_credential carries a plainly named token column — the two _cipher columns are the only token storage D8 allows'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='merchant' and table_name='mp_point_credential'
      and column_name in ('mp_user_id','access_token_cipher','refresh_token_cipher',
                          'access_token_expires_at','refresh_failed_at','refresh_attempts')
    group by table_schema, table_name having count(*) = 6
  ) then raise exception 'build-v3-72: merchant.mp_point_credential is missing one of its credential columns — the D8 renewal job reads the expiry, the failure stamp and the attempt counter'; end if;
  -- One Mercado Pago account is one merchant, asserted as uniqueness rather than as a name.
  if not exists (
    select 1
      from pg_class i
      join pg_index ix on ix.indexrelid = i.oid
      join pg_class t on t.oid = ix.indrelid
      join pg_namespace ns on ns.oid = t.relnamespace
    where ns.nspname='merchant' and t.relname='mp_point_credential'
      and i.relname='mp_point_credential_user_uq' and ix.indisunique
  ) then raise exception 'build-v3-72: merchant.mp_point_credential.mp_user_id is not unique — two merchants could be bound to the same Mercado Pago account, and one would charge into the other''s money'; end if;
  -- THE CIPHER COLUMNS ARE NOT READABLE BY THE DIAGNOSTIC ROLE. 90_rls arms every new
  -- merchant table with `select` for `readonly` through its default privileges, so "we did
  -- not grant it" would be worth nothing and the revoke in 72 is the only thing standing
  -- between the analytics role and the encrypted token. Asserted per column, because that is
  -- where the guarantee lives and a table-level grant restored later would otherwise pass.
  if has_table_privilege('readonly','merchant.mp_point_credential','select')
     or has_column_privilege('readonly','merchant.mp_point_credential','access_token_cipher','select')
     or has_column_privilege('readonly','merchant.mp_point_credential','refresh_token_cipher','select')
  then raise exception 'build-v3-72: readonly can select the OAuth cipher columns on merchant.mp_point_credential — the diagnostic role may reach the account and its expiry, never the token'; end if;
  if not exists (
    select 1 from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname in ('mp_point_credential','device_point_terminal')
      and cl.relrowsecurity and cl.relforcerowsecurity
    group by ns.nspname having count(*) = 2
  ) then raise exception 'build-v3-72 RLS is not forced on merchant.mp_point_credential and merchant.device_point_terminal'; end if;
  -- THE NUDGE, asserted in both halves: the trigger has to be present AND ENABLED (a
  -- disabled trigger keeps its pg_trigger row, and the till would simply stop hearing about
  -- resolutions), and the channel constant has to be inside the function the trigger calls —
  -- a function that notifies some other channel is a listener waiting for a writer that does
  -- not exist.
  if not exists (
    select 1 from pg_trigger
    where tgname='payment_attempt_notify_resolution' and not tgisinternal
  ) then raise exception 'build-v3-72: missing trigger payment_attempt_notify_resolution — the till would never be nudged when an attempt resolves'; end if;
  if exists (
    select 1 from pg_trigger
    where tgname='payment_attempt_notify_resolution' and tgenabled='D'
  ) then raise exception 'build-v3-72: trigger DISABLED: payment_attempt_notify_resolution — the till would never be nudged when an attempt resolves'; end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='merchant' and p.proname='tg_notify_tender_attempt'
      and p.prosrc like '%umi_tender_attempt%'
  ) then raise exception 'build-v3-72: merchant.tg_notify_tender_attempt does not notify umi_tender_attempt — the API listener would wait on a channel nothing ever writes to'; end if;
  if not exists (
    select 1 from runtime.schema_migration
    where version='build-v3-72' and status='applied'
  ) then raise exception 'missing build-v3-72 schema version'; end if;

  -- Workstream G · Phase 4 step 1 (build-v3-73): the refund as a SECOND attempt with
  -- the same model — what it gives back, the vendor id that proves it, and what the
  -- customer actually paid.
  --
  -- The shape assertions below are the cheap half and they are stated anyway, because a
  -- dropped column is the failure a reader expects. The interesting half is the LAST
  -- probe: a CHECK that exists and whose expression mentions `provider_refund_id` is
  -- still only a declaration, and this file's idiom is to prove the invariant, not to
  -- read it back. So the block below INSERTS a provider-proofed refund with no refund
  -- id and requires the database to refuse it BY NAME, inserts the same row WITH the id
  -- and requires the guard to stop refusing it, and probes the paid-amount guard with a
  -- negative. Every probe runs in a subtransaction that is rolled back, so the verify
  -- leaves no rows behind.
  --
  -- WHICH ERROR PROVES WHAT. On a fresh build there are no merchant/location/cart rows,
  -- so a probe insert can never fully succeed — after the CHECKs pass, a foreign key
  -- refuses it. That is deliberately used rather than worked around: the probe reads the
  -- FAILING CONSTRAINT'S NAME out of the diagnostics, so "the refund guard bit" means
  -- `check_violation` whose `constraint_name` is `payment_attempt_refund_proof_has_id_ck`,
  -- and "the guard accepted it" means the refusal came from somewhere else. A guard that
  -- had been dropped, or weakened to nothing, changes the name the probe sees and fails
  -- this file loudly — which is exactly the half-applied shape a name-only assertion
  -- would pass.
  if not exists (
    select 1 from information_schema.columns
    where table_schema='merchant' and table_name='pos_payment_attempt'
      and column_name in ('refund_of_attempt_id','provider_refund_id',
                          'provider_paid_minor_units','provider_tip_minor_units')
    group by table_schema, table_name having count(*) = 4
  ) then raise exception 'build-v3-73: merchant.pos_payment_attempt is missing one of the refund columns (refund_of_attempt_id, provider_refund_id, provider_paid_minor_units, provider_tip_minor_units)'; end if;
  -- The self-reference has to be RESTRICT, asserted through the server's own rendering:
  -- a refund whose capture could still be deleted is a refund that loses the thing it
  -- gives back, and `on delete cascade`/`set null` would verify as "the foreign key is
  -- there" while doing precisely that.
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid=c.conrelid
      join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='pos_payment_attempt'
      and c.conname='pos_payment_attempt_refund_of_fk' and c.contype='f'
      and pg_get_constraintdef(c.oid) like '%refund_of_attempt_id%'
      and pg_get_constraintdef(c.oid) like '%REFERENCES merchant.pos_payment_attempt(id)%'
      and pg_get_constraintdef(c.oid) like '%ON DELETE RESTRICT%'
  ) then raise exception 'build-v3-73: merchant.pos_payment_attempt has no ON DELETE RESTRICT self-reference on refund_of_attempt_id — a refund could outlive, or lose, the capture it gives back'; end if;
  -- Partial, and asserted through the server's own rendering of the predicate rather than
  -- by name (the same way the build-v3-72 block reads pg_get_expr on the open-terminal
  -- index): a full index would verify as "the index exists" and pay a write per capture.
  -- NOT unique is asserted too, because a unique one would make a second partial refund of
  -- the same capture impossible — the exact shape D6 exists to allow.
  if not exists (
    select 1
      from pg_class i
      join pg_index ix on ix.indexrelid = i.oid
      join pg_class t on t.oid = ix.indrelid
      join pg_namespace ns on ns.oid = t.relnamespace
    where ns.nspname='merchant' and t.relname='pos_payment_attempt'
      and i.relname='pos_payment_attempt_refund_of_idx'
      and not ix.indisunique
      and ix.indpred is not null
      and pg_get_expr(ix.indpred, ix.indrelid) like '%refund_of_attempt_id IS NOT NULL%'
      and pg_get_indexdef(i.oid) like '%refund_of_attempt_id%'
      and pg_get_indexdef(i.oid) like '%merchant_id%'
  ) then raise exception 'build-v3-73: missing PARTIAL index pos_payment_attempt_refund_of_idx over (merchant_id, refund_of_attempt_id) — "what has this capture given back?" would scan every attempt ever written'; end if;
  -- The refund half of the provider-proof rule, asserted by DEFINITION for the reason the
  -- build-v3-70 block gives: the constraint can be dropped and re-added with a weaker
  -- expression and still "exist". All three columns have to appear in it, or it is not the
  -- rule: proof_source is what makes it about a provider, refund_of_attempt_id is what
  -- makes it about a refund, and provider_refund_id is the id it requires.
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid=c.conrelid
      join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='pos_payment_attempt'
      and c.conname='payment_attempt_refund_proof_has_id_ck' and c.contype='c'
      and pg_get_constraintdef(c.oid) like '%proof_source%'
      and pg_get_constraintdef(c.oid) like '%refund_of_attempt_id%'
      and pg_get_constraintdef(c.oid) like '%provider_refund_id IS NOT NULL%'
  ) then raise exception 'build-v3-73: merchant.pos_payment_attempt has no refund-proof guard — a refund could be recorded as proven by the provider with no refund id to point at'; end if;
  -- The two money guards, asserted by the expression the server enforces: a negative
  -- paid amount would invert a reconciliation, and a column that "exists" with a check
  -- that no longer mentions it is the shape that would let it through.
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid=c.conrelid
      join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='pos_payment_attempt'
      and c.conname='payment_attempt_paid_minor_units_ck' and c.contype='c'
      and pg_get_constraintdef(c.oid) like '%provider_paid_minor_units%'
      and pg_get_constraintdef(c.oid) like '%>= 0%'
  ) then raise exception 'build-v3-73: merchant.pos_payment_attempt has no non-negative guard on provider_paid_minor_units — a negative paid amount could invert a reconciliation'; end if;
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid=c.conrelid
      join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='pos_payment_attempt'
      and c.conname='payment_attempt_tip_minor_units_ck' and c.contype='c'
      and pg_get_constraintdef(c.oid) like '%provider_tip_minor_units%'
      and pg_get_constraintdef(c.oid) like '%>= 0%'
  ) then raise exception 'build-v3-73: merchant.pos_payment_attempt has no non-negative guard on provider_tip_minor_units — a negative tip could invert a reconciliation'; end if;
  if not exists (
    select 1 from runtime.schema_migration
    where version='build-v3-73' and status='applied'
  ) then raise exception 'missing build-v3-73 schema version'; end if;

  -- The probes. Each runs in a subtransaction that is rolled back whatever the outcome,
  -- so a database that reaches the end of this file has the same rows it started with.
  declare
    v_state      text;
    v_constraint text;
    v_bit        boolean;
  begin
    -- 1 · THE GUARD BITES. A provider-proofed attempt that names a capture to refund and
    -- carries no refund id must be refused, and refused BY THIS CONSTRAINT: the
    -- diagnostics are read instead of a bare "something failed", because the FK below and
    -- our CHECK would both refuse a bad row and only one of them is the invariant.
    v_bit := false;
    begin
      insert into merchant.pos_payment_attempt
        (merchant_id, location_id, cart_id, method, amount_minor_units, currency,
         status, correlation_id, proof_source, provider_payment_id, refund_of_attempt_id)
      values
        (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'cash', 100, 'MXN',
         'succeeded', 'verify-73-bites', 'provider', 'PAY-VERIFY-73', gen_random_uuid());
    exception
      when others then
        get stacked diagnostics v_state = returned_sqlstate;
        get stacked diagnostics v_constraint = constraint_name;
        if v_state is distinct from '23514'
           or v_constraint is distinct from 'payment_attempt_refund_proof_has_id_ck'
        then
          raise exception 'build-v3-73: the unproven refund was refused by % (sqlstate %) instead of payment_attempt_refund_proof_has_id_ck — the guard is not the thing holding the line', coalesce(v_constraint,'nothing'), v_state;
        end if;
        v_bit := true;
    end;
    if not v_bit then
      raise exception 'build-v3-73: the database ACCEPTED a provider-proofed refund with no provider_refund_id — the refund-proof guard does not bite';
    end if;

    -- 2 · THE SAME ROW, WITH ITS REFUND ID, IS ACCEPTED — the rule is a rule and not a
    -- wall. There is no parent merchant in a fresh build, so the probe cannot end in a
    -- committed row; what it proves is that the refusal is no longer the refund guard.
    -- Any other refusal (the FK, or the marker raised right after a successful insert to
    -- roll the probe back) counts as acceptance, and a `check_violation` is a failure
    -- naming the constraint that refused it.
    v_bit := false;
    begin
      insert into merchant.pos_payment_attempt
        (merchant_id, location_id, cart_id, method, amount_minor_units, currency,
         status, correlation_id, proof_source, provider_payment_id,
         refund_of_attempt_id, provider_refund_id)
      values
        (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'cash', 100, 'MXN',
         'succeeded', 'verify-73-accepts', 'provider', 'PAY-VERIFY-73',
         gen_random_uuid(), 'REFUND-VERIFY-73');
      raise exception 'build-v3-73 rollback marker: the proven refund was accepted and this probe is being rolled back';
    exception
      when check_violation then
        get stacked diagnostics v_constraint = constraint_name;
        raise exception 'build-v3-73: the refund-proof guard refused a refund that carries its provider_refund_id (constraint %) — the rule is a wall, not a rule', coalesce(v_constraint,'nothing');
      when others then
        v_bit := true;
    end;
    if not v_bit then
      raise exception 'build-v3-73: the proven refund neither inserted nor raised — the guard cannot be shown to accept a correctly proven refund';
    end if;

    -- 3 · THE PAID AMOUNT CANNOT BE NEGATIVE. A row that is otherwise lawful is probed
    -- with a negative paid amount, and the refusal has to be that constraint by name —
    -- not the FK, and not "a CHECK of some kind".
    v_bit := false;
    begin
      insert into merchant.pos_payment_attempt
        (merchant_id, location_id, cart_id, method, amount_minor_units, currency,
         status, correlation_id, proof_source, provider_paid_minor_units)
      values
        (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'cash', 100, 'MXN',
         'succeeded', 'verify-73-negative-paid', 'cash', -1);
    exception
      when others then
        get stacked diagnostics v_state = returned_sqlstate;
        get stacked diagnostics v_constraint = constraint_name;
        if v_state is distinct from '23514'
           or v_constraint is distinct from 'payment_attempt_paid_minor_units_ck'
        then
          raise exception 'build-v3-73: a negative provider_paid_minor_units was refused by % (sqlstate %) instead of payment_attempt_paid_minor_units_ck', coalesce(v_constraint,'nothing'), v_state;
        end if;
        v_bit := true;
    end;
    if not v_bit then
      raise exception 'build-v3-73: the database ACCEPTED a negative provider_paid_minor_units — a tip reconciliation could silently invert';
    end if;
  end;

  -- Workstream H · step 4 (build-v3-74): COURSES AND STAGING — a dessert must not leave
  -- the kitchen with the starters.
  --
  -- The columns are asserted by name because a dropped column is the failure a reader
  -- expects. The BOUNDS are asserted by the expression the server enforces, not by the
  -- constraint's name: a guard that lost `<= 20` still "exists", still refuses 0, and
  -- would let a client write course 10_000 and make one ticket unreadable — which is the
  -- half-applied shape this block is here to catch.
  --
  -- The view assertion is the READ half, and it is the half a name cannot carry. A board
  -- read that lost `courseNumber`, or one that started filtering held items out of the
  -- ticket, still verifies as "kds.station_order exists" while making §8H step 4
  -- unobservable. So the block reads the view's OWN definition and requires the course,
  -- the derived flag and the watermark to be in it.
  if not exists (
    select 1 from information_schema.columns
    where table_schema='merchant' and column_name='course_number'
      and table_name in ('pos_cart_line','order_item','kitchen_order_item')
    group by table_schema, column_name having count(*) = 3
  ) then raise exception 'build-v3-74: course_number is missing from one of merchant.pos_cart_line, merchant.order_item, merchant.kitchen_order_item — the till''s course could not survive the sale, or the sale could not reach the kitchen with it'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='merchant' and table_name='kitchen_order'
      and column_name='fired_through_course'
  ) then raise exception 'build-v3-74: merchant.kitchen_order has no fired_through_course — there would be no fact saying how far the ticket has been fired'; end if;
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid=c.conrelid
      join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant'
      and cl.relname in ('pos_cart_line','order_item','kitchen_order_item')
      and c.contype='c'
      and pg_get_constraintdef(c.oid) like '%course_number >= 1%'
      and pg_get_constraintdef(c.oid) like '%course_number <= 20%'
    group by ns.nspname having count(*) = 3
  ) then raise exception 'build-v3-74: a course_number guard is missing or no longer bounds the course to 1..20 — an unbounded course ordinal is a ticket a cook cannot read'; end if;
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid=c.conrelid
      join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='kitchen_order'
      and c.conname='kitchen_order_fired_through_course_ck' and c.contype='c'
      and pg_get_constraintdef(c.oid) like '%fired_through_course >= 1%'
  ) then raise exception 'build-v3-74: merchant.kitchen_order has no fired_through_course floor — a ticket could be recorded as fired through no course at all'; end if;
  if not exists (
    select 1 from pg_views v
     where v.schemaname='kds' and v.viewname='station_order'
       and pg_get_viewdef('kds.station_order'::regclass, true) like '%courseNumber%'
       and pg_get_viewdef('kds.station_order'::regclass, true) like '%''fired''%'
       and pg_get_viewdef('kds.station_order'::regclass, true) like '%fired_through_course%'
  ) then raise exception 'build-v3-74: kds.station_order does not carry the item course and its fired flag, or the ticket''s watermark — the board could not tell a held dessert from a fired starter'; end if;
  -- THE COMMAND VOCABULARY, asserted because the CODE depends on it and nothing else
  -- would notice. `executeKitchenCommand` journals a `fire_course` row before it moves the
  -- watermark, and 42_pos_kitchen.sql's original CHECK lists seven types. A database that
  -- took the columns but not the widened vocabulary verifies as "the guard exists" while
  -- every fire on it dies on the journal insert with a bare 23514 — so the assertion reads
  -- the expression the server enforces and requires the new type by name in it.
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid=c.conrelid
      join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='kitchen_command'
      and c.conname='kitchen_command_command_type_check' and c.contype='c'
      and pg_get_constraintdef(c.oid) like '%fire_course%'
      and pg_get_constraintdef(c.oid) like '%change_priority%'
  ) then raise exception 'build-v3-74: merchant.kitchen_command does not accept the fire_course command type — the course could be set on the till and never fired in the kitchen'; end if;
  if not exists (
    select 1 from runtime.schema_migration
    where version='build-v3-74' and status='applied'
  ) then raise exception 'missing build-v3-74 schema version'; end if;

  -- Workstream I · step 2 (build-v3-75): TABLE-ORDER INTAKE — a guest at a table may
  -- order, and the order lands in the till and the kitchen with no manual step.
  --
  -- The columns are asserted by name because a dropped column is the failure a reader
  -- expects. Everything with teeth is asserted by the EXPRESSION the server enforces,
  -- because a guard that lost its pattern still "exists":
  --
  --   · `token_hash` without `^[a-f0-9]{64}$` accepts a raw token pasted in by a future
  --     writer, which is the one thing the design forbids — a database read would then
  --     return a working ordering link.
  --   · the live-table index without `WHERE revoked_at IS NULL` stops being the
  --     one-live-credential-per-table guarantee and becomes an index on the history,
  --     so a revoked QR would keep ordering.
  --   · the RLS predicate without the location clause lets a location-scoped session read
  --     another branch's credentials, and the public intake path is the one caller whose
  --     authority comes entirely from this narrowing.
  --   · the composite order FK without `merchant_id` would let the link point at another
  --     merchant's order.
  if not exists (
    select 1 from information_schema.columns
    where table_schema='merchant' and table_name='table_order_credential'
      and column_name in ('table_id','location_id','token_hash','revoked_at','revoked_by_user_id')
    group by table_schema, table_name having count(*) = 5
  ) then raise exception 'build-v3-75: merchant.table_order_credential is missing one of table_id, location_id, token_hash, revoked_at, revoked_by_user_id — the credential could not say which table it opens, or could not be revoked'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='merchant' and table_name='table_order'
      and column_name in ('order_id','location_id','table_id','credential_id','guest_name','guest_phone')
    group by table_schema, table_name having count(*) = 6
  ) then raise exception 'build-v3-75: merchant.table_order is missing one of order_id, location_id, table_id, credential_id, guest_name, guest_phone — the intake link could not say which table, or whose order, it was'; end if;
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid=c.conrelid
      join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='table_order_credential'
      and c.conname='table_order_credential_token_hash_check' and c.contype='c'
      and pg_get_constraintdef(c.oid) like '%[a-f0-9]{64}%'
  ) then raise exception 'build-v3-75: merchant.table_order_credential.token_hash no longer has a sha256-hex guard — a raw token pasted into this column would be stored, and the table would return a working ordering link to any reader'; end if;
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid=c.conrelid
      join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='table_order_credential'
      and c.conname='table_order_credential_revocation_complete' and c.contype='c'
      and pg_get_constraintdef(c.oid) like '%revoked_at IS NULL%'
      and pg_get_constraintdef(c.oid) like '%revoked_by_user_id IS NULL%'
  ) then raise exception 'build-v3-75: merchant.table_order_credential no longer requires a revocation to name its actor — an incident review could not tell who killed a table''s code'; end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname='merchant' and tablename='table_order_credential'
      and indexname='table_order_credential_token_uidx'
      and indexdef like 'CREATE UNIQUE INDEX%'
      and indexdef like '%(token_hash)%'
  ) then raise exception 'build-v3-75: merchant.table_order_credential has no UNIQUE index on token_hash — two rows could share a token, or the guest lookup could take more than one row'; end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname='merchant' and tablename='table_order_credential'
      and indexname='table_order_credential_live_table_uidx'
      and indexdef like 'CREATE UNIQUE INDEX%'
      and indexdef like '%WHERE (revoked_at IS NULL)%'
  ) then raise exception 'build-v3-75: the one-live-credential-per-table index is missing or no longer partial on revoked_at IS NULL — a revoked QR would keep ordering, or a rotation could not be recorded'; end if;
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid=c.conrelid
      join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='table_order'
      and c.contype='f'
      and pg_get_constraintdef(c.oid) like '%(merchant_id, order_id)%'
      and pg_get_constraintdef(c.oid) like '%REFERENCES merchant.customer_order(merchant_id, id)%'
  ) then raise exception 'build-v3-75: merchant.table_order has no composite FK to merchant.customer_order(merchant_id, id) — the link could point at another merchant''s order'; end if;
  if not exists (
    select 1 from pg_class cl
      join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='table_order_credential'
      and cl.relrowsecurity and cl.relforcerowsecurity
  ) then raise exception 'build-v3-75 RLS is not enabled AND forced on merchant.table_order_credential'; end if;
  if not exists (
    select 1 from pg_class cl
      join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='table_order'
      and cl.relrowsecurity and cl.relforcerowsecurity
  ) then raise exception 'build-v3-75 RLS is not enabled AND forced on merchant.table_order'; end if;
  if not exists (
    select 1 from pg_policies
    where schemaname='merchant' and tablename='table_order_credential'
      and policyname='table_order_credential_scope'
      and qual like '%current_merchant()%'
      and qual like '%current_location()%'
      and with_check like '%current_location()%'
  ) then raise exception 'build-v3-75: merchant.table_order_credential has no location-narrowed scope policy — a location-scoped session could read another branch''s table credentials'; end if;
  if not exists (
    select 1 from pg_policies
    where schemaname='merchant' and tablename='table_order'
      and policyname='table_order_scope'
      and qual like '%current_merchant()%'
      and qual like '%current_location()%'
  ) then raise exception 'build-v3-75: merchant.table_order has no location-narrowed scope policy — a location-scoped session could read another branch''s table orders'; end if;
  if not exists (
    select 1 from runtime.schema_migration
    where version='build-v3-75' and status='applied'
  ) then raise exception 'missing build-v3-75 schema version'; end if;

  -- ---------------------------------------------------------------------------
  -- Workstream E · step 4 (build-v3-76): RECIPES, PREP, LOTS AND INVOICES — an owner
  -- may build a recipe, produce the prep, and reconcile the stock the kitchen used.
  -- ---------------------------------------------------------------------------
  if not exists (
    select 1 from information_schema.columns
     where table_schema='merchant' and table_name='inventory_recipe'
       and column_name='target_item_id' and is_nullable='YES'
  ) then raise exception 'build-v3-76: merchant.inventory_recipe.target_item_id is missing or NOT NULL — a sub-recipe could not exist'; end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema='merchant' and table_name='inventory_recipe'
       and column_name='product_id' and is_nullable='NO'
  ) then raise exception 'build-v3-76: merchant.inventory_recipe.product_id is still NOT NULL — a sub-recipe could not exist'; end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid='merchant.inventory_recipe'::regclass
       and conname='inventory_recipe_exactly_one_target_ck'
  ) then raise exception 'build-v3-76: the exactly-one-target check is missing from merchant.inventory_recipe'; end if;

  if not exists (
    select 1 from pg_trigger
     where tgname='inventory_recipe_component_acyclic' and not tgisinternal
  ) then raise exception 'build-v3-76: the recipe cycle guard trigger is missing — a prep could consume itself'; end if;

  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid=c.conrelid
      join pg_namespace ns on ns.oid=cl.relnamespace
     where ns.nspname='merchant' and cl.relname='stock_ledger_entry'
       and c.conname='stock_ledger_entry_entry_type_check'
       and pg_get_constraintdef(c.oid) like '%production_yield_loss%'
       and pg_get_constraintdef(c.oid) like '%invoice_variance_adjustment%'
  ) then raise exception 'build-v3-76: the ledger entry-type set does not carry the four production and invoice types'; end if;

  if not exists (
    select 1 from pg_proc p
      join pg_namespace ns on ns.oid=p.pronamespace
     where ns.nspname='merchant' and p.proname='append_stock_ledger' and p.pronargs=22
  ) then raise exception 'build-v3-76: merchant.append_stock_ledger does not take the lot argument — a production lot could never be named on the ledger'; end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema='merchant' and table_name='stock_ledger_entry' and column_name='lot_id'
  ) then raise exception 'build-v3-76: merchant.stock_ledger_entry.lot_id is missing — a recall could not reach the lot'; end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema='merchant' and table_name='purchase_order_receipt_line'
       and column_name='invoice_line_id'
  ) then raise exception 'build-v3-76: merchant.purchase_order_receipt_line.invoice_line_id is missing — a cost could not name its document'; end if;

  if exists (
    select 1 from (values ('stock_lot'),('inventory_allergen'),('inventory_item_allergen'),
                          ('supplier_invoice'),('supplier_invoice_line')) as t(name)
     where not exists (
       select 1 from pg_class cl
         join pg_namespace ns on ns.oid=cl.relnamespace
        where ns.nspname='merchant' and cl.relname=t.name
          and cl.relrowsecurity and cl.relforcerowsecurity
     )
  ) then raise exception 'build-v3-76 RLS is not enabled AND forced on a lot, allergen or invoice table'; end if;

  if exists (
    select 1 from (values ('inventory.item.manage'),('inventory.conversion.manage'),
                          ('inventory.recipe.manage'),('inventory.recipe.approve'),
                          ('inventory.invoice.capture'),('inventory.invoice.approve')) as p(key)
     where not exists (select 1 from umi.permission where key=p.key)
  ) then raise exception 'build-v3-76: a new inventory write permission is missing from umi.permission'; end if;

  if not exists (
    select 1 from umi.role r
      join umi.role_permission rp on rp.role_id=r.id
      join umi.permission p on p.id=rp.permission_id
     where r.key='owner' and p.key='inventory.recipe.approve'
  ) then raise exception 'build-v3-76: owner does not hold inventory.recipe.approve — the approval gate would have no holder'; end if;

  if not exists (
    select 1 from runtime.schema_migration
    where version='build-v3-76' and status='applied'
  ) then raise exception 'missing build-v3-76 schema version'; end if;

  if not exists (
    select 1 from pg_proc p
      join pg_namespace ns on ns.oid=p.pronamespace
     where ns.nspname='merchant' and p.proname='product_allergen_labels'
  ) then raise exception 'build-v3-76: merchant.product_allergen_labels is missing — the kitchen ticket and the guest menu would have no single source for a derived allergen list'; end if;

  -- BEHAVIOUR. The cycle guard and the one-target rule must BITE, and the probe rows
  -- must not survive the build. A fresh build carries no merchant, so the probe makes
  -- its own rows and rolls the whole block back with a marker, the way the build-v3-73
  -- probe does.
  declare
    v_merchant uuid; v_location uuid; v_stock uuid;
    v_a uuid; v_b uuid; v_recipe uuid; v_recipe_a uuid;
    v_product uuid; v_product_recipe uuid;
    v_c uuid; v_c_recipe uuid; v_plate uuid; v_plate_recipe uuid;
    v_ratio numeric;
    v_state text; v_bit boolean;
  begin
    begin
      insert into merchant.merchant(name) values ('verify-76') returning id into v_merchant;
      insert into merchant.location(merchant_id,name) values (v_merchant,'verify') returning id into v_location;
      insert into merchant.inventory_location(
        merchant_id,location_id,public_reference,display_name,location_type
      ) values (v_merchant,v_location,'VERIFY','Verify','kitchen_storage') returning id into v_stock;
      insert into merchant.inventory_item(merchant_id,public_reference,display_name,item_type,base_unit)
        values (v_merchant,'VA','Verify A','ingredient','gram') returning id into v_a;
      insert into merchant.inventory_item(merchant_id,public_reference,display_name,item_type,base_unit)
        values (v_merchant,'VB','Verify B','composite_component','gram') returning id into v_b;
      insert into merchant.inventory_recipe(
        merchant_id,target_item_id,version,yield_quantity,yield_scale,yield_unit
      ) values (v_merchant,v_b,1,1000,0,'gram') returning id into v_recipe;
      insert into merchant.inventory_recipe_component(
        merchant_id,recipe_id,inventory_item_id,quantity,unit,quantity_scale
      ) values (v_merchant,v_recipe,v_a,500,'gram',0);

      v_bit := false;
      begin
        insert into merchant.inventory_recipe(
          merchant_id,target_item_id,version,yield_quantity,yield_scale,yield_unit
        ) values (v_merchant,v_a,1,1000,0,'gram') returning id into v_recipe_a;
        insert into merchant.inventory_recipe_component(
          merchant_id,recipe_id,inventory_item_id,quantity,unit,quantity_scale
        ) values (v_merchant,v_recipe_a,v_b,500,'gram',0);
      exception when others then
        get stacked diagnostics v_state = returned_sqlstate;
        if v_state is distinct from 'P0001' then
          raise exception 'build-v3-76: the cycle was refused by sqlstate % instead of the guard''s own error', v_state;
        end if;
        v_bit := true;
      end;
      if not v_bit then
        raise exception 'build-v3-76: the database ACCEPTED a recipe cycle — a prep could consume itself';
      end if;

      v_bit := false;
      begin
        insert into merchant.inventory_recipe(
          merchant_id,version,yield_quantity,yield_scale,yield_unit
        ) values (v_merchant,1,1,0,'unit');
      exception when check_violation then
        v_bit := true;
      end;
      if not v_bit then
        raise exception 'build-v3-76: a recipe with no target was accepted';
      end if;

      -- THE EXPLOSION REACHES THROUGH A SUB-RECIPE. An allergen on item A must
      -- appear on item B, because B's recipe consumes A. A stored product list would
      -- answer from stale text; this answers from the recipe as it is now.
      insert into merchant.inventory_allergen(merchant_id,code,label)
        values (v_merchant,'gluten','Gluten');
      insert into merchant.inventory_item_allergen(merchant_id,inventory_item_id,inventory_allergen_id)
        select v_merchant,v_a,id from merchant.inventory_allergen
         where merchant_id=v_merchant and code='gluten';
      if not exists (
        select 1 from merchant.inventory_item_allergen_labels(v_merchant,v_b) l
         where l.code='gluten'
      ) then
        raise exception 'build-v3-76: the allergen explosion did not reach through the recipe — a guest with an allergy would read an incomplete list';
      end if;

      -- AND A RETIRED RECIPE STOPS CLAIMING ITS INGREDIENTS. This is the whole reason
      -- the list is derived: a stored product-level list would keep showing a removed
      -- ingredient, which is the one mistake an allergen list must never make.
      insert into merchant.product(merchant_id,name)
        values (v_merchant,'Verify Plate') returning id into v_product;
      insert into merchant.inventory_recipe(
        merchant_id,product_id,version,yield_quantity,yield_scale,yield_unit
      ) values (v_merchant,v_product,1,1,0,'portion') returning id into v_product_recipe;
      insert into merchant.inventory_recipe_component(
        merchant_id,recipe_id,inventory_item_id,quantity,unit,quantity_scale
      ) values (v_merchant,v_product_recipe,v_a,500,'gram',0);
      insert into merchant.inventory_catalog_mapping(
        merchant_id,product_id,mapping_type,recipe_id,version
      ) values (v_merchant,v_product,'recipe',v_product_recipe,1);

      if not exists (
        select 1 from merchant.product_allergen_labels(v_merchant,v_product,null) l
         where l.code='gluten'
      ) then
        raise exception 'build-v3-76: a product mapped to a recipe did not report its ingredient allergen';
      end if;

      update merchant.inventory_recipe
         set active=false, retired_at=clock_timestamp()
       where merchant_id=v_merchant and id=v_product_recipe;

      if exists (
        select 1 from merchant.product_allergen_labels(v_merchant,v_product,null) l
         where l.code='gluten'
      ) then
        raise exception 'build-v3-76: a RETIRED recipe still claimed its allergen — a guest would read a removed ingredient';
      end if;

      -- THREE LEVELS, AND THE TOTAL IS EXACT. A raw ingredient (A) is cooked into a
      -- prep (C) through a middle prep (B), and a plate consumes C. The explosion must
      -- carry the factor of every level down, so the plate's cost rests on the raw
      -- item and not on a rounded intermediate.
      --
      --   C: 500 g from 250 g B          -> 0.5 g B per g C   (the recipe above)
      --   B: 1000 g from 500 g A         -> 0.5 g A per g B   (the recipe above)
      --   plate: yields 2 portions, 100 g C for the whole batch -> 50 g C per portion
      --   therefore one portion costs 50 * 0.5 * 0.5 = 12.5 g of A
      insert into merchant.inventory_item(merchant_id,public_reference,display_name,item_type,base_unit,quantity_scale)
        values (v_merchant,'VC','Verify prep C','composite_component','gram',0) returning id into v_c;
      insert into merchant.inventory_recipe(merchant_id,target_item_id,version,yield_quantity,yield_scale,yield_unit)
        values (v_merchant,v_c,1,500,0,'gram') returning id into v_c_recipe;
      insert into merchant.inventory_recipe_component(merchant_id,recipe_id,inventory_item_id,quantity,unit,quantity_scale)
        values (v_merchant,v_c_recipe,v_b,250,'gram',0);
      insert into merchant.product(merchant_id,name)
        values (v_merchant,'Verify Dish') returning id into v_plate;
      insert into merchant.inventory_recipe(merchant_id,product_id,version,yield_quantity,yield_scale,yield_unit)
        values (v_merchant,v_plate,1,2,0,'portion') returning id into v_plate_recipe;
      insert into merchant.inventory_recipe_component(merchant_id,recipe_id,inventory_item_id,quantity,unit,quantity_scale)
        values (v_merchant,v_plate_recipe,v_c,100,'gram',0);

      select e.numerator / e.denominator into v_ratio
        from merchant.explode_inventory_recipe(v_merchant,v_plate_recipe) e
       where e.inventory_item_id = v_a;
      if v_ratio is distinct from 12.5::numeric then
        raise exception 'build-v3-76: the three-level explosion answered % g of the raw item instead of 12.5 — a plate would be costed from a rounded intermediate', v_ratio;
      end if;

      -- A SUB-RECIPE IS NOT A LEAF. The prep rows must say so, or a plate would cost
      -- the prep's own price AND the ingredients it is made of.
      if not exists (
        select 1 from merchant.explode_inventory_recipe(v_merchant,v_plate_recipe) e
         where e.inventory_item_id = v_c and e.has_recipe
      ) then
        raise exception 'build-v3-76: the explosion did not mark a produced item as produced';
      end if;

      raise exception 'build-v3-76 rollback marker: the probes passed and this block is being rolled back';
    exception
      when others then
        if sqlerrm like 'build-v3-76 rollback marker:%' then
          null;
        else
          raise;
        end if;
    end;
  end;

  -- counts (sanity)
  select count(*) into n from information_schema.tables where table_schema='umi'     and table_type='BASE TABLE'; raise notice 'umi base tables:     %', n;
  select count(*) into n from information_schema.tables where table_schema='merchant'  and table_type='BASE TABLE'; raise notice 'merchant base tables:  %', n;
  select count(*) into n from information_schema.tables where table_schema='runtime' and table_type='BASE TABLE'; raise notice 'runtime base tables: %', n;

  raise notice 'build-v3 verify: OK';
end $$;
