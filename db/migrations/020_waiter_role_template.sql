-- Use the effective merchant role for every operator permission read.
create or replace function umi.resolve_staff_permissions(p_staff_id uuid)
returns text[]
language sql
stable
security definer
set search_path=umi,merchant,pg_temp
as $$
  select coalesce(array_agg(effective.key order by effective.key),'{}'::text[])
  from (
    select p.key
    from merchant.staff s
    join umi.permission p on p.status='active'
    left join merchant.role_permission mrp
      on s.merchant_role_id is not null
     and mrp.role_id=s.merchant_role_id
     and mrp.permission_id=p.id
    left join umi.role_permission rp
      on s.merchant_role_id is null
     and rp.role_id=s.role_id
     and rp.permission_id=p.id
    where s.id=p_staff_id and s.status='active'
      and (mrp.permission_id is not null or rp.permission_id is not null)
      and not exists (
        select 1 from merchant.staff_permission_override denied
        where denied.staff_id=s.id and denied.permission_id=p.id and denied.effect='deny'
          and (denied.expires_at is null or denied.expires_at>now())
      )
    union
    select p.key
    from merchant.staff_permission_override allowed
    join merchant.staff s on s.id=allowed.staff_id and s.status='active'
    join umi.permission p on p.id=allowed.permission_id and p.status='active'
    where allowed.staff_id=p_staff_id and allowed.effect='allow'
      and (allowed.expires_at is null or allowed.expires_at>now())
      and not exists (
        select 1 from merchant.staff_permission_override denied
        where denied.staff_id=allowed.staff_id
          and denied.permission_id=allowed.permission_id and denied.effect='deny'
          and (denied.expires_at is null or denied.expires_at>now())
      )
  ) effective;
$$;
revoke all on function umi.resolve_staff_permissions(uuid) from public;
grant execute on function umi.resolve_staff_permissions(uuid) to api,worker;

-- Restore merchant role invalidation after a pilot matrix reapply.
create or replace function runtime.invalidate_operator_sessions_for_rbac()
returns trigger
language plpgsql
security definer
set search_path=runtime,merchant,umi,pg_temp
as $$
begin
  if tg_table_schema='umi' and tg_table_name='role_permission' then
    update runtime.operator_session os
    set state='ended',ended_at=coalesce(ended_at,now()),last_activity_at=now()
    from merchant.staff s
    where os.staff_id=s.id
      and s.role_id=coalesce(new.role_id,old.role_id)
      and os.state in ('active','locked');
  elsif tg_table_schema='merchant' and tg_table_name='role_permission' then
    update runtime.operator_session os
    set state='ended',ended_at=coalesce(ended_at,now()),last_activity_at=now()
    from merchant.staff s
    where os.staff_id=s.id
      and s.merchant_role_id=coalesce(new.role_id,old.role_id)
      and os.state in ('active','locked');
  elsif tg_table_schema='merchant' and tg_table_name='staff_permission_override' then
    update runtime.operator_session
    set state='ended',ended_at=coalesce(ended_at,now()),last_activity_at=now()
    where staff_id=coalesce(new.staff_id,old.staff_id)
      and state in ('active','locked');
  else
    update runtime.operator_session
    set state='ended',ended_at=coalesce(ended_at,now()),last_activity_at=now()
    where staff_id=coalesce(new.id,old.id)
      and state in ('active','locked');
  end if;
  return coalesce(new,old);
end $$;

drop trigger if exists staff_authority_operator_session_invalidation on merchant.staff;
create trigger staff_authority_operator_session_invalidation
after update of role_id,merchant_role_id,location_id,status,operator_pin_hash,operator_pin_lookup
on merchant.staff
for each row
when (
  old.role_id is distinct from new.role_id
  or old.merchant_role_id is distinct from new.merchant_role_id
  or old.location_id is distinct from new.location_id
  or old.status is distinct from new.status
  or old.operator_pin_hash is distinct from new.operator_pin_hash
  or old.operator_pin_lookup is distinct from new.operator_pin_lookup
)
execute function runtime.invalidate_operator_sessions_for_rbac();

-- Waiters can prepare and send orders. Payment needs a separate permission.
insert into umi.role_template(key,name,description)
values ('waiter','Mesero','Prepare carts and send orders without payment authority')
on conflict(key) do nothing;
insert into umi.role_template_revision(template_id,version,name,description)
select id,1,name,description from umi.role_template where key='waiter'
on conflict(template_id,version) do nothing;
insert into umi.role_template_revision_permission(template_id,version,permission_id)
select t.id,1,p.id from umi.role_template t cross join umi.permission p
where t.key='waiter' and p.key in ('catalog.read','cart.write','order.fire')
on conflict do nothing;
insert into merchant.role(merchant_id,key,name,description,source_template_id,source_template_version)
select m.id,t.key,t.name,t.description,t.id,1
from merchant.merchant m cross join umi.role_template t where t.key='waiter'
on conflict(merchant_id,key) do nothing;
insert into merchant.role_permission(merchant_id,role_id,permission_id)
select r.merchant_id,r.id,rp.permission_id
from merchant.role r join umi.role_template t on t.id=r.source_template_id and t.key='waiter'
join umi.role_template_revision_permission rp on rp.template_id=t.id and rp.version=r.source_template_version
where r.key='waiter' and r.source_template_version=1 and r.revision=1
on conflict do nothing;
