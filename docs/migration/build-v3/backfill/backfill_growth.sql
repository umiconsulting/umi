-- ============================================================================
-- BUILD-V3 BACKFILL — DOMAIN: Growth, telemetry & audit   [APPROVED]
-- Source DB: umi_backfill_v3 (PGPORT=5233). Run inside one transaction at cutover.
--
-- Adversarial review verdict: SOUND. Verified against target DDL (10_umi.sql,
-- 20_tenant.sql) and live source. All 12 tables in grow.* / observability.*
-- are accounted for; completeness confirmed.
--
-- NON-EMPTY MAP:
--   grow.subscriptions        (5) -> umi.subscription      (2 active, 3 canceled)
--   observability.audit_log  (20) -> tenant.audit_log      (all café config edits,
--                                     one business, RLS-scoped)
-- EMPTY (target stated, 0 rows): grow.leads->umi.prospect;
--   grow.lead_events->umi.prospect_event;
--   observability.conversation_outcomes->tenant.conversation.outcome (column).
-- DROP: grow.feature_flags (5 GLOBAL tenant_id-NULL ops/cron/deploy switches —
--   NOT per-plan entitlement); observability.ai_runs/edge_logs/pipeline_spans/
--   security_events/evaluation_traces/data_quality_findings (telemetry->OTel).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- ENTITLEMENT SEED (packaging). ACCESS truth = core.product_instances (per-café
-- product_key toggles: cash/dashboard/conversaflow/kds). grow.subscriptions only
-- carries BILLING status (all plan='standard'); it does NOT describe access. We
-- reproduce access as 3 public tiers, each café routed to the tier matching its
-- provisioned module set. Every café maps EXACTLY -> zero overrides needed.
--   Starter = {cash} ; Growth = {cash,dashboard} ; Pro = {cash,dashboard,conversaflow,kds}
-- Each module is ONE kind='flag' feature (KDS stays a single door — no sub-features
-- until a real pricing reason appears). feature.module = the product module itself.
-- ----------------------------------------------------------------------------

-- 4 product-module features (the "doors")
insert into umi.feature (key, module, name, kind) values
  ('cash',        'cash',        'Loyalty & Stored Value (umi-cash)', 'flag'),
  ('dashboard',   'dashboard',   'Owner Dashboard',                   'flag'),
  ('conversaflow','conversaflow','WhatsApp Agent (ConversaFlow)',     'flag'),
  ('kds',         'kds',         'Kitchen Display (KDS)',             'flag')
on conflict (key) do nothing;

-- 3 public tiers
insert into umi.plan (key, name, description, is_public, status) values
  ('starter','Starter','Loyalty & stored value only.',                         true,'active'),
  ('growth', 'Growth', 'Loyalty plus the owner dashboard.',                     true,'active'),
  ('pro',    'Pro',    'Full stack: loyalty, dashboard, WhatsApp agent, KDS.',  true,'active')
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


-- ----------------------------------------------------------------------------
-- 1) grow.subscriptions -> umi.subscription
--    tenant_id      -> business_id        (xfk tenant.business; all 5 verified present)
--    status         -> status  (active->active ; disabled->canceled). OWNER DECISION
--      "honor billing status": a canceled sub grants NO effective access (the view
--      filters status in (trialing,active)) -> the 3 disabled cafés go dark. Reversible.
--    plan_id: NOT the source plan (all 'standard'); the TIER whose bundle matches the
--      café's provisioned modules in core.product_instances:
--        has conversaflow|kds -> pro ; else has dashboard -> growth ; else starter.
--    suspended_at   -> canceled_at        (3 disabled rows carry it)
--    created_at     -> started_at + created_at ; updated_at carried
--    current_period_start/end: no source -> NULL
--    metadata {source_system,...}: pure migration provenance -> DROP
--    unique(business_id) holds: source has exactly one row per tenant.
-- ----------------------------------------------------------------------------
insert into umi.subscription
  (id, business_id, plan_id, status, current_period_start, current_period_end,
   started_at, canceled_at, created_at, updated_at)
select
  s.id,
  s.tenant_id                                   as business_id,
  p.id                                          as plan_id,
  case s.status
    when 'active'   then 'active'
    when 'disabled' then 'canceled'
    when 'trialing' then 'trialing'
    else 'canceled'                    -- defensive; source has only active|disabled
  end                                           as status,
  null::timestamptz                             as current_period_start,
  null::timestamptz                             as current_period_end,
  s.created_at                                  as started_at,
  s.suspended_at                                as canceled_at,
  s.created_at,
  s.updated_at
from grow.subscriptions s
join lateral (
  select case
    when bool_or(pi.product_key in ('conversaflow','kds')) then 'pro'
    when bool_or(pi.product_key = 'dashboard')             then 'growth'
    else 'starter'
  end as tier
  from core.product_instances pi
  where pi.tenant_id = s.tenant_id
) t on true
join umi.plan p on p.key = t.tier;


-- ----------------------------------------------------------------------------
-- 2) observability.audit_log -> tenant.audit_log
--    All 20 rows are café config edits (hours/address/whatsapp/payment_methods)
--    for a single business => café-facing audit, RLS (NOT umi.audit_log).
--    tenant_id       -> business_id  (all present in tenant.business)
--    action          -> 'update'     (every row has previous+new config; fits CHECK)
--    entity          -> 'business'   (soft descriptor)
--    entity_id       -> tenant_id     (soft ref to the business whose config changed)
--    previous_config -> before ; new_config -> after ; changed_at -> at
--    actor_slack_id  -> NO home: actor_user_id is a uuid FK to umi.user; Slack
--      ops-bot ids (U0AJ..., U0AK...) do not resolve to a umi.user. Left NULL.
--      Adding an actor_slack_id column for 20 historical rows = over-specification
--      (fails redundancy test) -> not a GAP. Audit substance survives.
--    metadata: all '{}' -> nothing to explode.
-- ----------------------------------------------------------------------------
insert into tenant.audit_log
  (id, business_id, actor_user_id, action, entity, entity_id, before, after, at)
select
  al.id,
  al.tenant_id            as business_id,
  null::uuid              as actor_user_id,   -- slack actor unresolvable to umi.user
  'update'                as action,
  'business'              as entity,
  al.tenant_id            as entity_id,
  -- redact Umi-internal Slack ids from this CAFÉ-READABLE (RLS) audit log (audit 2026-07-12)
  al.previous_config - 'slack_channel_id' - 'slack_channel_name'  as before,
  al.new_config      - 'slack_channel_id' - 'slack_channel_name'  as after,
  al.changed_at           as at
from observability.audit_log al;


-- ============================================================================
-- RECONCILE
-- ============================================================================
-- subscriptions: expect src=5 dst=5
-- select (select count(*) from grow.subscriptions) as src, (select count(*) from umi.subscription) as dst;
-- status distribution: expect active=2, canceled=3
-- select status, count(*) from umi.subscription group by status order by status;
-- canceled rows carry canceled_at from suspended_at: expect 3
-- select count(*) filter (where canceled_at is not null) from umi.subscription;
--
-- audit_log: expect src=20 dst=20
-- select (select count(*) from observability.audit_log) as src, (select count(*) from tenant.audit_log) as dst;
-- before/after preserved: expect 20
-- select count(*) filter (where before is not null and after is not null) from tenant.audit_log;
--
-- No money / stamp sums in this domain.
