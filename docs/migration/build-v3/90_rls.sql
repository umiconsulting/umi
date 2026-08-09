-- ============================================================================
-- build-v3 · 90_rls  — Grants + Row-Level Security   (HARDENED 2026-07-12)
-- Boundary: `api` is RLS-confined to one merchant per request; `worker` has
-- BYPASSRLS; `readonly` reads only (never secrets). Per request the API sets:
--     set local app.current_merchant = '<uuid>'   -- transaction-scoped
-- Isolation is defense-in-depth: least-privilege grants + RLS + FORCE, so a
-- single app-layer bug cannot cross merchants or reach credentials.
-- Consolidated from the security audit (2026-07-12): one grant block, one helper.
-- ============================================================================

-- ---- Fail-closed merchant key: empty/missing GUC -> NULL -> zero rows (never errors) ----
create or replace function umi.current_merchant() returns uuid
  language sql stable
  set search_path = pg_catalog as $$
  select nullif(current_setting('app.current_merchant', true), '')::uuid
$$;
comment on function umi.current_merchant() is
  'The request''s merchant scope. NULL when unset/empty so RLS fails CLOSED (0 rows), never errors.';

-- ---- Location scope: OPTIONAL. NULL means "all locations of the current merchant" ----
-- The dashboard reads across locations, so a NULL location must not empty the result set.
-- Location policies therefore read `umi.current_location() is null or location_id = ...`.
-- This is a narrowing key, not an authorization key: `current_merchant()` is what
-- keeps one café out of another's data.
create or replace function umi.current_location() returns uuid
  language sql stable
  set search_path = pg_catalog as $$
  select nullif(current_setting('app.current_location', true), '')::uuid
$$;
comment on function umi.current_location() is
  'The request''s location narrowing. NULL = every location of the current merchant (dashboard reads).';

-- ---- Device scope: REQUIRED wherever it appears. NULL -> zero rows ----
-- The offline-replay tables are the device's own journal on the server. A request with
-- no proven device has no merchant reading or writing any of them, so those policies
-- demand `umi.current_device() is not null` and fail closed rather than falling back to
-- merchant scope. That asymmetry with current_location() is deliberate.
create or replace function umi.current_device() returns uuid
  language sql stable
  set search_path = pg_catalog as $$
  select nullif(current_setting('app.current_device', true), '')::uuid
$$;
comment on function umi.current_device() is
  'The request''s enrolled device. NULL when unset so device-scoped RLS fails CLOSED (0 rows).';

-- ---- No ambient authority: lock schema public (CVE-2018-1058) and our schemas ----
revoke create on schema public from public;
revoke all on all tables in schema umi, merchant, runtime, kds from public;
revoke all on schema kds from public, api;
grant usage on schema umi, merchant, runtime to api, worker, readonly;
grant usage on schema kds to worker, readonly;
grant select on all tables in schema kds to worker, readonly;

-- ===========================================================================
-- GRANTS — least privilege per role
-- ===========================================================================

-- worker: full DML everywhere (isolation is BYPASSRLS + code correctness).
grant select, insert, update, delete on all tables in schema umi, merchant, runtime to worker;

-- readonly: broad read for diagnostics — but NEVER credentials or auth secrets.
grant select on all tables in schema umi, merchant, runtime to readonly;
revoke select on umi.audit_log from readonly;                       -- sealed Umi-internal
revoke select on runtime.session, runtime.otp, runtime.password_reset_token,
                 runtime.pairing from readonly;   -- auth substrate

-- api (the café REQUEST-PATH role): full DML on merchant (RLS-bound); umi limited to
-- global catalogs + per-café tables (RLS-scoped); minimal, scoped runtime.
grant select, insert, update, delete on all tables in schema merchant to api;

-- Gate 4A writes kitchen authority only through the scoped UMI API repositories.
revoke insert, update, delete on
  merchant.kitchen_route,
  merchant.kitchen_order,
  merchant.kitchen_order_item,
  merchant.kitchen_command,
  merchant.kitchen_event,
  merchant.kitchen_device_station
from api;
grant select on
  merchant.kitchen_route,
  merchant.kitchen_order,
  merchant.kitchen_order_item,
  merchant.kitchen_command,
  merchant.kitchen_event,
  merchant.kitchen_device_station
to api;

-- Gate 3F permits points and stored-value facts only through command boundaries.
revoke insert, update, delete on
  merchant.customer_consent_history,
  merchant.loyalty_points_ledger,
  merchant.loyalty_stored_value_ledger,
  merchant.loyalty_gift_card_ledger
from api, worker;
grant select on
  merchant.customer_consent_history,
  merchant.loyalty_points_ledger,
  merchant.loyalty_stored_value_ledger,
  merchant.loyalty_gift_card_ledger
to api, worker;
revoke all on merchant.gift_card_secret_delivery,merchant.gift_card_lookup_attempt
from api,worker,readonly;
revoke update,delete on merchant.loyalty_earn_preview,merchant.loyalty_sale_policy_snapshot
from api,worker;

-- Gate 3D keeps policy server-owned and committed compensation append-only.
revoke insert, update, delete on merchant.pos_exception_policy from api;
revoke delete on merchant.pos_exception_preview from api;

-- Gate 3E permits stock changes only through the scoped ledger functions.
-- The balance is a rebuildable projection. It is not a direct write boundary.
revoke insert, update, delete on merchant.stock_ledger_entry from api, worker;
revoke insert, update, delete on merchant.stock_balance from api, worker;
grant select on merchant.stock_ledger_entry, merchant.stock_balance to api, worker;
revoke update, delete on
  merchant.pos_sale_exception,
  merchant.pos_sale_exception_line,
  merchant.pos_tender_compensation,
  merchant.pos_cash_compensation,
  merchant.pos_restock_intent,
  merchant.pos_exception_receipt
from api;

--   umi global catalogs — same for every merchant, safe to read cross-merchant
grant select on umi.role, umi.permission, umi.role_permission, umi.channel_type,
                umi.feature, umi.plan, umi.plan_feature to api;
--   umi per-café tables — readable but RLS-scoped to the current merchant (below)
grant select on umi.subscription, umi.subscription_item, umi.invoice,
                umi.entitlement_override to api;
--   NOT granted to api: umi.prospect / prospect_event (Umi sales pipeline),
--     umi.audit_log (sealed), umi.user_role, umi.access_grant. Left ungranted =
--     unreadable by the request path.
--   umi.access_grant is the break-glass table: the only thing that can produce the `*`
--     permission. It is sealed from api for a stronger reason than the others — if the
--     request path could write it, the request path could elevate itself, and every
--     other control in this file would be decoration. runtime.elevation_grant IS
--     granted to api (a till must record its own manager approval), which is exactly
--     why platform elevation could not reuse that table. Reads happen on the worker
--     pool, like every other platform grant.
--   umi.user_role joined that list when it became a PLATFORM-only grant: it holds
--     Umi's own cross-merchant operators and no merchant_id, so there is no predicate
--     that could scope it to one café. The auth queries that read it run on the worker
--     pool. A café's own role grant is merchant.staff.role_id, which api reads under
--     the merchant policy like every other merchant table.
--   umi.effective_entitlement VIEW (security_invoker) — SELECT only:
grant select on umi.effective_entitlement to api;
--   Views are read-only for api (the merchant grant-all handed it DML on the views too).
--   SWEPT, not listed: security_gate.sql asserts "api holds no DML on ANY view", and a
--   hand-maintained list cannot satisfy a universal assertion — it goes stale the first
--   time someone adds a view. It did: merchant.kds_ticket landed and the gate went red.
--   The sweep is the dual of the check, so the two cannot drift apart again. Views are
--   all created upstream of this file (10_umi / 20_merchant), so they are all visible here.
do $$
declare v record;
begin
  for v in select schemaname, viewname
             from pg_views
            where schemaname in ('umi', 'merchant', 'runtime')
  loop
    execute format('revoke insert, update, delete on %I.%I from api', v.schemaname, v.viewname);
  end loop;
end $$;

--   merchant.contact.normalized_value is DERIVED by merchant.tg_contact_normalize (60_triggers),
--   never supplied. Revoking the column makes it UNFORGEABLE: an app can no longer write a
--   hand-rolled normalization into it, which is exactly how the L15 corruption stayed
--   self-consistent (same broken function on read and write). raw is the truth.
--   ⚠️ `revoke update (col) on t from api` DOES NOT WORK once api holds table-level
--   UPDATE — and it does, from the blanket grant above (`api=arwd`). PostgreSQL treats a
--   table-level privilege as covering every column, and a column-level REVOKE cannot
--   subtract from it. This file carried exactly that statement for
--   merchant.contact.normalized_value with a long comment about making the column
--   UNFORGEABLE; the statement had never had any effect. Only its trigger, which fires
--   on INSERT **or UPDATE**, was actually protecting the column.
--
--   The working form is: revoke the table-level UPDATE, then grant UPDATE back on every
--   column except the protected one. Generated rather than listed, so a new column is
--   grantable automatically and cannot silently become read-only.
do $$
declare
  r record;
  cols text;
begin
  for r in select * from (values
    -- table,                  protected column,  why
    ('contact',        'normalized_value'),  -- derived by tg_contact_normalize; raw is the truth
    ('customer_order', 'business_date'),     -- decides which day's revenue and cash-up a sale lands in
    ('pos_cart',       'business_date')
  ) as v(tbl, col)
  loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
      into cols
      from information_schema.columns
     where table_schema = 'merchant' and table_name = r.tbl and column_name <> r.col;
    execute format('revoke update on merchant.%I from api', r.tbl);
    execute format('grant update (%s) on merchant.%I to api', cols, r.tbl);
  end loop;
end $$;

--   runtime — only the machinery the request path legitimately serves, scoped:
grant select, insert, update, delete on runtime.conversation_cart to api;  -- live in-flight cart
grant select, insert          on runtime.reminder_sent    to api;    -- nudge dedup
grant select, insert          on runtime.idempotency_key  to api;    -- request dedup
-- product_embedding: SELECT only. Semantic product search is a REQUEST-path read
-- (the bot's menu fallback), and it is being moved off the BYPASSRLS worker pool onto
-- the RLS-enforced api pool — which it cannot do without reading this table. The row
-- is a vector keyed by product_id and carries no merchant fact of its own; isolation
-- comes from the join to merchant.product, which IS under RLS. No write: only the
-- worker's enrichment pass produces embeddings.
grant select                  on runtime.product_embedding to api;   -- RAG read path
--   NOT granted to api: session/otp/password_reset_token/pairing (auth
--     substrate -> auth definer/worker only), outbox/inbound/dead_letter (queue -> worker),
--     message/knowledge_embedding (RAG -> worker), integration_sync/pass_device.

-- ---- Credentials are NEVER on the request path: column-lock umi.user ----
--   password_hash/salt/algorithm are read ONLY by the worker pool / a SECURITY DEFINER
--   auth function — never by api or readonly. api/readonly see identity columns only.
revoke select on umi.user from api, readonly;
grant  select (id, email, full_name, status, last_login_at, created_at, updated_at)
  on umi.user to api, readonly;
--   The request path DOES mint identities: adding a staff member creates the person
--   who will hold the till PIN. The grant is COLUMN-SCOPED so it can only ever mint a
--   login-less row — password_hash/salt/algorithm are not in the list, so a forged
--   account carries no credential and can authenticate nothing. Column-level INSERT is
--   real in Postgres (unlike the `revoke update (col)` no-op the gate caught earlier),
--   because api holds no table-level INSERT here to override it.
grant  insert (email, full_name, status) on umi.user to api;

-- ---- The wallet web-service token is a bearer secret, not a merchant fact ----
--   merchant.loyalty_wallet_pass.web_service_token is Apple's `authenticationToken`,
--   signed into the .pkpass and replayed on every callback. Holding it is sufficient to
--   read a customer's card and re-download their pass. Apple's call arrives with NO
--   session and NO merchant context, so it is served by the worker pool, never by api.
--   Same generated form as the UPDATE lock above: a table-level SELECT covers every
--   column, so the column must be subtracted by revoking the table grant and granting
--   the rest back.
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
    from information_schema.columns
   where table_schema = 'merchant'
     and table_name   = 'loyalty_wallet_pass'
     and column_name <> 'web_service_token';
  execute 'revoke select on merchant.loyalty_wallet_pass from api, readonly';
  execute format('grant select (%s) on merchant.loyalty_wallet_pass to api, readonly', cols);
  execute 'revoke insert, update on merchant.loyalty_wallet_pass from api';
  execute format('grant insert (%s), update (%s) on merchant.loyalty_wallet_pass to api',
                 cols, cols);
end $$;

-- ---- Append-only audit: nobody (not even worker) updates/deletes an audit row ----
revoke update, delete on umi.audit_log, merchant.audit_log from api, worker, readonly;

-- ---- Future tables: do NOT auto-arm the request path. api gets explicit grants only.
--   (worker = trusted machinery, readonly = non-secret schemas.)
alter default privileges in schema merchant, runtime grant select, insert, update, delete on tables to worker;
alter default privileges in schema umi             grant select on tables to worker;
alter default privileges in schema merchant, runtime grant select on tables to readonly;

-- ===========================================================================
-- RLS — merchant.*  (every base table scoped to the current merchant, FORCED)
-- ===========================================================================

-- Root: merchant keys on id.
alter table merchant.merchant enable row level security;
alter table merchant.merchant force  row level security;
create policy merchant_isolation on merchant.merchant
  using      (id = umi.current_merchant())
  with check (id = umi.current_merchant());

-- Tables carrying merchant_id directly: one uniform policy + FORCE.
do $$
declare r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema=c.table_schema and t.table_name=c.table_name
    where c.table_schema='merchant' and c.column_name='merchant_id'
      and t.table_type='BASE TABLE'
  loop
    execute format('alter table merchant.%I enable row level security', r.table_name);
    execute format('alter table merchant.%I force  row level security', r.table_name);
    execute format($f$create policy merchant_isolation on merchant.%I
      using      (merchant_id = umi.current_merchant())
      with check (merchant_id = umi.current_merchant())$f$, r.table_name);
  end loop;
end $$;

-- Child tables (no merchant_id): scope via parent. USING covers read/update/delete;
-- WITH CHECK blocks grafting a child under another merchant's parent.
do $$
declare r record;
begin
  -- `station` was HERE, scoped via location. It moved out when it gained merchant_id, and
  -- it had to move in the same change: the loop above is a dynamic sweep over every
  -- merchant table with a merchant_id, so leaving this row would create a SECOND
  -- merchant_isolation policy on station and abort the whole RLS rebuild with 42710.
  -- Scoping via location was also wrong on its own terms — a station with location_id NULL
  -- ("every location") joins to nothing and would have been invisible to its owner.
  for r in select * from (values
    ('loyalty_wallet_pass',         'loyalty_card',      'card_id',         'id'),
    ('product_option_group',        'product',           'product_id',      'id'),
    ('product_location_availability', 'product',           'product_id',      'id'),
    ('message',                     'conversation',      'conversation_id', 'id'),
    ('knowledge_chunk',             'knowledge_document','document_id',     'id'),
    ('order_item',                  'customer_order',    'order_id',        'id'),
    ('order_event',                 'customer_order',    'order_id',        'id'),
    ('payment',                     'customer_order',    'order_id',        'id')
  ) as v(child, parent, fk, pk)
  loop
    execute format('alter table merchant.%I enable row level security', r.child);
    execute format('alter table merchant.%I force  row level security', r.child);
    execute format($f$create policy merchant_isolation on merchant.%I
      using (exists (select 1 from merchant.%I p where p.%I = merchant.%I.%I
                       and p.merchant_id = umi.current_merchant()))
      with check (exists (select 1 from merchant.%I p where p.%I = merchant.%I.%I
                       and p.merchant_id = umi.current_merchant()))$f$,
      r.child, r.parent, r.pk, r.child, r.fk, r.parent, r.pk, r.child, r.fk);
  end loop;
end $$;

-- product_modifier: two hops (option_group -> product).
alter table merchant.product_modifier enable row level security;
alter table merchant.product_modifier force  row level security;
create policy merchant_isolation on merchant.product_modifier
  using (exists (select 1 from merchant.product_option_group g
                   join merchant.product p on p.id = g.product_id
                  where g.id = product_modifier.option_group_id
                    and p.merchant_id = umi.current_merchant()))
  with check (exists (select 1 from merchant.product_option_group g
                   join merchant.product p on p.id = g.product_id
                  where g.id = product_modifier.option_group_id
                    and p.merchant_id = umi.current_merchant()));

-- refund: two hops (payment -> customer_order).
alter table merchant.refund enable row level security;
alter table merchant.refund force  row level security;
create policy merchant_isolation on merchant.refund
  using (exists (select 1 from merchant.payment pay
                   join merchant.customer_order o on o.id = pay.order_id
                  where pay.id = refund.payment_id
                    and o.merchant_id = umi.current_merchant()))
  with check (exists (select 1 from merchant.payment pay
                   join merchant.customer_order o on o.id = pay.order_id
                  where pay.id = refund.payment_id
                    and o.merchant_id = umi.current_merchant()));

-- ===========================================================================
-- RLS — umi.*  per-café tables (catalogs stay global; credentials column-locked)
-- ===========================================================================
alter table umi.subscription enable row level security;
alter table umi.subscription force  row level security;
create policy merchant_isolation on umi.subscription
  using      (merchant_id = umi.current_merchant())
  with check (merchant_id = umi.current_merchant());

alter table umi.invoice enable row level security;
alter table umi.invoice force  row level security;
create policy merchant_isolation on umi.invoice
  using      (merchant_id = umi.current_merchant())
  with check (merchant_id = umi.current_merchant());

-- umi.user_role has NO policy on purpose. It is a platform grant table with no
-- merchant_id, so no predicate could scope it to one café; it is sealed by GRANT
-- instead, like umi.audit_log (see the grant block above). security_gate.sql asserts
-- that api and readonly cannot SELECT it.

-- umi.access_grant has NO policy for the same reason, and needs none for a second one:
-- api holds no grant on it at all, so there is nothing for a policy to constrain. Its
-- merchant_id is nullable by design (a platform action has no café), which is itself a
-- reason a policy would be wrong here — `merchant_id = umi.current_merchant()` returns
-- NULL for a platform row, and a USING clause that returns NULL hides the row silently
-- while WITH CHECK raises. Sealed by GRANT, asserted by security_gate.sql.

-- subscription_item / entitlement_override: scope via subscription.merchant_id.
alter table umi.subscription_item enable row level security;
alter table umi.subscription_item force  row level security;
create policy merchant_isolation on umi.subscription_item
  using (exists (select 1 from umi.subscription s where s.id = subscription_item.subscription_id
                   and s.merchant_id = umi.current_merchant()))
  with check (exists (select 1 from umi.subscription s where s.id = subscription_item.subscription_id
                   and s.merchant_id = umi.current_merchant()));

alter table umi.entitlement_override enable row level security;
alter table umi.entitlement_override force  row level security;
create policy merchant_isolation on umi.entitlement_override
  using (exists (select 1 from umi.subscription s where s.id = entitlement_override.subscription_id
                   and s.merchant_id = umi.current_merchant()))
  with check (exists (select 1 from umi.subscription s where s.id = entitlement_override.subscription_id
                   and s.merchant_id = umi.current_merchant()));

-- ===========================================================================
-- RLS — runtime.*  (only the two request-path tables; rest is worker-only)
-- ===========================================================================
alter table runtime.reminder_sent enable row level security;
alter table runtime.reminder_sent force  row level security;
create policy merchant_isolation on runtime.reminder_sent
  using      (merchant_id = umi.current_merchant())
  with check (merchant_id = umi.current_merchant());

alter table runtime.conversation_cart enable row level security;
alter table runtime.conversation_cart force  row level security;
create policy merchant_isolation on runtime.conversation_cart
  using (exists (select 1 from merchant.conversation cv where cv.id = conversation_cart.conversation_id
                   and cv.merchant_id = umi.current_merchant()))
  with check (exists (select 1 from merchant.conversation cv where cv.id = conversation_cart.conversation_id
                   and cv.merchant_id = umi.current_merchant()));

-- Merchant-scoped the moment it gained a merchant_id (2026-07-29, queue-cluster restore).
-- `api` holds select+insert on it for request dedup, and the universal gate check caught
-- this within one run of adding the column — which is the whole argument for stating a
-- check as a universal rather than a list of table names.
alter table runtime.idempotency_key enable row level security;
alter table runtime.idempotency_key force  row level security;
create policy merchant_isolation on runtime.idempotency_key
  using      (merchant_id = umi.current_merchant())
  with check (merchant_id = umi.current_merchant());

alter table runtime.conversation_turn enable row level security;
alter table runtime.conversation_turn force  row level security;
create policy merchant_isolation on runtime.conversation_turn
  using (exists (select 1 from merchant.conversation cv where cv.id = conversation_turn.conversation_id
                   and cv.merchant_id = umi.current_merchant()))
  with check (exists (select 1 from merchant.conversation cv where cv.id = conversation_turn.conversation_id
                   and cv.merchant_id = umi.current_merchant()));

-- ===========================================================================
-- RLS — POS: location narrowing and device scoping
-- ===========================================================================
-- These are RESTRICTIVE policies. PERMISSIVE policies OR together; RESTRICTIVE ones
-- AND with everything else. So the merchant_isolation policy created by the sweep above
-- still decides WHICH MERCHANT, and these can only narrow it further — a location or
-- device policy can never widen access to another café's rows.
--
-- Why two different postures:
--   LOCATION is a narrowing. The dashboard reads across every location and sets no location
--   GUC, so NULL must mean "all locations", not "no rows". Making location fail closed
--   would blank the owner's own reports.
--   DEVICE is authorization. The replay tables are one terminal's journal held on the
--   server. A request that cannot prove which device it is has no merchant reading any
--   of them, so NULL means zero rows.

-- ---- Location narrowing: SWEPT, with a recorded opt-OUT ----
-- This was an opt-IN list of table names, which is the booby-trap this file already
-- warns about for the child-table list: a new merchant table with a location_id that
-- nobody remembers to add gets NO narrowing, silently, and the failure is open. The
-- sweep inverts it — forgetting now yields narrowing, which is the safe direction.
--
-- ONE predicate serves both column shapes. Where location_id is NOT NULL the
-- `location_id is null` disjunct is simply never true, so it costs nothing; where it is
-- nullable, a merchant-wide row (no location) stays visible to a location-scoped caller,
-- which is what "this fact belongs to the whole café" means.
--
-- The opt-out list is short and each entry is a claim about the DATA, not a
-- convenience:
--   staff          — manager approval reaches ACROSS locations. Narrowing staff would
--                    make a manager at another location unreachable to authorize a void,
--                    which is precisely when you need one.
--   loyalty_visit  — a stamp count is a property of the CARD, merchant-wide. A café
--                    with two locations would undercount a customer's stamps the moment
--                    a till set its location, and quietly deny an earned reward.
do $$
declare
  t record;
  skip constant text[] := array['staff', 'loyalty_visit'];
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'merchant' and c.relkind = 'r'          -- base tables only; a view has no policies
       and exists (select 1 from information_schema.columns col
                    where col.table_schema = 'merchant' and col.table_name = c.relname
                      and col.column_name = 'location_id')
       and not (c.relname = any(skip))
     order by c.relname
  loop
    execute format($f$create policy location_narrowing on merchant.%I as restrictive
      using      (umi.current_location() is null or location_id is null
                  or location_id = umi.current_location())
      with check (umi.current_location() is null or location_id is null
                  or location_id = umi.current_location())$f$, t.relname);
  end loop;
end $$;

-- ---- Device scoping: FAIL CLOSED. No proven device, no rows. ----
-- This is the policy set that was inert on the source location: the API never set
-- app.current_device, and the repositories ran on the BYPASSRLS worker pool, so
-- nothing ever evaluated these predicates. pg.service.ts now sets the GUC and the POS
-- repositories run as `api`, which is what makes this real rather than decorative.
--
-- Deliberately opt-IN, unlike location narrowing above. Device scoping is the strongest
-- restriction in this file — it hides a row from everyone who cannot prove which
-- terminal they are — so applying it by sweep would silently blind the dashboard to
-- any future device-related table it legitimately reads. Opt-in, plus the assertion
-- below so that forgetting is LOUD instead of silent.
do $$
declare t text;
begin
  foreach t in array array[
    'device_replay_cursor', 'offline_replay_command', 'offline_reconciliation',
    'offline_replay_conflict', 'offline_provisional_mapping',
    'pos_checkout_draft', 'cash_shift',
    'pos_exception_preview', 'pos_sale_exception',
    'inventory_count'
  ] loop
    execute format($f$create policy device_scoping on merchant.%I as restrictive
      using      (umi.current_device() is not null and device_id = umi.current_device())
      with check (umi.current_device() is not null and device_id = umi.current_device())$f$, t);
  end loop;
end $$;

-- Every merchant table carrying a device_id must have made a DECISION about device
-- scoping — either it is scoped above, or it is named here as deliberately not. A new
-- table that does neither aborts the build rather than shipping unscoped.
do $$
declare
  undecided text[];
  -- Ledger history belongs to the merchant and location. Its device_id records provenance.
  -- A later trusted device can read the original fact for refund and support workflows.
  not_device_scoped constant text[] := array[
    'stock_ledger_entry',
    'loyalty_points_ledger',
    'loyalty_stored_value_ledger',
    'loyalty_gift_card_ledger',
    -- These rows record a target device or command actor. The column is provenance.
    -- Merchant, location, permission, and station checks control access.
    'kitchen_command',
    'kitchen_device_station'
  ]::text[];
begin
  select array_agg(c.relname order by c.relname) into undecided
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'merchant' and c.relkind = 'r'
     and exists (select 1 from information_schema.columns col
                  where col.table_schema = 'merchant' and col.table_name = c.relname
                    and col.column_name = 'device_id')
     and not exists (select 1 from pg_policy p
                      where p.polrelid = c.oid and p.polname = 'device_scoping')
     and not (c.relname = any(not_device_scoped));
  if undecided is not null then
    raise exception
      'merchant tables carry device_id with no device-scoping decision: %. Scope them or name them in not_device_scoped.',
      undecided;
  end if;
end $$;

-- ===========================================================================
-- RLS — runtime.*  POS device trust and operator presence
-- ===========================================================================
-- These join the two request-path runtime tables above. They are on the request path
-- because the POS runs as `api`, not as the worker: an operator session that only the
-- BYPASSRLS pool can write is an operator session with no merchant isolation at all.
alter table runtime.operator_session enable row level security;
alter table runtime.operator_session force  row level security;
create policy merchant_isolation on runtime.operator_session
  using      (merchant_id = umi.current_merchant())
  with check (merchant_id = umi.current_merchant());
create policy location_narrowing on runtime.operator_session as restrictive
  using      (umi.current_location() is null or location_id = umi.current_location())
  with check (umi.current_location() is null or location_id = umi.current_location());

alter table runtime.device_enrollment_challenge enable row level security;
alter table runtime.device_enrollment_challenge force  row level security;
create policy merchant_isolation on runtime.device_enrollment_challenge
  using      (merchant_id = umi.current_merchant())
  with check (merchant_id = umi.current_merchant());

alter table runtime.elevation_grant enable row level security;
alter table runtime.elevation_grant force  row level security;
create policy merchant_isolation on runtime.elevation_grant
  using      (merchant_id = umi.current_merchant())
  with check (merchant_id = umi.current_merchant());

-- The two write-only audit tables. api holds INSERT and nothing else, but INSERT alone
-- is enough to forge a security event against another café — WITH CHECK is what stops
-- that. `merchant_id is null` is permitted because these are soft refs: a platform-level
-- security event (a login attempt against an account with no merchant yet) has no
-- merchant to name, and audit exhaust must outlive whatever it describes.
alter table runtime.security_audit_event enable row level security;
alter table runtime.security_audit_event force  row level security;
create policy merchant_isolation on runtime.security_audit_event
  using      (merchant_id is null or merchant_id = umi.current_merchant())
  with check (merchant_id is null or merchant_id = umi.current_merchant());

alter table runtime.audit_event_internal enable row level security;
alter table runtime.audit_event_internal force  row level security;
create policy merchant_isolation on runtime.audit_event_internal
  using      (merchant_id = umi.current_merchant())
  with check (merchant_id = umi.current_merchant());

-- ===========================================================================
-- GRANTS — the POS request path
-- ===========================================================================
-- merchant.* is already granted to api by the blanket grant above and confined by RLS.
-- runtime.* is sealed by default, so every POS need is listed explicitly here.

--   Operator presence: the POS starts, locks and ends shifts on the request path.
grant select, insert, update on runtime.operator_session to api;
--   Elevation: request a grant, then consume it. Never delete one — a consumed
--   approval is evidence.
grant select, insert, update on runtime.elevation_grant to api;
--   Enrolment: the dashboard creates the challenge, the device consumes it.
grant select, insert, update on runtime.device_enrollment_challenge to api;
--   Security decisions and the unredacted half of an audit event are WRITE-ONLY for
--   the request path. The POS records a denial; it must never be able to read back
--   another café's denials, or its own investigators' notes.
grant insert on runtime.security_audit_event to api;
grant insert on runtime.audit_event_internal to api;
revoke select, update, delete on runtime.security_audit_event from api;
revoke select, update, delete on runtime.audit_event_internal from api;
--   readonly must not see the auth substrate either.
revoke select on runtime.operator_session, runtime.device_enrollment_challenge,
                 runtime.elevation_grant, runtime.security_audit_event,
                 runtime.audit_event_internal from readonly;

-- ---- Append-only: history that can be edited is not history ----
-- The triggers in 60_triggers refuse the write; these revokes mean the attempt never
-- reaches a trigger. Belt and braces, because this is the money.
revoke update, delete on
  merchant.audit_event, merchant.financial_event, merchant.receipt_snapshot,
  merchant.pos_committed_sale, merchant.offline_replay_command,
  merchant.offline_provisional_mapping
  from api, worker, readonly;
revoke update, delete on runtime.security_audit_event, runtime.audit_event_internal
  from worker;

-- ---- Policies are read-only to everyone but the platform ----
-- A café cannot raise its own offline cash limit; that is the entire point of a limit.
revoke insert, update, delete on merchant.pos_offline_policy, merchant.pos_offline_cash_policy
  from api, readonly;
revoke all on umi.audit_retention_policy from api, readonly;
-- A permission override is READ by the request path and WRITTEN by nothing on it. If
-- api could insert effect='allow', a compromised request path would grant itself any
-- permission it liked, and the deny rows would be deletable by the party they restrain.
-- Writes go through the worker pool. RLS still scopes the reads: the table carries
-- merchant_id, so the merchant_isolation loop covered it already.
revoke insert, update, delete on merchant.staff_permission_override from api, readonly;
grant  select on merchant.staff_permission_override to api;

-- ---- The offline reconciliation acknowledgement is the ONE column a device may set ----
revoke update on merchant.offline_reconciliation from api;
grant  update (acknowledged_at) on merchant.offline_reconciliation to api;
revoke update on merchant.offline_replay_conflict from api;
grant  update (last_observed_at, resolution_state, resolution_acknowledged_at)
  on merchant.offline_replay_conflict to api;

-- Gate 3F customer history is available only through the scoped function.
revoke all on merchant.customer_history_event,merchant.customer_history_event_scoped
  from api,worker,readonly;
do $$ begin
  if to_regprocedure('merchant.read_customer_history_event_scoped(uuid,uuid)') is not null then
    execute 'revoke all on function merchant.read_customer_history_event_scoped(uuid,uuid) '
      'from public,api,worker,readonly';
  end if;
end $$;
grant execute on function merchant.read_customer_history_event_scoped(
  uuid,uuid,uuid
) to api;
do $$ begin
  if to_regprocedure('merchant.read_customer_history_event_scoped(uuid,uuid,uuid,boolean,boolean,boolean)') is not null then
    execute 'revoke all on function merchant.read_customer_history_event_scoped(uuid,uuid,uuid,boolean,boolean,boolean) '
      'from public,api,worker,readonly';
  end if;
end $$;
revoke all on function merchant.commit_customer_value_closeout(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,text,date,uuid,uuid,jsonb
) from public,api,worker,readonly;
revoke all on function merchant.activate_sale_funded_gift_card(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,date,jsonb
) from public,api,worker,readonly;
