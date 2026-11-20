-- The reusable setup secret can enroll devices only in this reserved demo merchant.
-- Credentials and fixture data belong to the operational seeder, never this migration.
create table if not exists runtime.app_review_access (
  merchant_id uuid primary key references merchant.merchant(id),
  location_id uuid not null references merchant.location(id),
  created_by uuid not null references umi."user"(id),
  setup_code_hash text not null unique check (setup_code_hash ~ '^[a-f0-9]{64}$'),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint app_review_demo_only check (merchant_id = 'a1100000-0000-4000-8000-000000000001'::uuid)
);
alter table runtime.app_review_access enable row level security;
alter table runtime.app_review_access force row level security;
revoke all on runtime.app_review_access from public, api, worker;
grant select on runtime.app_review_access to worker;
