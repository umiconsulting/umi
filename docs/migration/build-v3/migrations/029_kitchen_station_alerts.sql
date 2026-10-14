-- Sólo inicializa al crear la columna; repetir no sobreescribe cambios del admin.
do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_schema = 'merchant' and table_name = 'station' and column_name = 'alert_settings') then
    alter table merchant.station add column alert_settings jsonb not null default
      '{"overdueSeconds":900,"soundsEnabled":true,"arrivalSound":"arrival","overdueSound":"overdue","readySound":"ready"}'::jsonb;
    update merchant.station set alert_settings = jsonb_set(alert_settings, '{overdueSeconds}', '300'::jsonb)
      where key = 'barra';
  end if;
end $$;

-- Limpieza del marcador usado durante la verificación local inicial.
update merchant.station
   set capabilities = array_remove(capabilities, 'alerts_configured')
 where capabilities @> array['alerts_configured']::text[];
