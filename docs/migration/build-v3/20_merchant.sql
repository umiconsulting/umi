-- ============================================================================
-- build-v3 · schema: merchant
-- The café's merchant. RLS-scoped per merchant (policies in 90_rls.sql).
-- Conventions: see 10_umi.sql header.
-- merchant->umi FKs are INLINE here (umi is built first). Only the circular
-- umi->merchant FKs are deferred (50_cross_schema_fk.sql).
-- ============================================================================

create schema if not exists merchant;

-- Shared guard: money ledgers are immutable once written.
create or replace function merchant.tg_append_only() returns trigger
  language plpgsql
  set search_path = pg_catalog as $$   -- pinned: no writable schema on the path
begin
  raise exception 'table %.% is append-only; % is not permitted',
    tg_table_schema, tg_table_name, tg_op;
end $$;

/*
 * Run one statement against an append-only table, then close it again.
 *
 * A forward migration sometimes must rewrite a protected row. The append-only
 * trigger refuses that, correctly, so the migration has to lift the guard.
 *
 * ⚠️ Do not write `alter table ... disable trigger` on its own. The statement
 * after it can fail, and the table then stays writable with nothing to say so.
 * `merchant.loyalty_stored_value_ledger` holds the money: `balance = SUM(delta)`,
 * so a rewritten row changes a customer balance and leaves no record.
 *
 * This function is the safe form. It disables the trigger, runs the statement,
 * and PUTS THE TRIGGER BACK THE WAY IT FOUND IT. All of that runs inside the
 * caller transaction, and the `exception` block restores the trigger before it
 * re-raises. That covers the caller who traps the error and commits anyway,
 * which is the one case a rollback does not cover.
 *
 * It restores the PREVIOUS state, and does not simply enable. Two nested calls
 * on one table then behave: the inner call gives back the disabled state the
 * outer call created, instead of closing the table under it.
 *
 * The caller stays in charge of the transaction:
 *
 *   begin;
 *   select merchant.with_append_only_writable(
 *     'merchant.loyalty_stored_value_ledger',
 *     $sql$ update merchant.loyalty_stored_value_ledger set ... $sql$);
 *   commit;
 *
 * ⚠️ Do not add `security definer` to this function. It runs a statement the
 * caller supplies. Without that clause the statement carries the caller
 * privileges and this function grants nothing; with it, any caller who can
 * execute this function gets the owner privileges for one arbitrary statement.
 *
 * WHICH TABLES. Only a table that carries a trigger running
 * `merchant.tg_append_only` — nine of them today, and any added later, because
 * the set comes from the catalog and not from a list here. A table with no such
 * trigger raises. This cannot become a way to disable an arbitrary trigger.
 *
 * ⚠️ Schema-qualify every name inside `stmt`. `search_path` is pinned to
 * `pg_catalog` for this function, and `stmt` runs under that path.
 */
create or replace function merchant.with_append_only_writable(target text, stmt text)
  returns void
  language plpgsql
  set search_path = pg_catalog as $$
declare
  trigger_name text;
  was_enabled  "char";
begin
  -- The catalog decides, not a list. `tgisinternal` excludes the triggers
  -- Postgres creates for a constraint, which nobody may touch.
  select t.tgname, t.tgenabled into trigger_name, was_enabled
    from pg_trigger t
   where t.tgrelid = target::regclass
     and t.tgfoid = 'merchant.tg_append_only'::regproc
     and not t.tgisinternal
   limit 1;

  if trigger_name is null then
    raise exception
      'with_append_only_writable: % carries no append-only trigger. Write the statement directly.', target;
  end if;

  execute format('alter table %s disable trigger %I', target, trigger_name);
  begin
    execute stmt;
  exception when others then
    if was_enabled <> 'D' then
      execute format('alter table %s enable trigger %I', target, trigger_name);
    end if;
    raise;
  end;
  -- Restore, do not enable. A nested call must give back what it found.
  if was_enabled <> 'D' then
    execute format('alter table %s enable trigger %I', target, trigger_name);
  end if;
end $$;

comment on function merchant.with_append_only_writable(text, text) is
  'Run one statement against an append-only table with its guard lifted, inside the caller transaction. Restores the previous trigger state on every path.';

-- ----------------------------------------------------------------------------
-- ROOT
-- ----------------------------------------------------------------------------

create table merchant.merchant (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  legal_name        text,
  -- The URL key, and the ONLY thing left of the old `slug`. Everything routes by `id`;
  -- this exists because four things already published a café's name inside a URL and
  -- cannot be recalled:
  --   1. 350 Apple Wallet passes are installed on customers' phones. A .pkpass is a
  --      SIGNED bundle and its `webServiceURL` is frozen at generation time, so every
  --      one of them will call /api/{handle}/passes/apple forever. Apple does not
  --      require the café in that path — the serial number identifies the card — so
  --      this dependency is self-inflicted, and NEW passes need not repeat it. It is
  --      still permanent for the passes already issued.
  --   2. umi-cash serves its whole customer site under /{handle}/... .
  --   3. Brand assets are files named /logos/{handle}-wallet-logo.png.
  --   4. The dashboard prints umi.app/{handle} as the café's public address.
  --
  -- NULLABLE and NOT auto-assigned, which is the difference between this and `slug`.
  -- A café created after cutover gets no handle and is reached by id; a handle appears
  -- only when somebody publishes a URL that has to keep working. The column is designed
  -- to stop growing.
  handle            text unique
                      check (handle is null or handle ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  city              text,
  timezone          text not null default 'America/Mexico_City',
  currency          text not null default 'MXN',
  locale            text not null default 'es-MX',
  -- Hours are a COLUMN, not a table (owner decision). Shape:
  --   {"mon":[{"open":"08:00","close":"20:00"}], ...,
  --    "exceptions":[{"date":"2026-12-25","closed":true},
  --                  {"date":"2026-05-10","open":"10:00","close":"14:00"}]}
  --
  -- WHY A DOCUMENT. The unit of READ equals the unit of WRITE: one weekly form writes
  -- it, and every reader (bot "¿están abiertos?", the ordering window, the register's
  -- after-hours flag, the dashboard grid) wants the whole schedule for one place and
  -- evaluates it in app code. Nothing filters or joins on hours in SQL — nobody asks
  -- "which cafés are open now" — so the row table was splitting an atom that is never
  -- accessed in pieces, and charging the bot's hot path a second query for it.
  -- It also could not express things a café actually has: a split shift (its UNIQUE
  -- index on (merchant, location, day) FORBADE a second window), a date exception, or a
  -- window that runs past midnight. The one thing it did better — DB-typed `time` —
  -- comes back as the CHECK below plus validation on the write path.
  --
  -- WHAT DOES NOT GO IN HERE. These are the hours the DOORS are open. Per-channel and
  -- per-service restrictions are a POLICY on top, not a second schedule: the WhatsApp
  -- cutoff below is one, and the POS will bring more. Keeping them separate is what
  -- stops this column from growing a nesting level per channel.
  open_hours        jsonb not null default '{}'::jsonb
                      check (jsonb_typeof(open_hours) = 'object'),
  -- The ORDERING WINDOW for the conversational channel. Hours say when the café is
  -- open; these say whether it is taking WhatsApp orders right now, and until how
  -- long before closing. They were the last four keys of the n8n-era `config` blob
  -- (`accepts_whatsapp_orders`, `order_cutoff_minutes`, `special_notice`,
  -- `bypass_phones`), and they are typed columns here for the reason
  -- CONVERSATION_MODEL.md §2c gives: build-v3 dissolves that blob rather than
  -- restoring it.
  --
  -- Named for the channel ON PURPOSE. The POS is a second ordering channel and it
  -- must NOT be paused by this switch — a café that stops taking WhatsApp orders at
  -- the lunch rush is still selling at the counter. A neutral `ordering_enabled`
  -- would read as governing both, and would eventually be wired to do so.
  whatsapp_ordering_enabled     boolean not null default true,
  -- Minutes before closing after which the bot stops accepting orders (the
  -- dashboard slider). Replaces a legacy ABSOLUTE `order_cutoff_time` that could
  -- silently override it — one cutoff, one source.
  whatsapp_order_cutoff_minutes integer not null default 30
                                  check (whatsapp_order_cutoff_minutes between 0 and 1440),
  -- Free text the bot adds to its hours answer ("today we close early"). Merchant
  -- authored, so it is content, not configuration.
  whatsapp_ordering_notice      text,
  -- Numbers that may order outside the window — staff testing the bot, the owner.
  -- E.164, normalized on write: an inbound WhatsApp number arrives normalized, and
  -- a list stored any other way silently never matches.
  whatsapp_bypass_phone         text[] not null default array[]::text[],
  -- Menu authority: managed in our dashboard, or synced from a POS integration.
  menu_source       text not null default 'dashboard'
                      check (menu_source in ('dashboard','pos_sync')),
  -- Branding (typed; add columns rather than a catch-all blob).
  logo_url          text,
  brand_color       text,   -- primary brand color (dashboard theming + wallet pass)
  secondary_color   text,   -- accent color (dashboard theming)
  -- Conversational assistant voice (merchant-configurable from the dashboard). Two knobs:
  -- assistant_name overrides the display persona (null -> merchant name); assistant_tone is
  -- the tone preset (casual|friendly|formal), rendered as the prompt's tone line. Freeform
  -- tone + extra instructions were deferred (no injection point decided) — add columns then.
  assistant_name    text,
  assistant_tone    text,
  -- When the trading day rolls over. A café that serves until 01:00 counts that sale as
  -- belonging to the previous day, and its cash-up, its revenue report and its receipt
  -- must all agree about which day that is. Midnight is the safe default; a late-night
  -- merchant sets 04:00. EVERY business_date in this schema is derived from this column
  -- plus `timezone` by merchant.tg_business_date, so they cannot disagree with each other.
  business_day_start time not null default '00:00',
  status            text not null default 'active'
                      check (status in ('active','suspended')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table  merchant.merchant is 'The café. Root of the merchant schema (was merchant.merchant).';
comment on column merchant.merchant.open_hours is
  'Weekly hours + date exceptions as one jsonb column — hours are an attribute, not a table. '
  'A location may override it (merchant.location.open_hours); read COALESCE(location, merchant).';
comment on column merchant.merchant.whatsapp_ordering_enabled is
  'The pause switch for conversational ordering. Does NOT gate the POS or the counter.';

-- ----------------------------------------------------------------------------
-- PLACES & PEOPLE-WHO-WORK
-- ----------------------------------------------------------------------------

create table merchant.location (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references merchant.merchant(id) on delete cascade,
  name         text not null,
  address      text,
  -- How a customer may pay AT THIS COUNTER, in the order the bot should say them.
  -- Umi takes no money online: an order arrives on WhatsApp and is paid in person, so
  -- this is a fact about the physical place, exactly like `address` one line up.
  --
  -- It lived on the merchant until now, and that was demonstrably the wrong home:
  -- Kalala has two locations and the merchant-level config carried ONE address and ONE
  -- payment list, so every customer who chose Congreso was told the Chapultepec
  -- address. A merchant-level answer to a per-location question is not a shortcut, it
  -- is a wrong answer.
  --
  -- NOT NULL with an empty default, deliberately NOT the nullable-inherit rule that
  -- `timezone` and `open_hours` below use. For an array that rule is ambiguous —
  -- NULL would mean "ask the café" while '{}' would mean "accepts nothing", and no
  -- caller can act on that difference. Empty simply means "not recorded", and the bot
  -- says so.
  payment_methods text[] not null default '{}',
  lat          numeric(9,6),          -- captured pin (all prod locations have coords); not derived
  lng          numeric(10,6),
  timezone     text,                  -- null = inherit merchant.timezone
  -- Same inherit rule as `timezone` one line up, for the same reason: a location is
  -- usually the café's hours and sometimes not (a mall location closes with the mall).
  -- NULL = inherit merchant.open_hours; '{}' is NOT the same thing — that is an
  -- explicit "no windows", i.e. closed. Same jsonb shape as merchant.open_hours.
  --
  -- WE DIVERGE FROM THE INDUSTRY HERE, deliberately. Square has no hours on `Merchant`
  -- at all — only `Location.business_hours`. Google puts `regularHours` on the Location,
  -- Toast on the restaurant, DoorDash on the store. None of them inherit; the physical
  -- place always carries its own hours. We inherit because (a) `location.timezone` one line
  -- up already does, and two adjacent columns with opposite rules is worse than one
  -- unusual rule; (b) almost every merchant is a single café, and per-location-only means
  -- every one of them writes an override that says nothing; (c) the dashboard has ONE
  -- Hours screen, so a chain with uniform hours edits one row, not N. The cost is real
  -- and already paid: reconcile_v3 carries a `pointless_location_overrides` invariant that
  -- only exists because this shape can produce them, and the API returns `hoursLevel` so
  -- a reader always knows which level answered.
  open_hours   jsonb                  -- null = inherit merchant.open_hours
                 check (open_hours is null or jsonb_typeof(open_hours) = 'object'),
  status       text not null default 'active' check (status in ('active','closed')),
  -- What the customer CALLS this place, which is rarely its registered name. The bot
  -- resolves free text ("chapu") to a location ("Chapultepec"), and the owner curates the
  -- nicknames it should also accept. Written by the dashboard's Sucursales editor.
  --
  -- These were dropped from the first build-v3 draft as "empty" — and they are empty, in
  -- a café that has one location and no reason to nickname it. That reasoning read the
  -- DATA and not the WRITER: the editor ships, it saves aliases and descriptor, and the
  -- columns simply were not there to receive them. Empty is not the same as unused.
  aliases      text[] not null default '{}',
  descriptor   text,                  -- a human hint for disambiguation ("la del centro")
  -- Stored, not computed per query, because the trigram index below has to be built on
  -- the same expression the query scores against.
  search_text  text generated always as
                 (merchant.location_search_text(name, aliases)) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Redundant against the PK, and load-bearing: it lets child tables carry a COMPOSITE
  -- foreign key (merchant_id, location_id) so the database itself refuses a row whose
  -- location belongs to another café. A device charging at someone else's location is the
  -- exact failure this prevents.
  unique (merchant_id, id)
);

-- The fuzzy half of location resolution. word_similarity() is only fast with this index;
-- without it every customer message that names a location sequentially scans.
create index location_search_text_trgm
  on merchant.location using gin (search_text extensions.gin_trgm_ops);
-- Search via expression index, NOT a stored search_text column.
create index location_name_lower on merchant.location (lower(name));
comment on column merchant.location.open_hours is
  'This location''s hours, or NULL to inherit merchant.merchant.open_hours. Mirrors location.timezone.';

-- A KDS station: the board a device pairs to. CONFIG — the owner creates and renames
-- these at business cadence, never by migration (ORDER_MODEL.md §5). The order itself
-- carries no station; the KDS scopes by the device's paired station at query time.
--
-- This table was built with only (location_id, name) and the backfill dropped the rest as
-- "no target col". That was wrong on all four counts — every dropped column has a live
-- consumer in kds.repository.ts, and the shape was wrong besides:
--   merchant_id -> the repository scopes EVERY station query by merchant, and without the
--     column the only isolation was a join through location, which cannot express a
--     station that belongs to no location (below).
--   location_id is NULLABLE -> NULL means "every location". listStations/loadStation treat a
--     missing location as unscoped, and findActiveStationByKey matches the location with
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
create table merchant.station (
  id          uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete cascade,
  location_id   uuid references merchant.location(id) on delete cascade,  -- NULL = every location
  key         text not null,
  name        text not null,
  status      text not null default 'active'
                check (status in ('active','disabled','archived')),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- One live station per key per location scope. NULLS NOT DISTINCT (pg15+) is what makes
-- the merchant-wide scope work: with default NULL semantics two location-less stations could
-- both claim key 'cafe', and findActiveStationByKey would return an arbitrary one.
-- Archived rows are excluded so a key can be reused after the station is retired.
create unique index station_merchant_location_key_uidx
  on merchant.station (merchant_id, location_id, key) nulls not distinct
  where status <> 'archived';

create table merchant.integration (
  id                  uuid primary key default gen_random_uuid(),
  merchant_id         uuid not null references merchant.merchant(id) on delete cascade,
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
  unique (merchant_id, provider),
  -- Cross-merchant guard: two merchants may NEVER claim the same external account.
  -- For provider='twilio' that account IS the inbound WhatsApp sender number, so a
  -- collision would route one café's customer messages to another café. NULLs stay
  -- distinct in Postgres, so a merchant with no number yet is unaffected.
  unique (provider, external_account_id)
);
comment on table merchant.integration is
  'Generic external connection (POS sync / message sender / wallet issuer / AI). '
  'Umi''s own POS is just provider=''umi_pos''. Sync cursor lives in runtime.integration_sync.';

-- THE employment, and the only principal a café ever acts through.
--
-- One person, two doors. The PIN opens the till. The email+password on umi.user opens
-- the dashboard. Most staff need only the first — that is Shopify POS ("POS-only
-- staff"), Square (passcode now, invite later) and Toast (POS passcode vs Toast Web).
--
-- But BOTH doors open onto the same identity, so `user_id` is NOT NULL. A PIN-only
-- barista still gets a umi.user row, with no email and no password: they cannot log in,
-- and they do not need to. The reason is not tidiness, it is that build-v3 has already
-- decided who an actor is — runtime.operator_session requires user_id AND staff_id,
-- and audit_log.actor_user_id / elevation_grant.approved_by all point at umi.user. An
-- operator with no user row could not open a session, and no void or refund they
-- performed could be attributed to them.
--
-- What the merchant creates is therefore the EMPLOYMENT, and a umi.user comes with it.
-- What the merchant grants separately is dashboard access: set email + send an invite.
--
-- `role_id` lives HERE and not on umi.user_role, for a different reason that survives
-- the above: umi.user_role was (user, role, merchant, location) and this table is
-- (user, merchant, location). They were one table minus a column. One employment, one
-- café role; umi.user_role keeps the platform grants only.
--
-- name/phone/email are the MERCHANT's record of the employee, not the login. They are
-- deliberately not read from umi.user: umi.user has no phone at all, and one person who
-- works at two cafés would otherwise let café A rename them inside café B.
create table merchant.staff (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references merchant.merchant(id) on delete cascade,
  location_id    uuid references merchant.location(id),
  -- Always set. The row it points at may hold no email and no password (PIN-only).
  user_id      uuid not null references umi.user(id),
  role_id      uuid not null references umi.role(id),
  name         text not null,
  phone        text,
  email        text,          -- employment contact; the LOGIN address is umi.user.email
  position     text,
  hired_at     date,
  -- The merchant's switch. 'invited' is not here: that is a state of the login, and
  -- umi.user.status already holds it.
  status       text not null default 'active' check (status in ('active','disabled')),
  -- ---- Operator PIN ----------------------------------------------------------
  -- The till PIN. It is NOT a second password: the enrolled DEVICE authorizes the
  -- channel (may this terminal transact at all, at this location), and the PIN authorizes
  -- the privileged ACTION — void, refund, over-threshold discount, drawer open — and
  -- names the actor for the audit chain. The PIN itself is never stored, and never
  -- reaches the device's disk.
  --
  -- TWO columns, because they answer two different questions.
  --   operator_pin_lookup  WHO typed this? A blind index: HMAC-SHA256(pin, pepper),
  --                        with the pepper held OUTSIDE the database (app env / KMS).
  --                        Deterministic, so the row can be found from the PIN alone —
  --                        which is what lets the operator just type it, with no name
  --                        grid. A stolen database yields no PIN table, because the
  --                        pepper is not in it.
  --   operator_pin_hash    is that PIN right? Per-row salt, slow hash. Verification
  --                        only; never searched.
  operator_pin_lookup  text,
  operator_pin_salt    text,
  operator_pin_hash    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- One employment per person per café.
  unique (merchant_id, user_id),
  -- Redundant against the PK on its own. It is the TARGET of the composite FK on
  -- merchant.staff_permission_override, which is what stops an override belonging to
  -- one café from naming an employment at another. Same shape as
  -- merchant.location (merchant_id, id), used by runtime.operator_session.
  unique (merchant_id, id),
  -- Square's rule, enforced rather than hoped for: two staff at one café may not share
  -- a PIN. Without this the PIN names nobody and the audit chain has no actor.
  unique (merchant_id, operator_pin_lookup),
  constraint staff_operator_pin_lookup_ck
    check (operator_pin_lookup is null or operator_pin_lookup ~ '^[a-f0-9]{64}$'),
  constraint staff_operator_pin_hash_ck
    check (operator_pin_hash is null or operator_pin_hash ~ '^[a-f0-9]{128}$'),
  constraint staff_operator_pin_salt_ck
    check (operator_pin_salt is null or operator_pin_salt ~ '^[a-f0-9]{32}$'),
  -- A hash without its salt is unverifiable; a salt without its hash is noise; a lookup
  -- without a hash finds a row it cannot verify. All three or none.
  constraint staff_operator_pin_triple_ck
    check ((operator_pin_salt is null) = (operator_pin_hash is null)
       and (operator_pin_salt is null) = (operator_pin_lookup is null))
  -- NO "must be able to sign in" constraint. A staff member added from the dashboard has
  -- no PIN and no password yet: the merchant records the person first, then issues a PIN
  -- or sends an invitation. Such a row already names the actor on a loyalty visit, which
  -- is what most of them are for.
);
comment on table merchant.staff is
  'THE café employment. One row per person per café, always backed by a umi.user. PIN '
  'opens the till, email+password opens the dashboard, role_id is the one café grant.';
comment on column merchant.staff.operator_pin_lookup is
  'Blind index HMAC-SHA256(pin, pepper) — finds the operator from the PIN alone. The '
  'pepper lives outside the database; verification still uses operator_pin_hash.';

-- A result a role grant cannot express: a temporary allow, or a deny that must beat
-- every role the employee holds. A POS needs both — suspend ONE cashier's refund right
-- today, without touching the role everyone else shares.
--
-- It hangs on the employment, not on umi.user, for the reason the cashier makes plain:
-- the person you most need to deny is the person least likely to have an account.
--
-- RESOLUTION ORDER: deny > allow > role grant. A deny row is absolute; that is the
-- whole point of the table, so nothing here may be resolved by "most specific wins".
create table merchant.staff_permission_override (
  id             uuid primary key default gen_random_uuid(),
  merchant_id    uuid not null references merchant.merchant(id) on delete cascade,
  staff_id       uuid not null references merchant.staff(id)    on delete cascade,
  permission_id  uuid not null references umi.permission(id)    on delete cascade,
  effect         text not null check (effect in ('allow','deny')),
  expires_at     timestamptz,  -- NULL = until revoked
  granted_by     uuid references umi.user(id),
  created_at     timestamptz not null default now(),
  -- One row per (employment, permission). No scope columns: the staff row already
  -- carries the merchant and the location, so a second copy could only disagree.
  unique (staff_id, permission_id),
  -- merchant_id and staff_id are ONE fact, not two. Checked separately, both FKs are
  -- satisfied by a row that claims café A and points at an employment in café B — RLS
  -- scopes reads by merchant_id, so café A would see and manage a deny governing café
  -- B's employee. The composite key makes that row unrepresentable.
  constraint staff_permission_override_same_merchant_fk
    foreign key (merchant_id, staff_id) references merchant.staff (merchant_id, id)
      on delete cascade
);
comment on table merchant.staff_permission_override is
  'Explicit permission result for one employment. A deny always beats role grants and allows.';

-- ----------------------------------------------------------------------------
-- CUSTOMER  ·  the person  →  contact  ·  how to reach them
-- ----------------------------------------------------------------------------

create table merchant.customer (
  id             uuid primary key default gen_random_uuid(),
  merchant_id    uuid not null references merchant.merchant(id) on delete cascade,
  name           text,
  birthday       date,                       -- was born_at (a date, not a timestamp)
  loyalty_status text not null default 'active'
                   check (loyalty_status in ('active','inactive')),
  merged_into_id uuid references merchant.customer(id),   -- soft-key dedup target
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on column merchant.customer.merged_into_id is
  'Non-null = this duplicate was merged into that customer (phone is an unverified soft key).';

-- Resolve a customer to the SURVIVOR at the end of its merge chain. Reads must never
-- stop at one hop: if A was merged into B and B later into C, a single hop lands on B,
-- a row that is itself dead — the caller then stamps a card that nobody looks at.
-- Nothing writes merged_into_id yet (there is no merge flow), so the read side has to
-- be the robust one. Depth-capped: a cycle (A->B->A) can only ever be created by a bug,
-- and this must degrade to a wrong-but-terminating answer, never an infinite walk.
create or replace function merchant.customer_survivor(p_customer_id uuid) returns uuid
  language sql stable
  set search_path = pg_catalog as $$
  with recursive walk(id, merged_into_id, depth) as (
    select c.id, c.merged_into_id, 0
      from merchant.customer c where c.id = p_customer_id
    union all
    select c.id, c.merged_into_id, w.depth + 1
      from walk w
      join merchant.customer c on c.id = w.merged_into_id
     where w.merged_into_id is not null and w.depth < 16
  )
  select id from walk order by depth desc limit 1;
$$;

create table merchant.contact (
  id                uuid primary key default gen_random_uuid(),
  merchant_id       uuid not null references merchant.merchant(id) on delete cascade,
  customer_id       uuid not null references merchant.customer(id) on delete cascade,
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
    check (not verified or verified_via = 'whatsapp_inbound'),
  -- P0-9. The database half of contact dedup. `identity.resolver.ts:128` takes a
  -- pg_advisory_xact_lock keyed on (merchant_id, normalized value) before it
  -- looks up and before it creates, and that lock is the ONLY thing preventing a
  -- duplicate contact today. It works — the race is not reproducible on either
  -- live path — but it is application-only, no constraint backs it, and
  -- security_gate.sql has no check for it.
  --
  -- ⚠ The key INCLUDES channel_id, and that is not a detail. A single E.164
  -- deliberately reaches across `phone`, `whatsapp` and `sms`
  -- (`identity.resolver.ts:118-121`), so one customer legitimately holds several
  -- rows with the same normalized_value and different channel_id. A unique key on
  -- (merchant_id, normalized_value) alone would REJECT those valid rows and break
  -- getReplyContext. Work item 19 proposed exactly that shape; it is wrong.
  --
  -- NULL normalized_value stays uncovered — Postgres treats NULLs as distinct —
  -- so the advisory lock is still load-bearing for the unnormalizable path.
  -- Measured against the loaded target: 0 violations.
  constraint contact_dedup_uq unique (merchant_id, channel_id, normalized_value)
);
comment on table  merchant.contact is
  'Reachability per channel. NOT uniquely keyed on phone — umi-cash collects an UNVERIFIED '
  'phone (SMS verification disabled, too costly in MX), so numbers are a soft identifier.';
comment on column merchant.contact.verified is
  'true only when proven (verified_via=whatsapp_inbound). Gates who is safe to proactively message.';
create index contact_lookup_idx on merchant.contact (merchant_id, normalized_value);

create table merchant.customer_fact (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references merchant.merchant(id) on delete cascade,
  customer_id  uuid not null references merchant.customer(id) on delete cascade,
  source       text not null default 'preferences'
                 check (source in ('preferences','staff')),
  key          text not null,            -- fact name: 'usual', 'allergies', 'birthday_month'…
  value        jsonb not null,           -- fact value (string or list); jsonb for round-trip fidelity
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (merchant_id, customer_id, source, key)
);
comment on table merchant.customer_fact is
  'The CDP knowledge atom: durable AI-remembered facts about a customer (usuals, allergies, '
  '"birthday in March"). Renamed + reshaped from customer_note, whose ONLY consumer was this '
  'facts path; the order note it was confused with lives on customer_order.notes. Customer 360 '
  'reads it as "memory". source=''staff'' is reserved for future staff-authored facts (no writer yet).';

-- ----------------------------------------------------------------------------
-- LOYALTY
-- ----------------------------------------------------------------------------

create table merchant.loyalty_program (
  merchant_id             uuid primary key references merchant.merchant(id) on delete cascade,
  card_prefix             text,
  topup_enabled           boolean not null default false,  -- does this café sell stored value (Saldo)?
  stamps_per_reward       integer,                          -- e.g. 8 visits -> 1 reward
  -- Can staff give more than one stamp in one action?
  -- This is the catch-up path for a customer from an external loyalty system.
  -- It is the only writer that creates a visit worth more than one stamp.
  --
  -- The column is typed, because build-v3 has no branding jsonb. See the owner
  -- call below. Production holds this value in `loyalty.programs.branding`, as a
  -- JSON key. The backfill must carry it.
  --
  -- A cafe that had the flag ON must not arrive with it OFF. That cafe loses the
  -- catch-up path, and its migrated cards are the cards that need a correction.
  -- The default is false, because OFF is the safe direction.
  --
  -- READ BY umi-api since 2026-08-17: `cash-scan.repository.merchantConfig` selects
  -- it and `CashScanService.seals` refuses the credit when it is false. A café that
  -- arrives with the flag OFF loses the catch-up path — so the backfill carrying
  -- `loyalty.programs.branding` still decides whether the gate opens for the cafés
  -- that had it. (umi-cash reads the branding key and stays frozen until cutover.)
  multi_seal_enabled      boolean not null default false,
  birthday_reward_enabled boolean not null default false,
  birthday_reward_name    text,
  self_registration       boolean not null default false,  -- may a customer self-enrol (no staff)?
  -- Wallet-pass presentation (read by the Apple/Google pass renderer + the registration page).
  -- Typed, not a branding jsonb junk-drawer (owner call, 2026-07-25).
  pass_style              text,
  primary_color           text,
  secondary_color         text,
  logo_url                text,
  strip_image_url         text,
  promo_message           text,
  promo_starts_at         timestamptz,
  promo_ends_at           timestamptz,
  promo_days              text,        -- e.g. 'mon,tue,wed' (the days a promo shows)
  -- Nested per-moment copy templates (escalating reward reminders), keyed by lifecycle
  -- journey. Honest jsonb — genuinely variable structured config, not a flat field.
  lifecycle_copy          jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
comment on table merchant.loyalty_program is
  '1:1 loyalty config + wallet-pass presentation for a café (was loyalty_settings).';

create table merchant.loyalty_card (
  id                   uuid primary key default gen_random_uuid(),
  merchant_id          uuid not null references merchant.merchant(id) on delete cascade,
  customer_id          uuid not null references merchant.customer(id) on delete cascade,
  card_number          text,          -- human-facing loyalty number (displayed)
  qr_token             text,          -- rotatable SCAN secret; distinct from card_number (a scan re-rolls it)
  qr_issued_at         timestamptz,
  lifecycle_message    text,          -- the wallet "moment" copy (reward reminders) shown on the pass
  lifecycle_message_at timestamptz,
  status               text not null default 'active' check (status in ('active','blocked')),
  issued_at            timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (merchant_id, card_number),
  unique (merchant_id, qr_token)
);
comment on table merchant.loyalty_card is
  'IDENTITY + scan/pass state. No cached BALANCE or VISIT count — those DERIVE from the '
  'ledger/visits. qr_token is the rotatable scan secret; lifecycle_message is the last '
  'wallet moment copy (written on scan, read by the pass).';

create table merchant.loyalty_stored_value_ledger (
  id               uuid primary key default gen_random_uuid(),
  merchant_id      uuid not null references merchant.merchant(id) on delete cascade,
  card_id          uuid not null references merchant.loyalty_card(id) on delete cascade,
  delta            bigint not null,                 -- centavos; +topup / -purchase
  reason           text not null
                     check (reason in ('migration_initial_balance','topup','purchase',
                                       'adjustment','gift_card_redeem','refund')),
  idempotency_key  text,
  staff_id         uuid references merchant.staff(id),
  external_ref     text,                            -- Zettle payment uuid (was in metadata)
  -- The sale this money movement belongs to. Same reasoning as loyalty_visit.order_id:
  -- a balance that moved for a reason nobody can name is not auditable. NULL for a
  -- top-up at the counter or a migration row, which have no order.
  -- FK added below, after merchant.customer_order exists (forward reference in this file).
  order_id         uuid,
  note             text,
  occurred_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (merchant_id, idempotency_key)
);
create index loyalty_ledger_order_idx
  on merchant.loyalty_stored_value_ledger (merchant_id, order_id) where order_id is not null;
comment on table merchant.loyalty_stored_value_ledger is
  'MONEY (Saldo). balance = SUM(delta). Append-only. Was misnamed card_ledger.';
create trigger stored_value_ledger_append_only
  before update or delete on merchant.loyalty_stored_value_ledger
  for each row execute function merchant.tg_append_only();

create table merchant.loyalty_visit (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references merchant.merchant(id) on delete cascade,
  card_id      uuid not null references merchant.loyalty_card(id) on delete cascade,
  location_id    uuid references merchant.location(id),
  staff_id     uuid references merchant.staff(id),
  -- 'migration' is GONE. It existed only to label the synthetic rows that the
  -- backfill invented to make count(*) come out right, and those rows are gone
  -- too (backfill_loyalty_v3.sql §6b, deleted). A source value whose only job is
  -- to bless a fabrication should not survive the fabrication.
  -- 'manual_bulk' is the catch-up path: staff crediting several stamps at once
  -- for a customer who arrived from an external loyalty system.
  source       text not null default 'scan'
                 check (source in ('scan','manual','manual_bulk','pos')),
  -- HOW MANY STAMPS THIS ROW IS WORTH.
  --
  -- A row is not a magnitude. The table used to say "Stamp count = count(*)",
  -- and that was true only while every interaction was worth exactly one stamp.
  -- It never was: the "Agregar sellos" catch-up path credits up to 50 at once,
  -- and production holds 28 such events carrying 115 stamps across 22 cards.
  --
  -- Without this column the backfill had to choose between losing those stamps
  -- and inventing rows to replace them. It invented them — 87 rows stamped at
  -- `card.created_at`, one card receiving 15 visits at a single microsecond —
  -- which balanced the total and destroyed the history. Measured cost of the
  -- other choice: 18 Kalala customers lose 87 stamps, worst card 20 -> 5. The
  -- customer sees that on her own phone, and no gate reports it.
  --
  -- With it the merchant can answer BOTH questions for the first time:
  --   "how many times did she come in?"  -> count(*)          (537)
  --   "how many stamps does she hold?"   -> sum(stamps)       (624)
  -- Reward maths reads sum(stamps). Streaks and recency read count(*) and
  -- occurred_at — one bulk credit was one real interaction, not nine visits.
  stamps       smallint not null default 1 check (stamps between 1 and 50),
  -- Why the staff member credited them. Carried from loyalty.visit_events.note.
  note         text,
  -- Makes a retried catch-up credit idempotent. The umi-cash bulk-seal endpoint
  -- already mints one per action; carrying it keeps the guarantee across cutover.
  idempotency_key text,
  -- WHAT THE STAMP BOUGHT. Until this column existed a visit knew that someone came in
  -- and nothing about what they purchased, so no reward could ever depend on spend and
  -- no basket could ever be attributed to a member. A POS sale writes the order here in
  -- the same transaction that mints the stamp. NULL for every non-POS source: a scan at
  -- the counter has no order behind it, and inventing one would be a lie.
  -- FK added below, after merchant.customer_order exists (forward reference in this file).
  order_id     uuid,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
-- "Which visits came from a sale, newest first" — the attribution read.
create index loyalty_visit_order_idx on merchant.loyalty_visit (merchant_id, order_id)
  where order_id is not null;
-- One row per INTERACTION, carrying its magnitude. Stamp count = sum(stamps),
-- never count(*) and never a cached column. count(*) answers a different and
-- also useful question — how many times the customer came in.
comment on table merchant.loyalty_visit is
  'One row per interaction. Stamps = sum(stamps); visits = count(*). Never a cached column.';
comment on column merchant.loyalty_visit.stamps is
  'Stamps this interaction is worth. 1 for a scan; up to 50 for a manual_bulk catch-up.';
-- Idempotency is per merchant, not global: two cafés may retry unrelated actions
-- that happen to mint the same key. Partial, because most rows carry no key.
create unique index loyalty_visit_idem_uq
  on merchant.loyalty_visit (merchant_id, idempotency_key)
  where idempotency_key is not null;

create table merchant.loyalty_reward (
  id               uuid primary key default gen_random_uuid(),
  merchant_id      uuid not null references merchant.merchant(id) on delete cascade,
  name             text not null,
  description      text,      -- café-authored copy for the reward (umi-cash reward config)
  type             text not null
                     check (type in ('stamps_free_item','spend_cashback','birthday','manual')),
  stamps_required  integer,   -- for type='stamps_free_item'
  spend_required   bigint,    -- centavos, for type='spend_cashback'
  value            bigint,    -- reward value in centavos where applicable
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table merchant.loyalty_reward is
  'The rewards a café offers (was reward_rule). "birthday" is a TYPE here, not a separate table.';

create table merchant.loyalty_redemption (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references merchant.merchant(id) on delete cascade,
  card_id      uuid not null references merchant.loyalty_card(id) on delete cascade,
  reward_id    uuid references merchant.loyalty_reward(id),
  reason       text not null check (reason in ('stamps','birthday','manual')),
  value        bigint,        -- centavos granted
  staff_id     uuid references merchant.staff(id),
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
comment on table merchant.loyalty_redemption is
  'A reward was consumed (the event). Birthday once-per-year is enforced by the app/a partial unique.';

-- A per-card BIRTHDAY entitlement, distinct from loyalty_reward (the rule) and from
-- loyalty_redemption (the stamp-claim event): it has a PENDING state (issued, unclaimed,
-- with an expiry window) that an event cannot hold. The scan checks for an active grant
-- (a cheap card_id lookup — it never reads the birthday), the lifecycle journey reminds
-- on grants about to expire, and a claim flips status -> 'redeemed'. Deliberately NOT a
-- loyalty_redemption row: birthday claims would corrupt the stamp-reward count (pending =
-- floor(visits/n) - COUNT(redemption)). ISSUANCE (reading the birthday, once/day) is the
-- legacy umi-cash wallet-push cron, not yet ported — this table is only read/redeemed here.
create table merchant.loyalty_birthday_grant (
  id          uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete cascade,
  card_id     uuid not null references merchant.loyalty_card(id) on delete cascade,
  year        integer not null,          -- the birthday year this grant is for
  status      text not null default 'active' check (status in ('active','redeemed','expired')),
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  redeemed_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (merchant_id, card_id, year)     -- one birthday grant per card per year
);
create index loyalty_birthday_grant_active_idx
  on merchant.loyalty_birthday_grant (merchant_id, card_id)
  where status = 'active';

create table merchant.loyalty_gift_card (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references merchant.merchant(id) on delete cascade,
  code         text not null,
  status       text not null default 'active' check (status in ('active','redeemed','void')),
  issued_at    timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (merchant_id, code)
);

create table merchant.loyalty_gift_card_ledger (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchant.merchant(id) on delete cascade,
  gift_card_id  uuid not null references merchant.loyalty_gift_card(id) on delete cascade,
  delta         bigint not null,   -- centavos
  reason        text not null check (reason in ('issue','redeem','adjustment')),
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create trigger gift_card_ledger_append_only
  before update or delete on merchant.loyalty_gift_card_ledger
  for each row execute function merchant.tg_append_only();

create table merchant.loyalty_wallet_pass (
  id                 uuid primary key default gen_random_uuid(),
  card_id            uuid not null references merchant.loyalty_card(id) on delete cascade,
  platform           text not null check (platform in ('apple','google')),
  external_object_id text,          -- Google object id / Apple serial
  -- Apple's `authenticationToken`. It is SIGNED INTO the .pkpass at generation
  -- (pass-apple.ts:117) and sent back on every web-service call as
  -- `Authorization: ApplePass <token>`. The server must hold the SAME value or the
  -- call is refused, so this CANNOT be regenerated for a pass already on a phone —
  -- the copy in the customer's Wallet is immutable. Carry it verbatim at cutover.
  -- Null for Google, which pushes updates and never calls back.
  -- It is a bearer secret: column-locked away from the request path in 90_rls.
  web_service_token  text,
  status             text not null default 'active' check (status in ('active','removed')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (card_id, platform)
);
-- The web service authenticates by (serial, token) with no session and no merchant
-- context — Apple knows neither. This is the lookup that call makes.
create unique index loyalty_wallet_pass_apple_serial_uidx
  on merchant.loyalty_wallet_pass (external_object_id)
  where platform = 'apple' and external_object_id is not null;

-- ----------------------------------------------------------------------------
-- COMMERCE  (generic — no "menu")
-- ----------------------------------------------------------------------------

create table merchant.product_category (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchant.merchant(id) on delete cascade,
  name          text not null,
  display_order integer not null default 0,
  created_at    timestamptz not null default now()
);
-- The catalog sync gets-or-creates a category BY NAME on every run. build-v2 keyed
-- that on a slug column (`key`) which build-v3 correctly does not have — the name is
-- the identity. Without this, the upsert has no conflict target and a re-sync forks
-- a second "Bebidas". 0 duplicate (merchant_id, name) pairs in the source.
create unique index product_category_merchant_name_uidx
  on merchant.product_category (merchant_id, name);

create table merchant.product (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references merchant.merchant(id) on delete cascade,
  category_id  uuid references merchant.product_category(id),
  name         text not null,
  description  text,
  price        bigint not null default 0,   -- centavos
  active       boolean not null default true,
  external_ref text,                          -- Zettle product id when synced
  -- ---- Till identity and tax ---------------------------------------------------
  sku          text,   -- the café's own code, typed or searched at the terminal
  barcode      text,   -- what the scanner reads; distinct from sku on purpose
  -- Basis points, not a percent: 16% IVA is 1600 and stays an integer through every
  -- total. A float tax rate is how receipts end a centavo apart from the ledger.
  tax_rate_basis_points integer not null default 0
                 check (tax_rate_basis_points between 0 and 10000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- Scanning a barcode must resolve to exactly one product, or the till has to ask the
-- cashier which one — which is not a thing a queue tolerates.
create unique index product_merchant_sku_uidx
  on merchant.product (merchant_id, sku) where sku is not null;
create unique index product_merchant_barcode_uidx
  on merchant.product (merchant_id, barcode) where barcode is not null;
-- The Zettle sync identifies a product by its external id. build-v2 kept that in
-- `metadata->>'zettle_uuid'` with no constraint, so the sync had to SELECT-then-write
-- and two concurrent runs could both miss and both INSERT. external_ref is the typed
-- home; this makes the upsert atomic. Partial: hand-created products have no ref.
-- 136/136 source products carry one, with 0 duplicates.
create unique index product_external_ref_uidx
  on merchant.product (merchant_id, external_ref)
  where external_ref is not null;
comment on column merchant.product.price is
  'Centavos. Name embeddings live in runtime.product_embedding, not here.';

create table merchant.product_option_group (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references merchant.product(id) on delete cascade,
  name        text not null,
  min_select  integer not null default 0,
  max_select  integer,
  created_at  timestamptz not null default now()
);

create table merchant.product_modifier (
  id              uuid primary key default gen_random_uuid(),
  option_group_id uuid not null references merchant.product_option_group(id) on delete cascade,
  name            text not null,
  price_delta     bigint not null default 0,   -- centavos
  created_at      timestamptz not null default now()
);

create table merchant.product_location_availability (
  product_id  uuid not null references merchant.product(id) on delete cascade,
  location_id   uuid not null references merchant.location(id) on delete cascade,
  -- ONE availability column. This replaced a boolean `available`, because "not
  -- available" turned out to be four different answers the till has to show
  -- differently: 86'd until tomorrow, not on this location's menu at all, disabled by
  -- the owner, or not on sale yet. A boolean plus a reason column would be the same
  -- fact in two places.
  status      text not null default 'enabled'
                check (status in ('enabled','disabled','temporarily_unavailable',
                                  'out_of_assortment','future_availability')),
  available_from timestamptz,   -- only meaningful with status='future_availability'
  updated_at  timestamptz not null default now(),
  primary key (product_id, location_id),
  constraint product_availability_future_ck
    check ((status = 'future_availability') = (available_from is not null))
);
comment on table merchant.product_location_availability is
  'Per-location "86''d" state. Absent row = available (default).';

-- ----------------------------------------------------------------------------
-- MESSAGING  (channel_account dissolved: customer reach = contact, sender = integration)
-- ----------------------------------------------------------------------------

create table merchant.conversation (
  id              uuid primary key default gen_random_uuid(),
  merchant_id     uuid not null references merchant.merchant(id) on delete cascade,
  customer_id     uuid references merchant.customer(id),
  channel_id      uuid not null references umi.channel_type(id),
  status          text not null default 'open' check (status in ('open','closed')),
  outcome         text check (outcome in ('converted','abandoned','resolved','unresolved')),
  external_ref    text,
  summary         text,        -- rolling working-memory summary of older messages (bot short-term memory)
  started_at      timestamptz not null default now(),
  last_message_at timestamptz,
  created_at      timestamptz not null default now()
);

create table merchant.message (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references merchant.conversation(id) on delete cascade,
  direction           text not null check (direction in ('inbound','outbound')),
  sender              text not null check (sender in ('customer','bot','staff','system')),
  body                text,
  provider_message_id text,   -- Twilio SID etc. (was buried in metadata)
  delivery_status     text check (delivery_status in ('queued','sent','delivered','read','failed')),
  occurred_at         timestamptz not null default now(),
  created_at          timestamptz not null default now()
);
comment on column merchant.message.body is 'Body embeddings live in runtime.message_embedding, not here.';
-- provider_message_id (Twilio SID) is the crash-safe ingress idempotency key: the user-message
-- INSERT catches this unique violation to drop a re-delivered webhook. runtime.inbound_event is
-- only an observability gate (written before the work), so it cannot be the authoritative dedup.
create unique index message_provider_message_id_uidx
  on merchant.message (provider_message_id) where provider_message_id is not null;

create table merchant.knowledge_document (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references merchant.merchant(id) on delete cascade,
  title        text not null,
  source       text,
  uri          text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table merchant.knowledge_chunk (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references merchant.knowledge_document(id) on delete cascade,
  ordinal      integer not null,
  body         text not null,
  created_at   timestamptz not null default now(),
  unique (document_id, ordinal)
);

-- ----------------------------------------------------------------------------
-- ORDERS
-- ----------------------------------------------------------------------------

create table merchant.customer_order (
  id               uuid primary key default gen_random_uuid(),
  merchant_id      uuid not null references merchant.merchant(id) on delete cascade,
  location_id        uuid references merchant.location(id),
  customer_id      uuid references merchant.customer(id),      -- null = anonymous walk-in
  conversation_id  uuid references merchant.conversation(id),  -- set when the order came from a chat
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
  -- WHICH TRADING DAY THIS SALE BELONGS TO. Derived by merchant.tg_business_date from
  -- placed_at, the merchant timezone and merchant.business_day_start — never supplied
  -- by a caller, because a till whose clock has drifted must not be able to move a sale
  -- into yesterday.
  --
  -- Without this column the POS and the order cluster answer "what did we sell today?"
  -- differently: pos_cart, receipt_snapshot and the cash-up all carry a business_date,
  -- while an order carried only placed_at, so a 23:40 sale is today on the receipt and
  -- yesterday in a placed_at report. That disagreement is silent, which is why it is a
  -- column and not a convention.
  business_date    date not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
  -- NOTE: no stored `total`. The order's working/owed total is DERIVED (Σ live
  -- lines) via merchant.order_total below — it cannot drift and self-heals on a
  -- void. Money-truth for a settled order lives on merchant.payment, not here.
);
comment on column merchant.customer_order.notes is
  'Order-level note captured at checkout. This is the NAMED column ORDER_MODEL.md §5 sanctions '
  '("add a named customer_order.notes when a real consumer earns it") — NOT a revived free-text '
  'blob. Both ends exist today: the WhatsApp checkout writes it, and the FROZEN iPad KDS ticket '
  'renders it to the barista as `customer_note`. Per-line customization belongs on '
  'order_item.notes; a lasting customer preference belongs on merchant.customer_fact.';
comment on column merchant.customer_order.pickup_person is
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
-- ORIGIN IDENTITY, not a retry key. `external_ref` answers "which record is this in
-- the system the order came FROM" (a Zettle payment id, an aggregator's order number),
-- and it is unique per merchant because one source record is one order.
--
-- It is NOT the idempotency key, though it was pressed into service as one when the
-- WhatsApp checkout turned out to be a live injection path with nothing to ON CONFLICT
-- against. With a second writer that overload breaks down: two injection paths would
-- have to agree on a namespace for a column that means "their id, not ours", and a
-- retry key must be chosen by the CALLER before the call, which an origin id is not.
--
-- Retry identity lives in merchant.business_command — `unique (merchant_id,
-- idempotency_key)` plus a request fingerprint, so a replay with a different body is a
-- conflict rather than a second charge. Order writes go through it.
create unique index customer_order_external_ref_uidx
  on merchant.customer_order (merchant_id, external_ref)
  where external_ref is not null;

create table merchant.order_item (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references merchant.customer_order(id) on delete cascade,
  product_id    uuid references merchant.product(id),
  name          text not null,              -- snapshot at order time
  variant_name  text,                       -- the CHOSEN variant, snapshot ("Grande", "Oat milk")
  quantity      integer not null default 1 check (quantity > 0),
  unit_price    bigint not null default 0 check (unit_price >= 0),  -- centavos, snapshot (final, incl. chosen modifiers)
  display_order integer not null default 0, -- the line's position on the ticket
  -- WHERE THIS LINE IS PREPARED. Deferred until "a second station + real routing
  -- exist" — the POS is that condition. A KDS device could infer its station from the
  -- device login because the device IS a station; a POS rings up a latte (bar) and a
  -- panini (grill) on one ticket, away from either, so the routing has to live on the
  -- line. The §2 grain ruling always said it belonged here.
  station_id    uuid references merchant.station(id),
  voided_at     timestamptz,                -- void tombstone; a live line = voided_at IS NULL
  void_reason   text,                       -- why: mistake · duplicate · customer_changed · test
  notes         text,
  created_at    timestamptz not null default now(),
  -- a reason is meaningless without a void (the reverse is allowed: a historical/
  -- unattributed void may have no reason — the backfill carries exactly that).
  constraint order_item_reason_needs_void check (void_reason is null or voided_at is not null),
  -- A COMP IS NOT A VOID. The interim convention was `voided_at` + void_reason='comp',
  -- which was harmless while nothing tracked stock. It stops being harmless the moment
  -- inventory is real: a VOID returns the item to stock because it was never made, a
  -- COMP does not because you served it and ate the cost. Encoding both as a void makes
  -- a free-text reason load-bearing for inventory. A comp is a 100%-off discount and
  -- now lives in merchant.order_discount, exactly as ORDER_MODEL §3 describes it.
  constraint order_item_comp_is_not_a_void
    check (void_reason is null or lower(void_reason) <> 'comp')
);
create index order_item_station_idx on merchant.order_item (station_id)
  where station_id is not null and voided_at is null;
create index merchant_order_item_order_idx on merchant.order_item (order_id);
comment on column merchant.order_item.name is
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
comment on column merchant.order_item.variant_name is
  'The chosen variant, snapshot at order time. Read by the frozen iPad ticket and by the '
  'reorder re-pricer, which matches it against the live catalog — so it is its own column, '
  'never folded into notes.';
comment on column merchant.order_item.display_order is
  'Line position on the ticket, 0-based. Carried, not derived: source insert timestamps tie '
  'within an order, so any derived ordinal falls back to random uuid order.';
comment on column merchant.order_item.voided_at is
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
-- owner must see (same append-only stance merchant.tg_append_only enforces on the money
-- ledgers, which likewise block delete despite an on-delete-cascade parent).
create or replace function merchant.tg_order_item_void_only() returns trigger
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
  before update or delete on merchant.order_item
  for each row execute function merchant.tg_order_item_void_only();

-- ONE place increments the version: any update of the order row, whatever caused it.
-- The order_item trigger below therefore does not increment directly — it touches the
-- parent and lets this fire, so a line change cannot double-bump.
create or replace function merchant.tg_customer_order_version() returns trigger
  language plpgsql
  set search_path = pg_catalog as $$
begin
  new.version := old.version + 1;
  return new;
end $$;
create trigger customer_order_version
  before update on merchant.customer_order
  for each row execute function merchant.tg_customer_order_version();

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
create or replace function merchant.tg_order_item_signal_change() returns trigger
  language plpgsql
  set search_path = pg_catalog as $$
declare
  has_events boolean;
begin
  select exists (select 1 from merchant.order_event e where e.order_id = new.order_id)
    into has_events;
  if not has_events then
    return null;                      -- initial assembly, not an amendment
  end if;
  -- Touch the parent: bumps version via customer_order_version, and updated_at via the
  -- shared touch trigger. Not an increment here — see above.
  update merchant.customer_order set updated_at = now() where id = new.order_id;
  insert into merchant.order_event (order_id, kind) values (new.order_id, 'order_upserted');
  return null;                        -- AFTER trigger; return value is ignored
end $$;
create trigger order_item_signal_change
  after insert or update on merchant.order_item
  for each row execute function merchant.tg_order_item_signal_change();

create table merchant.order_event (
  id          uuid primary key default gen_random_uuid(),
  sequence    bigint generated always as identity,
  order_id    uuid not null references merchant.customer_order(id) on delete cascade,
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
  staff_id    uuid references merchant.staff(id),
  occurred_at timestamptz not null default now(),
  -- A transition without a status is meaningless; an upsert with one is a lie. Making
  -- the pairing a constraint means a consumer can trust `kind` without re-checking.
  constraint order_event_status_matches_kind
    check ((kind = 'status_changed') = (status is not null))
);
comment on table merchant.order_event is
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
create index merchant_order_event_sequence_idx on merchant.order_event (sequence);
comment on column merchant.order_event.sequence is
  'Monotonic cursor for incremental polling (frozen KDS `after_sequence`). Ordering only — '
  'gaps are expected and meaningless; never treat it as a count.';

create table merchant.payment (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references merchant.customer_order(id) on delete cascade,
  amount       bigint not null,   -- centavos
  method       text not null check (method in ('cash','card','stored_value','gift_card')),
  external_ref text,               -- Zettle payment uuid
  status       text not null default 'captured'
                 check (status in ('pending','captured','failed')),
  paid_at      timestamptz,
  created_at   timestamptz not null default now()
);

create table merchant.refund (
  id          uuid primary key default gen_random_uuid(),
  payment_id  uuid not null references merchant.payment(id) on delete cascade,
  amount      bigint not null,   -- centavos
  reason      text,
  refunded_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- ---- Applied discounts, comps and promos ----------------------------------
-- The FACT that a discount was applied, not the RULE that decided it. The rule engine
-- (promo definitions, eligibility, stacking) stays deferred exactly as ORDER_MODEL says
-- — but the facts cannot wait, because @umi/contract already declares DiscountPreview
-- and DiscountBreakdown on every cart and checkout total, and a receipt has to print
-- what was taken off. Until this table existed the contract described money the schema
-- could not store.
--
-- A COMP is the 100%-off case, per ORDER_MODEL §3 ("a comp is really a 100 %-off
-- discount"), and it is always line-level: you comp a dish, not an order.
create table merchant.order_discount (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchant.merchant(id) on delete cascade,
  order_id      uuid not null references merchant.customer_order(id) on delete cascade,
  -- NULL = the discount applies to the whole order; set = to this one line.
  order_item_id uuid references merchant.order_item(id) on delete cascade,
  kind          text not null check (kind in ('discount','comp','promo')),
  code          text not null,     -- machine key, mirrors DiscountPreview.entries[].code
  label         text not null,     -- what the receipt prints
  -- The magnitude REMOVED from the total, always positive. Storing a signed value here
  -- invites a sign error in the one place a sign error is a refund.
  amount        bigint not null check (amount > 0),
  reason        text,              -- free text for a comp: "wrong order, remade"
  authorized_by uuid references umi.user(id),   -- who approved it; a comp needs a name
  created_at    timestamptz not null default now(),
  constraint order_discount_comp_is_line_level
    check (kind <> 'comp' or order_item_id is not null)
);
create index order_discount_order_idx on merchant.order_discount (order_id);
comment on table merchant.order_discount is
  'Applied discount FACTS (incl. comps as the 100%-off case). The promo RULE engine is '
  'still deferred; this is what a receipt prints and what a total subtracts.';

-- ---- Per-modifier money breakdown ------------------------------------------
-- Deferred until "a receipt needs \'$4 latte + $0.50 oat\' split out". A POS receipt
-- does. The POS already models this at cart grain in merchant.pos_cart_line_modifier;
-- without this table the breakdown collapses into order_item.unit_price at commit and
-- survives only inside receipt_snapshot.snapshot jsonb — money structure demoted to a
-- blob the moment it becomes money.
create table merchant.order_item_modifier (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchant.merchant(id) on delete cascade,
  order_item_id uuid not null references merchant.order_item(id) on delete cascade,
  -- Snapshots, like the line itself: renaming a modifier tomorrow must not rewrite a
  -- receipt printed today. The catalog refs are for analytics, and may go NULL.
  modifier_id   uuid references merchant.product_modifier(id) on delete set null,
  name          text not null,
  quantity      integer not null default 1 check (quantity > 0),
  price_delta   bigint not null,   -- centavos, signed: a modifier can subtract
  created_at    timestamptz not null default now()
);
create index order_item_modifier_line_idx on merchant.order_item_modifier (order_item_id);
comment on table merchant.order_item_modifier is
  'The receipt-level split of a line price. order_item.unit_price stays the line total; '
  'this explains it.';

-- ---- Sale → loyalty. The link the whole POS project exists to create. ----
-- Declared here rather than on the columns because the loyalty cluster is defined
-- earlier in this file than the order cluster. `on delete set null`: deleting an order
-- must never delete the stamp a customer earned — they still came in, they still
-- bought something, and the reward they are owed does not evaporate.
alter table merchant.loyalty_visit
  add constraint loyalty_visit_order_fk
  foreign key (order_id) references merchant.customer_order(id) on delete set null;
alter table merchant.loyalty_stored_value_ledger
  add constraint loyalty_ledger_order_fk
  foreign key (order_id) references merchant.customer_order(id) on delete set null;

-- ----------------------------------------------------------------------------
-- DERIVED: order projections (see ORDER_MODEL.md §1, §4)
-- The order carries no stored total and the "ticket" is not a KDS-private query:
-- both are VIEWS so there is one definition and it cannot drift. security_invoker
-- so the caller's RLS is enforced on the base tables (an owner-rights view would
-- leak every café's orders to any api session — the audit's cross-merchant leak).
-- ----------------------------------------------------------------------------

-- Working / owed total: Σ live lines (voided_at IS NULL), per order, ANY status.
-- CONTRACT: this is the *value of an order's live lines*, and its meaning depends on
-- the status you read it with — for an OPEN order it is what is OWED (self-heals as
-- lines are voided); for a completed order it is what was transacted; for a canceled
-- order it is notional value that did NOT convert (no cash moved). It is deliberately
-- NOT zeroed for canceled orders (the source keeps that value; the backfill reconciles
-- against it). It is NOT revenue — never sum it across statuses; revenue aggregates
-- merchant.payment. Consumers wanting "owed right now" filter to open orders (as
-- order_ticket does).
-- Gross of live lines, minus applied discounts. The two halves are summed in separate
-- subqueries rather than one join: joining both children to the order multiplies the
-- rows, and an order with two lines and one discount would count the discount twice.
create view merchant.order_total with (security_invoker = true) as
  select o.id          as order_id,
         o.merchant_id,
         coalesce(li.gross, 0)::bigint                          as gross,
         coalesce(di.discount, 0)::bigint                       as discount,
         (coalesce(li.gross, 0) - coalesce(di.discount, 0))::bigint as total
    from merchant.customer_order o
    left join lateral (
      select sum(i.unit_price * i.quantity) as gross
        from merchant.order_item i
       where i.order_id = o.id and i.voided_at is null
    ) li on true
    left join lateral (
      -- A discount attached to a VOIDED line falls out with the line. Without this a
      -- comped item that is then voided keeps subtracting money from an order that no
      -- longer contains it, and the total goes negative. Same self-healing property the
      -- gross sum has: amend the order and the derivation follows.
      --
      -- An ORDER-level discount is not filtered — it applies to the order, not a line.
      -- If it exceeds the remaining gross the total goes negative, and that is left
      -- VISIBLE on purpose: it means the pricing path allowed a discount larger than the
      -- bill, which is a service bug worth seeing rather than a number worth clamping.
      select sum(d.amount) as discount
        from merchant.order_discount d
        left join merchant.order_item i on i.id = d.order_item_id
       where d.order_id = o.id
         and (d.order_item_id is null or i.voided_at is null)
    ) di on true;

-- THE TICKET — one live projection of an order, and the only one.
--
-- There were briefly two (a line-grain `order_ticket` and an order-grain `kds_ticket`).
-- That was a defect inside the database, not a client concern: two renderings of ONE
-- concept drift, and §1's whole argument is that the ticket is defined once. The shape
-- kept is the one the domain calls for and consumers actually need — ORDER grain with
-- its lines nested, because a ticket IS an order with its lines.
--
-- No status filter. "Live" is a WHERE clause, not a schema fact: the KDS board asks for
-- in-flight statuses, the dashboard's history list asks for a status + window, and both
-- are the same projection read with different predicates. Baking the filter in is what
-- forced a second view.
--
-- Voided lines are INCLUDED (`voided_at` set) so the KDS renders them struck through —
-- a fired-then-voided line must be SEEN, not vanish, or the barista keeps pouring
-- (ORDER_MODEL §3; Toast marks them VOIDED for the same reason).
--
-- NO ORDER TOTAL. A total is a money question, and money has two different answers:
-- `order_total` for what is owed right now, `payment`/`refund` for what was charged.
-- Putting either on the ticket invites a settled surface to re-derive its money from
-- live lines, which silently rewrites what a customer was charged (§4). The LINE keeps
-- its `unit_price` — that is a snapshot FACT of the order_item row, and whether a screen
-- renders it is the client's decision, not the schema's.
--
-- NO STATION, NO FROZEN-CLIENT PADDING. The order carries no station (§5) and the KDS
-- scopes by the device's paired station at query time. Anything a specific client needs
-- in a specific shape — a non-optional field coalesced, a null column it expects to
-- exist — belongs in that client's adapter in the backend, never here.
--
-- Both derived columns are SCALAR SUBQUERIES, not joins, and that is measured: Postgres
-- prunes an unused subquery from the target list (a header-only read plans with no
-- SubPlan at all) but does NOT prune a LEFT JOIN to an aggregating view. So a consumer
-- that wants only the header pays nothing for the lines.
create view merchant.order_ticket with (security_invoker = true) as
  select o.id            as ticket_id,
         o.merchant_id,
         o.location_id,
         o.customer_id,
         o.conversation_id,
         o.source,
         o.fulfillment_type,
         o.status,
         o.cancel_reason,
         o.notes,
         o.pickup_person,
         o.external_ref,
         o.version,
         o.placed_at,
         o.created_at,
         o.updated_at,
         -- The puller's cursor: the highest change this ticket has emitted.
         coalesce((select max(e.sequence)
                     from merchant.order_event e
                    where e.order_id = o.id), 0)          as last_event_sequence,
         coalesce((select jsonb_agg(jsonb_build_object(
                            'item_id',       i.id,
                            'name',          i.name,
                            'variant_name',  i.variant_name,
                            'quantity',      i.quantity,
                            'unit_price',    i.unit_price,
                            'display_order', i.display_order,
                            'voided_at',     i.voided_at,
                            'void_reason',   i.void_reason,
                            'notes',         i.notes)
                          order by i.display_order, i.created_at)
                     from merchant.order_item i
                    where i.order_id = o.id), '[]'::jsonb) as items
    from merchant.customer_order o;

-- ----------------------------------------------------------------------------
-- DEVICES (the physical KDS iPad; sessions/pairing are runtime machinery)
-- ----------------------------------------------------------------------------

create table merchant.device (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchant.merchant(id) on delete cascade,
  location_id     uuid references merchant.location(id),
  station_id    uuid references merchant.station(id),   -- the station this device serves (re-assignable)
  name          text not null,
  kind          text not null default 'kds' check (kind in ('kds','pos_terminal')),
  -- The device's own identifier for the outside world. `id` never leaves the server:
  -- a terminal that can be revoked by guessing a sequential internal id is not revocable.
  public_id     uuid not null default gen_random_uuid(),
  -- ONE lifecycle column. A POS terminal has more states than active/retired: it can be
  -- awaiting its first credential, overdue for rotation, or replaced by a new unit whose
  -- history must stay linked. Adding a second `lifecycle_state` beside `status` would put
  -- the same fact in two columns, so `status` carries the whole vocabulary.
  status        text not null default 'active'
                  check (status in ('enrollment_pending','active','rotation_required',
                                    'rotated','revoked','replaced','retired')),
  -- Credential material, hashes only. A stolen database must not yield a working device.
  installation_hash    text,      -- sha256 of the app installation id; survives credential rotation
  credential_hash      text,      -- sha256 of the device credential
  credential_version   integer not null default 1 check (credential_version > 0),
  platform      text check (platform in ('android','ios','linux','macos','windows','web')),
  last_seen_at  timestamptz,
  -- Operator PIN throttle. It sits on the DEVICE, not on merchant.staff, and the PIN
  -- model forces that: a wrong PIN matches NO staff row, so there is no employee to
  -- count the failure against. The terminal is the only party present at a failed
  -- attempt, so the terminal keeps the count and takes the lockout.
  pin_failed_attempts  integer not null default 0,
  pin_locked_until     timestamptz,
  revoked_at    timestamptz,
  revocation_reason  text,
  replacement_device_id uuid references merchant.device(id),
  registered_at timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint device_public_id_uq unique (public_id),
  constraint device_credential_hash_ck
    check (credential_hash is null or credential_hash ~ '^[a-f0-9]{64}$'),
  constraint device_installation_hash_ck
    check (installation_hash is null or installation_hash ~ '^[a-f0-9]{64}$'),
  constraint device_pin_failed_attempts_ck check (pin_failed_attempts between 0 and 10),
  -- revoked_at and status are one fact, not two. Without this a row can claim to be
  -- active while carrying a revocation timestamp, and the reader has to guess.
  constraint device_revocation_ck
    check ((status in ('revoked','replaced')) = (revoked_at is not null))
);
-- One live installation per physical device. A reinstall that re-enrols must first
-- rotate or revoke the old row; two active rows for one tablet is how a revoked
-- terminal keeps charging.
create unique index device_active_installation_uq
  on merchant.device (installation_hash)
  where installation_hash is not null and status in ('active','rotation_required');

-- ----------------------------------------------------------------------------
-- AUDIT (café-facing, RLS-scoped)
-- In-place edits by staff that are NOT already append-only facts: config/settings,
-- prices, roles, order voids. (Money edits are already audited in the ledgers.)
-- Append-only (grant-revoke in 90_rls); soft entity_id so it outlives the row.
-- ----------------------------------------------------------------------------

create table merchant.audit_log (
  id             uuid primary key default gen_random_uuid(),
  merchant_id    uuid not null references merchant.merchant(id) on delete cascade,
  actor_user_id  uuid references umi.user(id) on delete set null,
  -- The Umi operator who acted THROUGH the café's account, when one did. NULL for the
  -- ordinary case where a café user acted as themselves.
  --
  -- One column, added before it is needed, because the alternative is a trail that can
  -- only answer one of two questions. Zendesk documents its own version of the wrong
  -- answer: when staff assume a user, "any actions you take ... are done by the user
  -- you're logged in as", so the acting person vanishes. Salesforce keeps both — the
  -- impersonated user on CreatedBy, the acting one on SetupAuditTrail.DelegateUser.
  -- PCI DSS 8.2.2 requires the same property of any shared credential: "Every action
  -- taken is attributable to an individual user."
  --
  -- Umi has no "log in as" feature today, so this column stays NULL. That is the point:
  -- adding it now costs one line, and the rule it encodes — actor_user_id is who the
  -- action RAN AS, delegate_user_id is who CAUSED it — is fixed before any code needs it.
  delegate_user_id uuid references umi.user(id) on delete set null,
  action         text not null
                   check (action in ('create','update','delete','grant','revoke','void','adjust')),
  entity         text not null,   -- 'merchant','product','loyalty_program','loyalty_reward','staff'
  entity_id      uuid,            -- soft ref, no FK
  outcome        text not null default 'success'
                   check (outcome in ('success','denied','failure')),
  request_id     text,            -- PCI DSS 10.2.2 "origination of event"
  before         jsonb,
  after          jsonb,
  at             timestamptz not null default now()
);
-- "Everything Umi did inside this café" — the query a café owner is entitled to run,
-- and the one an investigation starts from. Partial: delegated actions are the rare case.
create index merchant_audit_log_delegate_idx
  on merchant.audit_log (merchant_id, delegate_user_id, at desc)
  where delegate_user_id is not null;
create index merchant_audit_log_merchant_time_idx on merchant.audit_log (merchant_id, at desc);
create index merchant_audit_log_entity_idx        on merchant.audit_log (merchant_id, entity, at desc);
comment on table merchant.audit_log is
  'Café-facing audit ("who changed my settings/prices/roles"). RLS-scoped per merchant. Append-only.';

-- ----------------------------------------------------------------------------
-- DERIVED: conversation analytics (was observability.conversation_outcome — now
-- a VIEW, not a stored table; the one non-derivable bit is conversation.outcome).
-- ----------------------------------------------------------------------------

-- security_invoker: enforce the caller's RLS on the base tables. Without it the
-- view is owner-rights and leaks every café's conversations to any api session
-- (reproduced in the security audit: 0 base rows but 11 cross-merchant view rows).
create view merchant.conversation_analytics with (security_invoker = true) as
  select c.id          as conversation_id,
         c.merchant_id,
         c.outcome,
         count(m.id)                                                        as turn_count,
         extract(epoch from (max(m.occurred_at) - c.started_at))::int       as duration_seconds
    from merchant.conversation c
    left join merchant.message m on m.conversation_id = c.id
   group by c.id, c.merchant_id, c.outcome, c.started_at;

-- ============================================================================
-- INTEGRITY — the substrate every money-writing command runs on.
-- ============================================================================

-- The idempotency record. A retried command with the SAME fingerprint replays the
-- stored result; a retry with a DIFFERENT body is a conflict, never a second charge.
-- This is the IETF Idempotency-Key model and Stripe's implementation of it.
--
-- Supersedes runtime.idempotency_key for business commands. That table survives for
-- webhook/inbound dedup and says so in its own comment.
create table merchant.business_command (
  id                uuid primary key default gen_random_uuid(),
  merchant_id       uuid not null references merchant.merchant(id) on delete restrict,
  location_id         uuid references merchant.location(id),
  command_id        uuid not null,     -- the client's id for this command
  idempotency_key   text not null,
  command_type      text not null,
  -- sha256 of the canonical request body. Comparing bodies rather than trusting the
  -- key is what stops a replayed key from returning someone else's result.
  fingerprint       text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  status            text not null check (status in ('processing','succeeded','failed')),
  expected_version  bigint check (expected_version is null or expected_version >= 0),
  response_data     jsonb,
  failure_code      text,
  retryable         boolean not null default false,
  correlation_id    text not null,
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  -- Retention: see IDEMPOTENCY_RETENTION_HOURS in @umi/contract (72h). A device can be
  -- offline for a whole trading day, so 24h would strand a legitimate replay. Past the
  -- window the API answers IDEMPOTENCY_EXPIRED and the client must query the command.
  expires_at        timestamptz,
  unique (merchant_id, command_id),
  unique (merchant_id, idempotency_key),
  -- "Finished" and "has a finish time" are one fact.
  check ((status = 'processing') = (completed_at is null))
);
create index business_command_lookup_idx
  on merchant.business_command (merchant_id, command_type, started_at desc);
create index business_command_expiry_idx
  on merchant.business_command (expires_at) where expires_at is not null;
comment on table merchant.business_command is
  'Canonical idempotency record. Same fingerprint replays the stored result; a different '
  'fingerprint conflicts. Never a second charge.';

-- Optimistic concurrency for aggregates that carry NO version column of their own.
--
-- SCOPE RULE, enforced not documented: customer_order and pos_cart each own a `version`
-- column maintained beside their data, and registering them here as well would put one
-- fact in two places — the duplicate-derived-state trap this schema exists to avoid.
create table merchant.aggregate_version (
  merchant_id     uuid not null references merchant.merchant(id) on delete restrict,
  aggregate_type  text not null,
  aggregate_id    uuid not null,
  version         bigint not null default 0 check (version >= 0),
  updated_at      timestamptz not null default now(),
  primary key (merchant_id, aggregate_type, aggregate_id),
  constraint aggregate_version_no_self_versioned_ck
    check (aggregate_type not in ('customer_order', 'pos_cart'))
);
comment on table merchant.aggregate_version is
  'Optimistic version for aggregates without their own version column. customer_order '
  'and pos_cart carry theirs inline and are refused here by CHECK.';

-- The tamper-evident merchant event chain. Hash-linked per merchant, append-only,
-- readable by the café through GET /api/merchants/:id/audit.
--
-- NOT the same table as merchant.audit_log, and the boundary is by QUESTION ANSWERED:
--   audit_log   — "who changed this record, from what to what" (before/after diffs)
--   audit_event — "what happened in this merchant, provably unaltered" (money, access,
--                 device trust). An auditor reads this one.
-- No fact belongs in both.
create table merchant.audit_event (
  id              uuid primary key default gen_random_uuid(),
  merchant_id     uuid not null references merchant.merchant(id) on delete restrict,
  location_id       uuid references merchant.location(id),
  actor_user_id   uuid references umi.user(id) on delete set null,
  -- The Umi operator who acted through this café's account. Same rule as
  -- merchant.audit_log.delegate_user_id: actor_user_id is who the action RAN AS,
  -- delegate_user_id is who CAUSED it. NULL for an ordinary café action.
  --
  -- Added while this table is still empty, and that timing is the whole reason it is
  -- here now. The column is INSIDE the hash chain (see merchant.tg_audit_event_hash),
  -- so introducing it later would mean either leaving it outside the hash — where it
  -- could be edited without breaking the chain, defeating the point — or rehashing
  -- every row already written. Neither is a change anyone wants to make under an audit.
  delegate_user_id uuid references umi.user(id) on delete set null,
  command_id      uuid,
  event_type      text not null,
  entity_type     text not null,
  entity_id       uuid,
  outcome         text not null check (outcome in ('success','denied','failure')),
  reason_code     text,
  -- Redacted by construction: what a café may read. Anything sensitive goes to
  -- runtime.audit_event_internal, which no merchant role can select.
  public_data     jsonb not null default '{}'::jsonb,
  correlation_id  text not null,
  previous_hash   text,          -- set by trigger; NULL only for a merchant's first event
  event_hash      text not null, -- set by trigger
  occurred_at     timestamptz not null default now()   -- overwritten by trigger with clock_timestamp()
);
create index audit_event_search_idx
  on merchant.audit_event (merchant_id, occurred_at desc, event_type);
create index audit_event_entity_idx
  on merchant.audit_event (merchant_id, entity_type, entity_id, occurred_at desc);
create index audit_event_correlation_idx
  on merchant.audit_event (merchant_id, correlation_id);
comment on table merchant.audit_event is
  'Hash-chained merchant audit. Server timestamps, redacted payloads, append-only.';

-- Neutral immutable money history, independent of any product ledger. The loyalty
-- ledger stays authoritative for loyalty; this is the cross-domain record an auditor
-- reconciles against. A correction is a NEW row pointing at what it compensates —
-- never an UPDATE.
create table merchant.financial_event (
  id                  uuid primary key default gen_random_uuid(),
  merchant_id         uuid not null references merchant.merchant(id) on delete restrict,
  location_id           uuid references merchant.location(id),
  command_id          uuid not null,
  aggregate_type      text not null,
  aggregate_id        uuid not null,
  aggregate_version   bigint not null check (aggregate_version > 0),
  event_type          text not null,
  amount_minor_units  bigint not null,     -- centavos; signed. Never a float.
  currency            text not null check (currency ~ '^[A-Z]{3}$'),
  compensates_event_id uuid references merchant.financial_event(id),
  public_data         jsonb not null default '{}'::jsonb,
  correlation_id      text not null,
  occurred_at         timestamptz not null default now(),
  -- One event per aggregate version: the same version cannot be written twice.
  unique (merchant_id, aggregate_type, aggregate_id, aggregate_version),
  check (compensates_event_id is null or compensates_event_id <> id)
);
create index financial_event_command_idx on merchant.financial_event (merchant_id, command_id);
create index financial_event_time_idx    on merchant.financial_event (merchant_id, occurred_at desc);
comment on table merchant.financial_event is
  'Neutral immutable financial history. Product ledgers stay authoritative for their domain.';

-- ============================================================================
-- CATALOG EXTENSION — what a till needs that a WhatsApp menu did not.
-- ============================================================================

create table merchant.product_media (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchant.merchant(id) on delete cascade,
  product_id    uuid not null references merchant.product(id) on delete cascade,
  -- https only: a till on a café's wifi must not be talked into loading plaintext.
  url           text not null check (length(url) <= 2048 and url ~ '^https://'),
  alt_text      text check (length(alt_text) <= 240),
  width         integer check (width between 1 and 8192),
  height        integer check (height between 1 and 8192),
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (product_id, url)
);

-- A sellable variation with its own price delta (Small/Medium/Large). Distinct from
-- product_modifier, which ADDS to a line (oat milk); a variant IS the line.
create table merchant.product_variant (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchant.merchant(id) on delete cascade,
  product_id    uuid not null references merchant.product(id) on delete cascade,
  name          text not null,
  attributes    jsonb not null default '{}'::jsonb,
  price_delta   bigint not null default 0,   -- centavos, signed
  active        boolean not null default true,
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (product_id, name)
);

-- ============================================================================
-- POS CART — mutable preparation. NEVER an order, a payment or a kitchen ticket.
-- ============================================================================

create table merchant.pos_cart (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchant.merchant(id) on delete cascade,
  location_id     uuid not null references merchant.location(id),
  -- xfk-> runtime.operator_session (runtime is built after merchant; see 50_cross_schema_fk)
  operator_session_id uuid not null,
  status        text not null default 'draft'
                  check (status in ('draft','prepared','committed','abandoned')),
  -- The cart's own change marker, for the client's expectedVersion check. Registering
  -- it in merchant.aggregate_version as well is refused by CHECK there.
  version       integer not null default 1 check (version > 0),
  -- Server-derived, never client-supplied: a café's day ends at 04:00, not midnight,
  -- and a till whose clock drifted must not be able to move a sale into yesterday.
  business_date date not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
  -- The (merchant_id, location_id) composite FK is added by the sweep at the end of this
  -- file, together with every other merchant table that carries both columns.
);
-- One open cart per operator session. Two live carts on one till is how a sale gets
-- rung into the wrong basket.
create unique index pos_cart_active_operator_uidx
  on merchant.pos_cart (operator_session_id) where status in ('draft','prepared');
comment on table merchant.pos_cart is
  'Mutable POS preparation state. Never payment, receipt, inventory, KDS or committed order truth.';

create table merchant.pos_cart_line (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchant.merchant(id) on delete cascade,
  cart_id       uuid not null references merchant.pos_cart(id) on delete cascade,
  product_id    uuid not null references merchant.product(id),
  variant_id    uuid references merchant.product_variant(id),
  -- sha256 over product + variant + modifier selection + note. Two identical drinks
  -- collapse into one line with quantity 2; a different note makes a different line.
  identity_key  text not null check (identity_key ~ '^[a-f0-9]{64}$'),
  -- Snapshots, not live pointers: renaming a product tomorrow must not rewrite the
  -- receipt of a sale that happened today.
  product_name  text not null,
  variant_name  text,
  variant_attributes jsonb not null default '{}'::jsonb,
  quantity      integer not null check (quantity between 1 and 999),
  note          text check (length(note) <= 500 and note !~ '[<>]'),
  base_price    bigint not null check (base_price >= 0),   -- centavos
  variant_delta bigint not null default 0,
  modifier_total bigint not null default 0,
  tax_rate_basis_points integer not null check (tax_rate_basis_points between 0 and 10000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (cart_id, identity_key)
);
create index pos_cart_line_cart_idx on merchant.pos_cart_line (cart_id);

create table merchant.pos_cart_line_modifier (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchant.merchant(id) on delete cascade,
  line_id       uuid not null references merchant.pos_cart_line(id) on delete cascade,
  group_id      uuid not null references merchant.product_option_group(id),
  modifier_id   uuid not null references merchant.product_modifier(id),
  name          text not null,      -- snapshot, same reasoning as pos_cart_line
  quantity      integer not null check (quantity between 1 and 99),
  price_delta   bigint not null,
  unique (line_id, modifier_id)
);
create index pos_cart_modifier_line_idx on merchant.pos_cart_line_modifier (line_id);

-- ============================================================================
-- CHECKOUT — where a cart becomes money.
-- ============================================================================

-- Reservation semantics ONLY. This table never decrements stock; it records that a
-- cart is holding items while payment resolves, and expires on its own.
create table merchant.inventory_reservation (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchant.merchant(id) on delete restrict,
  location_id     uuid not null references merchant.location(id),
  cart_id       uuid not null references merchant.pos_cart(id) on delete restrict,
  status        text not null check (status in ('reserved','released','expired','commit_prepared')),
  cart_version  integer not null check (cart_version > 0),
  line_snapshot jsonb not null,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (cart_id)
);
comment on table merchant.inventory_reservation is
  'Checkout reservation only. This table never decrements or synchronizes inventory.';

-- One payment attempt per cart. `unknown` and `timeout` are first-class outcomes:
-- when a terminal stops answering, the sale becomes QUERY-ONLY. It must never be
-- retried into a second charge — the rule our own records call out by name.
create table merchant.pos_payment_attempt (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchant.merchant(id) on delete restrict,
  location_id     uuid not null references merchant.location(id),
  cart_id       uuid not null references merchant.pos_cart(id) on delete restrict,
  method        text not null check (method in ('cash','external_terminal')),
  amount_minor_units bigint not null check (amount_minor_units >= 0),
  currency      text not null check (currency ~ '^[A-Z]{3}$'),
  status        text not null
                  check (status in ('pending','succeeded','declined','cancelled','unknown','timeout')),
  query_only    boolean not null default false,
  provider_reference text,
  correlation_id text not null,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  unique (merchant_id, cart_id),
  -- An ambiguous outcome is query-only. Enforced here so no service can forget it.
  constraint payment_attempt_ambiguity_ck
    check (status not in ('unknown','timeout') or query_only)
);

-- The receipt as issued, frozen. Reports read this and never recompute a historical
-- total from today's prices.
create table merchant.receipt_snapshot (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchant.merchant(id) on delete restrict,
  location_id     uuid not null references merchant.location(id),
  order_id      uuid not null references merchant.customer_order(id) on delete restrict,
  payment_attempt_id uuid not null references merchant.pos_payment_attempt(id) on delete restrict,
  receipt_number text not null,
  business_date date not null,
  currency      text not null check (currency ~ '^[A-Z]{3}$'),
  grand_total   bigint not null check (grand_total >= 0),
  snapshot      jsonb not null,
  issued_at     timestamptz not null default now(),
  unique (merchant_id, receipt_number),
  unique (order_id)
);
comment on table merchant.receipt_snapshot is
  'Immutable receipt fact. Reports read this snapshot and never reconstruct historical totals.';

-- The join that says "this cart became this order, paid by this attempt, on this
-- receipt". Every column is UNIQUE: one cart cannot become two sales, and one order
-- cannot be claimed by two carts.
create table merchant.pos_committed_sale (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchant.merchant(id) on delete restrict,
  location_id     uuid not null references merchant.location(id),
  cart_id       uuid not null references merchant.pos_cart(id) on delete restrict,
  order_id      uuid not null references merchant.customer_order(id) on delete restrict,
  payment_attempt_id uuid not null references merchant.pos_payment_attempt(id) on delete restrict,
  receipt_snapshot_id uuid not null references merchant.receipt_snapshot(id) on delete restrict,
  totals_fingerprint text not null check (totals_fingerprint ~ '^[a-f0-9]{64}$'),
  committed_at  timestamptz not null default now(),
  unique (cart_id), unique (order_id), unique (payment_attempt_id), unique (receipt_snapshot_id)
);

-- ============================================================================
-- OFFLINE REPLAY — the device's journal, on the server.
-- Every table here is device-scoped and fails CLOSED without a proven device.
-- ============================================================================

-- What a device is allowed to do while disconnected. Cash is OFF by default and stays
-- off until a merchant is certified for it through pos_offline_cash_policy.
create table merchant.pos_offline_policy (
  merchant_id   uuid primary key references merchant.merchant(id) on delete cascade,
  version       text not null default '1',
  issued_at     timestamptz not null default clock_timestamp(),
  expires_at    timestamptz not null default (clock_timestamp() + interval '24 hours'),
  allowed_command_types text[] not null default array['operational.ack'],
  cash_sale_enabled boolean not null default false,
  max_queue_depth integer not null default 250 check (max_queue_depth between 1 and 1000),
  max_batch_size  integer not null default 20 check (max_batch_size between 1 and 50),
  max_command_age_seconds integer not null default 86400
                  check (max_command_age_seconds between 60 and 604800),
  updated_at    timestamptz not null default clock_timestamp()
);

-- Per-location offline cash limits. Every bound the till enforces locally is ALSO stored
-- here, because a client-side limit is a suggestion.
create table merchant.pos_offline_cash_policy (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchant.merchant(id) on delete restrict,
  location_id     uuid not null references merchant.location(id) on delete restrict,
  enabled       boolean not null default false,
  version       text not null,
  currency      text not null check (currency ~ '^[A-Z]{3}$'),
  max_policy_age_seconds integer not null check (max_policy_age_seconds between 60 and 86400),
  max_single_sale_minor_units bigint not null
                  check (max_single_sale_minor_units between 1 and 9007199254740991),
  max_accumulated_minor_units bigint not null
                  check (max_accumulated_minor_units between 1 and 9007199254740991),
  max_offline_sale_count integer not null check (max_offline_sale_count between 1 and 1000),
  max_active_queue_depth integer not null check (max_active_queue_depth between 1 and 1000),
  max_command_age_seconds integer not null check (max_command_age_seconds between 60 and 604800),
  max_catalog_age_seconds integer not null check (max_catalog_age_seconds between 60 and 604800),
  max_pricing_age_seconds integer not null check (max_pricing_age_seconds between 60 and 604800),
  max_tax_age_seconds     integer not null check (max_tax_age_seconds between 60 and 604800),
  manager_approval_threshold_minor_units bigint
                  check (manager_approval_threshold_minor_units is null
                         or manager_approval_threshold_minor_units between 1 and 9007199254740991),
  allowed_device_classes text[] not null default array['pos_terminal'],
  issued_at     timestamptz not null default clock_timestamp(),
  expires_at    timestamptz not null,
  updated_at    timestamptz not null default clock_timestamp(),
  unique (merchant_id, location_id),
  check (expires_at > issued_at)
);

-- How far the server has accepted this device's ordered command stream. Keyed by
-- credential version: rotating a credential starts a new stream, so a replay signed by
-- the old credential can never be accepted against the new one.
create table merchant.device_replay_cursor (
  merchant_id   uuid not null references merchant.merchant(id) on delete cascade,
  location_id     uuid not null references merchant.location(id),
  device_id     uuid not null references merchant.device(id),
  credential_version integer not null check (credential_version > 0),
  last_accepted_sequence bigint not null default 0 check (last_accepted_sequence >= 0),
  reconciliation_required boolean not null default false,
  updated_at    timestamptz not null default clock_timestamp(),
  primary key (device_id, credential_version)
);

-- The accepted commands themselves. Immutable: an accepted offline sale is history.
create table merchant.offline_replay_command (
  merchant_id   uuid not null references merchant.merchant(id) on delete restrict,
  location_id     uuid not null references merchant.location(id),
  device_id     uuid not null references merchant.device(id),
  credential_version integer not null,
  device_sequence bigint not null check (device_sequence > 0),
  command_id    uuid primary key,
  -- xfk-> runtime.operator_session (see 50_cross_schema_fk)
  operator_session_id uuid not null,
  idempotency_key uuid not null,
  command_type  text not null check (command_type in ('operational.ack','pos.checkout.cash')),
  fingerprint   text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  contract_version text not null,
  schema_version integer not null check (schema_version > 0),
  client_created_at timestamptz not null,   -- the DEVICE's clock; never trusted for money
  accepted_at   timestamptz not null default clock_timestamp(),   -- the server's clock
  payload       jsonb not null default '{}'::jsonb,
  result        jsonb not null,
  provisional_id uuid,
  official_id   uuid,
  -- The ordered stream: one command per sequence number per credential version.
  unique (device_id, credential_version, device_sequence),
  unique (merchant_id, idempotency_key)
);

create table merchant.offline_reconciliation (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchant.merchant(id) on delete restrict,
  location_id     uuid not null references merchant.location(id),
  device_id     uuid not null references merchant.device(id),
  credential_version integer not null,
  summary       jsonb not null,
  created_at    timestamptz not null default clock_timestamp(),
  acknowledged_at timestamptz
);

-- What could not be replayed, and what a human must do about it.
create table merchant.offline_replay_conflict (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references merchant.merchant(id) on delete restrict,
  location_id     uuid not null references merchant.location(id) on delete restrict,
  device_id     uuid not null references merchant.device(id) on delete restrict,
  command_id    uuid not null,
  device_sequence bigint not null check (device_sequence > 0),
  classification text not null,
  blocks_following boolean not null,
  operator_action_required boolean not null,
  manager_action_required  boolean not null,
  guidance_code text not null,
  correlation_id text not null,
  provisional_id uuid,
  official_id   uuid,
  first_observed_at timestamptz not null default clock_timestamp(),
  last_observed_at  timestamptz not null default clock_timestamp(),
  resolution_state text not null default 'open'
                  check (resolution_state in ('open','acknowledged','resolved')),
  resolution_acknowledged_at timestamptz,
  unique (merchant_id, device_id, command_id)
);

-- provisional receipt -> official receipt. Append-only and unique in every direction:
-- the same offline sale can never be promoted twice, which is how a disconnected shift
-- would otherwise double-count itself on reconnect.
create table merchant.offline_provisional_mapping (
  merchant_id   uuid not null references merchant.merchant(id) on delete restrict,
  location_id     uuid not null references merchant.location(id) on delete restrict,
  device_id     uuid not null references merchant.device(id) on delete restrict,
  command_id    uuid not null references merchant.offline_replay_command(command_id) on delete restrict,
  provisional_id uuid not null,
  official_sale_id uuid not null references merchant.pos_committed_sale(id) on delete restrict,
  official_receipt_id uuid not null references merchant.receipt_snapshot(id) on delete restrict,
  official_receipt_number text not null,
  reconciliation_reference uuid not null,
  mapped_at     timestamptz not null default clock_timestamp(),
  primary key (merchant_id, provisional_id),
  unique (merchant_id, official_sale_id),
  unique (merchant_id, official_receipt_id),
  unique (command_id)
);

-- ============================================================================
-- LOCATION BELONGS TO MERCHANT — enforced by the database, not by hope.
-- ============================================================================
-- Every merchant table that carries BOTH merchant_id and location_id gets a composite
-- foreign key (merchant_id, location_id) -> merchant.location (merchant_id, id).
--
-- Without it, a plain `location_id references merchant.location(id)` happily accepts a location
-- belonging to a DIFFERENT café. RLS scopes what a request can read, but the row is
-- already malformed by then, and a malformed row outlives the bug that wrote it: a sale
-- filed against another merchant's location corrupts both cafés' day.
--
-- This became free the moment `merchant.location` gained `unique (merchant_id, id)` for the
-- POS. It costs one index lookup per insert and removes a whole class of write bug.
--
-- MATCH SIMPLE (the default) is what we want: where location_id is NULL — a merchant-wide
-- row — the constraint is not checked at all, so "no location" stays legal.
--
-- Swept rather than listed, for the same reason as the RLS policies: a hand-maintained
-- list is a list someone forgets to extend, and forgetting here fails OPEN.
do $$
declare
  t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'merchant' and c.relkind = 'r'
       and c.relname <> 'location'
       and exists (select 1 from information_schema.columns col
                    where col.table_schema='merchant' and col.table_name=c.relname
                      and col.column_name='merchant_id')
       and exists (select 1 from information_schema.columns col
                    where col.table_schema='merchant' and col.table_name=c.relname
                      and col.column_name='location_id')
     order by c.relname
  loop
    execute format(
      'alter table merchant.%I add constraint %I foreign key (merchant_id, location_id)
         references merchant.location (merchant_id, id)',
      t.relname, t.relname || '_location_same_merchant_fk');
  end loop;
end $$;
