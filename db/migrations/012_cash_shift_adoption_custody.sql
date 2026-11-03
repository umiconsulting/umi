-- ============================================================================
-- 012 · A terminal that adopts a shift may write it
--
-- WHY. `merchant.cash_shift.device_scoping` (build-v3-68) demands, on every
-- write, that the row's `device_id` be the device making the request. That is
-- the CREATE-time owner, and it never changes: the BEFORE trigger in the same
-- file rejects any update that touches `device_id` with "cash shift identity is
-- immutable". Custody, meanwhile, is `holding_device_id` — which is exactly the
-- column adoption moves.
--
-- So `POST /pos/merchants/:merchantId/cash/shifts/:shiftId/adopt` could never
-- succeed. On the local till, 2026-10-10, the Caja screen offered "Traer el
-- turno a esta terminal" (the app had been re-enrolled, so its stored device
-- credential was new while the drawer's shift still belonged to the old one) and
-- EVERY press answered 500:
--
--   new row violates row-level security policy "device_scoping" for table
--   "cash_shift"  · DatabaseError
--
-- The screen said "No se completó la operación. Intenta de nuevo o solicita
-- ayuda." A till in that state cannot charge at all: the money path answers
-- CASH_SHIFT_REQUIRED until a shift it holds is active.
--
-- WHAT IT ADDS. One clause: the device HOLDING the shift may write it. The other
-- two branches are carried over verbatim — the administrative-command window for
-- refunds, and the orphan reclaim of build-v3-68, which stays the path for a
-- holder that no longer exists.
--
-- WHY IT IS SAFE. `device_scoping` is RESTRICTIVE, so it ANDs with the permissive
-- `merchant_isolation` and `merchant_location_isolation` policies: tenant and
-- location scoping are untouched. The clause only widens WHICH DEVICE of the same
-- merchant and location may write; the identity trigger still forbids taking a
-- row by rewriting `device_id`, so custody cannot be seized by writing it.
--
-- Idempotent and re-runnable: the policy is dropped before it is created.
-- ============================================================================

drop policy if exists device_scoping on merchant.cash_shift;
create policy device_scoping on merchant.cash_shift as restrictive
  using (true)
  with check (
    (umi.current_device() is not null and cash_shift.device_id = umi.current_device())
    -- The holder operates the drawer. Adoption moves custody here, so without
    -- this branch the operation that hands the shift over cannot pass its own
    -- guard.
    or (umi.current_device() is not null and cash_shift.holding_device_id = umi.current_device())
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

