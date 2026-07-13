-- ============================================================================
-- build-v3 · schema: tenant
-- The café's business. RLS-scoped per business (policies in 90_rls.sql).
-- Conventions: see 10_umi.sql header.
-- tenant->umi FKs are INLINE here (umi is built first). Only the circular
-- umi->tenant FKs are deferred (50_cross_schema_fk.sql).
-- ============================================================================

create schema if not exists tenant;

-- Shared guard: money ledgers are immutable once written.
create or replace function tenant.tg_append_only() returns trigger
  language plpgsql
  set search_path = pg_catalog as $$   -- pinned: no writable schema on the path
begin
  raise exception 'table %.% is append-only; % is not permitted',
    tg_table_schema, tg_table_name, tg_op;
end $$;

-- ----------------------------------------------------------------------------
-- ROOT
-- ----------------------------------------------------------------------------

create table tenant.business (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  legal_name        text,
  city              text,
  timezone          text not null default 'America/Mexico_City',
  currency          text not null default 'MXN',
  locale            text not null default 'es-MX',
  -- Hours are a COLUMN, not a table (owner decision). Shape:
  --   {"mon":[{"open":"08:00","close":"20:00"}], ...,
  --    "exceptions":[{"date":"2026-12-25","closed":true},
  --                  {"date":"2026-05-10","open":"10:00","close":"14:00"}]}
  open_hours        jsonb not null default '{}'::jsonb,
  -- Menu authority: managed in our dashboard, or synced from a POS integration.
  menu_source       text not null default 'dashboard'
                      check (menu_source in ('dashboard','pos_sync')),
  -- Branding (typed; add columns rather than a catch-all blob).
  logo_url          text,
  brand_color       text,
  -- Conversational agent config (owner-confirmed: typed columns on business).
  bot_voice         text,
  bot_tone          text,
  bot_instructions  text,
  status            text not null default 'active'
                      check (status in ('active','suspended')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table  tenant.business is 'The café. Root of the tenant schema (was tenant.tenant).';
comment on column tenant.business.open_hours is
  'Weekly hours + date exceptions as one jsonb column — hours are an attribute, not a table.';

-- ----------------------------------------------------------------------------
-- PLACES & PEOPLE-WHO-WORK
-- ----------------------------------------------------------------------------

create table tenant.branch (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references tenant.business(id) on delete cascade,
  name         text not null,
  address      text,
  lat          numeric(9,6),          -- captured pin (all prod locations have coords); not derived
  lng          numeric(10,6),
  timezone     text,                  -- null = inherit business.timezone
  status       text not null default 'active' check (status in ('active','closed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- Search via expression index, NOT a stored search_text column.
create index branch_name_lower on tenant.branch (lower(name));

create table tenant.station (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references tenant.branch(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

create table tenant.integration (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references tenant.business(id) on delete cascade,
  provider            text not null
                        check (provider in ('zettle','square','umi_pos','twilio',
                                            'google_wallet','apple_wallet','voyage')),
  external_account_id text,          -- Zettle account / WABA number / wallet issuer id
  status              text not null default 'connected'
                        check (status in ('connected','disconnected','error')),
  connected_by        uuid references umi.user(id),
  connected_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (business_id, provider)
);
comment on table tenant.integration is
  'Generic external connection (POS sync / message sender / wallet issuer / AI). '
  'Umi''s own POS is just provider=''umi_pos''. Sync cursor lives in runtime.integration_sync.';

create table tenant.staff (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references tenant.business(id) on delete cascade,
  branch_id    uuid references tenant.branch(id),
  user_id      uuid not null references umi.user(id),   -- credentials live on umi.user
  position     text,
  hired_at     date,
  status       text not null default 'active' check (status in ('active','inactive')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, user_id)
);
comment on table tenant.staff is
  'Café employment fact. Login/credentials on umi.user; role/authority on umi.user_role.';

-- ----------------------------------------------------------------------------
-- CUSTOMER  ·  the person  →  contact  ·  how to reach them
-- ----------------------------------------------------------------------------

create table tenant.customer (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references tenant.business(id) on delete cascade,
  name           text,
  birthday       date,                       -- was born_at (a date, not a timestamp)
  loyalty_status text not null default 'active'
                   check (loyalty_status in ('active','inactive')),
  merged_into_id uuid references tenant.customer(id),   -- soft-key dedup target
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on column tenant.customer.merged_into_id is
  'Non-null = this duplicate was merged into that customer (phone is an unverified soft key).';

create table tenant.contact (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references tenant.business(id) on delete cascade,
  customer_id       uuid not null references tenant.customer(id) on delete cascade,
  channel_id        uuid not null references umi.channel_type(id),
  raw_phone_number  text,     -- exactly what the customer gave us (phone/whatsapp/sms)
  raw_value         text,     -- non-phone channels (email, ig handle, ...)
  normalized_value  text,     -- DERIVED from raw (e.g. E.164). raw is the truth.
  is_primary        boolean not null default false,
  verified          boolean not null default false,
  verified_via      text check (verified_via in ('self_asserted','whatsapp_inbound')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table  tenant.contact is
  'Reachability per channel. NOT uniquely keyed on phone — umi-cash collects an UNVERIFIED '
  'phone (SMS verification disabled, too costly in MX), so numbers are a soft identifier.';
comment on column tenant.contact.verified is
  'true only when proven (verified_via=whatsapp_inbound). Gates who is safe to proactively message.';
create index contact_lookup_idx on tenant.contact (business_id, normalized_value);

create table tenant.customer_note (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references tenant.customer(id) on delete cascade,
  staff_id     uuid references tenant.staff(id),
  body         text not null,
  created_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- LOYALTY
-- ----------------------------------------------------------------------------

create table tenant.loyalty_program (
  business_id             uuid primary key references tenant.business(id) on delete cascade,
  card_prefix             text,
  topup_enabled           boolean not null default false,  -- does this café sell stored value (Saldo)?
  stamps_per_reward       integer,                          -- e.g. 8 visits -> 1 reward
  birthday_reward_enabled boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
comment on table tenant.loyalty_program is '1:1 loyalty config for a café (was loyalty_settings).';

create table tenant.loyalty_card (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references tenant.business(id) on delete cascade,
  customer_id  uuid not null references tenant.customer(id) on delete cascade,
  card_number  text,
  status       text not null default 'active' check (status in ('active','blocked')),
  issued_at    timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (business_id, card_number)
);
comment on table tenant.loyalty_card is
  'IDENTITY ONLY. No cached balance or visit count — both DERIVE from the ledger/visits below.';

create table tenant.loyalty_stored_value_ledger (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references tenant.business(id) on delete cascade,
  card_id          uuid not null references tenant.loyalty_card(id) on delete cascade,
  delta            bigint not null,                 -- centavos; +topup / -purchase
  reason           text not null
                     check (reason in ('migration_initial_balance','topup','purchase',
                                       'adjustment','gift_card_redeem','refund')),
  idempotency_key  text,
  staff_id         uuid references tenant.staff(id),
  external_ref     text,                            -- Zettle payment uuid (was in metadata)
  note             text,
  occurred_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (business_id, idempotency_key)
);
comment on table tenant.loyalty_stored_value_ledger is
  'MONEY (Saldo). balance = SUM(delta). Append-only. Was misnamed card_ledger.';
create trigger stored_value_ledger_append_only
  before update or delete on tenant.loyalty_stored_value_ledger
  for each row execute function tenant.tg_append_only();

create table tenant.loyalty_visit (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references tenant.business(id) on delete cascade,
  card_id      uuid not null references tenant.loyalty_card(id) on delete cascade,
  branch_id    uuid references tenant.branch(id),
  staff_id     uuid references tenant.staff(id),
  source       text not null default 'scan'
                 check (source in ('scan','manual','migration')),
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
comment on table tenant.loyalty_visit is 'One row per stamp. Stamp count = count(*), never a cached column.';

create table tenant.loyalty_reward (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references tenant.business(id) on delete cascade,
  name             text not null,
  type             text not null
                     check (type in ('stamps_free_item','spend_cashback','birthday','manual')),
  stamps_required  integer,   -- for type='stamps_free_item'
  spend_required   bigint,    -- centavos, for type='spend_cashback'
  value            bigint,    -- reward value in centavos where applicable
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table tenant.loyalty_reward is
  'The rewards a café offers (was reward_rule). "birthday" is a TYPE here, not a separate table.';

create table tenant.loyalty_redemption (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references tenant.business(id) on delete cascade,
  card_id      uuid not null references tenant.loyalty_card(id) on delete cascade,
  reward_id    uuid references tenant.loyalty_reward(id),
  reason       text not null check (reason in ('stamps','birthday','manual')),
  value        bigint,        -- centavos granted
  staff_id     uuid references tenant.staff(id),
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
comment on table tenant.loyalty_redemption is
  'A reward was consumed (the event). Birthday once-per-year is enforced by the app/a partial unique.';

create table tenant.loyalty_gift_card (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references tenant.business(id) on delete cascade,
  code         text not null,
  status       text not null default 'active' check (status in ('active','redeemed','void')),
  issued_at    timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (business_id, code)
);

create table tenant.loyalty_gift_card_ledger (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references tenant.business(id) on delete cascade,
  gift_card_id  uuid not null references tenant.loyalty_gift_card(id) on delete cascade,
  delta         bigint not null,   -- centavos
  reason        text not null check (reason in ('issue','redeem','adjustment')),
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create trigger gift_card_ledger_append_only
  before update or delete on tenant.loyalty_gift_card_ledger
  for each row execute function tenant.tg_append_only();

create table tenant.loyalty_wallet_pass (
  id                 uuid primary key default gen_random_uuid(),
  card_id            uuid not null references tenant.loyalty_card(id) on delete cascade,
  platform           text not null check (platform in ('apple','google')),
  external_object_id text,          -- Google object id / Apple serial
  status             text not null default 'active' check (status in ('active','removed')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (card_id, platform)
);

-- ----------------------------------------------------------------------------
-- COMMERCE  (generic — no "menu")
-- ----------------------------------------------------------------------------

create table tenant.product_category (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references tenant.business(id) on delete cascade,
  name          text not null,
  display_order integer not null default 0,
  created_at    timestamptz not null default now()
);

create table tenant.product (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references tenant.business(id) on delete cascade,
  category_id  uuid references tenant.product_category(id),
  name         text not null,
  description  text,
  price        bigint not null default 0,   -- centavos
  active       boolean not null default true,
  external_ref text,                          -- Zettle product id when synced
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on column tenant.product.price is
  'Centavos. Name embeddings live in runtime.product_embedding, not here.';

create table tenant.product_option_group (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references tenant.product(id) on delete cascade,
  name        text not null,
  min_select  integer not null default 0,
  max_select  integer,
  created_at  timestamptz not null default now()
);

create table tenant.product_modifier (
  id              uuid primary key default gen_random_uuid(),
  option_group_id uuid not null references tenant.product_option_group(id) on delete cascade,
  name            text not null,
  price_delta     bigint not null default 0,   -- centavos
  created_at      timestamptz not null default now()
);

create table tenant.product_branch_availability (
  product_id  uuid not null references tenant.product(id) on delete cascade,
  branch_id   uuid not null references tenant.branch(id) on delete cascade,
  available   boolean not null default true,   -- false = 86'd at this branch
  updated_at  timestamptz not null default now(),
  primary key (product_id, branch_id)
);
comment on table tenant.product_branch_availability is
  'Per-branch "86''d" state. Absent row = available (default).';

-- ----------------------------------------------------------------------------
-- MESSAGING  (channel_account dissolved: customer reach = contact, sender = integration)
-- ----------------------------------------------------------------------------

create table tenant.conversation (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references tenant.business(id) on delete cascade,
  customer_id     uuid references tenant.customer(id),
  channel_id      uuid not null references umi.channel_type(id),
  status          text not null default 'open' check (status in ('open','closed')),
  outcome         text check (outcome in ('converted','abandoned','resolved','unresolved')),
  external_ref    text,
  started_at      timestamptz not null default now(),
  last_message_at timestamptz,
  created_at      timestamptz not null default now()
);

create table tenant.message (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references tenant.conversation(id) on delete cascade,
  direction           text not null check (direction in ('inbound','outbound')),
  sender              text not null check (sender in ('customer','bot','staff','system')),
  body                text,
  provider_message_id text,   -- Twilio SID etc. (was buried in metadata)
  delivery_status     text check (delivery_status in ('queued','sent','delivered','read','failed')),
  occurred_at         timestamptz not null default now(),
  created_at          timestamptz not null default now()
);
comment on column tenant.message.body is 'Body embeddings live in runtime.message_embedding, not here.';

create table tenant.knowledge_document (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references tenant.business(id) on delete cascade,
  title        text not null,
  source       text,
  uri          text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table tenant.knowledge_chunk (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references tenant.knowledge_document(id) on delete cascade,
  ordinal      integer not null,
  body         text not null,
  created_at   timestamptz not null default now(),
  unique (document_id, ordinal)
);

-- ----------------------------------------------------------------------------
-- ORDERS
-- ----------------------------------------------------------------------------

create table tenant.customer_order (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references tenant.business(id) on delete cascade,
  branch_id        uuid references tenant.branch(id),
  customer_id      uuid references tenant.customer(id),      -- null = anonymous walk-in
  conversation_id  uuid references tenant.conversation(id),  -- set when the order came from a chat
  source           text not null check (source in ('whatsapp','pos','web','dashboard')),
  fulfillment_type text check (fulfillment_type in ('pickup','dine_in','delivery')),
  status           text not null default 'placed'
                     check (status in ('placed','preparing','ready','completed','canceled')),
  total            bigint not null default 0,   -- centavos
  external_ref     text,                          -- Zettle order id when synced
  placed_at        timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table tenant.order_item (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references tenant.customer_order(id) on delete cascade,
  product_id  uuid references tenant.product(id),
  station_id  uuid references tenant.station(id),   -- KDS routing target
  name        text not null,                          -- snapshot at order time
  quantity    integer not null default 1,
  unit_price  bigint not null default 0,   -- centavos, snapshot
  notes       text,
  created_at  timestamptz not null default now()
);
comment on column tenant.order_item.name is
  'Snapshot at order time — a line must not change if the product is later renamed.';

create table tenant.order_event (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references tenant.customer_order(id) on delete cascade,
  status      text not null
                check (status in ('placed','preparing','ready','completed','canceled')),
  staff_id    uuid references tenant.staff(id),
  occurred_at timestamptz not null default now()
);
comment on table tenant.order_event is 'Real status transitions only — not a catch-all event log.';

create table tenant.payment (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references tenant.customer_order(id) on delete cascade,
  amount       bigint not null,   -- centavos
  method       text not null check (method in ('cash','card','stored_value','gift_card')),
  external_ref text,               -- Zettle payment uuid
  status       text not null default 'captured'
                 check (status in ('pending','captured','failed')),
  paid_at      timestamptz,
  created_at   timestamptz not null default now()
);

create table tenant.refund (
  id          uuid primary key default gen_random_uuid(),
  payment_id  uuid not null references tenant.payment(id) on delete cascade,
  amount      bigint not null,   -- centavos
  reason      text,
  refunded_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- DEVICES (the physical KDS iPad; sessions/pairing are runtime machinery)
-- ----------------------------------------------------------------------------

create table tenant.device (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references tenant.business(id) on delete cascade,
  branch_id     uuid references tenant.branch(id),
  name          text not null,
  kind          text not null default 'kds' check (kind in ('kds','pos_terminal')),
  status        text not null default 'active' check (status in ('active','retired')),
  registered_at timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- AUDIT (café-facing, RLS-scoped)
-- In-place edits by staff that are NOT already append-only facts: config/settings,
-- prices, roles, order voids. (Money edits are already audited in the ledgers.)
-- Append-only (grant-revoke in 90_rls); soft entity_id so it outlives the row.
-- ----------------------------------------------------------------------------

create table tenant.audit_log (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references tenant.business(id) on delete cascade,
  actor_user_id  uuid references umi.user(id) on delete set null,
  action         text not null
                   check (action in ('create','update','delete','grant','revoke','void','adjust')),
  entity         text not null,   -- 'business','product','loyalty_program','loyalty_reward','staff'
  entity_id      uuid,            -- soft ref, no FK
  before         jsonb,
  after          jsonb,
  at             timestamptz not null default now()
);
create index tenant_audit_log_business_time_idx on tenant.audit_log (business_id, at desc);
create index tenant_audit_log_entity_idx        on tenant.audit_log (business_id, entity, at desc);
comment on table tenant.audit_log is
  'Café-facing audit ("who changed my settings/prices/roles"). RLS-scoped per business. Append-only.';

-- ----------------------------------------------------------------------------
-- DERIVED: conversation analytics (was observability.conversation_outcome — now
-- a VIEW, not a stored table; the one non-derivable bit is conversation.outcome).
-- ----------------------------------------------------------------------------

-- security_invoker: enforce the caller's RLS on the base tables. Without it the
-- view is owner-rights and leaks every café's conversations to any api session
-- (reproduced in the security audit: 0 base rows but 11 cross-tenant view rows).
create view tenant.conversation_analytics with (security_invoker = true) as
  select c.id          as conversation_id,
         c.business_id,
         c.outcome,
         count(m.id)                                                        as turn_count,
         extract(epoch from (max(m.occurred_at) - c.started_at))::int       as duration_seconds
    from tenant.conversation c
    left join tenant.message m on m.conversation_id = c.id
   group by c.id, c.business_id, c.outcome, c.started_at;
