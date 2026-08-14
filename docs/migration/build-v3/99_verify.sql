-- ============================================================================
-- build-v3 · 99_verify — build sanity assertions (RAISE on failure)
-- ============================================================================
do $$
declare n int;
begin
  -- schemas
  if not exists (select 1 from information_schema.schemata where schema_name='umi')     then raise exception 'missing schema umi';     end if;
  if not exists (select 1 from information_schema.schemata where schema_name='merchant')  then raise exception 'missing schema merchant';  end if;
  if not exists (select 1 from information_schema.schemata where schema_name='runtime') then raise exception 'missing schema runtime'; end if;
  if not exists (select 1 from information_schema.schemata where schema_name='kds')     then raise exception 'missing schema kds';     end if;

  -- roles
  if not exists (select 1 from pg_roles where rolname='api')      then raise exception 'missing role api'; end if;
  if not exists (select 1 from pg_roles where rolname='worker' and rolbypassrls) then raise exception 'worker must be BYPASSRLS'; end if;
  if not exists (select 1 from pg_roles where rolname='readonly') then raise exception 'missing role readonly'; end if;

  -- append-only triggers on the two money ledgers
  if not exists (select 1 from pg_trigger where tgname='stored_value_ledger_append_only') then raise exception 'missing append-only trigger: stored_value_ledger'; end if;
  if not exists (select 1 from pg_trigger where tgname='gift_card_ledger_append_only')    then raise exception 'missing append-only trigger: gift_card_ledger';    end if;

  -- views exist (derive, don't cache)
  if not exists (select 1 from information_schema.views where table_schema='umi'    and table_name='effective_entitlement')  then raise exception 'missing view umi.effective_entitlement'; end if;
  if not exists (select 1 from information_schema.views where table_schema='merchant' and table_name='conversation_analytics') then raise exception 'missing view merchant.conversation_analytics'; end if;

  -- RLS enabled on a representative merchant money table
  if not exists (
    select 1 from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='loyalty_stored_value_ledger' and cl.relrowsecurity
  ) then raise exception 'RLS not enabled on merchant.loyalty_stored_value_ledger'; end if;

  -- UmiPOS integration authorities must exist in the build-v3 chain.
  if not exists (
    select 1 from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='cash_ledger_entry'
      and cl.relrowsecurity and cl.relforcerowsecurity
  ) then raise exception 'Gate 3 cash ledger RLS is incomplete'; end if;
  if not exists (
    select 1 from pg_trigger where tgname='cash_ledger_immutable'
  ) then raise exception 'missing append-only trigger: cash_ledger'; end if;
  if not exists (
    select 1 from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='pos_sale_exception'
      and cl.relrowsecurity and cl.relforcerowsecurity
  ) then raise exception 'Gate 3D sale exception RLS is incomplete'; end if;
  if not exists (
    select 1 from pg_class cl join pg_namespace ns on ns.oid=cl.relnamespace
    where ns.nspname='merchant' and cl.relname='kitchen_order'
      and cl.relrowsecurity and cl.relforcerowsecurity
  ) then raise exception 'Gate 4A kitchen order RLS is incomplete'; end if;
  if not exists (
    select 1 from pg_trigger where tgname='kitchen_event_append_only'
  ) then raise exception 'missing append-only trigger: kitchen_event'; end if;
  if not exists (
    select 1 from information_schema.views
    where table_schema='kds' and table_name='station_order'
  ) then raise exception 'missing Gate 4A station order view'; end if;
  if not exists (
    select 1 from pg_trigger where tgname='pos_sale_exception_append_only'
  ) then raise exception 'missing append-only trigger: pos_sale_exception'; end if;
  if not exists (
    select 1 from pg_trigger where tgname='pos_exception_receipt_append_only'
  ) then raise exception 'missing append-only trigger: pos_exception_receipt'; end if;
  if not exists (
    select 1 from information_schema.tables
    where table_schema='runtime' and table_name='device_pairing_session'
  ) then raise exception 'missing UmiPOS device pairing session'; end if;
  if not exists (
    select 1 from runtime.schema_migration
    where version='build-v3-45' and status='applied'
  ) then raise exception 'missing Gate 6A schema version'; end if;

  -- observability must NOT exist (killed 2026-07-11)
  if exists (select 1 from information_schema.schemata where schema_name='observability') then raise exception 'observability schema should not exist'; end if;

  -- counts (sanity)
  select count(*) into n from information_schema.tables where table_schema='umi'     and table_type='BASE TABLE'; raise notice 'umi base tables:     %', n;
  select count(*) into n from information_schema.tables where table_schema='merchant'  and table_type='BASE TABLE'; raise notice 'merchant base tables:  %', n;
  select count(*) into n from information_schema.tables where table_schema='runtime' and table_type='BASE TABLE'; raise notice 'runtime base tables: %', n;

  raise notice 'build-v3 verify: OK';
end $$;
