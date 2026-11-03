-- Crea la política inicial de cobro para cada sucursal activa de ONCA.
-- Solo efectivo queda habilitado. El Dashboard puede modificar la fila después.
-- La repetición conserva los cambios posteriores y no escribe datos bancarios.

do $onca$
declare
  onca_id uuid;
begin
  select id into onca_id from merchant.merchant where handle = 'onca';
  if onca_id is null then
    raise exception '040_onca_checkout_policy: aplica 002 antes de 040';
  end if;
  if not exists (
    select 1 from merchant.location
     where merchant_id = onca_id and status = 'active'
  ) then
    raise exception '040_onca_checkout_policy: ONCA no tiene una sucursal activa';
  end if;

  insert into merchant.pos_checkout_policy
    (merchant_id, location_id, version, currency,
     manual_terminal_enabled, bank_transfer_enabled, mixed_tender_enabled,
     maximum_tender_lines, allow_dine_in_without_table)
  select onca_id, l.id, 'onca-initial-cash-only-v1', m.currency,
         false, false, false, 1, false
    from merchant.merchant m
    join merchant.location l on l.merchant_id = m.id
   where m.id = onca_id and l.status = 'active'
  on conflict (merchant_id, location_id) do nothing;
end
$onca$;
