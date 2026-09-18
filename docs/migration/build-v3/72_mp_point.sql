\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- build-v3 · 72_mp_point — workstream G, step 5 of the Mercado Pago Point plan
-- (`docs/plans/2026-09-17-mercadopago-point-integration-plan.md`): the per-merchant
-- credential, the terminal bound to a register, the terminal id an attempt holds, and
-- the partial unique index of decision D4.
--
-- The plan's sentence is the one this file serves: "The terminal is not a peripheral.
-- It is a remote actor that answers in its own time, over a network we do not own."
-- Everything below is a fact about that remote actor made durable in SQL — which
-- terminal an attempt is holding, which Mercado Pago account a merchant charges through,
-- which physical register is bound to which terminal — so the answer does not depend on
-- a service remembering it, or on a `409` arriving before the customer taps.
--
-- WHAT THIS ADDS AND WHY EACH PART EXISTS.
--
--   1. `merchant.pos_payment_attempt.terminal_id` — WHICH TERMINAL IS HOLDING THE MONEY.
--      The attempt already records the provider, the provider's order id and the proof;
--      what it could not say is which terminal the customer was standing at (D6 keeps the
--      order id AND the payment id for the refund, and this is the third id the settlement
--      report needs). Nullable, because the cash and manual-terminal attempts written
--      before this and still written today have no terminal at all. The value is COPIED
--      VERBATIM from `GET /terminals/v1/list` and NEVER REBUILT (research note 01, §1.2:
--      "Store the exact string from `GET /terminals/v1/list`. Never rebuild it.") — the
--      format CHECK below only refuses a value that could not be a terminal id; it is not
--      a constructor and it is not a closed set of terminal models.
--   2. `pos_payment_attempt_open_terminal_uq` — DECISION D4 IN THE SCHEMA. One terminal
--      takes one open order, and the vendor enforces it too: a second order answers
--      `409 already_queued_order_for_terminal` ("The terminal already has an order waiting.
--      It is necessary to finalize or cancel it to send new orders."). The vendor's rule is
--      discovered after the customer has already decided; ours is discovered by the till
--      BEFORE the card is presented, and it carries a named reason. The plan's §5 puts it
--      plainly: "A terminal busy with another order answers our own named conflict, from
--      the index of D4, before the customer touches the card."
--   3. `merchant.mp_point_credential` — DECISIONS D7 AND D8: THE CREDENTIAL IS THE
--      MERCHANT'S, NOT THE DEPLOYMENT'S. Today the token is one environment value read once
--      at boot (`tender.module.ts:19`), and the vendor's own quality checklist makes
--      "Centralized credentials" a REQUIREMENT rather than advice. The registry keeps its
--      shape; what changes is where the transport gets its token — a per-merchant row.
--      `mp_user_id` is the `collector_id` the OAuth response returns (the order response
--      echoes it back as `user_id`), and it is the key the account is bound by, so it is
--      UNIQUE: one Mercado Pago account maps to one merchant. An OAuth token lasts 180 days
--      and the vendor states the integration stops working without the renewal flow
--      (D8), so the row carries the expiry, the failure timestamp and the attempt counter
--      the job of Phase 5 step 2 reads. Tokens live ENCRYPTED and ONLY in the two `_cipher`
--      columns; there is deliberately no plaintext token column, so no API — and no
--      analytics role — can be handed one by accident.
--   4. `merchant.device_point_terminal` — WHICH REGISTER OWNS WHICH TERMINAL. Phase 5 step 3
--      gives the `/devices` screen the terminal configuration: list the terminals by API,
--      show the operating mode, and switch `PDV` and `STANDALONE`. This is the row that
--      screen reads and writes: one register has one terminal (`unique (device_id)`), one
--      terminal belongs to one merchant (`unique (merchant_id, terminal_id)`), and the
--      store and point of sale ids are stored because the vendor requires them to be
--      created per merchant with that merchant's token. `operating_mode` is `PDV` when the
--      point of sale drives the terminal and `STANDALONE` when a person does; the vendor
--      documents both as supported, so both are legal here and neither is a default that
--      pretends to know the counter.
--   5. `merchant.tg_notify_tender_attempt` and its trigger — THE NUDGE, and the channel
--      doctrine of §4 Phase 2 step 4: "The worker emits a realtime nudge, and the till
--      re-reads over REST." The payload carries IDS ONLY. A nudge is a wake-up, not a
--      delivery: the till hears the attempt id, and re-reads the row over RLS REST, so
--      there is exactly one source of truth and no stale amount or provider payload can
--      ever travel over the socket. This is the same rule, and the same shape, as
--      `merchant.tg_notify_conversation_message` in 60_triggers.sql: `set search_path =
--      pg_catalog`, `perform pg_notify(...)` with a `json_build_object`, and `pg_notify`'s
--      transactional delivery — a rolled-back resolution never nudges anyone.
--
-- WHY A PARTIAL UNIQUE INDEX, AND WHY ITS PREDICATE IS NOT A CLOCK. D4's guarantee is
-- "one open order per terminal", and a partial unique index is the only form that holds
-- without the writer's cooperation. A service check ("is this terminal free?") and the
-- INSERT that follows are two statements, so two tills that run them concurrently both
-- read "free" and both write; raising the isolation level moves the race rather than
-- closing it. The predicate is `status in ('pending','unknown','timeout')` because all
-- three of those hold the terminal at the vendor — an `unknown` is an order that reached
-- `created`/`at_terminal` and has not answered yet, which is precisely the state in which
-- the vendor answers `409` to a second order. THE PREDICATE CANNOT MENTION `now()`: a
-- partial-index predicate must be IMMUTABLE, and `now()` is not, so "expired" is not
-- something this index can decide. The row leaves the open set only by RESOLVING through
-- the normal path — `succeeded`, `declined` or `cancelled`, the same three statuses the
-- nudge below fires on — and a row that ages out is moved to `timeout` by the API's own
-- reap (`tender.repository.ts`, "an attempt whose window has closed is a `timeout`") and
-- then resolved or cancelled by the query path. That is deliberate and it is stated
-- plainly rather than left to be discovered: an unanswered attempt keeps holding its
-- terminal until someone finishes the story, which is the same thing the vendor does.
--
-- WHAT IS NOT ENFORCED HERE, STATED PLAINLY.
--
--   · A TERMINAL ID IS NOT A FOREIGN KEY, because the terminals live in Mercado Pago and
--     not in our database. `merchant.device_point_terminal.terminal_id` is the local record
--     of what we bound; whether the vendor still lists that terminal is a question only
--     `GET /terminals/v1/list` can answer, and the `/devices` screen asks it. The format
--     CHECK below is a shape guard, not an existence check.
--   · THE CREDENTIAL IS NOT VALIDATED HERE. `access_token_expires_at` is stored and
--     visible; "which merchants are inside the 14-day margin of D8" is a QUERY against it,
--     and "is this token still accepted" is the provider's answer, not a constraint's.
--     The `refresh_attempts` counter and `refresh_failed_at` are what make the alert of
--     §7 item 4 possible; nothing here decides when the job runs.
--   · THE CIPHER COLUMNS ARE NOT ENFORCED AS CIPHERTEXT. Whether a stored value is a valid
--     envelope of our key material is a fact about the encryption path, checked by the
--     service that writes it and by the integration test over the refresh job. What the
--     schema guarantees is the half a CHECK can guarantee: there is no OTHER column a
--     plaintext token could live in, and the table comment says so.
--   · ONE POINT OF SALE HOLDS ONE TERMINAL IN `PDV` MODE (research note 01, §5.3 — a
--     second terminal gets `412`). `pos_id` is stored so that rule can be checked against
--     the vendor's own list, but it is not a unique index here: the same point of sale may
--     legitimately hold several terminals in `STANDALONE`, and the constraint that would
--     accept the legal case is a partial one over a value the vendor owns. The `/devices`
--     screen and the vendor's `412` are what enforce it.
--
-- SCOPE, RLS AND GRANTS. Both tables are created AFTER 90_rls swept the catalog, so — like
-- 62_floor_plan, 65_table_reservation, 67_table_state, 69_procurement and 70_tender record
-- — they carry their own forced RLS and their own scope policy here, and their own grants.
-- `device_point_terminal` carries a location, so it takes the location-narrowed predicate
-- 67_table_state uses; `mp_point_credential` has no location (a credential is a fact about
-- the merchant, shared by every till), so it takes the merchant-only branch.
--
-- THE DEFAULT PRIVILEGES ARE ALREADY ARMED, and that is the thing to know before reading
-- the grant block. 90_rls ran `alter default privileges in schema merchant grant select on
-- tables to readonly` and `... grant select, insert, update, delete on tables to worker`, so
-- a table created afterwards arrives already readable by `readonly` and fully writable by
-- `worker` — the question is not what a new table has by default but what this file does
-- about it. It does two different things, deliberately:
--
--   · `device_point_terminal` keeps the defaults and matches 70_tender exactly:
--     `api`/`worker` = select,insert,update plus `readonly` = select. It holds no secret,
--     and the reporting side is entitled to see which register runs which terminal.
--   · `mp_point_credential` DOES NOT, and the reason is 90_rls' own doctrine for the role:
--     "readonly: broad read for diagnostics — but NEVER credentials or auth secrets". The
--     same file enforces that on `umi.user` and on `merchant.loyalty_wallet_pass` by
--     revoking the blanket read and re-granting the safe COLUMNS. This table is literally
--     the credential, so the default is wrong here for exactly that reason, and this file
--     follows that precedent rather than inventing one: the default-privilege select is
--     REVOKED from `readonly`, and only the identity and health columns are re-granted. The
--     two `_cipher` columns are excluded BY NAME, so the role that exists to read everything
--     can read the account and its expiry but never the token — and 99_verify asserts that
--     per column, so the guarantee cannot rot into a comment.
--
-- THE TWO TABLES DIFFER ON DELETE, AND THE FIRST DRAFT OF THIS FILE GOT IT WRONG. It said
-- "a terminal binding is corrected by an UPDATE", granted neither table DELETE, and left the
-- `/devices` surface impossible to use: `PointTerminalRepository.bind` releases the register's
-- PREVIOUS terminal with a `DELETE` — `device_point_terminal_device_uq` says one register holds
-- one terminal, so there is no other way to move one — and `unbind` deletes the row by
-- definition. Both run as `api`, so both answered `permission denied for table
-- device_point_terminal`, which is a 500 rather than a refusal a screen can explain.
--
--   · `device_point_terminal` THEREFORE CARRIES `delete` for `api` and `worker`. A binding is a
--     mutable statement about which register holds which device, and releasing one is a delete;
--     the row it removes is the café's own, narrowed by the policy below like every other write.
--   · `mp_point_credential` STILL CARRIES NONE, and that half of the doctrine was right: the row
--     is replaced in place, an unlink is an `UPDATE` that erases the material, and the row
--     disappears only when its merchant does, through its own `on delete cascade`.
--
-- It was found by the integration case the file originally said was missing
-- (`point-terminal.integration.ts`), which is the point of writing one.
--
-- Idempotent and re-runnable: a guarded column, a guarded constraint, guarded indexes,
-- guarded tables, `drop trigger if exists` + `create trigger`, `drop policy if exists` +
-- `create policy`, `revoke`/`grant` (both idempotent by nature), and a version row inserted
-- with `on conflict do nothing`.
--
-- THAT CLAIM IS ABOUT THIS FILE. Applying this file alone to a database that already has it
-- is a no-op that ends green. A second FULL `00_run.sh` over an existing database does not
-- get that far: it stops in `10_umi`, whose `create table umi.user` has no `if not exists`.
-- That is a property of the early files in the chain rather than of this one, and it is stated
-- here rather than left to be discovered — a fresh database is the supported way to re-run the
-- whole build.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · The terminal an attempt is holding
--
-- Added with `add column if not exists` so the file is re-runnable against a database that
-- already carries it, and the CHECK is added in a separate guarded block for the same
-- reason 70_tender guards its attempt constraints: the table predates this file, so a
-- half-applied run can leave the column without the constraint, and `add column if not
-- exists` would never put it back.
--
-- THE FORMAT CHECK IS THE SHAPE `type + "__" + terminal serial` the vendor documents —
-- see the examples in research note 01 (`NEWLAND_N950__SBX0000001`,
-- `NEWLAND_N950__N950NCB801293324`, `PAX_A910__SMARTPOS1234345545`). It refuses a value
-- with no `__` or an empty half, which is the mistake a hand-built id makes; it does NOT
-- close the set of terminal models, exactly as `payment_attempt_provider_slug_ck` in
-- 70_tender refuses a malformed provider slug without closing the set of providers. A new
-- Mercado Pago terminal model must not require a migration.
-- ---------------------------------------------------------------------------
alter table merchant.pos_payment_attempt
  add column if not exists terminal_id text;

comment on column merchant.pos_payment_attempt.terminal_id is
  'The Mercado Pago Point terminal this attempt is holding, copied VERBATIM from GET /terminals/v1/list and never rebuilt (research note 01 §1.2). The vendor''s format is `type of terminal + "__" + terminal serial`, e.g. NEWLAND_N950__SBX0000001. NULL for the cash and manual-terminal attempts that have no terminal, which is every attempt written before this file and every cash attempt written after it.';

do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname='merchant' and cl.relname='pos_payment_attempt'
       and c.conname='payment_attempt_terminal_id_ck'
  ) then
    alter table merchant.pos_payment_attempt add constraint payment_attempt_terminal_id_ck
      check (terminal_id is null or terminal_id ~ '^[A-Za-z0-9][A-Za-z0-9_]{0,39}__[A-Za-z0-9][A-Za-z0-9_-]{0,63}$');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2 · D4 — one terminal takes one open order
--
-- Partial, because only the OPEN statuses collide: `succeeded`, `declined` and `cancelled`
-- rows are history and any number of them may name the same terminal. The predicate's
-- three statuses are the three in which the vendor is still holding an order for that
-- terminal, and the row is released ONLY by resolving into one of the three closed
-- statuses (see the header: the predicate is immutable and therefore cannot express
-- "expired", so the reap writes `timeout` and the query path finishes the story).
--
-- Deliberately NOT a second index on `(merchant_id, terminal_id)`: the partial one IS the
-- btree for that pair, and a duplicate would cost a write on every attempt for a prefix
-- scan this one already serves — the same reasoning 70_tender gives for not indexing
-- `(merchant_id, cart_id, status)`.
-- ---------------------------------------------------------------------------
create unique index if not exists pos_payment_attempt_open_terminal_uq
  on merchant.pos_payment_attempt (merchant_id, terminal_id)
  where terminal_id is not null and status in ('pending','unknown','timeout');

comment on index merchant.pos_payment_attempt_open_terminal_uq is
  'DECISION D4. One OPEN attempt per (merchant, terminal): the till refuses a second order for a busy terminal with a named reason instead of learning it from the vendor''s 409 already_queued_order_for_terminal after the customer decided. A pending, unknown or timeout attempt still holds the terminal at the vendor, so all three are open here; a row is released only when it resolves to succeeded, declined or cancelled. The predicate cannot call now() — a partial-index predicate must be immutable — so expiry is the reap''s job, not the index''s.';

-- ---------------------------------------------------------------------------
-- 3 · The per-merchant credential (D7, D8)
--
-- ONE ROW PER MERCHANT, and the primary key says so: `merchant_id` IS the key rather than a
-- surrogate id with a unique constraint, because there is no such thing as a second
-- credential for a merchant — the OAuth flow replaces the row in place. `on delete cascade`
-- is the only delete path, which is why neither role is granted DELETE below.
--
-- THE TWO CIPHER COLUMNS ARE `text` AND MUST NEVER BE RETURNED BY AN API. Phases 1 and 2
-- charge through the deployment token (`MERCADO_PAGO_POINT_ACCESS_TOKEN`, the "own account"
-- mode of D7) and leave both columns NULL; Phase 5's OAuth callback stores the encrypted
-- material here. There is deliberately NO `access_token` and NO `refresh_token` column: the
-- absence is the guarantee, and 99_verify asserts that no plainly named token column
-- exists on this table. The table comment below states the rule for a reader who has the
-- row in front of them.
-- ---------------------------------------------------------------------------
create table if not exists merchant.mp_point_credential (
  merchant_id uuid primary key references merchant.merchant(id) on delete cascade,
  -- The collector id the OAuth response returns; the order response echoes it as `user_id`.
  mp_user_id text not null,
  -- Encrypted OAuth material. NULL until Phase 5 exchanges a code; never returned by an API.
  access_token_cipher text,
  refresh_token_cipher text,
  access_token_expires_at timestamptz,
  -- The D8 alert: when the last refresh failed, and how many times in a row. A job that
  -- refreshes every token with 14 days of margin records the attempt here, and §7 item 4
  -- fires the owner-visible alert off this pair.
  refresh_failed_at timestamptz,
  refresh_attempts integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  -- A collector id with no content is not an account, and the vendor's ids are short
  -- numeric strings. A shape guard, not a closed set.
  constraint mp_point_credential_user_shape_ck
    check (length(mp_user_id) between 1 and 64),
  -- The same rule payment_attempt_query_count_ck gives: a counter that cannot be a count of
  -- attempts is worth refusing rather than graphing.
  constraint mp_point_credential_refresh_attempts_ck
    check (refresh_attempts >= 0)
);

comment on table merchant.mp_point_credential is
  'The Mercado Pago credential of ONE merchant (D7/D8). THE CIPHER COLUMNS MUST NEVER BE RETURNED BY AN API: `mp_user_id` is the only value any response may echo, and the access and refresh tokens live here encrypted for the transport and the renewal job alone. Phase 1-2 leave the token columns NULL and charge through the deployment token; Phase 5''s OAuth callback fills them in. One row per merchant is the primary key, not a convention.';
comment on column merchant.mp_point_credential.mp_user_id is
  'The Mercado Pago collector id the OAuth response returns; the order response echoes it back as `user_id`. UNIQUE, because one Mercado Pago account maps to one merchant — two merchants sharing an account is a setup mistake, not a supported mode.';
comment on column merchant.mp_point_credential.access_token_cipher is
  'ENCRYPTED OAuth access token. NULL in the phases that charge through the deployment token. Never returned by an API — not by the merchant console, not by a support view, not by any endpoint.';
comment on column merchant.mp_point_credential.refresh_token_cipher is
  'ENCRYPTED OAuth refresh token, stored because the vendor states the integration stops working without the renewal flow. Never returned by an API, and never logged: §7 item 1 says no token, ever.';
comment on column merchant.mp_point_credential.access_token_expires_at is
  'When the access token stops being accepted (the vendor''s 180-day lifetime). The renewal job of D8 refreshes with 14 days of margin; "which merchants are inside the margin" is a query against this column.';
comment on column merchant.mp_point_credential.refresh_failed_at is
  'The moment the last refresh failed, so an owner-visible alert can fire after ONE failure (§7 item 4) instead of after the token has already expired at the counter.';
comment on column merchant.mp_point_credential.refresh_attempts is
  'Consecutive refresh attempts recorded by the D8 job. Reset when a refresh succeeds, which is what makes "failed three times in a row" a fact the alert can read.';

-- One Mercado Pago account is one merchant. Named as an index rather than a table
-- constraint because it is a uniqueness guarantee over a value the vendor owns, and the
-- reader asking "is this account already bound?" reads the index either way.
--
-- Deliberately absent: an index on `access_token_expires_at` for the renewal sweep. A
-- partial predicate over it would need `now()`, which is not immutable, and the table is
-- one row per merchant — a sequential scan of a table this size is the right plan, and an
-- index would be a second thing to keep correct.
create unique index if not exists mp_point_credential_user_uq
  on merchant.mp_point_credential (mp_user_id);

comment on index merchant.mp_point_credential_user_uq is
  'One Mercado Pago account maps to one merchant. Two merchants bound to the same collector id would mean one of them is charging into the other''s account.';

-- ---------------------------------------------------------------------------
-- 4 · The terminal bound to a register (Phase 5 step 3, the /devices screen)
--
-- THE FOREIGN KEYS ARE THE COMPOSITE FORM 40_pos_hardware_runtime.sql uses, and that is
-- deliberate rather than decorative. `merchant.device(merchant_id, location_id, id)` is a
-- unique key (40_pos_hardware_runtime adds `device_merchant_location_id_uk`), so the device
-- this row names is pinned to THIS merchant AND THIS location in one constraint — a test
-- can prove the binding refuses the same device under a different location. The location
-- reference is repeated in the same composite form, as in 65_table_reservation, so the
-- location is pinned to the merchant too. Note `merchant.device` does NOT carry
-- `unique (merchant_id, id)`: a composite key naming all three columns is the only one
-- available, which is why it is not spelled `(merchant_id, device_id)`.
--
-- `terminal_id` carries the same shape CHECK as section 1 — one rule for one value, stated
-- twice because a CHECK cannot be shared between tables without a domain, and a domain here
-- would be a second thing to migrate when the vendor adds a terminal model.
--
-- `unique (device_id)` is "a register has one terminal"; `unique (merchant_id, terminal_id)`
-- is "a terminal serves one register". `operating_mode` defaults to `STANDALONE` because
-- that is the mode a terminal is in before anyone configures it, and the default must not
-- silently claim a point of sale drives it.
-- ---------------------------------------------------------------------------
create table if not exists merchant.device_point_terminal (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete cascade,
  device_id uuid not null,
  location_id uuid not null,
  terminal_id text not null,
  store_id text,
  pos_id text,
  operating_mode text not null default 'STANDALONE'
    check (operating_mode in ('PDV','STANDALONE')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint device_point_terminal_terminal_id_ck
    check (terminal_id ~ '^[A-Za-z0-9][A-Za-z0-9_]{0,39}__[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
  -- A register has one terminal.
  constraint device_point_terminal_device_uq unique (device_id),
  -- A terminal serves one register of one merchant.
  constraint device_point_terminal_terminal_uq unique (merchant_id, terminal_id),
  -- Present for the same reason every table in this cluster carries it: a future composite
  -- foreign key can then name the merchant and the row together, and UUID uniqueness alone
  -- is not a scope check.
  constraint device_point_terminal_scope_uq unique (merchant_id, id),
  -- The location belongs to this merchant.
  foreign key (merchant_id, location_id)
    references merchant.location(merchant_id, id) on delete restrict,
  -- The register is THIS merchant's device, at THIS location (40_pos_hardware_runtime's
  -- composite form; `merchant.device` carries unique(merchant_id,location_id,id)).
  foreign key (merchant_id, location_id, device_id)
    references merchant.device(merchant_id, location_id, id) on delete restrict
);

comment on table merchant.device_point_terminal is
  'The Mercado Pago Point terminal bound to one register (Phase 5 step 3 — the data behind the /devices screen). One register has one terminal and one terminal serves one register of one merchant; the store and point of sale ids are kept because the vendor requires them to be created per merchant with that merchant''s token.';
comment on column merchant.device_point_terminal.terminal_id is
  'The terminal id VERBATIM from GET /terminals/v1/list — `type + "__" + serial`, e.g. NEWLAND_N950__SBX0000001. Never rebuilt from parts: the vendor documents that the exact string is what `config.point.terminal_id` must carry.';
comment on column merchant.device_point_terminal.store_id is
  'The vendor''s store id this terminal was paired to (Phase 5 step 4). Stored verbatim; the point of sale id below is the narrower binding.';
comment on column merchant.device_point_terminal.pos_id is
  'The vendor''s point of sale id (`pos_id`) the terminal is set to, e.g. from PATCH /terminals/v1/setup. One point of sale holds one terminal in PDV mode — the vendor answers 412 for a second — but that rule is enforced by the vendor and by the /devices screen, not by a unique index here: the same point of sale may hold several terminals in STANDALONE.';
comment on column merchant.device_point_terminal.operating_mode is
  'PDV (the point of sale drives the terminal) or STANDALONE (a person drives it). Both are supported by the vendor; the /devices screen switches between them, and the default records what an unconfigured terminal actually is — standalone.';

-- ---------------------------------------------------------------------------
-- 5 · Triggers
--
-- 60_triggers swept the catalog before either table existed, so the shared touch trigger is
-- attached by hand here — the same reason 65_table_reservation, 67_table_state,
-- 69_procurement and 70_tender record. It is the SAME function (`public.tg_touch_updated_at`,
-- defined in 00_foundation), not a second one: `updated_at` has one definition in this
-- build and a second function would be a second rule for the same column.
--
-- The nudge is modelled on `merchant.tg_notify_conversation_message` in 60_triggers.sql,
-- down to `set search_path = pg_catalog`, which is what makes the function unambiguous about
-- which `json_build_object` and which `pg_notify` it is calling.
-- ---------------------------------------------------------------------------
drop trigger if exists touch_updated_at on merchant.mp_point_credential;
create trigger touch_updated_at before update on merchant.mp_point_credential
  for each row execute function public.tg_touch_updated_at();

drop trigger if exists touch_updated_at on merchant.device_point_terminal;
create trigger touch_updated_at before update on merchant.device_point_terminal
  for each row execute function public.tg_touch_updated_at();

-- THE NUDGE. Fires ONLY on a RESOLUTION — one of the three closed statuses — and, on an
-- update, only when the status actually changed. The `update of status` column list alone
-- would not be enough: it fires whenever the statement names the column, including a
-- no-op re-write, and the API's `resolveAttempt` writes the row for other reasons too
-- (a query bump, a resolved_at change). The `is distinct from` test is what makes "one
-- resolution, one nudge" true.
--
-- The payload carries IDS ONLY — merchant, attempt, command identity, cart, location, and
-- the status that closed it. NEVER an amount, NEVER a provider payload. The till re-reads
-- the attempt over RLS REST and reads the money from the row, so the socket cannot show a
-- stale total and a declined card cannot be rendered as a paid one. The channel constant
-- is `umi_tender_attempt`; the listener lives in the API and reads `DATABASE_URL_APP`.
--
-- `tg_op` is tested BEFORE `old` is touched, deliberately. In an INSERT trigger OLD is an
-- unassigned record, and a boolean expression that mentions it is not a safe short-circuit
-- to rely on; the branch below never reads it on the insert path.
create or replace function merchant.tg_notify_tender_attempt() returns trigger
  language plpgsql
  set search_path = pg_catalog as $$
declare
  v_notify boolean := false;
begin
  if tg_op = 'INSERT' then
    v_notify := new.status in ('succeeded','declined','cancelled');
  elsif tg_op = 'UPDATE' then
    v_notify := new.status in ('succeeded','declined','cancelled')
                and old.status is distinct from new.status;
  end if;

  if v_notify then
    perform pg_notify(
      'umi_tender_attempt',
      json_build_object(
        'merchant_id', new.merchant_id,
        'attempt_id', new.id,
        'command_identity', new.command_identity,
        'cart_id', new.cart_id,
        'location_id', new.location_id,
        'status', new.status
      )::text
    );
  end if;
  return null;
end $$;

comment on function merchant.tg_notify_tender_attempt() is
  'The realtime nudge of the tender path: on a RESOLUTION (succeeded / declined / cancelled) it NOTIFYs umi_tender_attempt with IDS ONLY, and the till re-reads the attempt over RLS REST. Modelled on merchant.tg_notify_conversation_message. Fires on insert and on a status CHANGE, never on a status-rewriting no-op.';

drop trigger if exists payment_attempt_notify_resolution on merchant.pos_payment_attempt;
create trigger payment_attempt_notify_resolution
  after insert or update of status on merchant.pos_payment_attempt
  for each row execute function merchant.tg_notify_tender_attempt();

-- ---------------------------------------------------------------------------
-- 6 · Grants and RLS
--
-- Both tables were created after 90_rls swept the catalog, so each carries its own forced
-- policy and its own grants (see the header for why the two grant sets differ).
--
-- `api` and `worker` get select/insert/update on both. The request path writes the binding
-- from the /devices screen and reads the credential to call the provider; the worker is the
-- one that performs the OAuth refresh (D8 is a job, not a hope) and the one that resolves an
-- attempt onto a terminal. This file grants NO delete: a credential is replaced in place and
-- a terminal binding is corrected by an UPDATE. (`worker` does hold delete on both through
-- 90_rls' default privileges, exactly as it does on 70_tender's `fiscal_document`; nothing in
-- the tender path exercises it, and revoking a shared default here would be a change this
-- file has no business making on its way past.)
--
-- `device_point_terminal` additionally gives `readonly` select, exactly as 70_tender gives it
-- on the fiscal document: it holds no secret.
--
-- `mp_point_credential` is the exception, and the revoke below is the point of it. 90_rls
-- arms `readonly` with select on every new merchant table by default, so "no grant" would
-- have meant nothing here — the read would have arrived anyway. Following 90_rls' own
-- treatment of `merchant.loyalty_wallet_pass`, this file takes the blanket read AWAY and
-- gives back only the columns a diagnostic reader has any use for. The table-level select
-- and the two cipher columns are not among them: a `select *` by `readonly` now fails, which
-- is the intended outcome, and 99_verify asserts both halves by column.
-- ---------------------------------------------------------------------------
grant select,insert,update on merchant.mp_point_credential to api,worker;
grant select,insert,update,delete on merchant.device_point_terminal to api,worker;
grant select on merchant.device_point_terminal to readonly;

revoke select on merchant.mp_point_credential from readonly;
grant select (merchant_id, mp_user_id, access_token_expires_at, refresh_failed_at,
              refresh_attempts, created_at, updated_at)
  on merchant.mp_point_credential to readonly;

alter table merchant.mp_point_credential enable row level security;
alter table merchant.mp_point_credential force row level security;
drop policy if exists mp_point_credential_scope on merchant.mp_point_credential;
create policy mp_point_credential_scope on merchant.mp_point_credential
  using (merchant_id = (select umi.current_merchant()))
  with check (merchant_id = (select umi.current_merchant()));

alter table merchant.device_point_terminal enable row level security;
alter table merchant.device_point_terminal force row level security;
drop policy if exists device_point_terminal_scope on merchant.device_point_terminal;
create policy device_point_terminal_scope on merchant.device_point_terminal
  using (merchant_id = (select umi.current_merchant())
    and ((select umi.current_location()) is null
         or location_id = (select umi.current_location())))
  with check (merchant_id = (select umi.current_merchant())
    and ((select umi.current_location()) is null
         or location_id = (select umi.current_location())));

-- ---------------------------------------------------------------------------
-- 7 · Bookkeeping
--
-- The same trailing statement 70_tender and 71_immutable_delete_fix perform: one version
-- row, guarded so a re-run is a no-op. 99_verify asserts it, so a database that took these
-- objects without the version — or the reverse — fails the build rather than passing on a
-- half-applied shape.
-- ---------------------------------------------------------------------------
insert into runtime.schema_migration(version,status)
values('build-v3-72','applied') on conflict(version) do nothing;

commit;
