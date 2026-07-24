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
  brand_color       text,   -- primary brand color (dashboard theming + wallet pass)
  secondary_color   text,   -- accent color (dashboard theming)
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

-- A KDS station: the board a device pairs to. CONFIG — the owner creates and renames
-- these at business cadence, never by migration (ORDER_MODEL.md §5). The order itself
-- carries no station; the KDS scopes by the device's paired station at query time.
--
-- This table was built with only (branch_id, name) and the backfill dropped the rest as
-- "no target col". That was wrong on all four counts — every dropped column has a live
-- consumer in kds.repository.ts, and the shape was wrong besides:
--   business_id -> the repository scopes EVERY station query by tenant, and without the
--     column the only isolation was a join through branch, which cannot express a
--     station that belongs to no branch (below).
--   branch_id is NULLABLE -> NULL means "every branch". listStations/loadStation treat a
--     missing location as unscoped, and findActiveStationByKey matches the branch with
--     `IS NOT DISTINCT FROM` precisely to reach these. NOT NULL made them unrepresentable.
--   key -> the stable config handle the dashboard creates and looks stations up by
--     (findActiveStationByKey). Named `key`, not `station_key`: no stutter inside its own
--     table, matching umi.channel_type.key.
--   status -> archiveStation is a soft delete, and it must be: a device pairing and an
--     order both reference a station, so a hard delete would erase history. 'disabled' is
--     distinct from 'archived' — the repository lets a rename touch a disabled station
--     but not an archived one.
--   sort_order -> the board order the owner sets; listStations orders by it.
-- `metadata` is deliberately NOT carried (the one source row's is empty, and a jsonb junk
-- drawer is exactly what the naming rules forbid).
create table tenant.station (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete cascade,
  branch_id   uuid references tenant.branch(id) on delete cascade,  -- NULL = every branch
  key         text not null,
  name        text not null,
  status      text not null default 'active'
                check (status in ('active','disabled','archived')),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- One live station per key per branch scope. NULLS NOT DISTINCT (pg15+) is what makes
-- the tenant-wide scope work: with default NULL semantics two branch-less stations could
-- both claim key 'cafe', and findActiveStationByKey would return an arbitrary one.
-- Archived rows are excluded so a key can be reused after the station is retired.
create unique index station_business_branch_key_uidx
  on tenant.station (business_id, branch_id, key) nulls not distinct
  where status <> 'archived';

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
  unique (business_id, provider),
  -- Cross-tenant guard: two businesses may NEVER claim the same external account.
  -- For provider='twilio' that account IS the inbound WhatsApp sender number, so a
  -- collision would route one café's customer messages to another café. NULLs stay
  -- distinct in Postgres, so a business with no number yet is unaffected.
  unique (provider, external_account_id)
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

-- Resolve a customer to the SURVIVOR at the end of its merge chain. Reads must never
-- stop at one hop: if A was merged into B and B later into C, a single hop lands on B,
-- a row that is itself dead — the caller then stamps a card that nobody looks at.
-- Nothing writes merged_into_id yet (there is no merge flow), so the read side has to
-- be the robust one. Depth-capped: a cycle (A->B->A) can only ever be created by a bug,
-- and this must degrade to a wrong-but-terminating answer, never an infinite walk.
create or replace function tenant.customer_survivor(p_customer_id uuid) returns uuid
  language sql stable
  set search_path = pg_catalog as $$
  with recursive walk(id, merged_into_id, depth) as (
    select c.id, c.merged_into_id, 0
      from tenant.customer c where c.id = p_customer_id
    union all
    select c.id, c.merged_into_id, w.depth + 1
      from walk w
      join tenant.customer c on c.id = w.merged_into_id
     where w.merged_into_id is not null and w.depth < 16
  )
  select id from walk order by depth desc limit 1;
$$;

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
  updated_at        timestamptz not null default now(),
  -- verified means PROVEN, and inbound WhatsApp is the only proof we have. Without
  -- this, (verified=true, verified_via='self_asserted') is representable and directly
  -- contradicts the column comment below — and `verified` gates who we may proactively
  -- message, so a self-asserted number could be messaged as if it were consented.
  constraint contact_verified_needs_proof
    check (not verified or verified_via = 'whatsapp_inbound')
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
-- The catalog sync gets-or-creates a category BY NAME on every run. build-v2 keyed
-- that on a slug column (`key`) which build-v3 correctly does not have — the name is
-- the identity. Without this, the upsert has no conflict target and a re-sync forks
-- a second "Bebidas". 0 duplicate (business_id, name) pairs in the source.
create unique index product_category_business_name_uidx
  on tenant.product_category (business_id, name);

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
-- The Zettle sync identifies a product by its external id. build-v2 kept that in
-- `metadata->>'zettle_uuid'` with no constraint, so the sync had to SELECT-then-write
-- and two concurrent runs could both miss and both INSERT. external_ref is the typed
-- home; this makes the upsert atomic. Partial: hand-created products have no ref.
-- 136/136 source products carry one, with 0 duplicates.
create unique index product_external_ref_uidx
  on tenant.product (business_id, external_ref)
  where external_ref is not null;
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
  -- The aggregate's change marker. Bumped by tg_customer_order_version on EVERY update
  -- of this row, and the order_item trigger touches the parent so a LINE change bumps it
  -- too. Two uses: (1) optimistic concurrency — `UPDATE ... WHERE id=$1 AND version=$2`
  -- replaces holding a FOR UPDATE lock across a whole transaction; (2) a cheap "has this
  -- order changed" check for any consumer that does not want to read the event feed.
  -- Square's Order.version is the same idea. It is the ORDER's truth; order_event is the
  -- ordered FEED of changes — they answer different questions and neither replaces the
  -- other (a version alone cannot tell a puller what it missed, in what order).
  version          bigint not null default 1,
  cancel_reason    text,                          -- codes/notes for a void; contaminated free-text history NOT carried
  notes            text,                          -- order-level note the customer gave at checkout
  pickup_person    text,                          -- who collects the order, when not the buyer
  external_ref     text,                          -- Zettle order id when synced; also the bot's idempotency key
  placed_at        timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
  -- NOTE: no stored `total`. The order's working/owed total is DERIVED (Σ live
  -- lines) via tenant.order_total below — it cannot drift and self-heals on a
  -- void. Money-truth for a settled order lives on tenant.payment, not here.
);
comment on column tenant.customer_order.notes is
  'Order-level note captured at checkout. This is the NAMED column ORDER_MODEL.md §5 sanctions '
  '("add a named customer_order.notes when a real consumer earns it") — NOT a revived free-text '
  'blob. Both ends exist today: the WhatsApp checkout writes it, and the FROZEN iPad KDS ticket '
  'renders it to the barista as `customer_note`. Per-line customization belongs on '
  'order_item.notes; a lasting customer preference belongs on tenant.customer_note.';
comment on column tenant.customer_order.pickup_person is
  'Who collects the order, when that is not the buyer. Also a frozen KDS ticket field. Never '
  'populated in the source (0/51) but written by the WhatsApp checkout, so it gets a real column '
  'rather than a hard-coded null in the contract.';
-- NOTE: personal_message (the gift message that accompanies pickup_person) is
-- DEFERRED, not forgotten — see ORDER_MODEL.md §5 Deferred. It never had a column
-- (it lived in the details blob), it is written on 0 of 51 source orders, and the
-- only thing that ever displayed it was a Slack controller that no longer exists.
-- The KDS will earn it back. Re-add as a plain nullable text column then; there is
-- no history to retrofit precisely because there is none.

-- Idempotency for order INJECTION (ORDER_MODEL.md §6 planned this as "when the
-- injection path is built" — it already is: the WhatsApp checkout is one).
-- conversations/orders.repository.ts retries a turn with the SAME external_ref and
-- relies on ON CONFLICT to return the existing order; without this index the
-- conflict target does not exist and a retried turn creates a DUPLICATE order.
-- Partial, so the many orders with no external ref are unconstrained.
create unique index customer_order_external_ref_uidx
  on tenant.customer_order (business_id, external_ref)
  where external_ref is not null;

create table tenant.order_item (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references tenant.customer_order(id) on delete cascade,
  product_id    uuid references tenant.product(id),
  name          text not null,              -- snapshot at order time
  variant_name  text,                       -- the CHOSEN variant, snapshot ("Grande", "Oat milk")
  quantity      integer not null default 1 check (quantity > 0),
  unit_price    bigint not null default 0 check (unit_price >= 0),  -- centavos, snapshot (final, incl. chosen modifiers)
  display_order integer not null default 0, -- the line's position on the ticket
  voided_at     timestamptz,                -- void tombstone; a live line = voided_at IS NULL
  void_reason   text,                       -- why: mistake · duplicate · customer_changed · comp (service recovery) · test
  notes         text,
  created_at    timestamptz not null default now(),
  -- a reason is meaningless without a void (the reverse is allowed: a historical/
  -- unattributed void may have no reason — the backfill carries exactly that).
  constraint order_item_reason_needs_void check (void_reason is null or voided_at is not null)
);
create index tenant_order_item_order_idx on tenant.order_item (order_id);
comment on column tenant.order_item.name is
  'Snapshot at order time — a line must not change if the product is later renamed.';
-- variant_name + display_order are NAMED columns for the same reason customer_order
-- gained notes/pickup_person (2026-07-21): a live reader had already earned them.
-- ORDER_MODEL.md §5 folded variant_name into notes and dropped display_order as
-- "cosmetic". Both were wrong, and neither is visible to sql-preflight — a folded
-- column still resolves.
--   variant_name: TWO readers. The frozen iPad decodes it as its own field
--     (KDSAPIModels.swift `variantName`), and checkout re-prices a REORDER by
--     matching it against the live catalog (`product.variants[].name`). Folded into
--     notes as `variant · note` it is unrecoverable — there is no marker saying which
--     half is which, and a variant name may itself contain the separator. Measured on
--     the source: 63 of 73 lines carry one, so a fold breaks most reorders.
--   display_order: NOT derivable, measured — `row_number() over (order by created_at, id)`
--     disagrees with the source on 63 of 73 lines, because every line of an order shares
--     one insert timestamp and the tie then breaks on random uuid. Deriving it renders
--     the ticket SCRAMBLED. It is also the harder failure: the frozen Swift model decodes
--     it as a NON-OPTIONAL Int, so a missing value fails the whole payload and the KDS
--     goes BLANK rather than mis-ordered.
comment on column tenant.order_item.variant_name is
  'The chosen variant, snapshot at order time. Read by the frozen iPad ticket and by the '
  'reorder re-pricer, which matches it against the live catalog — so it is its own column, '
  'never folded into notes.';
comment on column tenant.order_item.display_order is
  'Line position on the ticket, 0-based. Carried, not derived: source insert timestamps tie '
  'within an order, so any derived ordinal falls back to random uuid order.';
comment on column tenant.order_item.voided_at is
  'A line is a void (Toast/Square term), not an order cancel. Amendments never edit a line: '
  'void the old (set this), add a new line. NULL = live. Voided lines survive as waste/history '
  'and fall out of the derived order total. A void of an ALREADY-FIRED line (see order_event) '
  'carried a cost — that is the comp case (product made, not charged); void_reason records it.';
-- NOTE: per-line station routing (order_item.station_id) is DEFERRED — a build-v3
-- invention read by nothing (the KDS ticket derives its station from the device
-- login), null on 100% of source lines. Re-add as a plain nullable FK when a
-- second station + real routing exist. See ORDER_MODEL.md §5.

-- A priced line is an immutable snapshot; the ONLY change allowed is voiding it ONCE
-- (voided_at NULL -> set, with a reason). Amendments are void-then-add, never an
-- in-place edit, and a line is never DELETED — voiding preserves the waste/history the
-- owner must see (same append-only stance tenant.tg_append_only enforces on the money
-- ledgers, which likewise block delete despite an on-delete-cascade parent).
create or replace function tenant.tg_order_item_void_only() returns trigger
  language plpgsql
  set search_path = pg_catalog as $$   -- pinned: no writable schema on the path
begin
  if tg_op = 'DELETE' then
    raise exception 'order_item % cannot be deleted; a line is voided (voided_at), never removed', old.id;
  end if;
  if old.voided_at is not null then
    raise exception 'order_item % is voided and frozen; amend by adding a new line, not editing', old.id;
  end if;
  if new.id            is distinct from old.id
  or new.order_id      is distinct from old.order_id
  or new.product_id    is distinct from old.product_id
  or new.name          is distinct from old.name
  or new.variant_name  is distinct from old.variant_name
  or new.quantity      is distinct from old.quantity
  or new.unit_price    is distinct from old.unit_price
  or new.display_order is distinct from old.display_order
  or new.created_at    is distinct from old.created_at then
    raise exception 'order_item % is an immutable snapshot; change an order by voiding the line and adding a new one', old.id;
  end if;
  return new;   -- permitted: set voided_at / void_reason (the void), or edit notes
end $$;
create trigger order_item_void_only
  before update or delete on tenant.order_item
  for each row execute function tenant.tg_order_item_void_only();

-- ONE place increments the version: any update of the order row, whatever caused it.
-- The order_item trigger below therefore does not increment directly — it touches the
-- parent and lets this fire, so a line change cannot double-bump.
create or replace function tenant.tg_customer_order_version() returns trigger
  language plpgsql
  set search_path = pg_catalog as $$
begin
  new.version := old.version + 1;
  return new;
end $$;
create trigger customer_order_version
  before update on tenant.customer_order
  for each row execute function tenant.tg_customer_order_version();

-- A LINE change is a change to the ticket, and the kitchen has to learn about it. This
-- is a trigger rather than app code on purpose: the order has FOUR writers today or soon
-- (WhatsApp bot, POS, dashboard, KDS) and a signal every one of them must remember to
-- emit is a signal one of them will forget. ORDER_MODEL §1 says the status and its event
-- "must be written together, never one without the other" — this makes that structural
-- for the line half.
--
-- The INSERT guard: during order CREATION the lines are written before the opening
-- `placed` event, so an order with no events yet is still being assembled and its lines
-- are not amendments. Once the ticket exists for the kitchen, an added line IS one. That
-- test is intrinsic ("is this order visible to a consumer yet"), not a dependency on
-- which statement the application happens to run first.
create or replace function tenant.tg_order_item_signal_change() returns trigger
  language plpgsql
  set search_path = pg_catalog as $$
declare
  has_events boolean;
begin
  select exists (select 1 from tenant.order_event e where e.order_id = new.order_id)
    into has_events;
  if not has_events then
    return null;                      -- initial assembly, not an amendment
  end if;
  -- Touch the parent: bumps version via customer_order_version, and updated_at via the
  -- shared touch trigger. Not an increment here — see above.
  update tenant.customer_order set updated_at = now() where id = new.order_id;
  insert into tenant.order_event (order_id, kind) values (new.order_id, 'order_upserted');
  return null;                        -- AFTER trigger; return value is ignored
end $$;
create trigger order_item_signal_change
  after insert or update on tenant.order_item
  for each row execute function tenant.tg_order_item_signal_change();

create table tenant.order_event (
  id          uuid primary key default gen_random_uuid(),
  sequence    bigint generated always as identity,
  order_id    uuid not null references tenant.customer_order(id) on delete cascade,
  -- What KIND of change this row records. Two, and deliberately only two:
  --   status_changed — the order advanced along its lifecycle. Carries `status`.
  --   order_upserted — the order's LINES changed (a void, or an added line on an
  --     amendment). Carries no status, because none happened.
  -- The second one exists because a puller cannot see a line void otherwise: voiding one
  -- line of five does not change the order's status, so a status-only feed never advances
  -- and the barista keeps making a cancelled drink. Toast and Square both push line
  -- changes to the kitchen in real time for exactly this reason.
  kind        text not null default 'status_changed'
                check (kind in ('status_changed','order_upserted')),
  status      text
                check (status in ('placed','preparing','ready','completed','canceled')),
  staff_id    uuid references tenant.staff(id),
  occurred_at timestamptz not null default now(),
  -- A transition without a status is meaningless; an upsert with one is a lie. Making
  -- the pairing a constraint means a consumer can trust `kind` without re-checking.
  constraint order_event_status_matches_kind
    check ((kind = 'status_changed') = (status is not null))
);
comment on table tenant.order_event is
  'The ordered change FEED for pullers: status transitions plus line-level upserts. Still '
  'not a catch-all log — two kinds, both real changes to what a consumer sees. The four '
  'kinds the source table carried were three parts sync-ingestion noise (order_upserted / '
  'status_change / snapshot_reconciled all duplicated the real transitions), which is what '
  'the "transitions only" rule was written against; this widening is the opposite — a '
  'change that WAS invisible becoming visible.';
-- The status spine has TWO consumer shapes, and this column serves the second one.
-- PUSH (ORDER_MODEL.md §1): a new row fires a "listo" notification — needs no cursor.
-- PULL: the FROZEN iPad KDS polls incrementally — `after_sequence` in the request,
-- `WHERE sequence > $n ORDER BY sequence` in the query, `last_event_sequence` on
-- every ticket. That needs a TOTAL ORDER, and occurred_at cannot supply one: in the
-- source events, 63 occurred_at values are TIED, so a `> timestamp` cursor silently
-- skips or replays events at every tie — the KDS would drop ticket transitions with
-- nothing raising an error. Monotonic bigint, assigned by the database, never reused.
create index tenant_order_event_sequence_idx on tenant.order_event (sequence);
comment on column tenant.order_event.sequence is
  'Monotonic cursor for incremental polling (frozen KDS `after_sequence`). Ordering only — '
  'gaps are expected and meaningless; never treat it as a count.';

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
-- DERIVED: order projections (see ORDER_MODEL.md §1, §4)
-- The order carries no stored total and the "ticket" is not a KDS-private query:
-- both are VIEWS so there is one definition and it cannot drift. security_invoker
-- so the caller's RLS is enforced on the base tables (an owner-rights view would
-- leak every café's orders to any api session — the audit's cross-tenant leak).
-- ----------------------------------------------------------------------------

-- Working / owed total: Σ live lines (voided_at IS NULL), per order, ANY status.
-- CONTRACT: this is the *value of an order's live lines*, and its meaning depends on
-- the status you read it with — for an OPEN order it is what is OWED (self-heals as
-- lines are voided); for a completed order it is what was transacted; for a canceled
-- order it is notional value that did NOT convert (no cash moved). It is deliberately
-- NOT zeroed for canceled orders (the source keeps that value; the backfill reconciles
-- against it). It is NOT revenue — never sum it across statuses; revenue aggregates
-- tenant.payment. Consumers wanting "owed right now" filter to open orders (as
-- order_ticket does).
create view tenant.order_total with (security_invoker = true) as
  select o.id          as order_id,
         o.business_id,
         coalesce(sum(i.unit_price * i.quantity)
                    filter (where i.voided_at is null), 0)::bigint as total
    from tenant.customer_order o
    left join tenant.order_item i on i.order_id = o.id
   group by o.id, o.business_id;

-- The ticket: the LIVE projection every in-flight consumer shares (KDS, customer
-- status "listo", pickup board, dashboard orders-in-flight). One line per row for
-- each in-flight order, carrying the order's current status; group by order_id to
-- render one ticket. Voided lines are INCLUDED (voided_at set) so the KDS renders
-- them as VOID — a fired-then-voided line must be seen, not vanish, so the barista
-- stops pouring (ORDER_MODEL §3). Money consumers filter live lines via
-- tenant.order_total, not here. Station is NOT here — the KDS scopes by the
-- device's paired station at query time.
create view tenant.order_ticket with (security_invoker = true) as
  select o.id           as order_id,
         o.business_id,
         o.branch_id,
         o.customer_id,
         o.source,
         o.fulfillment_type,
         o.status       as order_status,
         o.placed_at,
         i.id           as item_id,
         i.name         as item_name,
         i.variant_name,
         i.quantity,
         i.unit_price,
         i.display_order,
         i.voided_at,
         i.void_reason,
         i.notes
    from tenant.customer_order o
    join tenant.order_item i on i.order_id = o.id
   where o.status in ('placed','preparing','ready');

-- The KDS ticket: ORDER-grain, with its lines nested, shaped for the FROZEN iPad
-- contract (apps/umi-kds KDSSnapshotRow / KDSSnapshotItem). It is separate from
-- order_ticket on purpose — order_ticket is the line-grain LIVE projection every
-- in-flight consumer shares, while this one is the adapter for a single client we
-- cannot change, and it must serve HISTORY too (the dashboard order list filters by
-- status over a window), so it carries no status filter.
--
-- Vocabulary is NOT translated here. The view speaks build-v3
-- (placed·preparing·ready·completed·canceled); the service maps to the iPad's
-- (new·accepted·preparing·ready·completed·cancelled·partial_cancelled) at the
-- boundary, in one typed bidirectional place — see kds-contract.ts. Doing it in SQL
-- would put a client's words in the schema and leave the WHERE clauses speaking a
-- different language than the SELECT.
--
-- Two shapes exist only to satisfy non-optional fields in the Swift model, where a
-- null fails the decode of the WHOLE payload rather than one ticket:
--   source_transaction_id -> coalesced to the order id. external_ref is nullable
--     (a pos/web/dashboard order has none; 51/51 whatsapp orders do), but Swift
--     declares it non-optional.
--   items[].display_order -> not null in order_item, for the same reason.
-- Station is NULL by construction: the order carries no station (ORDER_MODEL §5) and
-- the KDS scopes by the device's paired station at query time. The board's
-- `station_id IS NULL OR station_id = $n` predicate therefore broadcasts, which is
-- what the source data did anyway (0 of 51 orders had a station).
create view tenant.kds_ticket with (security_invoker = true) as
  select o.id                                    as ticket_id,
         o.business_id,
         o.branch_id,
         coalesce(o.external_ref, o.id::text)    as source_transaction_id,
         o.source                                as source_channel,
         o.status,
         null::uuid                              as station_id,
         null::text                              as station_name,
         o.customer_id,
         o.pickup_person,
         o.notes                                 as customer_note,
         o.cancel_reason                         as cancellation_reason,
         o.placed_at,
         o.created_at,
         o.updated_at,
         coalesce(tot.total, 0)                  as total_cents,
         coalesce(ev.last_seq, 0)                as last_event_sequence,
         coalesce(
           (select jsonb_agg(jsonb_build_object(
                     'ticket_item_id',   i.id,
                     'name',             i.name,
                     'variant_name',     i.variant_name,
                     'quantity',         i.quantity,
                     'notes',            i.notes,
                     -- a voided line is the iPad's `is_cancelled`; it stays ON the
                     -- ticket so the barista sees it struck through and stops pouring
                     'is_cancelled',     (i.voided_at is not null),
                     'unit_price_cents', i.unit_price,
                     'display_order',    i.display_order)
                   order by i.display_order, i.created_at)
              from tenant.order_item i
             where i.order_id = o.id),
           '[]'::jsonb)                          as items
    from tenant.customer_order o
    left join tenant.order_total tot on tot.order_id = o.id
    left join lateral (
      select max(e.sequence) as last_seq
        from tenant.order_event e
       where e.order_id = o.id
    ) ev on true;

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
