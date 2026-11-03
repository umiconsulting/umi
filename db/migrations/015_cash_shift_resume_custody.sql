-- ============================================================================
-- 015 · A drawer taken back by its own terminal records who took it
--
-- WHY. The custody table records every rebinding of the terminal that holds a
-- drawer: `device_adoption` (the shift moved to another terminal),
-- `manager_recovery` (a manager counted it out) and `orphan_reclaim` (the
-- holding terminal is gone). One rebinding had no type, and it is the one a
-- café meets most often.
--
-- MEASURED, iMin D3-504, 2026-10-11. The till holds register CAJA-1 for the
-- ONCA demo merchant, with a drawer opened on 7 October by the Caja 1 operator.
-- The app was updated between shifts, so the drawer is still held by this very
-- terminal (`holding_device_id`) while `operator_session_id` points at a session
-- that no longer exists. The operator standing at the till is a different
-- person — and in this database a different row, because Caja 1's user is only
-- `invited`.
--
--   POST /cash/shifts/a45f4711…/resume
--     -> 500 INTERNAL_ERROR   (pos-cash.repository.ts threw a bare
--                              Error('INVALID_SHIFT_TRANSITION'))
--
-- and every charge after it:
--
--   POST /checkout
--     -> 409 CASH_SHIFT_REQUIRED with holdState=held_by_this_device
--
-- The till was told the drawer was its own and that resuming would fix it, and
-- the resume could never succeed: the write matched the shift on
-- `responsible_operator_id = acting operator`, which is a fact about the PERSON,
-- while the read that offered the button matches on `holding_device_id`, which is
-- a fact about the TERMINAL. One predicate decided two different questions.
--
-- WHAT CHANGES IN THE WRITE. `transition(resume)` now takes the same view the
-- read does: the terminal that holds the drawer may hand it back to the operator
-- standing in front of it. The session is re-pinned to that operator and so is
-- `responsible_operator_id`, because every other write on a drawer (a movement, a
-- count, the close) matches on the responsible operator — leaving it pointing at
-- a person who has left would only move the dead end one screen later.
--
-- THIS FILE IS THE OTHER HALF. A hand-over that no row records is exactly the
-- kind of history the custody table exists to prevent, so `operator_resume`
-- becomes a fourth event type. Its shape is the adoption's — a new holder, a new
-- session, and NO counted cash, because nobody counted anything: the money never
-- moved, only the name on it. `cash_custody_shape` enforces that, so a resume can
-- never be written with a number attached that nobody counted.
--
-- WHY NOT REUSE `device_adoption`. The two name different events and the audit
-- trail is read by a human after a variance: adoption says "the shift moved to
-- another terminal", this says "another operator took the drawer on the terminal
-- that already had it". Recording the second as the first would make the chain of
-- custody disagree with the terminal that actually held the cash.
--
-- Idempotent and re-runnable: both constraints are dropped before they are added.
-- ============================================================================

alter table merchant.cash_shift_custody_event
  drop constraint if exists cash_shift_custody_event_event_type_check;
alter table merchant.cash_shift_custody_event
  add constraint cash_shift_custody_event_event_type_check
  check (event_type in (
    'device_adoption',
    'manager_recovery',
    'orphan_reclaim',
    'operator_resume'
  ));

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
      when 'operator_resume' then
        new_holding_device_id is not null
        and new_holding_credential_version is not null
        and new_operator_session_id is not null
        and counted_cash_minor_units is null
      when 'manager_recovery' then
        counted_cash_minor_units is not null
        and expected_cash_minor_units is not null
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
