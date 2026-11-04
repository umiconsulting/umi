-- 53 · Server-authorized dashboard location selection — the grants.
--
-- PRE-CUTOVER PLACEMENT. It arrived as a file in `migrations/` while the DDL was
-- still open. `00_run.sh` applies the numbered files only, and CI runs
-- `test:integration:schema` against that pristine build BEFORE any migration, so
-- the backend read a relation no pristine database carried. See 49 for the rule.
--
-- The PERMISSION itself is seeded by 35 (generated from the pilot matrix), which
-- reconciles its own grants and so must create it. This file carries the rest:
-- the platform grant, the per-merchant grant and the template revision, all of
-- which need the tables 49 creates.

insert into umi.permission(
  key,description,product_key,group_key,status,delegable,risk_level
) values (
  'location.switch',
  'Select another merchant location for dashboard work',
  'dashboard','location','active',true,'high'
)
on conflict(key) do update set
  description=excluded.description,
  product_key=excluded.product_key,
  group_key=excluded.group_key,
  status=excluded.status,
  delegable=excluded.delegable,
  risk_level=excluded.risk_level;

insert into umi.role_permission(role_id,permission_id)
select r.id,p.id
from umi.role r
join umi.permission p on p.key='location.switch'
where r.key in ('admin','owner','developer','super_admin')
on conflict do nothing;

insert into merchant.role_permission(merchant_id,role_id,permission_id)
select mr.merchant_id,mr.id,p.id
from merchant.role mr
join umi.permission p on p.key='location.switch'
where mr.key in ('admin','owner') and mr.status='active'
on conflict do nothing;

insert into umi.role_template_revision_permission(template_id,version,permission_id)
select rt.id,rtr.version,p.id
from umi.role_template rt
join umi.role_template_revision rtr
  on rtr.template_id=rt.id and rtr.version=rt.current_version
join umi.permission p on p.key='location.switch'
where rt.key in ('admin','owner') and rt.status='active'
on conflict do nothing;
