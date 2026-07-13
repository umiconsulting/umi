-- ============================================================================
-- build-v3 · 99_verify — build sanity assertions (RAISE on failure)
-- ============================================================================
do $$
declare n int;
begin
  -- schemas
  if not exists (select 1 from information_schema.schemata where schema_name='umi')     then raise exception 'missing schema umi';     end if;
  if not exists (select 1 from information_schema.schemata where schema_name='tenant')  then raise exception 'missing schema tenant';  end if;
  if not exists (select 1 from information_schema.schemata where schema_name='runtime') then raise exception 'missing schema runtime'; end if;

  -- roles
  if not exists (select 1 from pg_roles where rolname='api')      then raise exception 'missing role api'; end if;
  if not exists (select 1 from pg_roles where rolname='worker' and rolbypassrls) then raise exception 'worker must be BYPASSRLS'; end if;
  if not exists (select 1 from pg_roles where rolname='readonly') then raise exception 'missing role readonly'; end if;

  -- append-only triggers on the two money ledgers
  if not exists (select 1 from pg_trigger where tgname='stored_value_ledger_append_only') then raise exception 'missing append-only trigger: stored_value_ledger'; end if;
  if not exists (select 1 from pg_trigger where tgname='gift_card_ledger_append_only')    then raise exception 'missing append-only trigger: gift_card_ledger';    end if;

  -- views exist (derive, don't cache)
  if not exists (select 1 from information_schema.views where table_schema='umi'    and table_name='effective_entitlement')  then raise exception 'missing view umi.effective_entitlement'; end if;
  if not exists (select 1 from information_schema.views where table_schema='tenant' and table_name='conversation_analytics') then raise exception 'missing view tenant.conversation_analytics'; end if;

  -- RLS enabled on a representative tenant money table
  if not exists (
    select 1 from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='tenant' and cl.relname='loyalty_stored_value_ledger' and cl.relrowsecurity
  ) then raise exception 'RLS not enabled on tenant.loyalty_stored_value_ledger'; end if;

  -- observability must NOT exist (killed 2026-07-11)
  if exists (select 1 from information_schema.schemata where schema_name='observability') then raise exception 'observability schema should not exist'; end if;

  -- counts (sanity)
  select count(*) into n from information_schema.tables where table_schema='umi'     and table_type='BASE TABLE'; raise notice 'umi base tables:     %', n;
  select count(*) into n from information_schema.tables where table_schema='tenant'  and table_type='BASE TABLE'; raise notice 'tenant base tables:  %', n;
  select count(*) into n from information_schema.tables where table_schema='runtime' and table_type='BASE TABLE'; raise notice 'runtime base tables: %', n;

  raise notice 'build-v3 verify: OK';
end $$;
