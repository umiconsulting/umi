-- =============================================================================
-- 13_tenant_loyalty.sql  (canonical rebuild v2 — schema `tenant`, RLS domain)
--
-- The restaurant's loyalty surface, rebuilt around append-only truth: the card is
-- IDENTITY-ONLY (derived balances/visit caches removed — balance = SUM(card_ledger),
-- visits = COUNT(visit)); the two money ledgers are insert-only and carry an
-- idempotency key; birthday rewards stay a distinct expirable entitlement.
--
-- Source: current build/11_loyalty.sql. Transformed per rebuild manifest FILE 13:
--   * schema loyalty.* -> tenant.*; PK becomes composite (tenant_id, id); every
--     intra-domain FK is composite (tenant_id, <fk>) -> tenant.<parent>(tenant_id, id).
--   * loyalty.cards           -> tenant.card          (IDENTITY-ONLY: balance_cents +
--       total_visits + visits_this_cycle + pending_rewards DROPPED; account_id ->
--       customer_id -> tenant.customer, since loyalty.accounts folds into customer)
--   * loyalty.points_ledger   -> tenant.card_ledger   (RENAMED; delta bigint;
--       idempotency_key UNIQUE(tenant_id, idempotency_key); + staff_id;
--       APPEND-ONLY trigger card_ledger_append_only)
--   * loyalty.visit_events    -> tenant.visit
--   * loyalty.reward_configs  -> tenant.reward_rule    (program_id dropped — no programs)
--   * loyalty.reward_redemptions -> tenant.reward_redemption
--   * loyalty.birthday_rewards -> tenant.birthday_reward (KEPT DISTINCT; expirable)
--   * loyalty.gift_cards      -> tenant.gift_card      (balance_cents cache DROPPED —
--       remaining value = SUM(gift_card_ledger.delta), same principle as the card)
--   * loyalty.gift_card_ledger -> tenant.gift_card_ledger (delta bigint;
--       idempotency_key UNIQUE(tenant_id, idempotency_key);
--       APPEND-ONLY trigger gift_card_ledger_append_only)
--   * loyalty.passes          -> tenant.wallet_pass    (Apple/Google mirror)
--
-- DROPPED entirely (not authored): loyalty.balances, loyalty.wallet_transactions,
--   loyalty.accounts (-> folded into tenant.customer, file 11), loyalty.programs
--   (-> tenant-level loyalty settings, file 11), loyalty.automation_rules.
-- MOVED to runtime (file 16, not here): loyalty.otp_verifications -> runtime.otp,
--   loyalty.lifecycle_sends -> runtime.nudge_sent, loyalty.pass_devices ->
--   runtime.pass_device.
--
-- Append-only trigger fn is the kernel's tenant.block_append_only_mutation()
-- (00_foundation), attached to EXACTLY the two money ledgers here. Does NOT author
-- RLS/policies (90_rls does that centrally). Idempotent + re-runnable.
-- Target: PostgreSQL 18, local build, port 5233.
-- =============================================================================

begin;

set search_path = tenant, public, extensions;

-- ===========================================================================
-- tenant.card  <- loyalty.cards (IDENTITY-ONLY).
--   card_number + qr_token carried byte-identical (wallet barcode / scan token).
--   DROPPED derived caches: balance_cents (= SUM(card_ledger.delta)), total_visits,
--   visits_this_cycle, pending_rewards (visits = COUNT(tenant.visit)).
--   account_id -> customer_id (loyalty.accounts folds into tenant.customer).
-- ===========================================================================
-- tenant.loyalty_settings <- loyalty.programs (the tenant's single loyalty-program
--   config; one row per tenant). card_prefix drives card-number generation and
--   birthday_reward_enabled gates the birthday cron — live facts, not dead config.
create table if not exists tenant.loyalty_settings (
  id                      uuid not null default gen_random_uuid(),
  tenant_id               uuid not null references tenant.tenant(id) on delete cascade,
  card_prefix             text,
  topup_enabled           boolean not null default true,
  self_registration       boolean not null default true,
  birthday_reward_enabled boolean not null default false,
  birthday_reward_name    text,
  pass_style              jsonb not null default '{}'::jsonb,
  branding                jsonb not null default '{}'::jsonb,
  metadata                jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id)                                       -- one program per tenant
);

create table if not exists tenant.card (
  id           uuid not null default gen_random_uuid(),
  tenant_id    uuid not null references tenant.tenant(id) on delete cascade,
  customer_id  uuid not null,
  card_number  text not null,                    -- byte-identical wallet barcode
  qr_token     text,                             -- byte-identical scan token
  qr_issued_at timestamptz,
  status       text not null default 'active'
    check (status in ('active', 'disabled', 'archived')),
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (tenant_id, id),
  -- card_number is the wallet barcode payload: globally unique + byte-identical.
  unique (card_number),
  foreign key (tenant_id, customer_id)
    references tenant.customer (tenant_id, id) on delete cascade
);

create unique index if not exists tenant_card_qr_token_uidx
  on tenant.card (qr_token) where qr_token is not null;
create index if not exists tenant_card_status_idx
  on tenant.card (tenant_id, status);
create index if not exists tenant_card_customer_idx
  on tenant.card (tenant_id, customer_id);

-- ===========================================================================
-- tenant.card_ledger  <- loyalty.points_ledger (RENAMED, APPEND-ONLY).
--   The card value ledger. delta is signed cents (bigint). source_type/source_id
--   are SOFT refs (no FK) so a row survives deletion of whatever caused it.
--   idempotency_key makes backfill/runtime re-posts a no-op — UNIQUE per tenant.
--   staff_id records the acting staff (nullable; composite FK -> tenant.staff).
--   Balance is SUM(delta) — there is no cache to reconcile.
-- ===========================================================================
create table if not exists tenant.card_ledger (
  id               uuid not null default gen_random_uuid(),
  tenant_id        uuid not null references tenant.tenant(id) on delete cascade,
  card_id          uuid not null,
  staff_id         uuid,                          -- acting staff (nullable)
  delta            bigint not null,               -- signed cents
  reason           text not null
    check (reason in ('migration_initial_balance', 'earn', 'redeem',
                      'topup', 'purchase', 'adjustment', 'gift_card_redeem')),
  source_type      text,                          -- SOFT ref (no FK)
  source_id        text,                          -- SOFT ref (no FK)
  idempotency_key  text not null,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, card_id)
    references tenant.card (tenant_id, id) on delete cascade,
  foreign key (tenant_id, staff_id)
    references tenant.staff (tenant_id, id) on delete set null (staff_id)
);

create index if not exists tenant_card_ledger_card_idx
  on tenant.card_ledger (tenant_id, card_id, created_at desc);
create index if not exists tenant_card_ledger_reason_idx
  on tenant.card_ledger (tenant_id, reason);
create index if not exists tenant_card_ledger_source_idx
  on tenant.card_ledger (tenant_id, source_type, source_id)
  where source_type is not null;

-- ===========================================================================
-- tenant.visit  <- loyalty.visit_events.
--   One row per scan; visit count = COUNT(*) per card (no cache). staff_id
--   nullable (backfill enforces presence). Composite FKs -> card + staff.
-- ===========================================================================
create table if not exists tenant.visit (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null references tenant.tenant(id) on delete cascade,
  card_id     uuid not null,
  staff_id    uuid,
  note        text,
  metadata    jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, card_id)
    references tenant.card (tenant_id, id) on delete cascade,
  foreign key (tenant_id, staff_id)
    references tenant.staff (tenant_id, id) on delete set null (staff_id)
);

create index if not exists tenant_visit_card_idx
  on tenant.visit (tenant_id, card_id, occurred_at desc);
create index if not exists tenant_visit_staff_idx
  on tenant.visit (tenant_id, staff_id) where staff_id is not null;

-- ===========================================================================
-- tenant.reward_rule  <- loyalty.reward_configs.
--   visits_required threshold + reward metadata + cost. program_id DROPPED
--   (no loyalty.programs — loyalty settings live at tenant level, file 11).
-- ===========================================================================
create table if not exists tenant.reward_rule (
  id                  uuid not null default gen_random_uuid(),
  tenant_id           uuid not null references tenant.tenant(id) on delete cascade,
  visits_required     integer not null default 10 check (visits_required > 0),
  reward_name         text not null,
  reward_description  text,
  reward_cost_cents   integer not null default 0,
  is_active           boolean not null default true,
  activated_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  primary key (tenant_id, id)
);

create index if not exists tenant_reward_rule_active_idx
  on tenant.reward_rule (tenant_id, is_active, activated_at desc);

-- ===========================================================================
-- tenant.reward_redemption  <- loyalty.reward_redemptions.
--   card_id -> card, reward_rule_id -> reward_rule, staff_id -> staff.
-- ===========================================================================
create table if not exists tenant.reward_redemption (
  id              uuid not null default gen_random_uuid(),
  tenant_id       uuid not null references tenant.tenant(id) on delete cascade,
  card_id         uuid not null,
  reward_rule_id  uuid not null,
  staff_id        uuid,
  note            text,
  redeemed_at     timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, card_id)
    references tenant.card (tenant_id, id) on delete cascade,
  foreign key (tenant_id, reward_rule_id)
    references tenant.reward_rule (tenant_id, id) on delete cascade,
  foreign key (tenant_id, staff_id)
    references tenant.staff (tenant_id, id) on delete set null (staff_id)
);

create index if not exists tenant_reward_redemption_card_idx
  on tenant.reward_redemption (tenant_id, card_id, redeemed_at desc);
create index if not exists tenant_reward_redemption_rule_idx
  on tenant.reward_redemption (tenant_id, reward_rule_id);

-- ===========================================================================
-- tenant.birthday_reward  <- loyalty.birthday_rewards (KEPT DISTINCT).
--   An expirable entitlement (issued/expired/redeemed) — deliberately not folded
--   into the ledger (red-team §8). One per card per year.
-- ===========================================================================
create table if not exists tenant.birthday_reward (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null references tenant.tenant(id) on delete cascade,
  card_id     uuid not null,
  year        integer not null,
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz,
  redeemed_at timestamptz,
  status      text not null default 'active'
    check (status in ('active', 'redeemed', 'expired')),
  created_at  timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, card_id, year),
  foreign key (tenant_id, card_id)
    references tenant.card (tenant_id, id) on delete cascade
);

create index if not exists tenant_birthday_reward_card_idx
  on tenant.birthday_reward (tenant_id, card_id, year desc);
create index if not exists tenant_birthday_reward_active_idx
  on tenant.birthday_reward (tenant_id, status, expires_at)
  where status = 'active';

-- ===========================================================================
-- tenant.gift_card  <- loyalty.gift_cards.
--   code byte-identical (redemption token, globally unique). amount_cents is the
--   initial face value (a real fact, kept). balance_cents cache DROPPED —
--   remaining value = SUM(gift_card_ledger.delta), same principle as the card.
--   recipient_email/phone stay TYPED PII (GDPR-reachable, never opaque jsonb).
--   redeemed_at drives the derived isRedeemed. Composite FKs -> staff + card.
-- ===========================================================================
create table if not exists tenant.gift_card (
  id                          uuid not null default gen_random_uuid(),
  tenant_id                   uuid not null references tenant.tenant(id) on delete cascade,
  code                        text not null,    -- byte-identical redemption token
  amount_cents                integer not null check (amount_cents > 0),  -- initial face value
  created_by_staff_id         uuid,
  sender_name                 text,
  message                     text,
  recipient_name              text,
  recipient_email             text,             -- typed PII (GDPR-reachable)
  recipient_phone             text,             -- typed PII (GDPR-reachable)
  redeemed_at                 timestamptz,       -- isRedeemed is DERIVED from this
  redeemed_card_id            uuid,
  expires_at                  timestamptz,
  created_at                  timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (code),
  foreign key (tenant_id, created_by_staff_id)
    references tenant.staff (tenant_id, id) on delete set null (created_by_staff_id),
  foreign key (tenant_id, redeemed_card_id)
    references tenant.card (tenant_id, id) on delete set null (redeemed_card_id)
);

create index if not exists tenant_gift_card_redeemed_idx
  on tenant.gift_card (tenant_id, redeemed_at);
create index if not exists tenant_gift_card_recipient_phone_idx
  on tenant.gift_card (tenant_id, recipient_phone) where recipient_phone is not null;
create index if not exists tenant_gift_card_recipient_email_idx
  on tenant.gift_card (tenant_id, lower(recipient_email)) where recipient_email is not null;

-- ===========================================================================
-- tenant.gift_card_ledger  <- loyalty.gift_card_ledger (APPEND-ONLY).
--   Every load/spend on a gift card. delta signed cents (bigint). Remaining value
--   = SUM(delta). idempotency_key UNIQUE per tenant makes re-posts a no-op.
-- ===========================================================================
create table if not exists tenant.gift_card_ledger (
  id               uuid not null default gen_random_uuid(),
  tenant_id        uuid not null references tenant.tenant(id) on delete cascade,
  gift_card_id     uuid not null,
  delta            bigint not null,               -- signed cents
  reason           text not null
    check (reason in ('migration_initial_load', 'load', 'redeem', 'adjustment', 'expire')),
  source_type      text,                          -- SOFT ref (no FK)
  source_id        text,                          -- SOFT ref (no FK)
  idempotency_key  text not null,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, gift_card_id)
    references tenant.gift_card (tenant_id, id) on delete cascade
);

create index if not exists tenant_gift_card_ledger_card_idx
  on tenant.gift_card_ledger (tenant_id, gift_card_id, created_at desc);

-- ===========================================================================
-- tenant.wallet_pass  <- loyalty.passes.
--   Apple/Google wallet mirror (umi-cash writer). All identity tokens
--   byte-identical. One row per (card, provider). Composite FK -> tenant.card.
-- ===========================================================================
create table if not exists tenant.wallet_pass (
  id                  uuid not null default gen_random_uuid(),
  tenant_id           uuid not null references tenant.tenant(id) on delete cascade,
  card_id             uuid not null,
  provider            text not null check (provider in ('apple', 'google')),
  provider_object_id  text,                       -- google (byte-identical)
  serial_number       text,                       -- apple (byte-identical)
  auth_token          text,                       -- apple (byte-identical, secret-adjacent)
  status              text not null default 'active'
    check (status in ('active', 'disabled', 'archived')),
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, card_id, provider),
  foreign key (tenant_id, card_id)
    references tenant.card (tenant_id, id) on delete cascade
);

create unique index if not exists tenant_wallet_pass_apple_serial_uidx
  on tenant.wallet_pass (serial_number) where serial_number is not null;
create unique index if not exists tenant_wallet_pass_google_object_uidx
  on tenant.wallet_pass (provider_object_id) where provider_object_id is not null;
create index if not exists tenant_wallet_pass_provider_idx
  on tenant.wallet_pass (tenant_id, provider);
create index if not exists tenant_wallet_pass_card_idx
  on tenant.wallet_pass (tenant_id, card_id);

-- ===========================================================================
-- APPEND-ONLY TRIGGERS (gate check #4 — expects exactly 2, both here).
--   Attach the kernel's tenant.block_append_only_mutation() to the two money
--   ledgers. Trigger names MUST contain 'append_only'. Fire BEFORE UPDATE OR
--   DELETE and RAISE — the ledgers are insert-only; balances derive from SUM(delta).
-- ===========================================================================
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'card_ledger_append_only'
      and tgrelid = 'tenant.card_ledger'::regclass
  ) then
    create trigger card_ledger_append_only
      before update or delete on tenant.card_ledger
      for each row execute function tenant.block_append_only_mutation();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'gift_card_ledger_append_only'
      and tgrelid = 'tenant.gift_card_ledger'::regclass
  ) then
    create trigger gift_card_ledger_append_only
      before update or delete on tenant.gift_card_ledger
      for each row execute function tenant.block_append_only_mutation();
  end if;
end $$;

-- ===========================================================================
-- GRANTS. tenant is the RLS request-facing schema; 90_rls grants umi_app the
--   row-scoped DML. Domain files grant the service role. No password-grade
--   secrets here (pass auth_token is a continuity token readable by the request
--   role for wallet flows) — no column-level REVOKE surgery needed.
-- ===========================================================================
grant select, insert, update, delete on all tables in schema tenant to umi_worker;
alter default privileges in schema tenant
  grant select, insert, update, delete on tables to umi_worker;

commit;
