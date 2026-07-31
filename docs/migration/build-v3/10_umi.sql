-- ============================================================================
-- build-v3 · schema: umi
-- Umi's OWN SaaS merchant + identity + entitlement.
-- SEALED: no café ever writes here; Umi owns every fact in this schema.
-- ----------------------------------------------------------------------------
-- HOUSE CONVENTIONS (whole build-v3):
--   * PK            uuid, default gen_random_uuid()
--   * time          timestamptz always; created_at + updated_at where mutable
--                   (updated_at maintained by trigger tg_touch_updated_at, 00_foundation)
--   * money         bigint centavos
--   * controlled vocab   text + CHECK (native ENUM: never; see enum decision memo)
--   * lookup table  only where a value carries attributes  → umi.role, umi.channel_type
--   * names         singular, snake_case
--   * cross-schema FK (umi <-> merchant is circular) is DEFERRED to
--                   50_cross_schema_fk.sql; such columns are marked  -- xfk-> below
-- ============================================================================

create schema if not exists umi;

-- ----------------------------------------------------------------------------
-- IDENTITY
-- One login identity per human who can authenticate (café staff + Umi operators).
-- Customers NEVER authenticate (umi-cash collects an unverified phone only) — so
-- nothing here references merchant.customer.
-- ----------------------------------------------------------------------------

create table umi.user (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  password_hash  text,                                -- null while status='invited'
  password_salt  text,                                 -- scrypt needs salt+hash; storing a hash
                                                        --   without its salt makes it unverifiable
                                                        --   (schema gap the security audit caught).
  password_algorithm text,                             -- opaque scheme id the umi-api verifier
                                                        --   dispatches on: scrypt-sha256-v1 |
                                                        --   legacy-sha256-v1 | null. Free text (not
                                                        --   CHECK) so a crypto rotation never needs a
                                                        --   schema migration; the backend owns the set.
  full_name      text not null,
  status         text not null default 'invited'
                   check (status in ('invited','active','suspended')),
  last_login_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index user_email_lower_uq on umi.user (lower(email));
comment on table  umi.user is
  'Every human who can log in (café staff + Umi operators). Customers are not users.';
comment on column umi.user.status is 'invited (no password yet) | active | suspended.';

create table umi.role (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique,     -- 'superadmin','owner','manager','cashier','kitchen'
  name         text not null,
  description  text,
  is_platform  boolean not null default false,  -- true = Umi-internal (e.g. superadmin), never granted to a café
  created_at   timestamptz not null default now()
);
comment on table umi.role is
  'Role catalog. A LOOKUP TABLE (not a CHECK) because a role carries attributes: its permissions.';

create table umi.permission (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique,     -- 'loyalty.adjust_balance','order.refund','staff.manage', ...
  description  text,
  created_at   timestamptz not null default now()
);

create table umi.role_permission (
  role_id        uuid not null references umi.role(id)       on delete cascade,
  permission_id  uuid not null references umi.permission(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table umi.user_role (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references umi.user(id) on delete cascade,
  role_id      uuid not null references umi.role(id),
  merchant_id  uuid,        -- xfk-> merchant.merchant ; NULL = platform-wide grant (superadmin)
  location_id    uuid,        -- xfk-> merchant.location   ; NULL = all locations of the merchant
  granted_by   uuid references umi.user(id),
  created_at   timestamptz not null default now(),
  unique (user_id, role_id, merchant_id, location_id)
);
comment on table umi.user_role is
  'GRANT: one human holds many roles across scopes. Null merchant = platform-wide. '
  'This replaces the old polymorphic merchant.login; there is no principal_type discriminator.';

-- A result that a role grant cannot express: a temporary allow, or a deny that must
-- beat every role the human holds. A POS needs both — suspend one cashier's refund
-- right today without touching the role everyone else shares.
--
-- RESOLUTION ORDER: deny > allow > role grant. A deny row is absolute; that is the
-- whole point of the table, so nothing here may be resolved by "most specific wins".
create table umi.user_permission_override (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references umi.user(id) on delete cascade,
  permission_id  uuid not null references umi.permission(id) on delete cascade,
  merchant_id    uuid,        -- xfk-> merchant.merchant ; NULL = every merchant
  location_id      uuid,        -- xfk-> merchant.location   ; NULL = every location of the merchant
  effect         text not null check (effect in ('allow','deny')),
  expires_at     timestamptz, -- NULL = until revoked
  granted_by     uuid references umi.user(id),
  created_at     timestamptz not null default now(),
  -- A location without a merchant is not a scope, it is a bug.
  constraint permission_override_location_scope_ck
    check (location_id is null or merchant_id is not null)
);
-- One row per (human, permission, scope). The coalesce sentinels make NULL scopes
-- collide the way a plain UNIQUE would not: without them a user could hold two
-- contradictory platform-wide rows for the same permission.
create unique index user_permission_override_scope_uq
  on umi.user_permission_override
  (user_id, permission_id,
   coalesce(merchant_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(location_id,   '00000000-0000-0000-0000-000000000000'::uuid));
comment on table umi.user_permission_override is
  'Explicit permission result for one human. A deny always beats role grants and allows.';

-- How long an audit class must survive, by law and by policy. Read by the retention
-- worker; never by a request. The floor is a year — a shorter policy is a mistake, so
-- the CHECK refuses it rather than trusting review to catch it.
create table umi.audit_retention_policy (
  id                uuid primary key default gen_random_uuid(),
  event_class       text not null unique,
  minimum_days      integer not null check (minimum_days >= 365),
  archive_required  boolean not null default true,
  created_at        timestamptz not null default now()
);
comment on table umi.audit_retention_policy is
  'Minimum retention per audit class. Sealed: no merchant role may read or write it.';

-- ----------------------------------------------------------------------------
-- PLATFORM VOCABULARY
-- ----------------------------------------------------------------------------

create table umi.channel_type (
  id                 uuid primary key default gen_random_uuid(),
  key                text not null unique,   -- 'whatsapp','phone','sms','email','instagram','messenger','pos','web','manual'
  name               text not null,
  supports_outbound  boolean not null default false,  -- can Umi send TO the customer on this channel?
  created_at         timestamptz not null default now()
);
comment on table umi.channel_type is
  'The channel vocabulary. LOOKUP TABLE (carries a label + capability), Umi-owned — not the café''s.';

-- ----------------------------------------------------------------------------
-- ENTITLEMENT  (what a café is ALLOWED to do — kept separate from billing below)
-- ----------------------------------------------------------------------------

create table umi.feature (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique,   -- module flag = the bare module name ('kds','cash');
                                        --   finer features are dotted under it ('kds.multi_location',
                                        --   'cash.gift_cards','cash.max_locations')
  module       text not null
                 check (module in ('cash','dashboard','conversaflow','kds','pos')),
  name         text not null,
  description  text,
  kind         text not null
                 check (kind in ('flag','limit')),  -- flag = on/off ; limit = a number
  created_at   timestamptz not null default now()
);
comment on column umi.feature.module is
  'The product module a feature belongs to (the access "door": cash/dashboard/conversaflow/kds/pos). '
  'A bare module flag (key=module) grants the whole module; dotted keys are sub-features under it. '
  'Promote to a umi.module catalog only if the dashboard registry needs display attributes.';
comment on column umi.feature.kind is
  'flag: presence of a plan_feature row = enabled. limit: plan_feature.limit_value carries the cap.';

create table umi.plan (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique,   -- 'basic','pro','enterprise' (custom bundles too, is_public=false)
  name         text not null,
  description  text,
  is_public    boolean not null default true,   -- false = bespoke/negotiated bundle
  status       text not null default 'active'
                 check (status in ('active','retired')),
  created_at   timestamptz not null default now()
);
comment on table umi.plan is
  'Named tiers. Mint a new plan only when a bundle is REUSED across >=2 cafés; a single café''s '
  'deviation is an entitlement_override, not a bespoke plan.';

create table umi.plan_feature (
  plan_id      uuid not null references umi.plan(id)    on delete cascade,
  feature_id   uuid not null references umi.feature(id) on delete cascade,
  limit_value  bigint,   -- NULL for kind='flag' (row presence = granted) or 'unlimited' for kind='limit'
  primary key (plan_id, feature_id)
);
comment on table umi.plan_feature is 'Which features each plan grants, and at what limit.';

create table umi.subscription (
  id                    uuid primary key default gen_random_uuid(),
  merchant_id           uuid not null,     -- xfk-> merchant.merchant
  plan_id               uuid not null references umi.plan(id),
  status                text not null default 'trialing'
                          check (status in ('trialing','active','past_due','canceled')),
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  started_at            timestamptz not null default now(),
  canceled_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (merchant_id)                     -- one current subscription per café (history via change_log)
);

create table umi.entitlement_override (
  id               uuid primary key default gen_random_uuid(),
  subscription_id  uuid not null references umi.subscription(id) on delete cascade,
  feature_id       uuid not null references umi.feature(id),
  enabled          boolean not null default true,   -- can GRANT a feature the plan lacks, or REVOKE one it has
  limit_value      bigint,                          -- override the plan's cap
  reason           text,
  expires_at       timestamptz,                     -- null = permanent
  created_at       timestamptz not null default now(),
  unique (subscription_id, feature_id)
);
comment on table umi.entitlement_override is
  'Per-subscription deviation = "custom". Overlays plan_feature in the effective_entitlement view.';

-- ----------------------------------------------------------------------------
-- BILLING  (what a café is CHARGED — separate concern from entitlement above)
-- ----------------------------------------------------------------------------

create table umi.subscription_item (
  id               uuid primary key default gen_random_uuid(),
  subscription_id  uuid not null references umi.subscription(id) on delete cascade,
  label            text not null,
  quantity         integer not null default 1,
  unit_amount      bigint not null,        -- centavos
  created_at       timestamptz not null default now()
);

create table umi.invoice (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null,              -- xfk-> merchant.merchant
  amount       bigint not null,            -- centavos
  currency     text not null default 'MXN',
  status       text not null default 'draft'
                 check (status in ('draft','open','paid','void','uncollectible')),
  issued_at    timestamptz,
  due_at       timestamptz,
  paid_at      timestamptz,
  created_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- SALES PIPELINE
-- ----------------------------------------------------------------------------

-- Umi's ONE sales pipeline. A café-prospect is the same entity whether an
-- automated funnel is nurturing it (a "lead" — landing-page diagnostic + email
-- drip) or a human is working it (a "prospect" — notes/calls). So this table
-- carries both halves: the CRM spine + the funnel-automation fields the
-- landing-page sequence engine (modules/leads) drives. Sealed/service-role
-- (worker BYPASSRLS); merchant_id is NULL by design (Umi-internal, no merchant).
create table umi.prospect (
  id                 uuid primary key default gen_random_uuid(),
  business_name      text,                       -- a landing lead may not give a company
  contact_name       text,
  email              text,
  phone              text,
  status             text not null default 'new'
                       check (status in ('new','nurturing','qualified','converted','lost','unsubscribed')),
  source_app         text,                       -- surface that captured it (e.g. umi-landing-page)
  submitted_form     text,                       -- which form (e.g. diagnostic)
  diagnostic_data    jsonb,                      -- landing-page diagnostic score/level/recommendations
  diagnostic_date    timestamptz,
  sequence_paused    boolean not null default false,
  pause_reason       text,
  emails_sent        text[] not null default '{}',   -- drip dedup gate (array_append/array_remove)
  last_email_sent_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
-- One live lead per email while it is still in an active stage; once it leaves
-- (converted/lost/unsubscribed) the email is free to re-enter. Backs the
-- engine's insert-or-update-by-active-email (TOCTOU 23505 catch).
create unique index umi_prospect_email_active_uidx
  on umi.prospect (email) where status in ('new','nurturing','qualified');

-- Unified prospect timeline: automation events (diagnostic_completed, email_sent,
-- email_failed, sequence_paused/resumed, responded, unsubscribed) and manual
-- touches (note/call/meeting) share one log. `event_type` is open text on purpose
-- — the funnel's event set is actively evolving, so a CHECK here is a migration tax.
create table umi.prospect_event (
  id           uuid primary key default gen_random_uuid(),
  prospect_id  uuid not null references umi.prospect(id) on delete cascade,
  event_type   text not null,
  event_data   jsonb,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- AUDIT (Umi-internal, sealed)
-- Platform-privileged actions: superadmin ops, plan/feature/entitlement changes,
-- creating/suspending a merchant, cross-merchant work. NEVER café-facing.
-- Soft refs (no FK) so the trail outlives what it describes; actor is the one FK.
-- Append-only (enforced by grant-revoke in 90_rls, not a trigger).
-- ----------------------------------------------------------------------------

create table umi.audit_log (
  id             uuid primary key default gen_random_uuid(),
  actor_user_id  uuid references umi.user(id) on delete set null,
  action         text not null
                   check (action in ('create','update','delete','grant','revoke','suspend','restore')),
  entity         text not null,   -- soft descriptor: 'plan','entitlement_override','merchant','user_role'
  entity_id      uuid,            -- soft ref, no FK
  merchant_id    uuid,            -- soft: which merchant it affected (nullable)
  before         jsonb,
  after          jsonb,
  at             timestamptz not null default now()
);
create index umi_audit_log_entity_idx on umi.audit_log (entity, at desc);
create index umi_audit_log_actor_idx  on umi.audit_log (actor_user_id, at desc);
comment on table umi.audit_log is
  'Umi-internal audit of platform-privileged actions. Sealed/service-role. Append-only.';

-- ----------------------------------------------------------------------------
-- DERIVED: a café's EFFECTIVE entitlement = plan_feature overlaid by override.
-- A VIEW, never a stored table (derive, don't cache).
-- ----------------------------------------------------------------------------

-- security_invoker: the view runs with the CALLER's rights so RLS on the base
-- tables (umi.subscription) is enforced per merchant — without this the view runs
-- as owner and returns every merchant's entitlements to any api session.
create view umi.effective_entitlement with (security_invoker = true) as
  -- features the plan grants (an override may modify or revoke them)
  select s.merchant_id,
         f.key                                   as feature_key,
         coalesce(o.enabled, true)               as enabled,
         coalesce(o.limit_value, pf.limit_value) as limit_value
    from umi.subscription   s
    join umi.plan_feature   pf on pf.plan_id = s.plan_id
    join umi.feature        f  on f.id = pf.feature_id
    left join umi.entitlement_override o
           on o.subscription_id = s.id
          and o.feature_id = pf.feature_id
          and (o.expires_at is null or o.expires_at > now())
   where s.status in ('trialing','active')
  union all
  -- features an override GRANTS that the plan does not include
  select s.merchant_id,
         f.key,
         o.enabled,
         o.limit_value
    from umi.subscription s
    join umi.entitlement_override o
      on o.subscription_id = s.id
     and (o.expires_at is null or o.expires_at > now())
    join umi.feature f on f.id = o.feature_id
    left join umi.plan_feature pf
      on pf.plan_id = s.plan_id and pf.feature_id = o.feature_id
   where s.status in ('trialing','active')
     and pf.plan_id is null;
comment on view umi.effective_entitlement is
  'Resolved access per café. Query this, never plan_feature directly. Override wins over plan.';

-- ----------------------------------------------------------------------------
-- STARTER SEED (fixed catalogs; plans/features are config and may evolve)
-- ----------------------------------------------------------------------------

insert into umi.channel_type (key, name, supports_outbound) values
  ('whatsapp','WhatsApp',      true),
  ('phone',   'Phone',         false),
  ('sms',     'SMS',           true),
  ('email',   'Email',         true),
  ('instagram','Instagram',    true),
  ('messenger','Messenger',    true),
  ('pos',     'Point of Sale', false),
  ('web',     'Web',           false),
  ('manual',  'Manual entry',  false)
on conflict (key) do nothing;

-- Retention floors. Financial history outlives everything else because a tax
-- authority can ask for it ten years later; security and merchant events follow the
-- seven-year commercial default.
insert into umi.audit_retention_policy (event_class, minimum_days) values
  ('security',  2555),
  ('merchant',  2555),
  ('financial', 3650)
on conflict (event_class) do nothing;

-- ---- POS permission vocabulary ----------------------------------------------
-- The permission keys the POS guard chain checks. They are seeded here rather than
-- created by application code so that a fresh database can authorize a POS before any
-- request has ever run.
insert into umi.permission (key, description) values
  ('device.enroll',            'Enrol a POS or KDS device for a location'),
  ('catalog.read',             'Read the operator-safe location catalog'),
  ('cart.write',               'Prepare a location-scoped POS cart'),
  ('checkout.commit',          'Commit a location-scoped POS sale'),
  ('offline.replay',           'Replay and reconcile device-authenticated offline commands'),
  ('offline.cash.checkout',    'Create a policy-authorized provisional cash sale'),
  ('offline.recovery.review',  'Approve one scoped offline recovery action'),
  ('audit.read',               'Read merchant-visible, redacted audit events')
on conflict (key) do update set description = excluded.description;

-- ⚠️ NO role->permission grants here. This file runs BEFORE any role exists — the role
-- catalogue is seeded by backfill_identity / seed_rbac — so a grant written here joins
-- against an empty umi.role and silently inserts nothing. The POS grants live in
-- backfill/seed_rbac.sql, which runs after the roles do.

-- The POS offline-cash flag. Off until a merchant is explicitly certified for it;
-- `merchant.pos_offline_cash_policy` then carries the limits.
insert into umi.feature (key, module, name, description, kind) values
  ('pos.offline_cash', 'pos', 'POS offline cash',
   'Policy-controlled provisional cash checkout', 'flag')
on conflict (key) do nothing;
