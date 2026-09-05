-- 49 · Merchant-owned roles and platform role templates.
--
-- PRE-CUTOVER PLACEMENT. `migrations/README.md` puts a schema change in a
-- numbered file until the cutover stamps `FROZEN.sha256`, and only after that in
-- `migrations/`. This arrived as `migrations/002_merchant_roles.sql` while the
-- DDL was still open, so a PRISTINE build never carried it: `00_run.sh` applies
-- the numbered files only, and `umi-api-ci.yml` builds that way and runs
-- `test:integration:schema` BEFORE it applies any migration. The backend already
-- reads `merchant.role`, `merchant.role_permission` and `umi.role_template`, so
-- schema-parity failed on four identifiers that existed in no pristine database.
--
-- It runs LAST, next to 47 and 48, because it reads rows rather than only
-- declaring tables: the templates come from `umi.role`, the merchant roles from
-- `merchant.merchant` x `umi.role`, and the staff backfill from both. Those rows
-- do not exist until 35 has seeded the catalogue.
--
-- Still additive, and still re-runnable: `merchant.staff.role_id` stays the
-- rollback path until the new resolver has finished its observation period.

-- ---------------------------------------------------------------------------
-- 0 · The four platform permissions `backfill/seed_rbac.sql` also seeds.
--
-- ORDER, not decoration. `seed_rbac.sql` inserts them with (key, description)
-- and runs BEFORE this file in the backfill path but AFTER `00_run.sh` in CI.
-- Once `product_key` and `group_key` are NOT NULL below, that two-column insert
-- fails. Seeding them here first makes the `where not exists` in `seed_rbac.sql`
-- find them and insert nothing, so one file serves both runners unchanged.
-- ---------------------------------------------------------------------------
insert into umi.permission (key, description)
select v.key, v.description
from (values
  ('insights.read',   'Read merchant insights and reports'),
  ('loyalty.operate', 'Operate the loyalty register'),
  ('orders.operate',  'Operate orders and the kitchen board'),
  ('tenant.manage',   'Change merchant settings, staff and locations')
) as v(key, description)
where not exists (select 1 from umi.permission p where p.key = v.key);


alter table umi.permission add column if not exists product_key text;
alter table umi.permission add column if not exists group_key text;
alter table umi.permission add column if not exists status text;
alter table umi.permission add column if not exists delegable boolean;
alter table umi.permission add column if not exists risk_level text;

update umi.permission
set product_key = case
      when split_part(key, '.', 1) = 'kitchen' then 'kds'
      when split_part(key, '.', 1) in ('loyalty','wallet','gift_card','stored_value') then 'cash'
      when split_part(key, '.', 1) in ('audit','insights','merchant','tenant') then 'dashboard'
      else 'pos'
    end,
    group_key = split_part(key, '.', 1),
    status = coalesce(status, 'active'),
    delegable = coalesce(delegable, true),
    risk_level = coalesce(risk_level, case
      when key like '%.approve' or key like '%.manage' or key like '%.refund%' then 'high'
      when key like '%.write' or key like '%.create' or key like '%.adjust%' then 'medium'
      else 'low'
    end)
where product_key is null
   or group_key is null
   or status is null
   or delegable is null
   or risk_level is null;

alter table umi.permission alter column product_key set not null;
alter table umi.permission alter column group_key set not null;
alter table umi.permission alter column status set default 'active';
alter table umi.permission alter column status set not null;
alter table umi.permission alter column delegable set default true;
alter table umi.permission alter column delegable set not null;
alter table umi.permission alter column risk_level set default 'low';
alter table umi.permission alter column risk_level set not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='permission_status_ck') then
    alter table umi.permission add constraint permission_status_ck
      check (status in ('active','retired'));
  end if;
  if not exists (select 1 from pg_constraint where conname='permission_risk_level_ck') then
    alter table umi.permission add constraint permission_risk_level_ck
      check (risk_level in ('low','medium','high'));
  end if;
end $$;

create table if not exists umi.role_template (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  current_version integer not null default 1 check (current_version > 0),
  status text not null default 'active' check (status in ('active','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists umi.role_template_revision (
  template_id uuid not null references umi.role_template(id) on delete cascade,
  version integer not null check (version > 0),
  name text not null,
  description text,
  published_at timestamptz not null default now(),
  primary key (template_id, version)
);

create table if not exists umi.role_template_revision_permission (
  template_id uuid not null,
  version integer not null,
  permission_id uuid not null references umi.permission(id) on delete restrict,
  primary key (template_id, version, permission_id),
  foreign key (template_id, version)
    references umi.role_template_revision(template_id, version) on delete cascade
);

insert into umi.role_template(key,name,description)
select key,name,description
from umi.role
where not is_platform
on conflict(key) do nothing;

insert into umi.role_template_revision(template_id,version,name,description)
select id,1,name,description from umi.role_template
on conflict(template_id,version) do nothing;

insert into umi.role_template_revision_permission(template_id,version,permission_id)
select t.id,1,rp.permission_id
from umi.role_template t
join umi.role r on r.key=t.key and not r.is_platform
join umi.role_permission rp on rp.role_id=r.id
on conflict do nothing;

create table if not exists merchant.role (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  source_template_id uuid references umi.role_template(id) on delete set null,
  source_template_version integer,
  legacy_role_id uuid references umi.role(id) on delete restrict,
  is_system boolean not null default false,
  status text not null default 'active' check (status in ('active','archived')),
  revision integer not null default 1 check (revision > 0),
  created_by uuid references umi.user(id) on delete set null,
  updated_by uuid references umi.user(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id,id),
  unique (merchant_id,key),
  constraint merchant_role_template_revision_ck check (
    (source_template_id is null) = (source_template_version is null)
  ),
  constraint merchant_role_template_revision_fk foreign key
    (source_template_id,source_template_version)
    references umi.role_template_revision(template_id,version) on delete set null
);

create table if not exists merchant.role_permission (
  merchant_id uuid not null,
  role_id uuid not null,
  permission_id uuid not null references umi.permission(id) on delete restrict,
  primary key (role_id,permission_id),
  constraint merchant_role_permission_same_merchant_fk foreign key (merchant_id,role_id)
    references merchant.role(merchant_id,id) on delete cascade
);

insert into merchant.role(
  merchant_id,key,name,description,source_template_id,source_template_version,
  legacy_role_id,is_system
)
select m.id,r.key,r.name,r.description,t.id,1,r.id,r.key='owner'
from merchant.merchant m
cross join umi.role r
join umi.role_template t on t.key=r.key
where not r.is_platform
on conflict(merchant_id,key) do nothing;

insert into merchant.role_permission(merchant_id,role_id,permission_id)
select mr.merchant_id,mr.id,rp.permission_id
from merchant.role mr
join umi.role_permission rp on rp.role_id=mr.legacy_role_id
on conflict do nothing;

alter table merchant.staff add column if not exists merchant_role_id uuid;

update merchant.staff s
set merchant_role_id=mr.id
from merchant.role mr
where s.merchant_role_id is null
  and mr.merchant_id=s.merchant_id
  and mr.legacy_role_id=s.role_id;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='staff_merchant_role_same_merchant_fk') then
    alter table merchant.staff add constraint staff_merchant_role_same_merchant_fk
      foreign key (merchant_id,merchant_role_id)
      references merchant.role(merchant_id,id) on delete restrict;
  end if;
end $$;

create index if not exists staff_merchant_role_idx
  on merchant.staff(merchant_id,merchant_role_id);
create index if not exists merchant_role_permission_permission_idx
  on merchant.role_permission(permission_id,role_id);

alter table merchant.role enable row level security;
alter table merchant.role force row level security;
drop policy if exists merchant_isolation on merchant.role;
create policy merchant_isolation on merchant.role
  using (merchant_id=umi.current_merchant())
  with check (merchant_id=umi.current_merchant());

alter table merchant.role_permission enable row level security;
alter table merchant.role_permission force row level security;
drop policy if exists merchant_isolation on merchant.role_permission;
create policy merchant_isolation on merchant.role_permission
  using (merchant_id=umi.current_merchant())
  with check (merchant_id=umi.current_merchant());

grant select on umi.role_template,umi.role_template_revision,
  umi.role_template_revision_permission to api;
grant select,insert,update,delete on merchant.role,merchant.role_permission to api;

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

drop trigger if exists merchant_role_permission_operator_session_invalidation
  on merchant.role_permission;
create trigger merchant_role_permission_operator_session_invalidation
after insert or update or delete on merchant.role_permission
for each row execute function runtime.invalidate_operator_sessions_for_rbac();

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

do $$
begin
  raise notice '49_merchant_roles: templates, merchant roles, grants, RLS, and staff backfill are ready.';
end $$;
