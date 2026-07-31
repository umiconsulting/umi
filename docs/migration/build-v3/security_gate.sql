-- ============================================================================
-- build-v3 · security_gate.sql — RUNNABLE prod gate (2026-07-12)
-- Asserts the locally-verifiable half of SECURITY_GATE.md against a built DB.
-- Fails loudly (nonzero exit) on any regression so CI/cutover can BLOCK on it.
--   usage:  PGPORT=5233 psql -v ON_ERROR_STOP=1 -d umi_backfill_v3 -f security_gate.sql
-- Deployment-only gates (TLS verify-full, SCRAM login verifiers, pg_hba, FDW
-- remnants, secret rotation, pooler SET-LOCAL) live in SECURITY_GATE.md.
-- ============================================================================
\set ON_ERROR_STOP on

create temp table gate(label text, status text);
insert into gate
select * from (values
  -- RLS enablement & FORCE ---------------------------------------------------
  ('merchant: every base table RLS+FORCE',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end from pg_class c
       join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='merchant' and c.relkind='r'
         and not (c.relrowsecurity and c.relforcerowsecurity))),
  ('umi per-café tables RLS+FORCE (5)',
    (select case when count(*)=5 then 'PASS' else 'FAIL' end from pg_class c
       join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='umi' and c.relrowsecurity and c.relforcerowsecurity
         and c.relname in ('subscription','subscription_item','invoice','entitlement_override','user_role'))),
  -- Derived columns must be genuinely un-writable by the request path. This check
  -- exists because 90_rls asserted it with a statement that does nothing:
  -- `revoke update (col)` is a no-op while api holds table-level UPDATE, so the
  -- much-commented "UNFORGEABLE" guard on contact.normalized_value never bound.
  ('api cannot UPDATE derived columns (normalized_value, business_date)',
    (select case when bool_and(not has_column_privilege('api', t, c, 'UPDATE'))
                 then 'PASS' else 'FAIL' end
       from (values ('merchant.contact','normalized_value'),
                    ('merchant.customer_order','business_date'),
                    ('merchant.pos_cart','business_date')) as v(t,c))),
  -- SWEPT, not listed. This was a hardcoded pair of table names, so every runtime
  -- table added to the request path afterwards was invisible to it: the check passed
  -- while the new tables went unchecked. Stated as a universal instead — if a runtime
  -- row belongs to a merchant and the request path can touch it, it is isolated.
  -- Deliberate exceptions carry no merchant_id and are therefore not matched:
  -- idempotency_key (a global dedup key) and product_embedding (isolation comes from
  -- the join to merchant.product, which is under RLS).
  ('every api-reachable runtime table with merchant_id has RLS+FORCE',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'runtime' and c.relkind = 'r'
         and exists (select 1 from information_schema.columns col
                      where col.table_schema='runtime' and col.table_name=c.relname
                        and col.column_name='merchant_id')
         and exists (select 1 from information_schema.role_table_grants g
                      where g.table_schema='runtime' and g.table_name=c.relname
                        and g.grantee='api')
         and not (c.relrowsecurity and c.relforcerowsecurity))),
  -- Views: security_invoker -------------------------------------------------
  -- EVERY view in umi/merchant must enforce the caller's RLS. An owner-rights view
  -- leaks cross-merchant (the audit reproduced this on conversation_analytics: 0
  -- base rows, 11 cross-merchant view rows). Assert none is missing the option —
  -- count-agnostic, so adding a view (order_total/order_ticket) can't silently pass.
  ('every umi/merchant view is security_invoker',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end from pg_class c
       join pg_namespace n on n.oid=c.relnamespace
       where c.relkind='v' and n.nspname in ('umi','merchant')
         and not (coalesce(c.reloptions,'{}') @> array['security_invoker=true']))),
  -- The invoker check is count-agnostic, so it can't notice a contract view being
  -- dropped. Assert the two order projections that consumers depend on still exist.
  ('build-v3 order views exist (order_total, order_ticket)',
    (select case when count(*)=2 then 'PASS' else 'FAIL' end from pg_class c
       join pg_namespace n on n.oid=c.relnamespace
       where c.relkind='v' and n.nspname='merchant'
         and c.relname in ('order_total','order_ticket'))),
  ('api holds no DML on any view',
    (select case when bool_or(has_table_privilege('api',c.oid,'insert')
                           or has_table_privilege('api',c.oid,'update')
                           or has_table_privilege('api',c.oid,'delete')) then 'FAIL' else 'PASS' end
       from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where c.relkind='v' and n.nspname in ('umi','merchant'))),
  -- Credentials never on the request path -----------------------------------
  ('api CANNOT read umi.user.password_hash',
    case when has_column_privilege('api','umi.user','password_hash','select') then 'FAIL' else 'PASS' end),
  ('api CANNOT read umi.user.password_salt',
    case when has_column_privilege('api','umi.user','password_salt','select') then 'FAIL' else 'PASS' end),
  ('readonly CANNOT read umi.user.password_hash',
    case when has_column_privilege('readonly','umi.user','password_hash','select') then 'FAIL' else 'PASS' end),
  ('api CAN read umi.user.email (identity col)',
    case when has_column_privilege('api','umi.user','email','select') then 'PASS' else 'FAIL' end),
  -- Auth substrate off the request path -------------------------------------
  ('api has ZERO privilege on runtime auth tables',
    (select case when bool_or(p) then 'FAIL' else 'PASS' end from (
       select has_table_privilege('api','runtime.'||t, 'select,insert,update,delete') p
       from unnest(array['session','otp','password_reset_token','pairing']) t) x)),
  ('readonly CANNOT read runtime auth tables',
    (select case when bool_or(p) then 'FAIL' else 'PASS' end from (
       select has_table_privilege('readonly','runtime.'||t,'select') p
       from unnest(array['session','otp','password_reset_token']) t) x)),
  ('api CANNOT read umi.prospect / umi.audit_log',
    case when has_table_privilege('api','umi.prospect','select')
           or has_table_privilege('api','umi.audit_log','select') then 'FAIL' else 'PASS' end),
  -- Role posture ------------------------------------------------------------
  ('api is NOT superuser / NOT bypassrls',
    (select case when rolsuper or rolbypassrls then 'FAIL' else 'PASS' end from pg_roles where rolname='api')),
  ('worker IS bypassrls (machinery)',
    (select case when rolbypassrls then 'PASS' else 'FAIL' end from pg_roles where rolname='worker')),
  -- Least privilege on future objects ---------------------------------------
  ('no api/worker* default ACL leaks (api locked)',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end from pg_default_acl d
       join pg_namespace n on n.oid=d.defaclnamespace
       where n.nspname in ('umi','merchant','runtime')
         and array_to_string(d.defaclacl,',') ~ '(^|,)api=')),
  -- public schema hardening -------------------------------------------------
  ('PUBLIC cannot CREATE in schema public',
    case when has_schema_privilege('public','public','create') then 'FAIL' else 'PASS' end),
  -- Append-only audit --------------------------------------------------------
  ('no role holds UPDATE/DELETE on audit_log',
    (select case when bool_or(p) then 'FAIL' else 'PASS' end from (
       select has_table_privilege(r,'umi.audit_log','update')
           or has_table_privilege(r,'merchant.audit_log','delete') p
       from unnest(array['api','worker','readonly']) r) x)),
  -- Trigger function search_path pinned -------------------------------------
  ('trigger funcs have pinned search_path',
    (select case when count(*)=3 then 'PASS' else 'FAIL' end from pg_proc p
       where p.proname in ('tg_touch_updated_at','tg_append_only','tg_order_item_void_only')
         and array_to_string(coalesce(p.proconfig,'{}'),',') like '%search_path%')),
  -- Data hygiene (credential + PII cleaning) --------------------------------
  ('0 active users with NULL password hash',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end from umi."user"
       where status='active' and password_hash is null)),
  ('0 legacy-sha256 hashes retained',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end from umi."user"
       where password_algorithm='legacy-sha256-v1')),
  ('some strong scrypt logins survive (functional)',
    (select case when count(*)>=1 then 'PASS' else 'FAIL' end from umi."user"
       where status='active' and password_algorithm='scrypt-sha256-v1' and password_hash is not null)),
  ('ghost @umi.invalid account is not active',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end from umi."user"
       where email like '%@umi.invalid' and status='active')),
  ('no Slack ids in café-readable audit_log',
    (select case when count(*)=0 then 'PASS' else 'FAIL' end from merchant.audit_log
       where before ? 'slack_channel_id' or after ? 'slack_channel_id'
          or before ? 'slack_channel_name' or after ? 'slack_channel_name')),
  ('no historical webhook PII in runtime',
    case when (select count(*) from runtime.outbox_event)
            + (select count(*) from runtime.inbound_event)
            + (select count(*) from runtime.dead_letter) = 0 then 'PASS' else 'FAIL' end)
) g(label,status);

\echo ''
\echo '================= STRUCTURAL GATE ================='
select status, label from gate order by (status='FAIL') desc, label;

-- capture merchant ids for behavioral tests (as superuser)
select id as kalala from merchant.merchant where name='Kalala Café' \gset
select id as egr    from merchant.merchant where name='El Gran Ribera' \gset

\echo ''
\echo '================= BEHAVIORAL GATE (as role api) ================='
set role api;

-- fail-closed: no merchant context => zero rows, no error
do $$ begin
  perform set_config('app.current_merchant','',false);
  if (select count(*) from merchant.merchant) <> 0 then raise exception 'FAIL: empty GUC did not fail closed'; end if;
end $$;
\echo 'PASS: empty/missing app.current_merchant -> 0 rows, no error (fail-closed)'

-- scoped to El Gran Ribera: sees only its own, and the VIEW does not leak Kalala
select set_config('app.current_merchant', :'egr', false);
do $$ begin
  if (select count(*) from merchant.merchant)               <> 1 then raise exception 'FAIL: EGR sees <>1 merchant'; end if;
  if (select count(*) from merchant.conversation)           <> 0 then raise exception 'FAIL: EGR sees foreign conversations'; end if;
  if (select count(*) from merchant.conversation_analytics) <> 0 then raise exception 'FAIL: conversation_analytics VIEW leaks cross-merchant to EGR'; end if;
  if (select count(*) from umi.effective_entitlement)     <> 2 then raise exception 'FAIL: EGR effective_entitlement <>2 (leak or wrong scope)'; end if;
end $$;
\echo 'PASS: EGR scope isolated; conversation_analytics + effective_entitlement do NOT leak cross-merchant'

-- scoped to Kalala: sees its own 11 conversations and 4 entitlements
select set_config('app.current_merchant', :'kalala', false);
do $$ begin
  if (select count(*) from merchant.conversation_analytics) <> 11 then raise exception 'FAIL: Kalala analytics <>11'; end if;
  if (select count(*) from umi.effective_entitlement)     <> 4  then raise exception 'FAIL: Kalala entitlements <>4'; end if;
end $$;
\echo 'PASS: Kalala scope sees exactly its own rows'

reset role;

\echo ''
\echo '================= ENFORCE ================='
do $$
declare n int;
begin
  select count(*) into n from gate where status='FAIL';
  if n > 0 then raise exception 'SECURITY GATE FAILED: % structural check(s) failed', n;
  else raise notice 'SECURITY GATE PASSED: % structural + 3 behavioral checks green', (select count(*) from gate);
  end if;
end $$;
