-- ============================================================================
-- build-v3 · 60_triggers
-- Attach the shared touch-updated_at trigger to every base table that has an
-- updated_at column (dynamic — no per-table maintenance).
-- ============================================================================
do $$
declare r record;
begin
  for r in
    select c.table_schema, c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.column_name = 'updated_at'
      and c.table_schema in ('umi','tenant','runtime')
      and t.table_type = 'BASE TABLE'
  loop
    execute format(
      'create trigger touch_updated_at before update on %I.%I
         for each row execute function public.tg_touch_updated_at()',
      r.table_schema, r.table_name);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- tenant.contact.normalized_value is DERIVED, never supplied (BACKFILL_METHODOLOGY
-- L15). The app used to hand-roll its own normalization into this column, which is
-- how the corruption stayed self-consistent — the same broken function on read AND
-- write, so a phantom key still matched. Deriving it here (plus the
-- REVOKE UPDATE (normalized_value) in 90_rls) makes the column UNFORGEABLE: raw is
-- the truth, normalized is a pure function of it.
-- ----------------------------------------------------------------------------
create or replace function tenant.tg_contact_normalize() returns trigger
  language plpgsql
  set search_path = pg_catalog as $$
declare
  v_channel_key text;
begin
  select ct.key into v_channel_key from umi.channel_type ct where ct.id = new.channel_id;
  -- phone-family carries the number in raw_phone_number; other channels in raw_value.
  new.normalized_value := tenant.normalize_identity(
    v_channel_key,
    coalesce(new.raw_phone_number, new.raw_value)
  );
  return new;
end $$;

-- Fires on EVERY insert/update (not column-scoped): an UPDATE that touched only
-- normalized_value would otherwise skip the trigger and forge the column.
create trigger contact_normalize
  before insert or update on tenant.contact
  for each row execute function tenant.tg_contact_normalize();
