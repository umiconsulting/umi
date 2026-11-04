\set ON_ERROR_STOP on

-- A waiter takes orders offline and must be able to replay those same commands
-- when connectivity returns. Without this permission the journal stays pending,
-- blocks account changes, and retries the replay route until it answers 403.

insert into umi.role_template_revision(template_id,version,name,description)
select id,3,name,description from umi.role_template where key='waiter'
on conflict(template_id,version) do nothing;

insert into umi.role_template_revision_permission(template_id,version,permission_id)
select t.id,3,p.id
from umi.role_template t
cross join umi.permission p
where t.key='waiter'
  and p.key in (
    'catalog.read',
    'cart.write',
    'offline.replay',
    'order.fire',
    'kitchen.read',
    'kitchen.station.read'
  )
on conflict do nothing;

update merchant.role r
   set source_template_version=3,
       revision=3,
       updated_at=now()
 where r.key='waiter'
   and r.source_template_version=2
   and r.revision=2
   and exists (
     select 1
       from umi.role_template t
      where t.id=r.source_template_id
        and t.key='waiter'
   );

insert into merchant.role_permission(merchant_id,role_id,permission_id)
select r.merchant_id,r.id,rp.permission_id
from merchant.role r
join umi.role_template t
  on t.id=r.source_template_id
 and t.key='waiter'
join umi.role_template_revision_permission rp
  on rp.template_id=t.id
 and rp.version=r.source_template_version
where r.key='waiter'
on conflict do nothing;
