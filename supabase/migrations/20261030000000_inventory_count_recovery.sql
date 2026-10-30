-- Count recovery keeps the original operator and command provenance.
-- Merchant and location policies still restrict every operation.
begin;
create or replace function merchant.inventory_count_cancel_authorized(
  p_count_id uuid,p_merchant_id uuid,p_location_id uuid
) returns boolean language sql stable security invoker set search_path=pg_catalog as $$
  select exists (
    select 1 from merchant.administrative_command ac
    where ac.id=nullif(current_setting('app.inventory_count_cancel_command_id',true),'')::uuid
      and ac.merchant_id=p_merchant_id and ac.location_id=p_location_id
      and ac.actor_user_id=nullif(current_setting('app.user_id',true),'')::uuid
      and ac.operation='inventory.count.cancel' and ac.permission='inventory.count.create'
      and ac.status='pending' and ac.target_aggregate_id=p_count_id
  ) or exists (
    select 1 from runtime.operator_session os
    where os.id=nullif(current_setting('app.inventory_count_cancel_session_id',true),'')::uuid
      and os.merchant_id=p_merchant_id and os.location_id=p_location_id
      and os.user_id=nullif(current_setting('app.user_id',true),'')::uuid
      and os.device_id=umi.current_device() and os.state='active'
      and os.expires_at>clock_timestamp()
      and ('inventory.count.create'=any(os.permissions) or '*'=any(os.permissions))
  );
$$;
revoke all on function merchant.inventory_count_cancel_authorized(uuid,uuid,uuid) from public;
grant execute on function merchant.inventory_count_cancel_authorized(uuid,uuid,uuid) to api,worker;

drop policy if exists device_scoping on merchant.inventory_count;
-- SELECT exposes the active count in its merchant and location to an authorized reader.
create policy inventory_count_scope_read on merchant.inventory_count as restrictive for select using (true);
create policy device_scoping on merchant.inventory_count as restrictive for insert
  with check ((
  (umi.current_device() is not null and inventory_count.device_id=umi.current_device())
  or (inventory_count.administrative_command_id is not null and exists (
    select 1 from merchant.administrative_command ac
    where ac.id=inventory_count.administrative_command_id
      and ac.merchant_id=(select umi.current_merchant())
      and ac.actor_user_id=nullif(current_setting('app.user_id',true),'')::uuid
      and (ac.location_id is null or umi.current_location() is null or ac.location_id=umi.current_location())
  ))
));
create policy inventory_count_scope_update on merchant.inventory_count as restrictive for update
  using ((
  (umi.current_device() is not null and inventory_count.device_id=umi.current_device())
  or (inventory_count.administrative_command_id is not null and exists (
    select 1 from merchant.administrative_command ac
    where ac.id=inventory_count.administrative_command_id
      and ac.merchant_id=(select umi.current_merchant())
      and ac.actor_user_id=nullif(current_setting('app.user_id',true),'')::uuid
      and (ac.location_id is null or umi.current_location() is null or ac.location_id=umi.current_location())
  ))
) or merchant.inventory_count_cancel_authorized(id,merchant_id,location_id))
  with check ((status<>'cancelled' and (
  (umi.current_device() is not null and inventory_count.device_id=umi.current_device())
  or (inventory_count.administrative_command_id is not null and exists (
    select 1 from merchant.administrative_command ac
    where ac.id=inventory_count.administrative_command_id
      and ac.merchant_id=(select umi.current_merchant())
      and ac.actor_user_id=nullif(current_setting('app.user_id',true),'')::uuid
      and (ac.location_id is null or umi.current_location() is null or ac.location_id=umi.current_location())
  ))
)) or (status='cancelled' and merchant.inventory_count_cancel_authorized(id,merchant_id,location_id)));
create policy inventory_count_scope_delete on merchant.inventory_count as restrictive for delete
  using ((
  (umi.current_device() is not null and inventory_count.device_id=umi.current_device())
  or (inventory_count.administrative_command_id is not null and exists (
    select 1 from merchant.administrative_command ac
    where ac.id=inventory_count.administrative_command_id
      and ac.merchant_id=(select umi.current_merchant())
      and ac.actor_user_id=nullif(current_setting('app.user_id',true),'')::uuid
      and (ac.location_id is null or umi.current_location() is null or ac.location_id=umi.current_location())
  ))
));
commit;
