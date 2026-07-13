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
