-- =============================================================================
-- 11_tenant_core.sql  (canonical rebuild v2 — RUN ORDER POSITION 3)
--
-- Schema: `tenant` (RLS). The org tree + identity graph + principals — the
-- hardest file: it re-shapes the old 9-schema identity kernel into the 4-schema
-- model. RLS root = tenant.tenant (keys on id, NO tenant_id). Every other table
-- carries `tenant_id` and a composite PK `(tenant_id, id)` so child FKs are the
-- inline composite form `(tenant_id, <fk>) -> parent(tenant_id, id)`.
--
-- Sources (current build/):
--   10_core.sql  — core.tenants/locations/people/contact_methods/users/
--                  tenant_memberships/roles/permissions/role_permissions/
--                  membership_roles/staff_members/integration_tokens/
--                  password_reset_tokens/contact_merge_candidates/external_refs
--   12_ops.sql   — ops.businesses (org node + tenant-authored config)
--   11_loyalty.sql — loyalty.accounts (folded into tenant.customer)
--   13_comms.sql — comms.customer_preferences (re-grained to tenant.customer_note)
--
-- Transform highlights (per manifest FILE 11):
--   * core.tenants          -> tenant.tenant           (RLS root, keys on id)
--   * ops.businesses        -> tenant.business         (+ menu_source)
--   * core.locations        -> tenant.branch           (+ business_id composite FK)
--   * NEW                   -> tenant.contact          (thin identity anchor)
--   * NEW GLOBAL            -> tenant.channel          (issuer catalog, no tenant_id)
--   * core.contact_methods  -> tenant.contact_identity (matured; folds merge_candidates + external_refs provenance)
--   * core.people (+loyalty.accounts) -> tenant.customer
--   * comms.customer_preferences -> tenant.customer_note (atomic facts)
--   * core.users            -> tenant.login            (RLS exception, no tenant_id, secrets)
--   * RBAC (5 tables)       -> tenant.tenant_access     (role enum bridge)
--   * core.staff_members    -> tenant.staff
--   * core.password_reset_tokens -> tenant.password_reset_token
--   * core.integration_tokens    -> tenant.integration_token
--   * DROP core.external_refs, core.product_instances (-> umi.subscription_item),
--          core.sessions (-> runtime.session), core.contact_merge_candidates.
--
-- Depends on: 00_foundation.sql (schemas, roles, legacy.stable_uuid,
--   tenant.normalize_identity, tenant.can_access_tenant reads tenant.tenant_access).
-- 90_rls.sql enables+forces RLS + policies + grants umi_app + seals secret cols.
-- Idempotent: create ... if not exists; guarded constraints.
-- Target: PostgreSQL 18.
-- =============================================================================

begin;

set search_path = tenant, public, extensions;

-- ---------------------------------------------------------------------------
-- tenant.f_branch_search_text(name, aliases) — the branch-name trigram target
--   as ONE immutable boundary. IMMUTABILITY NOTE (from 2026-07-03 apply):
--   array_to_string(anyarray, text) is only STABLE, so inlining it into a
--   generated-column expression fails 42P17. A LANGUAGE plpgsql function is
--   never inlined, so its DECLARED immutability is trusted. Body stays fully
--   qualified; do NOT add SET search_path (would defeat immutability). f_unaccent
--   is intentionally DROPPED per the PR2 decision (lowercase + pg_trgm only).
-- ---------------------------------------------------------------------------
create or replace function tenant.f_branch_search_text(p_name text, p_aliases text[])
  returns text language plpgsql immutable parallel safe as $$
begin
  return lower(coalesce(p_name, '') || ' ' || coalesce(array_to_string(p_aliases, ' '), ''));
end;
$$;

-- ===========================================================================
-- tenant.tenant  <- core.tenants
--   The RLS ROOT. It IS the tenant, so it keys on `id` (NO tenant_id column);
--   90_rls gives it an id-based policy, not the generic tenant_isolation one.
--   Absorbs nothing from ops.businesses — the org/brand node stays separate
--   (tenant.business) per red-team §8.
-- ===========================================================================
create table if not exists tenant.tenant (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  status      text not null default 'active'
    check (status in ('active', 'disabled', 'archived')),
  timezone    text not null default 'America/Mexico_City',
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ===========================================================================
-- tenant.channel  (NEW — GLOBAL reference catalog, NO tenant_id)
--   The set of identity issuers/channels (whatsapp/instagram/messenger/sms/
--   email/pos/web/manual). Global because a channel's normalization semantics
--   are the same for every tenant. Seeded by the worker (90_rls grants global
--   catalog read); referenced by tenant.contact_identity via a plain FK.
-- ===========================================================================
create table if not exists tenant.channel (
  id                     uuid primary key default gen_random_uuid(),
  key                    text not null unique,     -- whatsapp/instagram/messenger/sms/email/pos/web/manual
  namespace              text,                      -- optional grouping (e.g. 'meta')
  normalization_rule     text not null default 'none'
    check (normalization_rule in ('e164', 'lower', 'none')),
  deterministic_matchable boolean not null default false,
  default_trust          numeric not null default 0.5,
  metadata               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now()
);

-- Seed the GLOBAL channel catalog (idempotent). REQUIRED: normalize_identity +
-- every contact_identity dedup are unusable without it, and build-v2 shipped no
-- seed. normalization_rule mirrors tenant.normalize_identity's dispatch; only the
-- value-keyed channels (phone/whatsapp/sms/email) are deterministically matchable
-- — Meta PSIDs (instagram/messenger) + pos/web/manual match by external_id, not
-- value. The app's identity resolver may re-upsert this same set at bootstrap.
insert into tenant.channel (key, namespace, normalization_rule, deterministic_matchable, default_trust) values
  ('phone',     null,   'e164',  true,  0.90),
  ('whatsapp',  'meta', 'e164',  true,  0.85),
  ('sms',       null,   'e164',  true,  0.85),
  ('email',     null,   'lower', true,  0.80),
  ('instagram', 'meta', 'none',  false, 0.60),
  ('messenger', 'meta', 'none',  false, 0.60),
  ('pos',       null,   'none',  false, 0.50),
  ('web',       null,   'none',  false, 0.50),
  ('manual',    null,   'none',  false, 0.50)
on conflict (key) do nothing;

-- ===========================================================================
-- tenant.business  <- ops.businesses
--   Org node + the tenant's own authored config (brand/config/voice/hours
--   window all live inside `config`/`open_times`/`branding` jsonb, carried
--   verbatim). NEW: menu_source stamps where the menu is authored/synced from.
--   Composite PK (tenant_id, id); one business per tenant (unique(tenant_id)).
-- ===========================================================================
create table if not exists tenant.business (
  id             uuid not null default gen_random_uuid(),
  tenant_id      uuid not null references tenant.tenant(id) on delete cascade,
  name           text not null,
  business_type  text,
  city           text,
  menu_source    text not null default 'dashboard'
    check (menu_source in ('dashboard', 'zettle', 'pos')),
  config         jsonb not null default '{}'::jsonb,     -- brand/voice/hours-window config
  open_times     jsonb not null default '{}'::jsonb,
  branding       jsonb not null default '{}'::jsonb,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, id),
  unique (tenant_id)                                      -- one business per tenant
);

create index if not exists tenant_business_tenant_idx
  on tenant.business (tenant_id);

-- ===========================================================================
-- tenant.branch  <- core.locations
--   Physical/service location. NEW: business_id ties the branch to its org
--   node (composite FK, nullable). Composite PK (tenant_id, id).
-- ===========================================================================
create table if not exists tenant.branch (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null references tenant.tenant(id) on delete cascade,
  business_id uuid,
  slug        text,
  name        text not null,
  -- Branch-resolution profile (was core.locations.aliases/descriptor/search_text).
  -- search_text is the trigram match target; f_unaccent is DROPPED per the PR2
  -- decision (rely on lower() + pg_trgm word_similarity).
  aliases     text[] not null default '{}',
  descriptor  text,
  search_text text generated always as
    (tenant.f_branch_search_text(name, aliases)) stored,
  address     text,
  lat         double precision,
  lng         double precision,
  status      text not null default 'active'
    check (status in ('active', 'disabled', 'archived')),
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, id),
  foreign key (tenant_id, business_id)
    references tenant.business (tenant_id, id) on delete set null
);

create unique index if not exists tenant_branch_tenant_slug_uidx
  on tenant.branch (tenant_id, slug) where slug is not null;
create index if not exists tenant_branch_tenant_idx
  on tenant.branch (tenant_id, status);
create index if not exists tenant_branch_business_idx
  on tenant.branch (tenant_id, business_id) where business_id is not null;
-- trigram target for branch-name/alias fuzzy matching (set_branch resolution).
create index if not exists tenant_branch_search_trgm_idx
  on tenant.branch using gin (search_text extensions.gin_trgm_ops);

-- ===========================================================================
-- tenant.contact  (NEW — thin identity ANCHOR)
--   The stable node that identities point at and a customer hangs off of. No
--   business attributes; just a merge/resolution state. Composite PK.
-- ===========================================================================
create table if not exists tenant.contact (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null references tenant.tenant(id) on delete cascade,
  merge_state text not null default 'resolved'
    check (merge_state in ('resolved', 'candidate', 'merged')),
  merged_into uuid,                                       -- self-ref when merged
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, id),
  foreign key (tenant_id, merged_into)
    references tenant.contact (tenant_id, id) on delete set null
);

create index if not exists tenant_contact_tenant_state_idx
  on tenant.contact (tenant_id, merge_state);

-- ===========================================================================
-- tenant.contact_identity  <- core.contact_methods
--   Matured reachability spine; folds core.contact_merge_candidates (confidence
--   / match_type) and core.external_refs (external_id / collected_via
--   provenance). channel_id -> tenant.channel(id) [global, plain FK]; contact_id
--   -> tenant.contact [composite FK]. The dedup key is the per-channel
--   normalized value: UNIQUE(tenant_id, channel_id, normalized_value).
-- ===========================================================================
create table if not exists tenant.contact_identity (
  id               uuid not null default gen_random_uuid(),
  tenant_id        uuid not null references tenant.tenant(id) on delete cascade,
  contact_id       uuid not null,
  channel_id       uuid not null references tenant.channel(id),
  external_id      text,                                  -- issuer subject / external ref
  normalized_value text,                                  -- tenant.normalize_identity(channel.key, raw)
  display_value    text,                                  -- as-collected, human-readable
  confidence       numeric,
  match_type       text
    check (match_type in ('deterministic', 'probabilistic')),
  collected_via    text,                                  -- how this identity was observed
  is_primary       boolean not null default false,
  verified_at      timestamptz,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  metadata         jsonb not null default '{}'::jsonb,
  primary key (tenant_id, id),
  unique (tenant_id, id),
  unique (tenant_id, channel_id, normalized_value),       -- dedup spine (G4)
  foreign key (tenant_id, contact_id)
    references tenant.contact (tenant_id, id) on delete cascade
);

create index if not exists tenant_contact_identity_contact_idx
  on tenant.contact_identity (tenant_id, contact_id);
create index if not exists tenant_contact_identity_lookup_idx
  on tenant.contact_identity (tenant_id, channel_id, normalized_value);
-- external_id (issuer subject) dedup. The (tenant,channel,normalized_value) unique
-- escapes via NULLs (NULLS DISTINCT), so identities carried only by external_id
-- (a Meta PSID, an unparseable phone) would otherwise get zero uniqueness and the
-- resolver could mint unlimited duplicate contact/customer rows.
create unique index if not exists tenant_contact_identity_external_uidx
  on tenant.contact_identity (tenant_id, channel_id, external_id)
  where external_id is not null;
-- one primary identity per (contact, channel).
create unique index if not exists tenant_contact_identity_primary_uidx
  on tenant.contact_identity (tenant_id, contact_id, channel_id)
  where is_primary;

-- ===========================================================================
-- tenant.customer  <- core.people (absorbs loyalty.accounts)
--   The tenant-scoped person. Anchored to exactly one tenant.contact
--   (program-less: one customer per contact). Loyalty is a relationship column
--   set folded in from loyalty.accounts (no separate account relation). No
--   `type` column. Reachability lives in contact_identity, so the old
--   normalized_phone/normalized_email dedup caches are dropped here.
-- ===========================================================================
create table if not exists tenant.customer (
  id             uuid not null default gen_random_uuid(),
  tenant_id      uuid not null references tenant.tenant(id) on delete cascade,
  contact_id     uuid not null,
  name           text,                                    -- was core.people.display_name
  born_at        date,                                    -- was core.people.birth_date
  loyalty_status text not null default 'active'           -- folded from loyalty.accounts.status
    check (loyalty_status in ('active', 'disabled', 'archived')),
  loyalty_joined_at timestamptz,                          -- folded from loyalty.accounts.created_at
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, id),
  unique (tenant_id, contact_id),                         -- one customer per contact
  foreign key (tenant_id, contact_id)
    references tenant.contact (tenant_id, id) on delete cascade
);

create index if not exists tenant_customer_tenant_name_idx
  on tenant.customer (tenant_id, name);
create index if not exists tenant_customer_tenant_born_idx
  on tenant.customer (tenant_id, born_at) where born_at is not null;
create index if not exists tenant_customer_contact_idx
  on tenant.customer (tenant_id, contact_id);

-- ===========================================================================
-- tenant.customer_note  <- comms.customer_preferences (re-grained to atomic facts)
--   One durable fact per row (the old aggregate-preference blob is decomposed).
--   customer_id -> tenant.customer [composite FK]. comms.memory_items is dropped.
-- ===========================================================================
create table if not exists tenant.customer_note (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null references tenant.tenant(id) on delete cascade,
  customer_id uuid not null,
  fact        text not null,
  source      text,                                       -- 'preferences' | 'agent' | 'staff' | ...
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id)
    references tenant.customer (tenant_id, id) on delete cascade
);

create index if not exists tenant_customer_note_customer_idx
  on tenant.customer_note (tenant_id, customer_id, created_at desc);

-- ===========================================================================
-- tenant.login  <- core.users   (RLS EXCEPTION — NO tenant_id)
--   Login principal; belongs to many tenants via tenant.tenant_access. RLS is
--   self-access (id = app.user_id), wired in 90_rls. Secret cols
--   (password_salt/hash/algorithm) are SEALED from umi_app + public in 90_rls.
--   contact_id is a soft link to a customer identity (tenant.contact is
--   composite-keyed, so no plain FK is possible — kept as a bare uuid).
-- ===========================================================================
create table if not exists tenant.login (
  id                 uuid primary key default gen_random_uuid(),
  auth_subject       text unique,                         -- external auth linkage
  email              text,
  phone              text,
  display_name       text,
  contact_id         uuid,                                -- soft link to a tenant.contact (no FK: composite key)
  password_salt      text,                                -- SECRET (90_rls seal)
  password_hash      text,                                -- SECRET (90_rls seal)
  password_algorithm text,                                -- SECRET label
  status             text not null default 'active'
    check (status in ('active', 'invited', 'disabled', 'archived')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists tenant_login_email_uidx
  on tenant.login (lower(email)) where email is not null;

-- ===========================================================================
-- tenant.tenant_access  <- core.tenant_memberships + roles + permissions +
--                          role_permissions + membership_roles (5 tables collapsed)
--   The RBAC bridge, flattened to a single role enum. This is the table
--   tenant.can_access_tenant() reads (tenant_id, login_id, status='active').
--   Composite PK (tenant_id, id) + UNIQUE(tenant_id, login_id) (one edge per
--   login per tenant). login_id -> tenant.login(id) [plain FK; login has no
--   tenant_id].
-- ===========================================================================
create table if not exists tenant.tenant_access (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null references tenant.tenant(id) on delete cascade,
  login_id    uuid not null references tenant.login(id) on delete cascade,
  role        text not null default 'staff'
    -- super_admin = Umi's cross-tenant operator (hola@umiconsulting.co): wildcard
    -- permissions + can_access_tenant bypass (see 00_foundation, 18_umi). One
    -- active super_admin edge anywhere flags a GLOBAL super_admin. 'developer' /
    -- 'tech_assist' are deliberately PARKED (not admitted until wired end-to-end).
    check (role in ('owner', 'admin', 'staff', 'viewer', 'super_admin')),
  status      text not null default 'active'
    check (status in ('active', 'invited', 'disabled', 'archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, id),
  unique (tenant_id, login_id)                            -- one access edge per login per tenant
);

create index if not exists tenant_access_login_idx
  on tenant.tenant_access (login_id);
create index if not exists tenant_access_lookup_idx
  on tenant.tenant_access (tenant_id, login_id, status);

-- ===========================================================================
-- tenant.staff  <- core.staff_members
--   Operational identity referenced by loyalty/orders. branch_id -> tenant.branch
--   [composite FK, nullable]; login_id -> tenant.login(id) [plain FK, nullable].
-- ===========================================================================
create table if not exists tenant.staff (
  id          uuid not null default gen_random_uuid(),
  tenant_id   uuid not null references tenant.tenant(id) on delete cascade,
  branch_id   uuid,
  login_id    uuid references tenant.login(id) on delete set null,
  name        text not null,
  email       text,
  phone       text,
  status      text not null default 'active'
    check (status in ('active', 'invited', 'disabled', 'archived')),
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id)
    references tenant.branch (tenant_id, id) on delete set null
);

create index if not exists tenant_staff_tenant_status_idx
  on tenant.staff (tenant_id, status, name);
create unique index if not exists tenant_staff_tenant_email_uidx
  on tenant.staff (tenant_id, lower(email)) where email is not null;
create index if not exists tenant_staff_login_idx
  on tenant.staff (login_id) where login_id is not null;

-- ===========================================================================
-- tenant.password_reset_token  <- core.password_reset_tokens
--   Login-keyed (no tenant_id). token_hash is SECRET-adjacent — 90_rls gives it
--   login self-access RLS and seals token_hash from umi_app.
-- ===========================================================================
create table if not exists tenant.password_reset_token (
  id          uuid primary key default gen_random_uuid(),
  login_id    uuid not null references tenant.login(id) on delete cascade,
  token_hash  text not null,                              -- SECRET-adjacent (90_rls seal)
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists tenant_password_reset_token_login_idx
  on tenant.password_reset_token (login_id);

-- ===========================================================================
-- tenant.integration_token  <- core.integration_tokens
--   OAuth secrets. Whole table is SECRET — 90_rls seals it from umi_app (worker
--   only), matching today's posture. Composite PK; UNIQUE(tenant_id, provider).
-- ===========================================================================
create table if not exists tenant.integration_token (
  id            uuid not null default gen_random_uuid(),
  tenant_id     uuid not null references tenant.tenant(id) on delete cascade,
  provider      text not null,                            -- 'zettle', ...
  access_token  text not null,                            -- SECRET
  refresh_token text,                                     -- SECRET
  token_type    text default 'Bearer',
  expires_at    timestamptz,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, id),
  unique (tenant_id, provider)
);

-- ===========================================================================
-- GRANTS
--   Domain files grant DML to umi_worker; 90_rls grants umi_app (row-scoped
--   after RLS is on) and seals the secret columns/tables. tenant is an
--   app-reachable schema, so we ONLY wire the worker here.
-- ===========================================================================
grant select, insert, update, delete on all tables in schema tenant to umi_worker;
alter default privileges in schema tenant
  grant select, insert, update, delete on tables to umi_worker;

commit;

-- =============================================================================
-- FILE 11 CONTRACT (for downstream tenant.* authors)
--   RLS root: tenant.tenant (keys on id; plain FK: tenant_id -> tenant.tenant(id)).
--   Global catalog: tenant.channel (id; plain FK: channel_id -> tenant.channel(id)).
--   Composite (tenant_id, id) parents for inline composite child FKs:
--     tenant.business, tenant.branch, tenant.contact, tenant.contact_identity,
--     tenant.customer, tenant.customer_note, tenant.staff, tenant.tenant_access,
--     tenant.integration_token
--       foreign key (tenant_id, <fk>) references tenant.<parent> (tenant_id, id)
--   Plain-keyed principals: tenant.login(id) (no tenant_id),
--     tenant.tenant_access(login_id), tenant.password_reset_token(login_id).
--   Identity: contact (anchor) <- contact_identity (channel_id + normalized_value,
--     UNIQUE(tenant_id,channel_id,normalized_value)); customer -> contact.
--   90_rls: enables+forces RLS, adds policies (tenant.tenant on id; login/
--     password_reset_token self-access), grants umi_app, seals login password_*
--     + integration_token + password_reset_token.token_hash. NO RLS added here.
-- =============================================================================
