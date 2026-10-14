-- ============================================================================
-- 013 · A drawer under count may record its count
--
-- WHY. `merchant.tg_cash_count_guard` (33_pos_cash.sql) refuses a count attempt
-- unless the shift is `open`, `suspended` or `reconciliation_required`. The
-- RECOUNT operation does the opposite of leaving the status alone: it moves the
-- shift to `counting` so the drawer stops accepting cash while it is counted
-- (pos-cash.repository.ts, the recount UPDATE: `set status='counting'`).
--
-- So the one INSERT that a recount exists for is the one the guard refuses, and
-- the drawer LOCKED. Reproduced on the local till, 2026-10-10, on a shift left
-- mid-close:
--
--   POST /cash/shifts/:id/counts/recount  -> 500 RECOUNT_NOT_AVAILABLE
--        (the recount UPDATE requires `status='reconciliation_required'`, and
--         the shift is already `counting`)
--   POST /cash/shifts/:id/counts          -> 500 DatabaseError
--        "cash count scope or ledger sequence is stale"
--        (this trigger, refusing `counting`)
--   POST /cash/shifts/:id/reconcile       -> 500 STALE_COUNT
--        (the reconcile SELECT also requires `status='reconciliation_required'`)
--
-- Every operator action on the Caja screen was refused by one of the three, and
-- the API answered 500 rather than a handled conflict. A drawer in that state
-- could not be counted, reconciled, closed — or charged against, because a
-- drawer under count accepts no cash. The money path was unreachable.
--
-- WHAT IT DOES. Adds `counting` to the statuses in which a count may be
-- RECORDED. That is what the status means: a count is in progress. The rest of
-- the guard is carried over unchanged — same merchant, location, register and
-- currency as the shift, the same ledger sequence, and the same denomination
-- check — so a count still cannot be filed against a drawer that moved.
--
-- Idempotent and re-runnable: the function is replaced, and the trigger with it.
-- ============================================================================

create or replace function merchant.tg_cash_count_guard()
returns trigger language plpgsql as $$
declare shift_row merchant.cash_shift%rowtype;
begin
  select * into shift_row from merchant.cash_shift where id=new.shift_id for update;
  if shift_row.id is null
     or shift_row.merchant_id<>new.merchant_id
     or shift_row.location_id<>new.location_id
     or shift_row.register_id<>new.register_id
     or shift_row.currency<>new.currency
     or shift_row.ledger_sequence<>new.ledger_sequence
     or shift_row.status not in ('open','suspended','counting','reconciliation_required')
     or not merchant.cash_denominations_valid(
       new.denominations,
       new.counted_minor_units,
       new.currency
     ) then
    raise exception 'cash count scope or ledger sequence is stale';
  end if;
  return new;
end $$;

drop trigger if exists cash_count_guard on merchant.cash_count_attempt;
create trigger cash_count_guard before insert on merchant.cash_count_attempt
  for each row execute function merchant.tg_cash_count_guard();
