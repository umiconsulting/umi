\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- build-v3 · 66_pos_cart_recovery_rollback — the resume stops re-dating the
-- cart, and the helper that existed only to re-date it goes away.
--
-- WHY THIS FILE EXISTS. build-v3-64 fixed a real 500: the cart-recovery path
-- wrote pos_cart.business_date from the request path, where `api` holds no
-- column privilege, and PostgreSQL reports that as the table-level
-- `permission denied for table pos_cart`. 64 fixed it by moving the write into
-- a SECURITY DEFINER function that stamped the date server-side.
--
-- The WRITE was never the answer. Three facts settle it:
--
--   1. 90_rls.sql seals the column deliberately — it revokes the table-level
--      UPDATE and grants it back column by column with business_date left out,
--      "because a client that can write it can move a sale into yesterday and
--      into the wrong cash-up". security_gate.sql asserts the seal.
--   2. merchant.tg_business_date (60_triggers) fires on INSERT **or UPDATE** and
--      re-derives the column from created_at, so whatever a resume writes is
--      overwritten in the same statement. That is D5: the re-stamp was inert.
--      60_triggers states the reason it fires on update: "a trigger that only
--      fires on insert leaves the column forgeable by a later UPDATE.
--      Re-deriving is idempotent, so firing on update costs nothing and closes
--      the hole."
--   3. The problem the re-stamp was invented for is solved already, further
--      along the money path. pos-checkout.repository.ts: the cart's date never
--      moves, so every cash sale on a cart that outlived midnight failed with a
--      500 and no explanation — and the fix is THE DRAWER DECIDES: "a sale paid
--      out of a shift belongs to that shift's business day, whatever day the
--      cart was born on. Without a shift there is nothing to disagree with and
--      the cart's own date stands." gate-3c-cash-migration.spec.ts asserts it:
--      "dates a cash sale by the shift, never by the cart it came from".
--
-- So a resume restores the lifecycle state and nothing else, and a day-boundary
-- cart keeps its CREATION date. That is also the shape `feat/table-map`'s
-- `fix(pos-cart): stop the resume upsert from editing the sealed business date`
-- already uses, so landing it here makes that merge a no-op for
-- PosCartRepository.create() instead of leaving a third variant.
--
-- WHY A NEW FILE AND NOT AN EDIT. 64 is applied: it stamped
-- runtime.schema_migration, and both freeze.sh and scripts/check-pr.mjs refuse
-- an edit to an applied file. The correction reaches the live database only as a
-- new numbered file.
--
-- WHY THE SAME FILE THEN DROPS THE HELPER, AND WHY THAT IS NOT A LOSS. The
-- create-or-replace below is 64's function with the business_date write removed,
-- so the chain's last word on it is correct and a NEW database never ends at
-- 64's version. Once the write is gone the helper has no remaining purpose:
--
--   · It would be dead code with the wrong name — a definer function whose only
--     privileged act was writing the one column a resume must not write.
--   · It would widen the surface for nothing. A definer function bypasses RLS
--     and must re-assert scope itself; every assertion is a liability that buys
--     nothing once the body is an upsert the request path may already run.
--   · The request path does NOT need it. `api` holds INSERT on pos_cart and
--     UPDATE on every column but business_date, which is exactly what the
--     upsert uses, plus the trigger's own re-derivation of the date.
--
-- NOT ONE MORE GRANT, and not one fewer: nothing here changes `api`'s
-- privileges, and has_column_privilege('api','merchant.pos_cart','business_date',
-- 'UPDATE') stays false. Granting the column would BE the bug.
--
-- Idempotent and re-runnable: `create or replace` and `drop function if exists`.
-- The drop is the default RESTRICT, not CASCADE, so a future dependent object
-- fails this file loudly instead of being taken down with it.
-- ============================================================================

-- 1 · The correction, as the chain's last word on the function. Identical to 64
--     except that business_date is named nowhere: absent from the INSERT column
--     list, no timezone lookup, no assignment in DO UPDATE. The scope assertions
--     stay, because a definer function that bypasses RLS owes them.
--
--     No grant block: create-or-replace keeps the existing ACL, and the one case
--     where there is no existing function — a database that somehow never ran 64
--     — cannot leak the default PUBLIC EXECUTE, because DDL is transactional and
--     by commit this function no longer exists.
create or replace function merchant.create_or_recover_pos_cart(
  p_merchant_id uuid, p_location_id uuid, p_operator_session_id uuid
) returns uuid language plpgsql security definer
set search_path=pg_catalog,merchant,runtime,umi as $$
declare v_cart_id uuid;
begin
  -- Fail closed before anything is written: the caller may not name a merchant
  -- or a location other than the one its transaction is scoped to.
  if umi.current_merchant() is null
  then raise exception 'POS_CART_CONTEXT_REQUIRED'; end if;
  if p_merchant_id is distinct from umi.current_merchant()
  then raise exception 'POS_CART_MERCHANT_SCOPE'; end if;
  if p_location_id is distinct from umi.current_location()
  then raise exception 'POS_CART_LOCATION_SCOPE'; end if;

  -- The predicates are the repository's own: an active branch of this merchant,
  -- and an operator session pinned to both. No row qualifies -> nothing inserted
  -- -> v_cart_id stays null -> the caller keeps its `branch_not_allowed`
  -- contract instead of inventing a second failure mode.
  insert into merchant.pos_cart
    (merchant_id,location_id,operator_session_id,original_operator_session_id,
     original_operator_user_id,operator_user_id)
  select p_merchant_id,p_location_id,p_operator_session_id,p_operator_session_id,
         os.user_id,os.user_id
  from merchant.location b
  join runtime.operator_session os on os.id=p_operator_session_id
  where b.id=p_location_id and b.merchant_id=p_merchant_id and b.status='active'
    and os.merchant_id=p_merchant_id and os.location_id=p_location_id
  on conflict (merchant_id,location_id,operator_user_id) where lifecycle_state in
    ('building_cart','ready_for_checkout','recovered')
  do update set operator_session_id=excluded.operator_session_id,
                lifecycle_state='recovered',
                updated_at=now()
  returning id into v_cart_id;

  return v_cart_id;
end $$;

-- 2 · Nothing is left to call it: the plain upsert above is the request path's,
--     and PosCartRepository.create() no longer references this function.
--     Measured on the live database before this file was written, pg_depend had
--     no entry depending on it (deptype <> 'i'), so the drop breaks nothing.
drop function if exists merchant.create_or_recover_pos_cart(uuid,uuid,uuid);

insert into runtime.schema_migration(version,status)
values('build-v3-66','applied') on conflict(version) do nothing;

commit;
