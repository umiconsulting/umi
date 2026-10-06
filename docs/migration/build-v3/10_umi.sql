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
-- One identity per human who can authenticate (café staff + Umi operators), whichever
-- way they do it: a password at the dashboard, or a PIN at the till. Both are the same
-- person and both must resolve to a row HERE, because every actor column in build-v3
-- points at this table — audit_log.actor_user_id, operator_session.user_id,
-- elevation_grant.approved_by. An operator who is not here cannot be named by any of
-- them. Email and password are therefore NULLABLE: they describe ONE way in, not what
-- makes somebody a user.
-- Customers NEVER authenticate (umi-cash collects an unverified phone only) — so
-- nothing here references merchant.customer.
-- ----------------------------------------------------------------------------

create table umi.user (
  id             uuid primary key default gen_random_uuid(),
  -- NULLABLE, and that is the POS operator. A barista signs in to the till with a PIN,
  -- has no mailbox we know of, and must never be given a synthetic address to satisfy a
  -- NOT NULL. They are still a user: they authenticate, they hold a role, and every
  -- audit_log.actor_user_id and runtime.operator_session.user_id in this schema
  -- requires them to exist here. Email is how a human LOGS IN, not what makes them one.
  -- NULLs stay distinct under user_email_lower_uq, so many PIN-only users coexist.
  email          text,
  password_hash  text,                                -- null while status='invited',
                                                        --   and null forever for PIN-only
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
  updated_at     timestamptz not null default now(),
  -- ---- Second factor ---------------------------------------------------------
  -- A platform grant holder reaches every café, so a password alone is one stolen
  -- credential away from all of them. PCI DSS 8.4.1 requires MFA for administrative
  -- access once the CDE exists; ASVS 4.3.1 asks for it on admin interfaces regardless.
  --
  -- `mfa_method` is a column and not a boolean because the first method Umi ships is
  -- NOT the one that ends up satisfying PCI. Read this before choosing 'email_otp':
  --   email_otp  A code mailed to umi.user.email. NIST SP 800-63B §5.1.3.1 says
  --              "Methods that do not prove possession of a specific device, such as
  --              voice-over-IP (VOIP) or email, SHALL NOT be used for out-of-band
  --              authentication." Email proves possession of nothing — whoever holds
  --              the password often reaches the inbox too. It is a second STEP, not a
  --              second FACTOR, and it will not pass a PCI assessment as MFA.
  --   totp       Shared secret, RFC 6238. A real "something you have". Not
  --              phishing-resistant (the code is manually re-keyed), but it satisfies
  --              the two-factor test. This is the one that closes 8.4.1.
  -- Free text under a CHECK, not an enum, so adding 'webauthn' is a seed change.
  mfa_method       text check (mfa_method in ('email_otp','totp')),
  mfa_enrolled_at  timestamptz,
  -- The whole rule, in one line: a password is worthless without the address it is
  -- typed beside. A user may have neither (PIN-only) or both (dashboard). Never a
  -- password alone — that row could never be authenticated by anything.
  constraint user_login_ck check (password_hash is null or email is not null),
  -- A method and its enrolment date arrive together, or neither does. Same pairing
  -- shape as user_role's revocation CHECK: the IS NULL equality form binds on every
  -- row, where `x is not null and y is not null` would evaluate to NULL and pass.
  constraint user_mfa_ck check ((mfa_method is null) = (mfa_enrolled_at is null)),
  -- email_otp needs a mailbox to send to. Enforceable here; totp does not need one.
  constraint user_mfa_email_ck
    check (mfa_method is distinct from 'email_otp' or email is not null)
);
create unique index user_email_lower_uq on umi.user (lower(email));
comment on table  umi.user is
  'Every human who AUTHENTICATES: café staff (PIN and/or password) + Umi operators. '
  'Customers are not users. Email+password is one way in, not the definition.';
comment on column umi.user.status is
  'invited (no password yet) | active | suspended. A PIN-only operator is active with '
  'no email and no password; the till PIN is on merchant.staff.';

create table umi.role (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique,     -- 'super_admin','developer' (platform) · 'owner','admin','staff','viewer' (café)
  name         text not null,
  description  text,
  is_platform  boolean not null default false,  -- true = Umi-internal, never granted inside a café
  created_at   timestamptz not null default now(),
  -- Redundant on its own (id is already the PK). It exists to be the TARGET of the
  -- composite foreign key on umi.user_role, which is what stops a café role from being
  -- granted platform-wide. See the note there.
  constraint role_id_platform_uq unique (id, is_platform)
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

-- The PLATFORM grant, and only that.
--
-- A role INSIDE a café hangs on the employment (merchant.staff.role_id), not here.
-- The reason is the barista: they sign in to the till with a PIN, they never open the
-- dashboard, and so they hold no umi.user row to grant anything to. A grant table that
-- the majority of a café's operators cannot appear in is not the grant table — it is a
-- second one. Square, Toast and Shopify POS all put the permission set on the employee
-- record and treat the passcode and the email login as two doors into it.
--
-- What is left here is the Umi operator: cross-merchant, always an account holder,
-- never an employee of any café. merchant_id/location_id are gone because a platform
-- grant has no scope to carry, and merchant.staff already carries the café's.
--
-- role_id must name a role with is_platform = true. A plain CHECK cannot say that,
-- because it needs a lookup — but a COMPOSITE FOREIGN KEY can. `is_platform` below is
-- pinned to true by its own CHECK, and the pair (role_id, true) can only resolve
-- against a umi.role row whose is_platform is also true. A café role therefore fails
-- to insert instead of being accepted and silently ignored.
--
-- A grant here ENDS. It carries an expiry, a revocation with its reason, why it was
-- asked for, and who approved it beside who granted it. Nothing in the platform layer
-- should be permanent by default; every other grant in this schema already is not
-- (merchant.staff_permission_override.expires_at, runtime.elevation_grant).
--
-- ⚠ PostgreSQL will NOT enforce expires_at. `VALID UNTIL` applies to a password, not to
-- a role, and no DDL construct expires a row. PLATFORM_GRANT_CTE in
-- apps/umi-api/src/modules/auth/rbac.sql.ts carries the predicate. Without it these
-- columns are decoration.
create table umi.user_role (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references umi.user(id) on delete cascade,
  role_id        uuid not null references umi.role(id),
  is_platform    boolean not null default true check (is_platform),
  granted_by     uuid references umi.user(id),
  -- A second person, deliberately distinct from granted_by. Nullable: the bootstrap
  -- grant has nobody to approve it, which is exactly why the seed must be run by hand.
  approved_by    uuid references umi.user(id),
  -- A ticket or case reference. Structured on purpose — free text defeats any later
  -- automated review of why platform access exists.
  justification  text,
  expires_at     timestamptz,   -- NULL = no automatic end; see the gate assertion
  revoked_at     timestamptz,
  revoked_reason text,
  created_at     timestamptz not null default now(),
  unique (user_id, role_id),
  constraint user_role_platform_only_fk
    foreign key (role_id, is_platform) references umi.role (id, is_platform),
  -- A revocation with no reason is an unexplained loss of access; a reason with no
  -- revocation is noise. Same shape as the pairing rules elsewhere in build-v3.
  constraint user_role_revocation_ck
    check ((revoked_at is null) = (revoked_reason is null))
);
create index user_role_active_idx on umi.user_role (user_id) where revoked_at is null;
comment on table umi.user_role is
  'PLATFORM grant: an Umi operator holds a cross-merchant role. Expires and revocable. '
  'A café role lives on merchant.staff.role_id, where a PIN-only operator holds one too.';
comment on column umi.user_role.is_platform is
  'Always true. Exists only to carry the composite FK that refuses a café role here.';
comment on column umi.user_role.expires_at is
  'NOT enforced by PostgreSQL. PLATFORM_GRANT_CTE (rbac.sql.ts) applies the predicate.';

-- ----------------------------------------------------------------------------
-- BREAK-GLASS: one privileged action, or one short window, above the catalog.
--
-- ⚠️ STAGED, NOT WIRED. Nothing reads this table and nothing writes it. `hasPermission`
-- still honours `'*'`, but `effectivePermissions` no longer emits one and no code path
-- inserts a grant, so break-glass does not exist as a capability yet — the schema is
-- here, the request-and-approve path is not. Read the two security_gate.sql assertions
-- about this table in that light: against zero rows they pass without checking
-- anything, which is not the same as a control being enforced. This repository already
-- carries runtime.elevation_grant in exactly that state. Wire it or drop it; do not
-- leave it here reading as protection.
--
-- `umi.user_role` says what an operator may do every day. This says what they may do
-- for the next few minutes, having asked for it on purpose. It is the ONLY thing that
-- may produce the `'*'` that `hasPermission` still honours (auth/roles.ts).
--
-- WHY NOT runtime.elevation_grant, which already models exactly this shape:
--   1. its merchant_id is NOT NULL — a platform action has no café;
--   2. its method CHECK admits only manager_approval / operator_pin — a till's two
--      answers, neither of which describes a platform approval;
--   3. its RLS policy keys on merchant_id, and a NULL merchant makes a USING clause
--      return NULL, which silently hides the row, while WITH CHECK raises instead;
--   4. 90_rls grants it to `api`. THIS is the decisive one. An elevation record the
--      request path can write is not a control — the request path could elevate
--      itself. `umi.user_role` is sealed from `api` for the same reason and
--      security_gate.sql asserts it. This table joins that seal.
--
-- SCOPE LIMIT, recorded so it is not quietly widened later: this is support and
-- recovery access. It is NOT the approval path for money. A void, a refund or an
-- over-threshold discount stays on runtime.elevation_grant with a manager or a PIN,
-- because optimistic "allow and audit" access is not appropriate where the risk is
-- fraud rather than delay.
create table umi.access_grant (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references umi.user(id) on delete cascade,
  -- '*' = full bypass. Any other value elevates exactly one permission key.
  permission_key text not null,
  merchant_id    uuid,   -- soft ref, NULL = platform-wide. No FK: this outlives the café.
  method         text not null check (method in ('platform_approval','break_glass')),
  -- TWO fields, because one cannot do both jobs. `reference` is machine-checkable, so a
  -- later review can join grants to tickets and find the ones that cite nothing real.
  -- `justification` is free text, because a menu of canned reasons is worse than no
  -- reason: in the one published study that measured it, 98% of users picked a
  -- predefined reason and the resulting log was judged infeasible to audit.
  -- DO NOT replace `justification` with a dropdown.
  reference      text not null,
  justification  text not null,
  approved_by    uuid references umi.user(id),
  -- NOT NULL, unlike umi.user_role.expires_at. A standing grant is a role; this is not
  -- one. The window is minutes, and the app sets it — PostgreSQL expires no row.
  expires_at     timestamptz not null,
  consumed_at    timestamptz,   -- single-action grants close here; windowed ones do not
  -- Withdrawn BEFORE it expired: wrong person, wrong incident, account compromised. A
  -- table that can only expire or be consumed has one way to stop an active elevation
  -- early — DELETE — which erases the fact that it ever happened. That is the exact gap
  -- SECURITY_GATE.md recorded against umi.user_role, and which user_role above now
  -- closes; the highest-privilege table in the schema must not be the one still open.
  revoked_at     timestamptz,
  revoked_reason text,
  created_at     timestamptz not null default now(),
  constraint access_grant_revocation_ck
    check ((revoked_at is null) = (revoked_reason is null))
);
create index access_grant_live_idx
  on umi.access_grant (user_id, expires_at)
  where consumed_at is null;
comment on table umi.access_grant is
  'Break-glass and just-in-time platform elevation. Sealed from `api` like umi.user_role. '
  'The only source of the `*` permission. Support and recovery only, never money.';
comment on column umi.access_grant.reference is
  'Machine-checkable ticket or case id. Pairs with justification; neither replaces the other.';
comment on column umi.access_grant.expires_at is
  'NOT enforced by PostgreSQL. The auth path applies the predicate, as with user_role.';

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

-- PCI DSS 10.2.2 names six fields an audit record must carry: user identification,
-- type of event, date and time, SUCCESS AND FAILURE INDICATION, ORIGINATION OF EVENT,
-- and the identity of the affected resource. This table carried four of them. The two
-- capitalised above were missing, and they are the two that matter most on a
-- platform-privileged table: a denied attempt to grant super_admin looks exactly like
-- no attempt at all without `outcome`, and without `request_id` a row cannot be tied
-- to the request that produced it. `runtime.security_audit_event` already carries both
-- under those names; the columns are spelled the same here on purpose.
create table umi.audit_log (
  id             uuid primary key default gen_random_uuid(),
  actor_user_id  uuid references umi.user(id) on delete set null,
  action         text not null
                   check (action in ('create','update','delete','grant','revoke','suspend','restore')),
  entity         text not null,   -- soft descriptor: 'plan','entitlement_override','merchant','user_role'
  entity_id      uuid,            -- soft ref, no FK
  merchant_id    uuid,            -- soft: which merchant it affected (nullable)
  outcome        text not null default 'success'
                   check (outcome in ('success','denied','failure')),
  request_id     text,            -- origination: the request that caused the change
  before         jsonb,
  after          jsonb,
  at             timestamptz not null default now()
);
create index umi_audit_log_entity_idx on umi.audit_log (entity, at desc);
create index umi_audit_log_actor_idx  on umi.audit_log (actor_user_id, at desc);
comment on table umi.audit_log is
  'Umi-internal audit of platform-privileged actions. Sealed/service-role. Append-only.';
comment on column umi.audit_log.outcome is
  'PCI DSS 10.2.2 "success and failure indication". A denied privileged action is a '
  'record, not a silence. Defaulted so existing writers stay correct.';
comment on column umi.audit_log.request_id is
  'PCI DSS 10.2.2 "origination of event". Same name as runtime.security_audit_event.';

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

-- ----------------------------------------------------------------------------
-- THE PRODUCT CATALOGUE — what Umi sells, and what each tier includes.
--
-- ⚠️ MOVED HERE 2026-08-19 from `backfill/backfill_growth.sql`, and the move is
-- the fix. A catalogue that only a MIGRATION writes leaves a platform built from
-- `00_run.sh` with nothing to sell: zero plans, so `umi.subscription.plan_id`
-- (NOT NULL) has nothing to point at, so no café can be opened at all. build-v3
-- was viable only as a migration target and nothing said so — `provision.
-- integration.ts` is the test that could not pass.
--
-- It belongs in the DDL for the same reason the permission catalogue above does:
-- both paths run this file first, and neither depends on a role existing. The
-- ROLE catalogue cannot move here — see the note above — because
-- `backfill_identity` carries the source rows WITH THEIR IDS, and a row seeded
-- first would collide on `role_key_key`. Roles stay in `seed_rbac.sql`, which
-- runs after it.
--
-- `on conflict do nothing` throughout, so a migrated platform that already holds
-- these keys is untouched.
-- ----------------------------------------------------------------------------

-- 5 product-module features (the "doors"). `pos` (UmiPOS) is in the catalogue so
-- it can be entitlement-gated and billed, but is bundled into NO plan below — a
-- café gains it only when POS is explicitly sold (a plan_feature grant or an
-- entitlement_override). Pricing and bundling are an owner decision; catalogue
-- presence is the prerequisite (H-4/H-8).
insert into umi.feature (key, module, name, kind) values
  ('cash',        'cash',        'Loyalty & Stored Value (umi-cash)', 'flag'),
  ('dashboard',   'dashboard',   'Owner Dashboard',                   'flag'),
  ('conversaflow','conversaflow','WhatsApp Agent (ConversaFlow)',     'flag'),
  ('kds',         'kds',         'Kitchen Display (KDS)',             'flag'),
  ('pos',         'pos',         'Point of Sale (UmiPOS)',            'flag')
on conflict (key) do nothing;

-- 3 public tiers
insert into umi.plan (key, name, description, is_public, status) values
  ('starter','Starter','Loyalty & stored value only.',                        true,'active'),
  ('growth', 'Growth', 'Loyalty plus the owner dashboard.',                    true,'active'),
  ('pro',    'Pro',    'Full stack: loyalty, dashboard, WhatsApp agent, KDS.', true,'active')
on conflict (key) do nothing;

-- plan_feature bundles (flag features -> limit_value NULL; row presence = granted)
insert into umi.plan_feature (plan_id, feature_id, limit_value)
select p.id, f.id, null::bigint
from (values
  ('starter','cash'),
  ('growth','cash'), ('growth','dashboard'),
  ('pro','cash'), ('pro','dashboard'), ('pro','conversaflow'), ('pro','kds')
) as b(plan_key, feature_key)
join umi.plan p    on p.key = b.plan_key
join umi.feature f on f.key = b.feature_key
on conflict do nothing;

-- The POS offline-cash flag. Off until a merchant is explicitly certified for it;
-- `merchant.pos_offline_cash_policy` then carries the limits.
insert into umi.feature (key, module, name, description, kind) values
  ('pos.offline_cash', 'pos', 'POS offline cash',
   'Policy-controlled provisional cash checkout', 'flag')
on conflict (key) do nothing;
