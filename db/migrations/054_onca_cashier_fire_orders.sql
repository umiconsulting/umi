-- ONCA toma pedidos en mostrador y los envía antes del cobro.
-- El rol genérico `cashier` no recibe `order.fire` porque otros comercios
-- pueden cobrar al preparar el pedido. Esta migración limita la ampliación al
-- comercio ONCA y no cambia la plantilla global.

do $onca_cashier_fire$
declare
  onca_id uuid;
  cashier_role_id uuid;
  fire_permission_id uuid;
begin
  select id into onca_id
    from merchant.merchant
   where handle = 'onca';

  if onca_id is null then
    raise exception '054_onca_cashier_fire_orders: ONCA no existe';
  end if;

  select id into cashier_role_id
    from merchant.role
   where merchant_id = onca_id
     and key = 'cashier'
     and status = 'active';

  if cashier_role_id is null then
    raise exception '054_onca_cashier_fire_orders: falta el rol cashier de ONCA';
  end if;

  select id into fire_permission_id
    from umi.permission
   where key = 'order.fire'
     and status = 'active';

  if fire_permission_id is null then
    raise exception '054_onca_cashier_fire_orders: falta order.fire';
  end if;

  insert into merchant.role_permission (merchant_id, role_id, permission_id)
  values (onca_id, cashier_role_id, fire_permission_id)
  on conflict do nothing;
end
$onca_cashier_fire$;
