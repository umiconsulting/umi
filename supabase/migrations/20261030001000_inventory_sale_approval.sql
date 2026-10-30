-- Preserve the consumed checkout approval when the sale commits its stock.
-- The ledger keeps its existing approval guard and the callable interface stays unchanged.
begin;
create or replace function merchant.commit_sale_inventory(
  p_reservation_id uuid,
  p_sale_id uuid,
  p_command_id uuid,
  p_operator_id uuid,
  p_device_id uuid,
  p_credential_version integer,
  p_business_date date,
  p_correlation_id text
) returns integer
language plpgsql security invoker set search_path=pg_catalog,merchant,runtime as $$
declare
  r record;
  v_res merchant.inventory_reservation%rowtype;
  v_count integer:=0;
  v_approval_id uuid;
begin
  select * into v_res from merchant.inventory_reservation
   where id=p_reservation_id and status in ('active','reserved') and expires_at>clock_timestamp()
   for update;
  if not found then raise exception 'RESERVATION_EXPIRED'; end if;

  -- Only the grant consumed by this checkout can authorize negative stock.
  select g.id into v_approval_id from runtime.elevation_grant g
   where g.merchant_id=v_res.merchant_id and g.location_id=v_res.location_id
     and g.permission_key='inventory.negative_stock.override'
     and g.method='manager_approval'
     and g.command_fingerprint=v_res.command_fingerprint
     and g.consumed_by_command_id=p_command_id and g.consumed_at is not null;

  for r in select * from merchant.inventory_reservation_line
    where reservation_id=p_reservation_id order by inventory_item_id,sale_line_id
  loop
    perform merchant.append_stock_ledger(
      r.merchant_id,r.location_id,r.inventory_location_id,r.inventory_item_id,
      'sale_committed',r.required_quantity,p_command_id,p_command_id,
      case when v_approval_id is not null then v_res.command_fingerprint
        else encode(extensions.digest(p_command_id::text||':'||r.inventory_item_id::text||':'||r.sale_line_id::text,'sha256'),'hex') end,
      'pos_sale',p_sale_id,p_operator_id,p_device_id,p_credential_version,p_business_date,
      p_correlation_id,p_sale_id,r.sale_line_id,null,null,
      jsonb_build_object('mappingId',r.mapping_id,'mappingVersion',r.mapping_version,
        'recipeId',r.recipe_id,'recipeVersion',r.recipe_version)
        || case when v_approval_id is not null then jsonb_build_object('negativeStockApprovalId',v_approval_id)
          else '{}'::jsonb end
    );
    v_count:=v_count+1;
  end loop;
  update merchant.inventory_reservation set status='committed',committed_at=clock_timestamp(),updated_at=clock_timestamp()
   where id=p_reservation_id;
  return v_count;
end $$;
revoke all on function merchant.commit_sale_inventory(uuid,uuid,uuid,uuid,uuid,integer,date,text) from public,readonly;
grant execute on function merchant.commit_sale_inventory(uuid,uuid,uuid,uuid,uuid,integer,date,text) to api,worker;
commit;
