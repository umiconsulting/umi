-- Prepara la configuración y los roles de ONCA después de 002 y 020.
-- Ejecuta todo en un bloque atómico. La repetición conserva los cambios del dueño.
-- No crea usuarios, PIN, dispositivos, cuentas ni medios de pago.

do $onca$
declare
  onca_id uuid;
  template_row record;
  new_role_id uuid;
  existing_role record;
  staff_role_id uuid;
  kds_keys constant text[] := array[
    'kitchen.read',
    'kitchen.station.read',
    'kitchen.prepare',
    'kitchen.ready',
    'kitchen.complete',
    'kitchen.recall',
    'kitchen.cancel_ack'
  ];
begin
  select id into onca_id from merchant.merchant where handle = 'onca';
  if onca_id is null then
    raise exception '039_onca_production_readiness: aplica 002 antes de 039';
  end if;

  if (select count(*) from umi.permission
        where key = any(kds_keys) and status = 'active') <> cardinality(kds_keys) then
    raise exception '039_onca_production_readiness: faltan permisos KDS activos';
  end if;

  select id into staff_role_id from umi.role where key = 'staff' and not is_platform;
  if staff_role_id is null then
    raise exception '039_onca_production_readiness: falta el rol canónico staff';
  end if;

  for template_row in
    select requested.key, t.id as template_id, t.name, t.description,
           t.current_version,
           case when requested.key = 'waiter' then staff_role_id
                else r.id end as legacy_role_id
      from (values ('admin'), ('cashier'), ('waiter')) as requested(key)
      left join umi.role_template t
        on t.key = requested.key and t.status = 'active'
      left join umi.role_template_revision revision
        on revision.template_id = t.id and revision.version = t.current_version
      left join umi.role r
        on r.key = requested.key and not r.is_platform
     order by requested.key
  loop
    if template_row.template_id is null then
      raise exception '039_onca_production_readiness: falta la plantilla %', template_row.key;
    end if;
    if not exists (
      select 1 from umi.role_template_revision
       where template_id = template_row.template_id
         and version = template_row.current_version
    ) then
      raise exception '039_onca_production_readiness: falta la revisión de %', template_row.key;
    end if;
    if template_row.key <> 'waiter' and template_row.legacy_role_id is null then
      raise exception '039_onca_production_readiness: falta el rol canónico %', template_row.key;
    end if;

    new_role_id := null;
    insert into merchant.role
      (merchant_id, key, name, description, source_template_id,
       source_template_version, legacy_role_id)
    values
      (onca_id, template_row.key, template_row.name, template_row.description,
       template_row.template_id, template_row.current_version,
       template_row.legacy_role_id)
    on conflict (merchant_id, key) do nothing
    returning id into new_role_id;

    if new_role_id is not null then
      insert into merchant.role_permission (merchant_id, role_id, permission_id)
      select onca_id, new_role_id, rp.permission_id
        from umi.role_template_revision_permission rp
       where rp.template_id = template_row.template_id
         and rp.version = template_row.current_version
      on conflict do nothing;
    else
      select status, source_template_id, legacy_role_id into existing_role
        from merchant.role
       where merchant_id = onca_id and key = template_row.key;
      if existing_role.status <> 'active'
         or existing_role.source_template_id is distinct from template_row.template_id then
        raise exception '039_onca_production_readiness: rol % incompatible o archivado',
          template_row.key;
      end if;
      if template_row.key = 'waiter' then
        if existing_role.legacy_role_id is not null
           and existing_role.legacy_role_id is distinct from staff_role_id then
          raise exception '039_onca_production_readiness: waiter tiene un rol canónico incompatible';
        end if;
        -- merchant.staff.role_id exige un valor aun cuando merchant_role_id
        -- determina los permisos efectivos del mesero.
        update merchant.role
           set legacy_role_id = staff_role_id
         where merchant_id = onca_id and key = 'waiter'
           and legacy_role_id is null;
      end if;
    end if;
  end loop;

  -- El mismo rol sirve a Barra y Cocina. La estación limita el tablero del equipo.
  new_role_id := null;
  insert into merchant.role (merchant_id, key, name, description, legacy_role_id)
  values (onca_id, 'onca-kds', 'Personal KDS',
          'Preparar, marcar listo, completar, recuperar y descartar en KDS',
          staff_role_id)
  on conflict (merchant_id, key) do nothing
  returning id into new_role_id;

  if new_role_id is not null then
    insert into merchant.role_permission (merchant_id, role_id, permission_id)
    select onca_id, new_role_id, id
      from umi.permission
     where key = any(kds_keys) and status = 'active'
    on conflict do nothing;
  else
    if exists (
      select 1 from merchant.role r
       where r.merchant_id = onca_id and r.key = 'onca-kds'
         and (r.status <> 'active' or r.legacy_role_id is distinct from staff_role_id)
    ) or exists (
      select 1
        from merchant.role r
        join merchant.role_permission rp on rp.role_id = r.id
        join umi.permission p on p.id = rp.permission_id
       where r.merchant_id = onca_id and r.key = 'onca-kds'
         and p.key <> all(kds_keys)
    ) then
      raise exception '039_onca_production_readiness: rol onca-kds incompatible o ampliado';
    end if;
  end if;

  -- Solo corrige los valores iniciales de 002. Conserva ajustes posteriores.
  update merchant.merchant
     set timezone = case when timezone = 'America/Mexico_City'
                         then 'America/Mazatlan' else timezone end,
         business_day_start = case when business_day_start = time '00:00'
                                   then time '04:00' else business_day_start end
   where id = onca_id
     and (timezone = 'America/Mexico_City' or business_day_start = time '00:00');
end
$onca$;
