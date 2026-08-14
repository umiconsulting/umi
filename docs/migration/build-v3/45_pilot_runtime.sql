-- Gate 6A deployment metadata. Business facts remain in their existing owners.
create table if not exists runtime.schema_migration (
  version text primary key,
  status text not null check (status = 'applied'),
  applied_at timestamptz not null default now()
);

revoke all on runtime.schema_migration from public, api, readonly;
grant select on runtime.schema_migration to worker;

insert into runtime.schema_migration(version, status)
values ('build-v3-45', 'applied')
on conflict (version) do nothing;
