-- Floor-plan drafts and published snapshots. Apply after 90_rls.sql.
create table merchant.floor_plan (
  merchant_id uuid not null,
  location_id uuid not null,
  version integer not null default 0 check (version >= 0),
  draft jsonb not null check (jsonb_typeof(draft) = 'object'),
  published_version integer not null default 0,
  published jsonb,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (merchant_id, location_id),
  foreign key (merchant_id, location_id) references merchant.location(merchant_id, id) on delete restrict,
  check (published_version >= 0 and published_version <= version),
  check ((published is null and published_at is null and published_version = 0)
    or (published is not null and jsonb_typeof(published) = 'object' and published_at is not null and published_version > 0))
);
alter table merchant.floor_plan enable row level security;
alter table merchant.floor_plan force row level security;
create policy floor_plan_scope on merchant.floor_plan
  using (merchant_id = (select umi.current_merchant())
    and ((select umi.current_location()) is null or location_id = (select umi.current_location())))
  with check (merchant_id = (select umi.current_merchant())
    and ((select umi.current_location()) is null or location_id = (select umi.current_location())));
grant select, insert, update on merchant.floor_plan to api, worker;
grant select on merchant.floor_plan to readonly;
comment on table merchant.floor_plan is 'Versioned layout configuration. POS reads only published snapshots. Publication history lives in merchant.audit_event.';
