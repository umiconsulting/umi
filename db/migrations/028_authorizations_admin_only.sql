\set ON_ERROR_STOP on
-- LAS AUTORIZACIONES VIVEN EN EL ADMIN, NO EN LOS ROLES DEL COMERCIO.
--
-- Decisión del dueño (2026-10-12): «las operaciones más sensibles deben obtener el PIN de
-- un admin». El till ya pregunta —cada movimiento por encima del umbral, cada retiro sin
-- venta, cada cancelado de un platillo ya hecho, cada descuento, cada excepción— y el PIN
-- se resuelve contra `umi.resolve_staff_permissions`: quien teclea tiene que **tener** la
-- permisión de autorización. La decisión, entonces, no es de pantallas: es de quién la
-- tiene.
--
-- POR QUÉ HACE FALTA ESTE ARCHIVO. La matriz canónica del piloto
-- (`config/umipos-pilot-role-grants.json` → `35_pos_pilot_rbac.sql`) gobierna los roles
-- canónicos (`umi.role`). Los roles PROPIOS del comercio son otra cosa: viven en
-- `merchant.role` / `merchant.role_permission`, se crean desde el panel, y
-- `umi.resolve_staff_permissions` **los prefiere** sobre el rol canónico cuando el
-- empleado tiene `merchant_role_id`. En este comercio el rol «Cajero» —creado a mano el
-- 2026-10-07— arrastraba **23 autorizaciones** `.approve` más `sale.void.create`, así que
-- estrechar los roles canónicos no cambiaba nada en la operación real: la cajera seguía
-- pudiendo autorizar. Esto es la mitad que faltaba.
--
-- QUÉ QUITA. Toda permisión de AUTORIZACIÓN de todo rol de comercio: la familia `*.approve`
-- (que incluye claves que ni la matriz del piloto conoce, como `inventory.invoice.approve`
-- o `inventory.recipe.approve`: los roles del comercio son libres de crecer) más las tres
-- que autorizan sin decirlo en el nombre —`sale.void.create`, `stored_value.reconcile` y
-- `order.void_after_preparation.approve`— y `offline.recovery.review`, que es el visto
-- bueno de un replay offline con diferencia de dinero.
--
-- QUÉ NO TOCA. Las permisiones de HACER: quien opera sigue operando y sigue pidiendo. El
-- rol «Cajero» conserva `cash.drawer.no_sale`, `cash.movement.paid_out`, `cash.reconcile`,
-- `cash.count.recount` y el resto; lo que pierde es la llave para autorizarse a sí mismo.
-- Tampoco toca los roles canónicos — eso lo gobierna `35_pos_pilot_rbac.sql` — ni las
-- excepciones por persona (`merchant.staff_permission_override`), que son del dueño.
--
-- EFECTO EN OPERACIÓN: para un retiro sin venta, un pago por encima del umbral o un
-- platillo ya empezado, alguien con rol `admin` teclea su PIN en esa caja. Si el comercio
-- quiere devolver una autorización a un rol propio, se hace desde el panel — y este archivo
-- no la vuelve a quitar, porque corre una vez.

delete from merchant.role_permission rp
 using merchant.role r, umi.permission p
 where rp.role_id = r.id
   and rp.permission_id = p.id
   and (
     p.key like '%.approve'
     or p.key in (
       'sale.void.create',
       'stored_value.reconcile',
       'order.void_after_preparation.approve',
       'offline.recovery.review'
     )
   );

comment on table merchant.role_permission is
  'Permisos de un rol PROPIO del comercio (`merchant.role`). `umi.resolve_staff_permissions` los prefiere sobre el rol canónico cuando el empleado tiene `merchant_role_id`. Desde la migración 028 ningún rol propio lleva permisos de AUTORIZACIÓN (`*.approve`, `sale.void.create`, `stored_value.reconcile`, `order.void_after_preparation.approve`, `offline.recovery.review`): autorizar es del rol `admin`.';
