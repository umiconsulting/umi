\set ON_ERROR_STOP on
-- QUÉ PASA CON UNA CUENTA QUE SOBREVIVE AL CORTE DEL DÍA.
--
-- Hasta hoy: nada. La lista de cuentas no filtra por antigüedad, así que una cuenta
-- de anteayer seguía apareciendo con la misma voz que la de la mesa 3, y el único
-- límite era que alguien se acordara de cobrarla o anularla.
--
-- Toast resuelve esto con una configuración por tienda, y es la que se copia aquí
-- (`docs/architecture/2026-10-12-cuentas-abiertas-adr.md`): en Toast Web →
-- Finance > Related > Settings > **Auto-close orders** se elige, para el corte del día
-- de negocio (4:00 a.m. locales por defecto), entre **Auto-close** (cerrar el saldo
-- contra un tipo de pago «Auto-Close» que es un marcador contable) o **Auto-void**
-- (anular: ni ingreso, ni impuesto, ni inventario) — y por FÁBRICA viene apagado, es
-- decir, resolución manual
-- (https://support.toasttab.com/en/article/Enable-Auto-Close-or-Auto-Void-for-Check-Reconciliation).
--
-- Esta migración guarda solo la mitad que este producto puede ejecutar hoy, y la
-- guarda con el nombre que dice la verdad: `manual` (lo de fábrica) o `auto_void`.
-- `auto_close` —cerrar cobrando a un tipo de pago marcador— necesita un tipo de pago
-- de sistema y el camino de cobro completo, así que no se declara aquí: un valor que
-- el código no ejecuta es una mentira en la base.
--
-- La frontera del día NO es una constante del till: es `business_day_start` en la
-- zona del comercio, que es de donde `merchant.tg_business_date` deriva cada
-- `pos_cart.business_date`. Con el corte en 04:00 locales, una cuenta abierta a la
-- 01:00 pertenece al día anterior, que es lo que hace que el barrido tenga algo que
-- barrer.
--
-- El libro sigue en `build-v3-79`, como todos los archivos de este directorio: el
-- cambio es aditivo y el ancla de compatibilidad es el ancla.

alter table merchant.merchant
  add column if not exists pos_day_close_policy text not null default 'manual';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'merchant.merchant'::regclass
       and conname = 'merchant_pos_day_close_policy_check'
  ) then
    alter table merchant.merchant
      add constraint merchant_pos_day_close_policy_check
      check (pos_day_close_policy in ('manual', 'auto_void'));
  end if;
end
$$;

-- `merchant.merchant` is granted column by column, so a column added here is a column
-- `api` cannot read until it is named. The settings route reads and writes it, and the
-- till's read path reads it to know whether the sweep runs at all.
grant select, insert, update (pos_day_close_policy) on merchant.merchant to api;
grant select, insert, update (pos_day_close_policy) on merchant.merchant to worker;

comment on column merchant.merchant.pos_day_close_policy is
  'Qué hace el cierre del día con las cuentas que siguen abiertas al corte: manual (por fábrica, como Toast) o auto_void (anularlas). Resuelve solo cuentas SIN cobrar: nunca toca una venta cobrada.';
