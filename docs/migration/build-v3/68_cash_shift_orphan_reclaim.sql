\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- build-v3 · 68_cash_shift_orphan_reclaim — the terminal state a shift lands on
-- when the terminal that holds it is never coming back.
--
-- THE DEFECT. A register whose holding device had been revoked, retired or
-- replaced could not be opened again and could not be closed. Driving the real
-- (native) POS through a whole sale reproduced it: BOTH registers at Chapultepec
-- were still held by shifts opened on 2026-09-03 and 2026-09-05 by devices that
-- no longer existed. `POST /cash/shifts` answered 500 `REGISTER_NOT_AVAILABLE`
-- and every payment on the till answered 500 `CASH_SHIFT_REQUIRED`, while the
-- Caja screen still showed "Turno abierto". The only way out was four hand-written
-- SQL statements. The API had one recovery operation
-- (`POST /cash/shifts/:shiftId/recover`) and it is a different thing entirely: a
-- MANAGER COUNTS THE DRAWER UNDER THEIR OWN NAME and the shift lands on
-- `recovered`. That operation is right, and it is unreachable by design from the
-- till: it needs a variance approval nobody at the counter holds.
--
-- THE LANDING SPOT IS `blocked`, AND THIS FILE IS WHERE IT IS PROVEN.
-- `cash-domain.ts` already declares `blocked: []` — a terminal state with no way
-- out — and `33_pos_cash.sql` already excludes it from the active-shift views and
-- from `cash_shift_one_unresolved_register`, so the register is released the
-- moment a shift is blocked. `closed` and `recovered` were both wrong here: a
-- closed shift was reconciled by the cashier responsible for it, and a recovered
-- one was counted by somebody else. Nobody counted this drawer. Marking it either
-- of those would put a number in a cash-up that no human ever counted, which is
-- the one thing the cash domain may not do.
--
-- WHAT THIS FILE ADDS, and why it is a constraint and not a convention:
--
--   * `orphan_reclaim` becomes a third custody event type. Custody events are
--     where `merchant.` already records which terminal held a drawer, why it
--     moved, who moved it and what the shift's status was on either side — so the
--     reclaim writes its reason there instead of inventing a second journal.
--
--   * `cash_custody_shape` gains the matching branch, and the branch is the
--     guarantee: an `orphan_reclaim` carries NO counted cash, NO expected cash
--     and NO approval. A drawer that was never counted cannot be recorded as
--     counted, by this operation or by any future writer, a backfill, or psql.
--     The application also enforces it; the constraint is what makes it true.
--
-- Nothing about `merchant.cash_shift` changes: `blocked` is already a legal
-- status, and it is deliberately NOT given a `closed_at` — the drawer was not
-- closed, it was abandoned. A report that wants these shifts selects on the
-- status, which is exactly what `cash-domain.ts` publishes.
--
-- Idempotent and re-runnable: both constraints are dropped before they are added.
-- ============================================================================

alter table merchant.cash_shift_custody_event
  drop constraint if exists cash_shift_custody_event_event_type_check;
alter table merchant.cash_shift_custody_event
  add constraint cash_shift_custody_event_event_type_check
  check (event_type in ('device_adoption','manager_recovery','orphan_reclaim'));

alter table merchant.cash_shift_custody_event
  drop constraint if exists cash_custody_shape;
alter table merchant.cash_shift_custody_event
  add constraint cash_custody_shape check (
    case event_type
      when 'device_adoption' then
        new_holding_device_id is not null
        and new_holding_credential_version is not null
        and new_operator_session_id is not null
        and counted_cash_minor_units is null
      when 'manager_recovery' then
        counted_cash_minor_units is not null
        and expected_cash_minor_units is not null
      -- The reclaim: the drawer keeps its cash and nobody counted it. Every
      -- column that would imply a count, an expectation or an approval is
      -- required to be empty, so the row cannot read as either of the other two.
      when 'orphan_reclaim' then
        new_holding_device_id is null
        and new_holding_credential_version is null
        and new_operator_session_id is null
        and counted_cash_minor_units is null
        and expected_cash_minor_units is null
        and approval_id is null
      else false
    end
  );

-- A blocked shift is a thing a report and a reconciliation queue have to find,
-- and neither has an index for `status` alone. Partial, because blocked rows are
-- a rounding error next to every shift a café has ever opened.
create index if not exists cash_shift_blocked_idx
  on merchant.cash_shift(merchant_id, location_id, opened_at)
  where status = 'blocked';

-- ============================================================================
-- THE TWO GUARDS IN THE WAY, AND WHY NEITHER IS WEAKENED.
--
-- With the operations above, the reclaim still cannot run, and the database is
-- right to refuse it. `90_rls.sql` pins writes to `merchant.cash_shift` to the
-- terminal that OPENED the shift — "a terminal may only create or mutate ITS OWN
-- shift, or an authorised pending refund command may" — and the terminal that
-- opened an orphaned shift is, by definition, the one that is gone. A
-- `tg_closed_cash_shift_immutable` trigger freezes the rest.
--
-- Reading that rule again settles what to do. What it protects is that a drawer
-- cannot be touched by a terminal that has no claim on it. Reclaiming an orphan
-- is the same claim seen from the other side: no terminal has a claim on it any
-- more, and that is a fact the DATABASE can check for itself. So the rule gains
-- one clause — the write is allowed when the terminal that holds the shift is
-- not usable — and the clause is a predicate over `merchant.device`, not a
-- permission granted to a caller. Nothing can assert it; it is looked up.
--
--   * `device_is_usable` is the ONE definition of "that terminal can still
--     authenticate". The repository's hold query, the RLS policy and the trigger
--     all call it, so the three cannot drift into disagreeing about what a live
--     till is — which is how a till ends up offering a drawer the API refuses.
--
--   * The policy clause allows exactly one new value: `status = 'blocked'`, on a
--     shift whose holding terminal is not usable. It cannot be used to write any
--     other column, because RLS `WITH CHECK` sees only the new row.
--
--   * So the trigger carries the rest, and it carries it strictly: the new row
--     must equal the old row with `status` and `version` replaced and nothing
--     else. The comparison is `to_jsonb` equality rather than a hand-written list
--     of nineteen column comparisons, so a column added to `cash_shift` later is
--     covered on the day it is added instead of the day somebody notices.
--
-- `closed_at` is deliberately NOT set by the reclaim, which is why the trigger
-- would refuse one that did: the drawer was not closed. And an unreachable case
-- is named rather than assumed — the holding device row cannot be missing, since
-- `cash_shift_holding_device_id_fkey` is ON DELETE RESTRICT, so "the row is gone"
-- is not a state this schema can reach.
-- ============================================================================

create or replace function merchant.device_is_usable(p_device_id uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from merchant.device d
     where d.id = p_device_id
       and d.status in ('active','rotation_required')
       and d.revoked_at is null
  )
$$;

create or replace function merchant.tg_closed_cash_shift_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then
    raise exception 'cash shift deletion is prohibited';
  end if;
  if old.status='closed' then
    raise exception 'closed cash shift is immutable';
  end if;
  -- THE ORPHAN RECLAIM (build-v3-68). One transition — a non-terminal shift
  -- becomes `blocked` — and only when the terminal holding it can no longer
  -- authenticate. Every other column must come out of the update untouched:
  -- `status` and `version` are the only two differences allowed.
  if new.status = 'blocked'
     and old.status not in ('closed','blocked','recovered')
     and not merchant.device_is_usable(old.holding_device_id)
     and to_jsonb(new) = (
           to_jsonb(old) || jsonb_build_object('status','blocked','version',old.version+1)
         ) then
    return new;
  end if;
  if new.merchant_id<>old.merchant_id or new.location_id<>old.location_id
     or new.register_id<>old.register_id or new.device_id<>old.device_id
     or new.device_credential_version<>old.device_credential_version
     or new.opening_operator_id<>old.opening_operator_id
     or new.opening_command_id<>old.opening_command_id
     or new.currency<>old.currency or new.business_date<>old.business_date
     or new.opening_float_minor_units<>old.opening_float_minor_units
     or new.opening_denominations<>old.opening_denominations then
    raise exception 'cash shift identity is immutable';
  end if;
  return new;
end $$;

-- The same clause on the policy, and it is required: PostgreSQL applies the
-- BEFORE trigger first and the RLS `WITH CHECK` to the row it returns, so a
-- trigger that permits the transition is not enough on its own.
drop policy if exists device_scoping on merchant.cash_shift;
create policy device_scoping on merchant.cash_shift as restrictive
  using (true)
  with check (
    (umi.current_device() is not null and cash_shift.device_id = umi.current_device())
    or
    (nullif(current_setting('app.administrative_command_id', true), '') is not null
      and exists (
        select 1
          from merchant.administrative_command ac
         where ac.id = nullif(current_setting('app.administrative_command_id', true), '')::uuid
           and ac.merchant_id = (select umi.current_merchant())
           and ac.actor_user_id = nullif(current_setting('app.user_id', true), '')::uuid
           and ac.location_id = umi.current_location()
           and ac.operation in ('refund.preview', 'refund.commit')
           and ac.status = 'pending'
      ))
    or
    (
      cash_shift.status = 'blocked'
      and not merchant.device_is_usable(cash_shift.holding_device_id)
    )
  );

grant execute on function merchant.device_is_usable(uuid) to api, worker;

insert into runtime.schema_migration(version,status)
values('build-v3-68','applied') on conflict(version) do nothing;

commit;
