\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- build-v3 · 71_immutable_delete_fix — two triggers that swallowed the DELETEs
-- they were supposed to refuse.
--
-- WHAT WAS WRONG. `32_pos_checkout.sql` guards two tables with a CONDITIONAL
-- immutability trigger — the row is frozen only once it is settled:
--
--   merchant.pos_checkout_draft   frozen when state in ('completed','receipt_available')
--   merchant.pos_tender_fact      frozen when status = 'committed'
--
-- Both functions ended `return new;`, which is right for the `before update` they
-- were written for and wrong for the `before delete` they were also attached to. In
-- a DELETE trigger NEW is NULL, and returning NULL from a BEFORE trigger cancels
-- the statement SILENTLY — no error, no row, and a caller that checked rowCount
-- sees zero deleted. So a row that passed every predicate of the delete still
-- survived, and the guard did not refuse the write, it ate it.
--
-- WHY THAT MATTERS, CONCRETELY. `PosCheckoutRepository.cancelDraft` clears a
-- cancelled checkout's uncommitted tender facts in order to free their
-- `unique (checkout_id, position)` slots. That DELETE matched rows and deleted
-- none, so the facts stayed, and the NEXT tender on the same cart collided with
-- its own history on that unique index — a cart that had a tender cancelled could
-- not be tendered again. It was found by an integration test that seeded a draft
-- and could not clear the slot, and the first thing to do was check the trigger
-- rather than the test.
--
-- WHAT THIS DOES NOT CHANGE. The rules themselves. A settled draft and a committed
-- fact remain undeletable AND unupdatable — the branch above still raises for
-- those, and `before update` is untouched. A committed checkout is a financial
-- record and a committed tender fact is money; nothing here loosens either. What
-- becomes possible is only what was always meant to be: deleting an UNSETTLED
-- draft or an UNCOMMITTED fact, which is the state the platform deliberately puts
-- them in while a sale is being assembled.
--
-- The pattern is not invented here: `merchant.tg_order_item_void_only` in
-- `20_merchant.sql` already handles `tg_op = 'DELETE'` explicitly and raises, and
-- the unconditional guards (`tg_append_only`, `tg_cash_fact_immutable`) never
-- reach the return at all. These two were the only conditional ones that fell
-- through on a delete.
--
-- Idempotent and re-runnable: `create or replace function` for both, and the
-- version row is inserted with `on conflict do nothing`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · The checkout draft
-- ---------------------------------------------------------------------------
create or replace function merchant.tg_pos_checkout_terminal_immutable()
returns trigger language plpgsql as $$
begin
  if old.state in ('completed','receipt_available') then
    raise exception 'committed checkout is immutable';
  end if;
  -- Hand back the row this operation is about. In a DELETE trigger that is OLD;
  -- NEW is NULL there, and returning NULL cancels the delete without a word.
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 2 · The tender fact
-- ---------------------------------------------------------------------------
create or replace function merchant.tg_pos_tender_committed_immutable()
returns trigger language plpgsql as $$
begin
  if old.status = 'committed' then
    raise exception 'committed tender is immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

comment on function merchant.tg_pos_checkout_terminal_immutable() is
  'Freezes a SETTLED checkout draft (completed / receipt_available) against update AND delete. A draft still being assembled is deletable, which cancelDraft relies on. Handles tg_op=DELETE explicitly: returning NEW in a delete trigger is NULL and cancels the delete silently rather than refusing it.';
comment on function merchant.tg_pos_tender_committed_immutable() is
  'Freezes a COMMITTED tender fact against update AND delete. An uncommitted fact belongs to a draft that may still be cancelled, so it is deletable. Handles tg_op=DELETE explicitly, for the same reason as the checkout draft trigger.';

insert into runtime.schema_migration(version,status)
values('build-v3-71','applied') on conflict(version) do nothing;

commit;
