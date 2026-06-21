-- Supabase Platform Staging Migration
-- Adds the optimized 7-schema structure on top of existing Supabase project
-- Every statement idempotent — safe to re-run
-- Does NOT modify existing tables (edge functions depend on them)

BEGIN;

-- ═══ Extensions ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ═══ Schemas ══════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS commerce;
CREATE SCHEMA IF NOT EXISTS cash;
CREATE SCHEMA IF NOT EXISTS observability;
CREATE SCHEMA IF NOT EXISTS legacy;
CREATE SCHEMA IF NOT EXISTS dashboard_compat;

-- ═══ platform.* tables (schema exists but has no tables on Supabase) ═════════

CREATE TABLE IF NOT EXISTS platform.users (
  id uuid primary key default gen_random_uuid(),
  auth_subject text unique,
  email text,
  phone text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS platform.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  status text not null default 'active'
    check (status in ('active', 'disabled', 'archived')),
  timezone text not null default 'America/Mazatlan',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS platform.locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  slug text not null,
  name text not null,
  timezone text,
  status text not null default 'active'
    check (status in ('active', 'disabled', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS platform.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  user_id uuid not null references platform.users(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'invited', 'disabled', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS platform.roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references platform.tenants(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_roles_tenant_key_uidx
  on platform.roles (tenant_id, key)
  where tenant_id is not null;

CREATE UNIQUE INDEX IF NOT EXISTS platform_roles_global_key_uidx
  on platform.roles (key)
  where tenant_id is null;

CREATE TABLE IF NOT EXISTS platform.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text,
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS platform.role_permissions (
  role_id uuid not null references platform.roles(id) on delete cascade,
  permission_id uuid not null references platform.permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS platform.membership_roles (
  membership_id uuid not null references platform.tenant_memberships(id) on delete cascade,
  role_id uuid not null references platform.roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (membership_id, role_id)
);

CREATE TABLE IF NOT EXISTS platform.staff_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  location_id uuid references platform.locations(id) on delete set null,
  user_id uuid references platform.users(id) on delete set null,
  name text not null,
  email text,
  phone text,
  status text not null default 'active'
    check (status in ('active', 'invited', 'disabled', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS platform_staff_members_tenant_status_idx
  on platform.staff_members (tenant_id, status, name);

CREATE UNIQUE INDEX IF NOT EXISTS platform_staff_members_tenant_email_uidx
  on platform.staff_members (tenant_id, email)
  where email is not null;

CREATE UNIQUE INDEX IF NOT EXISTS platform_staff_members_tenant_phone_uidx
  on platform.staff_members (tenant_id, phone)
  where phone is not null;

CREATE TABLE IF NOT EXISTS platform.product_instances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  location_id uuid references platform.locations(id) on delete cascade,
  product_key text not null
    check (product_key in ('cash', 'conversaflow', 'kds', 'dashboard', 'observability')),
  status text not null
    check (status in ('active', 'trialing', 'disabled', 'missing', 'archived')),
  config jsonb not null default '{}'::jsonb,
  enabled_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_instances_tenant_product_global_key
on platform.product_instances (tenant_id, product_key)
where location_id is null;

CREATE UNIQUE INDEX IF NOT EXISTS product_instances_tenant_location_product_key
on platform.product_instances (tenant_id, location_id, product_key)
where location_id is not null;

CREATE TABLE IF NOT EXISTS platform.contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  display_name text,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS platform_contacts_tenant_name_idx
  on platform.contacts (tenant_id, display_name);

CREATE TABLE IF NOT EXISTS platform.contact_identities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  contact_id uuid not null references platform.contacts(id) on delete cascade,
  identity_type text not null
    check (identity_type in ('phone', 'email', 'whatsapp', 'wallet_pass', 'external')),
  identity_value text not null,
  normalized_value text,
  provider text,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'failed', 'expired')),
  verified_at timestamptz,
  confidence text not null default 'source_asserted'
    check (confidence in ('source_asserted', 'otp_verified', 'staff_verified', 'candidate')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS platform_contact_identities_contact_idx
  on platform.contact_identities (contact_id);

CREATE INDEX IF NOT EXISTS platform_contact_identities_lookup_idx
  on platform.contact_identities (tenant_id, identity_type, normalized_value)
  where normalized_value is not null;

CREATE UNIQUE INDEX IF NOT EXISTS platform_contact_identities_verified_uidx
  on platform.contact_identities (tenant_id, identity_type, normalized_value)
  where normalized_value is not null
    and verification_status = 'verified';

CREATE TABLE IF NOT EXISTS platform.external_refs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references platform.tenants(id) on delete cascade,
  location_id uuid references platform.locations(id) on delete cascade,
  product_key text not null
    check (product_key in ('cash', 'conversaflow', 'kds', 'dashboard', 'observability', 'legacy')),
  external_schema text,
  external_table text,
  external_id text not null,
  external_slug text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (product_key, external_schema, external_table, external_id)
);

CREATE INDEX IF NOT EXISTS platform_external_refs_tenant_idx
  on platform.external_refs (tenant_id, product_key);

CREATE TABLE IF NOT EXISTS platform.contact_merge_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  left_contact_id uuid not null references platform.contacts(id) on delete cascade,
  right_contact_id uuid not null references platform.contacts(id) on delete cascade,
  match_type text not null
    check (match_type in ('exact_normalized_phone', 'exact_normalized_email', 'last10_phone', 'manual_review')),
  confidence text not null default 'candidate'
    check (confidence in ('candidate', 'high', 'rejected', 'merged')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (left_contact_id <> right_contact_id),
  unique (tenant_id, left_contact_id, right_contact_id, match_type)
);

CREATE INDEX IF NOT EXISTS platform_contact_merge_candidates_tenant_confidence_idx
  on platform.contact_merge_candidates (tenant_id, confidence, created_at desc);

-- ═══ commerce.* tables ════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS commerce.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  location_id uuid references platform.locations(id),
  contact_id uuid references platform.contacts(id),
  order_number text,
  source_product text not null
    check (source_product in ('cash', 'conversaflow', 'kds', 'dashboard', 'external')),
  source_ref text,
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'accepted', 'in_progress', 'ready', 'completed', 'cancelled', 'refunded')),
  channel text,
  currency text not null default 'MXN',
  subtotal_cents integer not null default 0,
  tax_cents integer not null default 0,
  discount_cents integer not null default 0,
  total_cents integer not null default 0,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  placed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS commerce_orders_tenant_status_idx
  on commerce.orders (tenant_id, status, created_at desc);

CREATE INDEX IF NOT EXISTS commerce_orders_location_status_idx
  on commerce.orders (location_id, status, created_at desc)
  where location_id is not null;

CREATE TABLE IF NOT EXISTS commerce.order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  order_id uuid not null references commerce.orders(id) on delete cascade,
  product_ref text,
  name text not null,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null default 0,
  total_cents integer not null default 0,
  variant_name text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS commerce_order_items_order_idx
  on commerce.order_items (order_id, id);

CREATE TABLE IF NOT EXISTS commerce.order_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  order_id uuid not null references commerce.orders(id) on delete cascade,
  event_type text not null,
  previous_status text,
  next_status text,
  actor_user_id uuid references platform.users(id),
  actor_staff_member_id uuid references platform.staff_members(id),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS commerce_order_events_order_idx
  on commerce.order_events (order_id, occurred_at desc);

CREATE TABLE IF NOT EXISTS commerce.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  order_id uuid references commerce.orders(id) on delete set null,
  contact_id uuid references platform.contacts(id),
  provider text,
  provider_payment_id text,
  status text not null default 'pending'
    check (status in ('pending', 'authorized', 'paid', 'failed', 'refunded', 'cancelled')),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'MXN',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS commerce_payments_tenant_status_idx
  on commerce.payments (tenant_id, status, created_at desc);

CREATE TABLE IF NOT EXISTS commerce.refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  payment_id uuid not null references commerce.payments(id) on delete cascade,
  provider_refund_id text,
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed', 'cancelled')),
  amount_cents integer not null check (amount_cents > 0),
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS commerce_refunds_payment_idx
  on commerce.refunds (payment_id, created_at desc);

CREATE TABLE IF NOT EXISTS commerce.business_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  location_id uuid references platform.locations(id),
  timezone text not null,
  weekly_hours jsonb not null default '{}'::jsonb,
  effective_from date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS commerce_business_hours_tenant_location_idx
  on commerce.business_hours (tenant_id, location_id);

CREATE TABLE IF NOT EXISTS commerce.service_windows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  location_id uuid references platform.locations(id),
  service_key text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer,
  status text not null default 'open'
    check (status in ('open', 'limited', 'closed', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS commerce_service_windows_tenant_time_idx
  on commerce.service_windows (tenant_id, starts_at, ends_at);

-- ═══ cash.* tables (new schema — umi_cash is old naming, not touched) ════════

CREATE TABLE IF NOT EXISTS cash.wallet_programs (
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

CREATE INDEX IF NOT EXISTS cash_wallet_programs_tenant_status_idx
  on cash.wallet_programs (tenant_id, status);

CREATE TABLE IF NOT EXISTS cash.loyalty_accounts (
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

CREATE INDEX IF NOT EXISTS cash_loyalty_accounts_tenant_status_idx
  on cash.loyalty_accounts (tenant_id, status);

CREATE TABLE IF NOT EXISTS cash.loyalty_cards (
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

CREATE INDEX IF NOT EXISTS cash_loyalty_cards_tenant_idx
  on cash.loyalty_cards (tenant_id);

CREATE TABLE IF NOT EXISTS cash.visit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  loyalty_card_id uuid not null references cash.loyalty_cards(id),
  staff_member_id uuid references platform.staff_members(id),
  note text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS cash_visit_events_card_idx
  on cash.visit_events (loyalty_card_id, occurred_at desc);

CREATE TABLE IF NOT EXISTS cash.wallet_transactions (
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

CREATE INDEX IF NOT EXISTS cash_wallet_transactions_card_idx
  on cash.wallet_transactions (loyalty_card_id, created_at desc);

CREATE TABLE IF NOT EXISTS cash.reward_configs (
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

CREATE INDEX IF NOT EXISTS cash_reward_configs_tenant_active_idx
  on cash.reward_configs (tenant_id, is_active, activated_at desc);

CREATE TABLE IF NOT EXISTS cash.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  loyalty_card_id uuid not null references cash.loyalty_cards(id),
  reward_config_id uuid not null references cash.reward_configs(id),
  staff_member_id uuid references platform.staff_members(id),
  note text,
  redeemed_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS cash_reward_redemptions_card_idx
  on cash.reward_redemptions (loyalty_card_id, redeemed_at desc);

CREATE TABLE IF NOT EXISTS cash.gift_cards (
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

CREATE INDEX IF NOT EXISTS cash_gift_cards_tenant_redeemed_idx
  on cash.gift_cards (tenant_id, redeemed_at);

CREATE TABLE IF NOT EXISTS cash.passes (
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

CREATE INDEX IF NOT EXISTS cash_passes_tenant_provider_idx
  on cash.passes (tenant_id, provider);

CREATE TABLE IF NOT EXISTS cash.pass_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  pass_id uuid not null references cash.passes(id) on delete cascade,
  device_token text not null,
  push_token text,
  created_at timestamptz not null default now(),
  unique (pass_id, device_token)
);

CREATE TABLE IF NOT EXISTS cash.otp_verifications (
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

CREATE INDEX IF NOT EXISTS cash_otp_verifications_identity_idx
  on cash.otp_verifications (tenant_id, identity_type, identity_value, created_at desc);

-- ═══ conversaflow: NEW tables only (existing old ones NOT touched) ══════════

CREATE TABLE IF NOT EXISTS conversaflow.channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  key text not null check (key in ('whatsapp', 'sms', 'slack', 'web', 'voice')),
  name text not null,
  status text not null default 'active'
    check (status in ('active', 'disabled', 'archived')),
  created_at timestamptz not null default now(),
  unique (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS conversaflow.channel_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  location_id uuid references platform.locations(id),
  channel_id uuid not null references conversaflow.channels(id),
  provider text not null,
  provider_account_id text not null,
  address text,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'active'
    check (status in ('active', 'disabled', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS conversaflow_channel_accounts_tenant_idx
  on conversaflow.channel_accounts (tenant_id, channel_id);

CREATE TABLE IF NOT EXISTS conversaflow.workflow_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  conversation_id uuid references conversaflow.conversations(id),
  order_id uuid references commerce.orders(id),
  job_type text not null,
  aggregate_type text,
  aggregate_id uuid,
  payload jsonb not null default '{}'::jsonb,
  state text not null default 'pending'
    check (state in ('pending', 'claimed', 'running', 'completed', 'failed', 'dead')),
  priority smallint not null default 0,
  max_attempts smallint not null default 3,
  attempt_count smallint not null default 0,
  next_run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS conversaflow_workflow_jobs_claimable_idx
  on conversaflow.workflow_jobs (priority desc, next_run_at asc)
  where state = 'pending';

CREATE TABLE IF NOT EXISTS conversaflow.job_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  job_id uuid not null references conversaflow.workflow_jobs(id) on delete cascade,
  attempt smallint not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text not null default 'running'
    check (outcome in ('running', 'success', 'error', 'timeout')),
  error text,
  metadata jsonb not null default '{}'::jsonb,
  unique (job_id, attempt)
);

CREATE TABLE IF NOT EXISTS conversaflow.memory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  contact_id uuid references platform.contacts(id),
  conversation_id uuid references conversaflow.conversations(id),
  memory_type text not null,
  content text not null,
  attributes jsonb not null default '{}'::jsonb,
  embedding_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS conversaflow_memory_items_contact_idx
  on conversaflow.memory_items (tenant_id, contact_id, updated_at desc);

CREATE TABLE IF NOT EXISTS conversaflow.tool_calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  conversation_id uuid references conversaflow.conversations(id),
  turn_id uuid references conversaflow.conversation_turns(id),
  tool_name text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  status text not null default 'started'
    check (status in ('started', 'succeeded', 'failed')),
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS conversaflow_tool_calls_turn_idx
  on conversaflow.tool_calls (turn_id, started_at);

-- ═══ kds: ADD missing tables (tickets, ticket_items, ticket_events, device_sessions already exist) ═══

CREATE TABLE IF NOT EXISTS kds.stations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  location_id uuid references platform.locations(id),
  station_key text not null,
  name text not null,
  status text not null default 'active'
    check (status in ('active', 'disabled', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, location_id, station_key)
);

CREATE TABLE IF NOT EXISTS kds.device_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  device_session_id uuid references kds.device_sessions(device_id) on delete set null,
  station_id uuid references kds.stations(id),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS kds_device_events_tenant_time_idx
  on kds.device_events (tenant_id, occurred_at desc);

CREATE TABLE IF NOT EXISTS kds.device_pairing_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id) on delete cascade,
  location_id uuid references platform.locations(id) on delete cascade,
  station_id uuid not null references kds.stations(id) on delete restrict,
  device_name text not null,
  requested_name text,
  pin_hash text not null,
  pin_salt text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'expired', 'used')),
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  expires_at timestamptz not null,
  approved_by uuid references platform.users(id) on delete set null,
  approved_at timestamptz,
  used_at timestamptz,
  denied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (attempt_count >= 0 and max_attempts > 0)
);

CREATE INDEX IF NOT EXISTS kds_device_pairing_tenant_status_idx
  on kds.device_pairing_requests (tenant_id, location_id, status, expires_at desc);

CREATE INDEX IF NOT EXISTS kds_device_pairing_pending_hash_idx
  on kds.device_pairing_requests (status, expires_at)
  where status = 'pending';

-- ═══ observability.* ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS observability.pipeline_traces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  conversation_id uuid references conversaflow.conversations(id),
  span text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  input jsonb,
  output jsonb,
  error text,
  metadata jsonb not null default '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS observability_pipeline_traces_tenant_idx
  on observability.pipeline_traces (tenant_id, started_at desc);

CREATE TABLE IF NOT EXISTS observability.evaluation_traces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references platform.tenants(id),
  conversation_id uuid references conversaflow.conversations(id),
  eval_type text not null,
  score numeric,
  passed boolean,
  input jsonb,
  output jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS observability.data_quality_findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references platform.tenants(id),
  finding_type text not null,
  severity text not null default 'info'
    check (severity in ('info', 'warning', 'error', 'critical')),
  source_schema text,
  source_table text,
  source_id uuid,
  message text not null,
  detail jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- ═══ legacy.* ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS legacy.import_batches (
  id uuid primary key default gen_random_uuid(),
  batch_key text not null unique,
  source text not null,
  table_count integer,
  row_count integer,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS legacy.tenant_mappings (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references legacy.import_batches(id),
  source_tenant_id text not null,
  source_slug text,
  target_tenant_id uuid references platform.tenants(id),
  mapping_confidence text not null default 'candidate'
    check (mapping_confidence in ('candidate', 'high', 'manual', 'rejected')),
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS legacy.user_mappings (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references legacy.import_batches(id),
  source_user_id text not null,
  source_email text,
  target_user_id uuid references platform.users(id),
  mapping_confidence text not null default 'candidate',
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS legacy.contact_mappings (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references legacy.import_batches(id),
  source_contact_id text not null,
  source_phone text,
  target_contact_id uuid references platform.contacts(id),
  mapping_confidence text not null default 'candidate',
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS legacy.location_mappings (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references legacy.import_batches(id),
  source_location_id text not null,
  source_slug text,
  target_location_id uuid references platform.locations(id),
  mapping_confidence text not null default 'candidate',
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS legacy.order_mappings (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references legacy.import_batches(id),
  source_order_id text not null,
  target_order_id uuid references commerce.orders(id),
  mapping_confidence text not null default 'candidate',
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS legacy.staff_mappings (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references legacy.import_batches(id),
  source_staff_id text not null,
  target_staff_member_id uuid references platform.staff_members(id),
  mapping_confidence text not null default 'candidate',
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS legacy.kds_ticket_mappings (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references legacy.import_batches(id),
  source_ticket_id text not null,
  target_ticket_id uuid references kds.tickets(ticket_id),
  mapping_confidence text not null default 'candidate',
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS legacy.public_compat_imports (
  id uuid primary key default gen_random_uuid(),
  source_schema text not null default 'public',
  source_table text not null,
  source_id uuid not null,
  status text not null default 'archived_only'
    check (status in ('archived_only')),
  created_at timestamptz not null default now()
);

CREATE TABLE IF NOT EXISTS legacy.replay_queue (
  id uuid primary key default gen_random_uuid(),
  source_conversation_id text not null,
  priority integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'replayed', 'skipped', 'failed')),
  created_at timestamptz not null default now()
);

-- ═══ dashboard_compat.* ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dashboard_compat.local_user_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references platform.users(id) on delete cascade,
  password_hash text not null,
  password_salt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

CREATE TABLE IF NOT EXISTS dashboard_compat.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references platform.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

COMMIT;
