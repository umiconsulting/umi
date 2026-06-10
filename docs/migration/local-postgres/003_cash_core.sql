create schema if not exists cash;

create table cash.wallet_programs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  location_id uuid references platform.locations(id),
  name text not null,
  card_prefix text,
  topup_enabled boolean not null default true,
  pass_style text not null default 'default',
  branding jsonb not null default '{}'::jsonb,
  status text not null default 'active'
    check (status in ('active', 'disabled', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cash_wallet_programs_tenant_status_idx
  on cash.wallet_programs (tenant_id, status);

create table cash.loyalty_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  contact_id uuid not null references platform.contacts(id),
  program_id uuid references cash.wallet_programs(id),
  status text not null default 'active'
    check (status in ('active', 'disabled', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, contact_id)
);

create index cash_loyalty_accounts_tenant_status_idx
  on cash.loyalty_accounts (tenant_id, status);

create table cash.loyalty_cards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  loyalty_account_id uuid not null references cash.loyalty_accounts(id) on delete cascade,
  card_number text not null unique,
  balance_cents integer not null default 0,
  total_visits integer not null default 0,
  visits_this_cycle integer not null default 0,
  pending_rewards integer not null default 0,
  qr_token text unique,
  qr_issued_at timestamptz,
  status text not null default 'active'
    check (status in ('active', 'disabled', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cash_loyalty_cards_tenant_idx
  on cash.loyalty_cards (tenant_id);

create table cash.visit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  loyalty_card_id uuid not null references cash.loyalty_cards(id),
  staff_member_id uuid references platform.staff_members(id),
  note text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index cash_visit_events_card_idx
  on cash.visit_events (loyalty_card_id, occurred_at desc);

create table cash.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  loyalty_card_id uuid not null references cash.loyalty_cards(id),
  staff_member_id uuid references platform.staff_members(id),
  type text not null check (type in ('topup', 'purchase', 'adjustment', 'gift_card_redeem')),
  amount_cents integer not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index cash_wallet_transactions_card_idx
  on cash.wallet_transactions (loyalty_card_id, created_at desc);

create table cash.reward_configs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  program_id uuid references cash.wallet_programs(id),
  visits_required integer not null default 10 check (visits_required > 0),
  reward_name text not null,
  reward_description text,
  reward_cost_cents integer not null default 0,
  is_active boolean not null default true,
  activated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index cash_reward_configs_tenant_active_idx
  on cash.reward_configs (tenant_id, is_active, activated_at desc);

create table cash.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  loyalty_card_id uuid not null references cash.loyalty_cards(id),
  reward_config_id uuid not null references cash.reward_configs(id),
  staff_member_id uuid references platform.staff_members(id),
  note text,
  redeemed_at timestamptz not null default now()
);

create index cash_reward_redemptions_card_idx
  on cash.reward_redemptions (loyalty_card_id, redeemed_at desc);

create table cash.gift_cards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  code text not null unique,
  amount_cents integer not null check (amount_cents > 0),
  created_by_staff_member_id uuid references platform.staff_members(id),
  sender_name text,
  message text,
  recipient_contact_id uuid references platform.contacts(id),
  recipient_email text,
  recipient_phone text,
  recipient_name text,
  redeemed_at timestamptz,
  redeemed_loyalty_card_id uuid references cash.loyalty_cards(id),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index cash_gift_cards_tenant_redeemed_idx
  on cash.gift_cards (tenant_id, redeemed_at);

create table cash.passes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  loyalty_card_id uuid not null references cash.loyalty_cards(id) on delete cascade,
  provider text not null check (provider in ('apple', 'google')),
  provider_object_id text,
  serial_number text,
  auth_token text,
  status text not null default 'active'
    check (status in ('active', 'disabled', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_object_id)
);

create index cash_passes_tenant_provider_idx
  on cash.passes (tenant_id, provider);

create table cash.pass_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  pass_id uuid not null references cash.passes(id) on delete cascade,
  device_token text not null,
  push_token text,
  created_at timestamptz not null default now(),
  unique (pass_id, device_token)
);

create table cash.otp_verifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  contact_id uuid references platform.contacts(id),
  identity_type text not null check (identity_type in ('phone', 'email')),
  identity_value text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index cash_otp_verifications_identity_idx
  on cash.otp_verifications (tenant_id, identity_type, identity_value, created_at desc);

grant select on all tables in schema cash to umi_app, umi_worker, umi_readonly;
