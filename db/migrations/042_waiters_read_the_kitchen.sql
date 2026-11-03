-- El mesero VE la cocina sin poder escribir en ella.
--
-- POR QUÉ. El aviso de "platillo listo" le llega al mesero, y para saber qué
-- sigue —si la mesa ya tiene todo, si falta un plato— necesita mirar el tablero.
-- Hasta ahora el rol de mesero solo tenía `cart.write`, `catalog.read` y
-- `order.fire`: ningún permiso de cocina, así que el tablero le respondía 403 y la
-- pantalla de KDS le quedaba cerrada.
--
-- QUÉ NO HABILITA ESTO. Nada de cocina se vuelve escribible para el mesero. El
-- tablero pide `kitchen.read` para LEER y las acciones (empezar, listo, terminar,
-- recuperar, cancelar) siguen detrás de `kitchen.prepare`, `kitchen.ready`,
-- `kitchen.complete`, `kitchen.recall` y `kitchen.cancel_ack`, que el mesero no
-- recibe. La pantalla esconde esos botones cuando el permiso no está.
--
-- POR QUÉ UNA REVISIÓN NUEVA DE LA PLANTILLA. Los permisos del mesero no viven en
-- el código: vienen de `umi.role_template` (revisión 1) y cada comercio recibe su
-- copia en `merchant.role`. Cambiar la revisión 1 ya aplicada no llegaría a nadie,
-- así que la 2 es la que lleva los dos permisos nuevos, y la migración re-apunta a
-- ella solo los roles que siguen intactos (revision 1, plantilla 1): un comercio
-- que ya editó su rol a mano conserva su decisión.
--
-- Re-ejecutable: todas las escrituras usan `on conflict do nothing` y las
-- actualizaciones están condicionadas a la revisión.

insert into umi.role_template_revision(template_id,version,name,description)
select id,2,name,description from umi.role_template where key='waiter'
on conflict(template_id,version) do nothing;

insert into umi.role_template_revision_permission(template_id,version,permission_id)
select t.id,2,p.id
from umi.role_template t cross join umi.permission p
where t.key='waiter'
  and p.key in ('catalog.read','cart.write','order.fire','kitchen.read','kitchen.station.read')
on conflict do nothing;

-- Los roles de mesero que nadie tocó se mueven a la revisión 2.
update merchant.role r
   set source_template_version=2, revision=2, updated_at=now()
 where r.key='waiter'
   and r.source_template_version=1
   and r.revision=1
   and exists (select 1 from umi.role_template t where t.id=r.source_template_id and t.key='waiter');

-- Y reciben los dos permisos nuevos.
insert into merchant.role_permission(merchant_id,role_id,permission_id)
select r.merchant_id,r.id,rp.permission_id
from merchant.role r
join umi.role_template t on t.id=r.source_template_id and t.key='waiter'
join umi.role_template_revision_permission rp
  on rp.template_id=t.id and rp.version=r.source_template_version
where r.key='waiter'
on conflict do nothing;
