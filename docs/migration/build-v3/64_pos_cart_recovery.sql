\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- build-v3 · 64_pos_cart_recovery — a till may recover its cart, but it may
-- not choose the day the recovery lands in.
--
-- WHY THIS FILE EXISTS. merchant.pos_cart.business_date is deliberately NOT
-- updatable by role `api`: 90_rls.sql revokes the table-level UPDATE and grants
-- it back column by column, leaving business_date out, because a client that
-- can write it can move a sale into yesterday and into the wrong cash-up.
--
-- The cart upsert in PosCartRepository.create() then ON CONFLICT DO UPDATE'd
-- `business_date` anyway — the re-stamp is wanted (a cart picked up the next
-- morning is today's cart; leaving yesterday's stamp on it is what sent stale
-- dates downstream to the cash ledger), but it was being done from the request
-- path, which has no privilege for it. PostgreSQL reports a missing COLUMN
-- UPDATE privilege as the TABLE-level `permission denied for table pos_cart`,
-- so the failure read as a table grant bug. It fired for every operator who
-- already had a live cart and opened the till again — the cart-recovery path,
-- on the money path. 318 occurrences in /tmp/umi-api.log, the first hours
-- before build-v3-63 was applied: this is pre-existing, not a 63 regression.
--
-- THE FIX, AND WHY IT IS A FUNCTION. The invariant (`api` may not choose a
-- business date) is the part that must not move, so the privileged half moves
-- to the owner instead of the grant moving to the client. This function runs
-- as its owner, does the same upsert, and derives the business date
-- SERVER-SIDE from the location's timezone — the same expression the
-- repository used to send, kept as the single source of truth. The client
-- passes scope, never a date.
--
-- SCOPE BINDING. A SECURITY DEFINER function owned by the schema owner bypasses
-- RLS, so it has to re-assert what the policy would have enforced; this is the
-- shape merchant.assert_hardware_scope (40_pos_hardware_runtime) and
-- merchant.assert_customer_value_write_scope (48_customer_value_worker_scope)
-- already use. merchant and location must equal the caller's transaction scope
-- (umi.current_merchant() / umi.current_location()), and the operator session
-- must itself belong to that merchant AND that location and sit on an active
-- branch. The trust model is RLS's own: the scope GUCs are set by the request
-- path (PgService.runWithMerchant) and are the tenant boundary.
--
-- NOT ONE MORE GRANT. No INSERT/UPDATE privilege is added to `api` by this
-- file, so `has_column_privilege('api','merchant.pos_cart','business_date',
-- 'UPDATE')` stays false and the 90_rls rule is intact.
--
-- Idempotent and re-runnable: `create or replace`, and the grant block is
-- unconditional.
-- ============================================================================

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

  -- The predicates below are the repository's, unchanged: an active branch of
  -- this merchant, and an operator session pinned to both. No row qualifies ->
  -- no row inserted -> v_cart_id stays null -> the caller keeps its existing
  -- `branch_not_allowed` contract instead of inventing a second failure mode.
  insert into merchant.pos_cart
    (merchant_id,location_id,operator_session_id,original_operator_session_id,
     original_operator_user_id,operator_user_id,business_date)
  select p_merchant_id,p_location_id,p_operator_session_id,p_operator_session_id,os.user_id,os.user_id,
    (now() at time zone coalesce(b.timezone,business.timezone))::date
  from merchant.location b
  join merchant.merchant business on business.id=b.merchant_id
  join runtime.operator_session os on os.id=p_operator_session_id
  where b.id=p_location_id and b.merchant_id=p_merchant_id and b.status='active'
    and os.merchant_id=p_merchant_id and os.location_id=p_location_id
  on conflict (merchant_id,location_id,operator_user_id) where lifecycle_state in
    ('building_cart','ready_for_checkout','recovered')
  do update set operator_session_id=excluded.operator_session_id,
                lifecycle_state='recovered',
                -- The server, not the client, says which day this is: the same
                -- expression the repository used to send, now the only writer.
                business_date=excluded.business_date,
                updated_at=now()
  returning id into v_cart_id;

  return v_cart_id;
end $$;

revoke all on function merchant.create_or_recover_pos_cart(uuid,uuid,uuid)
  from public,readonly,worker;
grant execute on function merchant.create_or_recover_pos_cart(uuid,uuid,uuid) to api;

insert into runtime.schema_migration(version,status)
values('build-v3-64','applied') on conflict(version) do nothing;

commit;
