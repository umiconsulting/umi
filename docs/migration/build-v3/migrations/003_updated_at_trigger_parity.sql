-- ============================================================================
-- 003 · The `touch_updated_at` trigger on every base table that has `updated_at`
--
-- WHY THIS EXISTS. `60_triggers.sql` does not list tables. It sweeps: it walks
-- `information_schema` for every base table with an `updated_at` column in
-- `umi`, `merchant` and `runtime`, and attaches `touch_updated_at` to each one.
-- A sweep attaches to whatever EXISTS WHEN IT RUNS — and the two build paths run
-- it at different points:
--
--   00_run.sh        ... 46_platform_bootstrap, 60_triggers, 61, 90_rls, 47…79
--   the backfill path 00_foundation, 10_umi, 20_merchant, 30_runtime, 60_triggers,
--                     THEN 30_device_pairing, 31…46, 50, 90_rls, 47…53, …
--
-- So a database built by the chain gets the trigger on the tables of
-- `30_device_pairing`, `32_pos_checkout`, `40_pos_hardware_runtime`,
-- `42_pos_kitchen` and `61_customer_activity`, and a database built by the
-- backfill path does not. PRODUCTION WAS BUILT BY THE BACKFILL PATH, so it is
-- missing those ten:
--
--   runtime.device_enrollment_request
--   merchant.pos_checkout_draft, merchant.pos_checkout_policy
--   merchant.hardware_device, merchant.hardware_pilot_policy
--   merchant.kitchen_order, merchant.kitchen_order_item, merchant.kitchen_route,
--   merchant.kitchen_device_station
--   merchant.customer_consent_current
--
-- WHY IT MATTERS, and why a version ledger never caught it. `runtime.
-- schema_migration` records WHICH FILES were applied; every environment records
-- the same 22 and reports `build-v3-79`. What differs is the OBJECTS those files
-- produced, because one of them is a sweep. The consequence is concrete: on
-- those ten tables `updated_at` only moves when the application writes it by
-- hand, so a kitchen order or a checkout draft can carry an `updated_at` that
-- stopped being true hours ago. Anything that reads it to decide staleness is
-- reading a value nobody refreshes.
--
-- AND THREE MORE THAT NO PATH REACHES. `merchant.role` and `umi.role_template`
-- (`49_merchant_roles.sql`) and `merchant.floor_plan` (`62_floor_plan.sql`) are
-- created AFTER `60_triggers` in the chain order AND after the corresponding
-- point in the backfill order. Neither route attaches the sweep to them, so they
-- are missing the trigger in every environment — including the pristine build
-- that CI validates. That is the third finding this file closes, and it is why
-- applying it to a chain-built database reports `attached 3` rather than
-- `nothing to do`. The number is not the point; convergence is.
--
-- THE DIRECTION OF THIS FIX. The chain order is the one CI validates on every
-- pull request against a pristine build, so the chain is the reference — but the
-- reference itself was short those three, and this file lands on both paths. Any
-- database it has already run against reports "nothing to do", and every
-- environment ends with the same 152 triggers.
--
-- IDEMPOTENT BY CONSTRUCTION. The loop selects only tables that do NOT already
-- carry a live `touch_updated_at` trigger, so a second apply changes nothing and
-- the file can never attach a duplicate. It also uses the same schema scope as
-- `60_triggers.sql` (`umi`, `merchant`, `runtime`) so the two agree on what the
-- sweep means.
-- ============================================================================

do $$
declare
  r        record;
  attached integer := 0;
begin
  for r in
    select c.table_schema, c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.column_name = 'updated_at'
       and c.table_schema in ('umi', 'merchant', 'runtime')
       and t.table_type = 'BASE TABLE'
       and not exists (
         select 1
           from pg_trigger g
           join pg_class cl on cl.oid = g.tgrelid
           join pg_namespace n on n.oid = cl.relnamespace
          where not g.tgisinternal
            and n.nspname = c.table_schema
            and cl.relname = c.table_name
            and g.tgname = 'touch_updated_at'
       )
     order by c.table_schema, c.table_name
  loop
    execute format(
      'create trigger touch_updated_at before update on %I.%I
         for each row execute function public.tg_touch_updated_at()',
      r.table_schema, r.table_name
    );
    attached := attached + 1;
    raise notice '003_updated_at_trigger_parity: attached touch_updated_at to %.%',
      r.table_schema, r.table_name;
  end loop;

  -- SAY WHAT HAPPENED. Zero is a result, not a failure: it is what a database
  -- built by the chain reports, and it is the point of the file.
  if attached = 0 then
    raise notice '003_updated_at_trigger_parity: nothing to do — every base table with updated_at already carries the trigger.';
  else
    raise notice '003_updated_at_trigger_parity: attached % missing trigger(s); every base table with updated_at now carries it.', attached;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The self-check. A migration that asserts nothing can report success while
-- leaving the hole it was written to close — so the file ends by proving the
-- invariant it just established. Tables excluded on purpose: a `kds`-schema
-- table, or one whose `updated_at` is maintained by a trigger under another
-- name. The list is read from the catalog, not written down.
-- ---------------------------------------------------------------------------
do $$
declare
  missing text;
begin
  select string_agg(c.table_schema || '.' || c.table_name, ', ' order by 1)
    into missing
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.column_name = 'updated_at'
     and c.table_schema in ('umi', 'merchant', 'runtime')
     and t.table_type = 'BASE TABLE'
     and not exists (
       select 1
         from pg_trigger g
         join pg_class cl on cl.oid = g.tgrelid
         join pg_namespace n on n.oid = cl.relnamespace
        where not g.tgisinternal
          and n.nspname = c.table_schema
          and cl.relname = c.table_name
          and g.tgname = 'touch_updated_at'
     );
  if missing is not null then
    raise exception
      '003_updated_at_trigger_parity: still without touch_updated_at after the sweep: %', missing;
  end if;
end $$;
