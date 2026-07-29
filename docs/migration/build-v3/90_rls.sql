-- ============================================================================
-- build-v3 · 90_rls  — Grants + Row-Level Security   (HARDENED 2026-07-12)
-- Boundary: `api` is RLS-confined to one business per request; `worker` has
-- BYPASSRLS; `readonly` reads only (never secrets). Per request the API sets:
--     set local app.current_business = '<uuid>'   -- transaction-scoped
-- Isolation is defense-in-depth: least-privilege grants + RLS + FORCE, so a
-- single app-layer bug cannot cross tenants or reach credentials.
-- Consolidated from the security audit (2026-07-12): one grant block, one helper.
-- ============================================================================

-- ---- Fail-closed tenant key: empty/missing GUC -> NULL -> zero rows (never errors) ----
create or replace function umi.current_business() returns uuid
  language sql stable
  set search_path = pg_catalog as $$
  select nullif(current_setting('app.current_business', true), '')::uuid
$$;
comment on function umi.current_business() is
  'The request''s tenant scope. NULL when unset/empty so RLS fails CLOSED (0 rows), never errors.';

-- ---- Branch scope: OPTIONAL. NULL means "all branches of the current business" ----
-- The dashboard reads across branches, so a NULL branch must not empty the result set.
-- Branch policies therefore read `umi.current_branch() is null or branch_id = ...`.
-- This is a narrowing key, not an authorization key: `current_business()` is what
-- keeps one café out of another's data.
create or replace function umi.current_branch() returns uuid
  language sql stable
  set search_path = pg_catalog as $$
  select nullif(current_setting('app.current_branch', true), '')::uuid
$$;
comment on function umi.current_branch() is
  'The request''s branch narrowing. NULL = every branch of the current business (dashboard reads).';

-- ---- Device scope: REQUIRED wherever it appears. NULL -> zero rows ----
-- The offline-replay tables are the device's own journal on the server. A request with
-- no proven device has no business reading or writing any of them, so those policies
-- demand `umi.current_device() is not null` and fail closed rather than falling back to
-- business scope. That asymmetry with current_branch() is deliberate.
create or replace function umi.current_device() returns uuid
  language sql stable
  set search_path = pg_catalog as $$
  select nullif(current_setting('app.current_device', true), '')::uuid
$$;
comment on function umi.current_device() is
  'The request''s enrolled device. NULL when unset so device-scoped RLS fails CLOSED (0 rows).';

-- ---- No ambient authority: lock schema public (CVE-2018-1058) and our schemas ----
revoke create on schema public from public;
revoke all on all tables in schema umi, tenant, runtime from public;
grant usage on schema umi, tenant, runtime to api, worker, readonly;

-- ===========================================================================
-- GRANTS — least privilege per role
-- ===========================================================================

-- worker: full DML everywhere (isolation is BYPASSRLS + code correctness).
grant select, insert, update, delete on all tables in schema umi, tenant, runtime to worker;

-- readonly: broad read for diagnostics — but NEVER credentials or auth secrets.
grant select on all tables in schema umi, tenant, runtime to readonly;
revoke select on umi.audit_log from readonly;                       -- sealed Umi-internal
revoke select on runtime.session, runtime.otp, runtime.password_reset_token,
                 runtime.pairing from readonly;   -- auth substrate

-- api (the café REQUEST-PATH role): full DML on tenant (RLS-bound); umi limited to
-- global catalogs + per-café tables (RLS-scoped); minimal, scoped runtime.
grant select, insert, update, delete on all tables in schema tenant to api;

--   umi global catalogs — same for every tenant, safe to read cross-tenant
grant select on umi.role, umi.permission, umi.role_permission, umi.channel_type,
                umi.feature, umi.plan, umi.plan_feature to api;
--   umi per-café tables — readable but RLS-scoped to the current business (below)
grant select on umi.subscription, umi.subscription_item, umi.invoice,
                umi.entitlement_override, umi.user_role to api;
--   NOT granted to api: umi.prospect / prospect_event (Umi sales pipeline),
--     umi.audit_log (sealed). Left ungranted = unreadable by the request path.
--   umi.effective_entitlement VIEW (security_invoker) — SELECT only:
grant select on umi.effective_entitlement to api;
--   Views are read-only for api (the tenant grant-all handed it DML on the views too).
--   SWEPT, not listed: security_gate.sql asserts "api holds no DML on ANY view", and a
--   hand-maintained list cannot satisfy a universal assertion — it goes stale the first
--   time someone adds a view. It did: tenant.kds_ticket landed and the gate went red.
--   The sweep is the dual of the check, so the two cannot drift apart again. Views are
--   all created upstream of this file (10_umi / 20_tenant), so they are all visible here.
do $$
declare v record;
begin
  for v in select schemaname, viewname
             from pg_views
            where schemaname in ('umi', 'tenant', 'runtime')
  loop
    execute format('revoke insert, update, delete on %I.%I from api', v.schemaname, v.viewname);
  end loop;
end $$;

--   tenant.contact.normalized_value is DERIVED by tenant.tg_contact_normalize (60_triggers),
--   never supplied. Revoking the column makes it UNFORGEABLE: an app can no longer write a
--   hand-rolled normalization into it, which is exactly how the L15 corruption stayed
--   self-consistent (same broken function on read and write). raw is the truth.
revoke update (normalized_value) on tenant.contact from api;

--   runtime — only the machinery the request path legitimately serves, scoped:
grant select, insert, update, delete on runtime.conversation_cart to api;  -- live in-flight cart
grant select, insert          on runtime.reminder_sent    to api;    -- nudge dedup
grant select, insert          on runtime.idempotency_key  to api;    -- request dedup
-- product_embedding: SELECT only. Semantic product search is a REQUEST-path read
-- (the bot's menu fallback), and it is being moved off the BYPASSRLS worker pool onto
-- the RLS-enforced api pool — which it cannot do without reading this table. The row
-- is a vector keyed by product_id and carries no tenant fact of its own; isolation
-- comes from the join to tenant.product, which IS under RLS. No write: only the
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

-- ---- Append-only audit: nobody (not even worker) updates/deletes an audit row ----
revoke update, delete on umi.audit_log, tenant.audit_log from api, worker, readonly;

-- ---- Future tables: do NOT auto-arm the request path. api gets explicit grants only.
--   (worker = trusted machinery, readonly = non-secret schemas.)
alter default privileges in schema tenant, runtime grant select, insert, update, delete on tables to worker;
alter default privileges in schema umi             grant select on tables to worker;
alter default privileges in schema tenant, runtime grant select on tables to readonly;

-- ===========================================================================
-- RLS — tenant.*  (every base table scoped to the current business, FORCED)
-- ===========================================================================

-- Root: business keys on id.
alter table tenant.business enable row level security;
alter table tenant.business force  row level security;
create policy tenant_isolation on tenant.business
  using      (id = umi.current_business())
  with check (id = umi.current_business());

-- Tables carrying business_id directly: one uniform policy + FORCE.
do $$
declare r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema=c.table_schema and t.table_name=c.table_name
    where c.table_schema='tenant' and c.column_name='business_id'
      and t.table_type='BASE TABLE'
  loop
    execute format('alter table tenant.%I enable row level security', r.table_name);
    execute format('alter table tenant.%I force  row level security', r.table_name);
    execute format($f$create policy tenant_isolation on tenant.%I
      using      (business_id = umi.current_business())
      with check (business_id = umi.current_business())$f$, r.table_name);
  end loop;
end $$;

-- Child tables (no business_id): scope via parent. USING covers read/update/delete;
-- WITH CHECK blocks grafting a child under another tenant's parent.
do $$
declare r record;
begin
  -- `station` was HERE, scoped via branch. It moved out when it gained business_id, and
  -- it had to move in the same change: the loop above is a dynamic sweep over every
  -- tenant table with a business_id, so leaving this row would create a SECOND
  -- tenant_isolation policy on station and abort the whole RLS rebuild with 42710.
  -- Scoping via branch was also wrong on its own terms — a station with branch_id NULL
  -- ("every branch") joins to nothing and would have been invisible to its owner.
  for r in select * from (values
    ('loyalty_wallet_pass',         'loyalty_card',      'card_id',         'id'),
    ('product_option_group',        'product',           'product_id',      'id'),
    ('product_branch_availability', 'product',           'product_id',      'id'),
    ('message',                     'conversation',      'conversation_id', 'id'),
    ('knowledge_chunk',             'knowledge_document','document_id',     'id'),
    ('order_item',                  'customer_order',    'order_id',        'id'),
    ('order_event',                 'customer_order',    'order_id',        'id'),
    ('payment',                     'customer_order',    'order_id',        'id')
  ) as v(child, parent, fk, pk)
  loop
    execute format('alter table tenant.%I enable row level security', r.child);
    execute format('alter table tenant.%I force  row level security', r.child);
    execute format($f$create policy tenant_isolation on tenant.%I
      using (exists (select 1 from tenant.%I p where p.%I = tenant.%I.%I
                       and p.business_id = umi.current_business()))
      with check (exists (select 1 from tenant.%I p where p.%I = tenant.%I.%I
                       and p.business_id = umi.current_business()))$f$,
      r.child, r.parent, r.pk, r.child, r.fk, r.parent, r.pk, r.child, r.fk);
  end loop;
end $$;

-- product_modifier: two hops (option_group -> product).
alter table tenant.product_modifier enable row level security;
alter table tenant.product_modifier force  row level security;
create policy tenant_isolation on tenant.product_modifier
  using (exists (select 1 from tenant.product_option_group g
                   join tenant.product p on p.id = g.product_id
                  where g.id = product_modifier.option_group_id
                    and p.business_id = umi.current_business()))
  with check (exists (select 1 from tenant.product_option_group g
                   join tenant.product p on p.id = g.product_id
                  where g.id = product_modifier.option_group_id
                    and p.business_id = umi.current_business()));

-- refund: two hops (payment -> customer_order).
alter table tenant.refund enable row level security;
alter table tenant.refund force  row level security;
create policy tenant_isolation on tenant.refund
  using (exists (select 1 from tenant.payment pay
                   join tenant.customer_order o on o.id = pay.order_id
                  where pay.id = refund.payment_id
                    and o.business_id = umi.current_business()))
  with check (exists (select 1 from tenant.payment pay
                   join tenant.customer_order o on o.id = pay.order_id
                  where pay.id = refund.payment_id
                    and o.business_id = umi.current_business()));

-- ===========================================================================
-- RLS — umi.*  per-café tables (catalogs stay global; credentials column-locked)
-- ===========================================================================
alter table umi.subscription enable row level security;
alter table umi.subscription force  row level security;
create policy tenant_isolation on umi.subscription
  using      (business_id = umi.current_business())
  with check (business_id = umi.current_business());

alter table umi.invoice enable row level security;
alter table umi.invoice force  row level security;
create policy tenant_isolation on umi.invoice
  using      (business_id = umi.current_business())
  with check (business_id = umi.current_business());

alter table umi.user_role enable row level security;
alter table umi.user_role force  row level security;
create policy tenant_isolation on umi.user_role
  using      (business_id = umi.current_business())
  with check (business_id = umi.current_business());

-- subscription_item / entitlement_override: scope via subscription.business_id.
alter table umi.subscription_item enable row level security;
alter table umi.subscription_item force  row level security;
create policy tenant_isolation on umi.subscription_item
  using (exists (select 1 from umi.subscription s where s.id = subscription_item.subscription_id
                   and s.business_id = umi.current_business()))
  with check (exists (select 1 from umi.subscription s where s.id = subscription_item.subscription_id
                   and s.business_id = umi.current_business()));

alter table umi.entitlement_override enable row level security;
alter table umi.entitlement_override force  row level security;
create policy tenant_isolation on umi.entitlement_override
  using (exists (select 1 from umi.subscription s where s.id = entitlement_override.subscription_id
                   and s.business_id = umi.current_business()))
  with check (exists (select 1 from umi.subscription s where s.id = entitlement_override.subscription_id
                   and s.business_id = umi.current_business()));

-- ===========================================================================
-- RLS — runtime.*  (only the two request-path tables; rest is worker-only)
-- ===========================================================================
alter table runtime.reminder_sent enable row level security;
alter table runtime.reminder_sent force  row level security;
create policy tenant_isolation on runtime.reminder_sent
  using      (business_id = umi.current_business())
  with check (business_id = umi.current_business());

alter table runtime.conversation_cart enable row level security;
alter table runtime.conversation_cart force  row level security;
create policy tenant_isolation on runtime.conversation_cart
  using (exists (select 1 from tenant.conversation cv where cv.id = conversation_cart.conversation_id
                   and cv.business_id = umi.current_business()))
  with check (exists (select 1 from tenant.conversation cv where cv.id = conversation_cart.conversation_id
                   and cv.business_id = umi.current_business()));

alter table runtime.conversation_turn enable row level security;
alter table runtime.conversation_turn force  row level security;
create policy tenant_isolation on runtime.conversation_turn
  using (exists (select 1 from tenant.conversation cv where cv.id = conversation_turn.conversation_id
                   and cv.business_id = umi.current_business()))
  with check (exists (select 1 from tenant.conversation cv where cv.id = conversation_turn.conversation_id
                   and cv.business_id = umi.current_business()));

-- ===========================================================================
-- RLS — POS: branch narrowing and device scoping
-- ===========================================================================
-- These are RESTRICTIVE policies. PERMISSIVE policies OR together; RESTRICTIVE ones
-- AND with everything else. So the tenant_isolation policy created by the sweep above
-- still decides WHICH BUSINESS, and these can only narrow it further — a branch or
-- device policy can never widen access to another café's rows.
--
-- Why two different postures:
--   BRANCH is a narrowing. The dashboard reads across every branch and sets no branch
--   GUC, so NULL must mean "all branches", not "no rows". Making branch fail closed
--   would blank the owner's own reports.
--   DEVICE is authorization. The replay tables are one terminal's journal held on the
--   server. A request that cannot prove which device it is has no business reading any
--   of them, so NULL means zero rows.

-- ---- Branch narrowing (nullable branch_id: a row with no branch is business-wide) ----
do $$
declare t text;
begin
  foreach t in array array[
    'business_command', 'audit_event', 'financial_event'
  ] loop
    execute format($f$create policy branch_narrowing on tenant.%I as restrictive
      using      (umi.current_branch() is null or branch_id is null
                  or branch_id = umi.current_branch())
      with check (umi.current_branch() is null or branch_id is null
                  or branch_id = umi.current_branch())$f$, t);
  end loop;
end $$;

-- ---- Branch narrowing (branch_id NOT NULL: every row belongs to one branch) ----
do $$
declare t text;
begin
  foreach t in array array[
    'pos_cart', 'inventory_reservation', 'pos_payment_attempt', 'receipt_snapshot',
    'pos_committed_sale', 'pos_offline_cash_policy', 'device_replay_cursor',
    'offline_replay_command', 'offline_reconciliation', 'offline_replay_conflict',
    'offline_provisional_mapping'
  ] loop
    execute format($f$create policy branch_narrowing on tenant.%I as restrictive
      using      (umi.current_branch() is null or branch_id = umi.current_branch())
      with check (umi.current_branch() is null or branch_id = umi.current_branch())$f$, t);
  end loop;
end $$;

-- ---- Device scoping: FAIL CLOSED. No proven device, no rows. ----
-- This is the policy set that was inert on the source branch: the API never set
-- app.current_device, and the repositories ran on the BYPASSRLS worker pool, so
-- nothing ever evaluated these predicates. pg.service.ts now sets the GUC and the POS
-- repositories run as `api`, which is what makes this real rather than decorative.
do $$
declare t text;
begin
  foreach t in array array[
    'device_replay_cursor', 'offline_replay_command', 'offline_reconciliation',
    'offline_replay_conflict', 'offline_provisional_mapping'
  ] loop
    execute format($f$create policy device_scoping on tenant.%I as restrictive
      using      (umi.current_device() is not null and device_id = umi.current_device())
      with check (umi.current_device() is not null and device_id = umi.current_device())$f$, t);
  end loop;
end $$;

-- ===========================================================================
-- RLS — runtime.*  POS device trust and operator presence
-- ===========================================================================
-- These join the two request-path runtime tables above. They are on the request path
-- because the POS runs as `api`, not as the worker: an operator session that only the
-- BYPASSRLS pool can write is an operator session with no tenant isolation at all.
alter table runtime.operator_session enable row level security;
alter table runtime.operator_session force  row level security;
create policy tenant_isolation on runtime.operator_session
  using      (business_id = umi.current_business())
  with check (business_id = umi.current_business());
create policy branch_narrowing on runtime.operator_session as restrictive
  using      (umi.current_branch() is null or branch_id = umi.current_branch())
  with check (umi.current_branch() is null or branch_id = umi.current_branch());

alter table runtime.device_enrollment_challenge enable row level security;
alter table runtime.device_enrollment_challenge force  row level security;
create policy tenant_isolation on runtime.device_enrollment_challenge
  using      (business_id = umi.current_business())
  with check (business_id = umi.current_business());

alter table runtime.elevation_grant enable row level security;
alter table runtime.elevation_grant force  row level security;
create policy tenant_isolation on runtime.elevation_grant
  using      (business_id = umi.current_business())
  with check (business_id = umi.current_business());

-- The two write-only audit tables. api holds INSERT and nothing else, but INSERT alone
-- is enough to forge a security event against another café — WITH CHECK is what stops
-- that. `business_id is null` is permitted because these are soft refs: a platform-level
-- security event (a login attempt against an account with no business yet) has no
-- business to name, and audit exhaust must outlive whatever it describes.
alter table runtime.security_audit_event enable row level security;
alter table runtime.security_audit_event force  row level security;
create policy tenant_isolation on runtime.security_audit_event
  using      (business_id is null or business_id = umi.current_business())
  with check (business_id is null or business_id = umi.current_business());

alter table runtime.audit_event_internal enable row level security;
alter table runtime.audit_event_internal force  row level security;
create policy tenant_isolation on runtime.audit_event_internal
  using      (business_id = umi.current_business())
  with check (business_id = umi.current_business());

-- ===========================================================================
-- GRANTS — the POS request path
-- ===========================================================================
-- tenant.* is already granted to api by the blanket grant above and confined by RLS.
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
  tenant.audit_event, tenant.financial_event, tenant.receipt_snapshot,
  tenant.pos_committed_sale, tenant.offline_replay_command,
  tenant.offline_provisional_mapping
  from api, worker, readonly;
revoke update, delete on runtime.security_audit_event, runtime.audit_event_internal
  from worker;

-- ---- Policies are read-only to everyone but the platform ----
-- A café cannot raise its own offline cash limit; that is the entire point of a limit.
revoke insert, update, delete on tenant.pos_offline_policy, tenant.pos_offline_cash_policy
  from api, readonly;
revoke all on umi.audit_retention_policy from api, readonly;
revoke insert, update, delete on umi.user_permission_override from api, readonly;
grant  select on umi.user_permission_override to api;

-- ---- The offline reconciliation acknowledgement is the ONE column a device may set ----
revoke update on tenant.offline_reconciliation from api;
grant  update (acknowledged_at) on tenant.offline_reconciliation to api;
revoke update on tenant.offline_replay_conflict from api;
grant  update (last_observed_at, resolution_state, resolution_acknowledged_at)
  on tenant.offline_replay_conflict to api;
