-- =============================================================================
-- 99_verify.sql  (canonical rebuild v2 — RUN ORDER POSITION: last)
--
-- STRUCTURAL integrity gate for the P0/P1 rebuild (schema built EMPTY — no FDW,
-- no backfill). Every check RAISEs EXCEPTION on failure (ON_ERROR_STOP aborts).
-- The data-reconciliation checks (conservation / grain / orphans / coverage) are
-- P2 backfill validation and are NOT run here — they need source data + FDW.
--
-- Canonical target: schemas umi / tenant / runtime / observability.
-- =============================================================================

\set ON_ERROR_STOP on

do $$
declare v_n int; v_trig int; r record;
begin
  raise notice '=== Umi canonical rebuild — structural integrity gate ===';

  -- CHECK 1 — every tenant.* base table carries tenant_id EXCEPT the deliberately
  --   tenant-less identity tables (tenant keys on id; login/password_reset_token
  --   are login-keyed cross-tenant; channel is a global catalog).
  select count(*) into v_n
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and n.nspname='tenant' and c.relname not like 'v_%'
    and c.relname not in ('tenant','login','password_reset_token','channel')
    and not exists (select 1 from pg_attribute a
                    where a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped);
  if v_n>0 then
    for r in
      select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.relkind='r' and n.nspname='tenant' and c.relname not like 'v_%'
        and c.relname not in ('tenant','login','password_reset_token','channel')
        and not exists (select 1 from pg_attribute a
                        where a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped)
    loop raise warning 'CHECK1 missing tenant_id: tenant.%', r.relname; end loop;
    raise exception 'CHECK 1 FAILED: % tenant-scoped table(s) lack tenant_id', v_n;
  end if;
  raise notice 'CHECK 1 ok: every tenant-scoped table carries tenant_id';

  -- CHECK 2 — RLS enabled on every tenant_id-bearing table.
  select count(*) into v_n
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and n.nspname='tenant'
    and exists (select 1 from pg_attribute a
                where a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped)
    and not c.relrowsecurity;
  if v_n>0 then raise exception 'CHECK 2 FAILED: % tenant table(s) without RLS', v_n; end if;
  raise notice 'CHECK 2 ok: RLS enabled on every tenant_id-bearing table';

  -- CHECK 3 — every RLS table has a policy; tenant tables are FORCEd.
  select count(*) into v_n
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and c.relrowsecurity and n.nspname='tenant'
    and not exists (select 1 from pg_policies p where p.schemaname='tenant' and p.tablename=c.relname);
  if v_n>0 then raise exception 'CHECK 3 FAILED: % RLS table(s) without a policy', v_n; end if;
  select count(*) into v_n
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and n.nspname='tenant' and c.relrowsecurity and not c.relforcerowsecurity;
  if v_n>0 then raise exception 'CHECK 3b FAILED: % tenant table(s) not FORCEd', v_n; end if;
  raise notice 'CHECK 3 ok: every RLS table has a policy and tenant tables are FORCEd';

  -- CHECK 4 — EXACTLY two append-only ledger triggers (card_ledger, gift_card_ledger).
  select count(*) into v_trig from pg_trigger
  where tgname like '%append_only%' and not tgisinternal;
  if v_trig <> 2 then
    raise exception 'CHECK 4 FAILED: % append_only trigger(s), expected 2', v_trig;
  end if;
  raise notice 'CHECK 4 ok: 2 append-only ledger triggers present';

  -- CHECK 5 — every tenant.* base table has a composite (tenant_id, id) PK
  --   (except the id-keyed / login-keyed allowlist).
  select count(*) into v_n
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind='r' and n.nspname='tenant'
    and c.relname not in ('tenant','login','password_reset_token','channel')
    and not exists (
      select 1 from pg_constraint k
      where k.conrelid=c.oid and k.contype='p'
        and (select array_agg(att.attname::text order by u.ord)
             from unnest(k.conkey) with ordinality u(attnum,ord)
             join pg_attribute att on att.attrelid=c.oid and att.attnum=u.attnum)
            = array['tenant_id','id']
    );
  if v_n>0 then
    for r in
      select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.relkind='r' and n.nspname='tenant'
        and c.relname not in ('tenant','login','password_reset_token','channel')
        and not exists (
          select 1 from pg_constraint k where k.conrelid=c.oid and k.contype='p'
            and (select array_agg(att.attname::text order by u.ord)
                 from unnest(k.conkey) with ordinality u(attnum,ord)
                 join pg_attribute att on att.attrelid=c.oid and att.attnum=u.attnum)
                = array['tenant_id','id'])
    loop raise warning 'CHECK5 non-composite PK: tenant.%', r.relname; end loop;
    raise exception 'CHECK 5 FAILED: % tenant table(s) lack a composite (tenant_id, id) PK', v_n;
  end if;
  raise notice 'CHECK 5 ok: composite (tenant_id, id) PK on every tenant table';

  raise notice 'Data checks (conservation / grain / orphans / coverage) -> DEFERRED to P2 backfill validation.';
end $$;

do $$
begin
  raise notice '====================================================';
  raise notice ' STRUCTURAL GATE PASSED — P0/P1 rebuild assembles clean.';
  raise notice '====================================================';
end $$;
