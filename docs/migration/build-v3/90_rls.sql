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
                 runtime.device_session, runtime.pairing from readonly;   -- auth substrate

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
--   Views are read-only for api (the tenant grant-all handed it DML on the views too):
revoke insert, update, delete on
  tenant.conversation_analytics, tenant.order_total, tenant.order_ticket from api;

--   runtime — only the machinery the request path legitimately serves, scoped:
grant select, insert, update on runtime.conversation_state to api;   -- live convo FSM
grant select, insert          on runtime.reminder_sent    to api;    -- nudge dedup
grant select, insert          on runtime.idempotency_key  to api;    -- request dedup
--   NOT granted to api: session/otp/password_reset_token/device_session/pairing (auth
--     substrate -> auth definer/worker only), outbox/inbound/dead_letter (queue -> worker),
--     product/message/knowledge_embedding (RAG -> worker), integration_sync/pass_device.

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
  for r in select * from (values
    ('station',                     'branch',            'branch_id',       'id'),
    ('customer_note',               'customer',          'customer_id',     'id'),
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

alter table runtime.conversation_state enable row level security;
alter table runtime.conversation_state force  row level security;
create policy tenant_isolation on runtime.conversation_state
  using (exists (select 1 from tenant.conversation cv where cv.id = conversation_state.conversation_id
                   and cv.business_id = umi.current_business()))
  with check (exists (select 1 from tenant.conversation cv where cv.id = conversation_state.conversation_id
                   and cv.business_id = umi.current_business()));
