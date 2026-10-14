# Comandas anteriores: diagnóstico del cierre diario

Fecha: 2026-10-13. Comercio: ONCA. Sucursal: `54be4d9e-fa0a-4a42-b95f-402acfccade6`.

> **Seguimiento al build 93:** el diagnóstico siguiente conserva el estado anterior a la corrección. El [reporte posterior](2026-10-13-kds-completar-descartar.md) acredita Capuccino de 004 listo y terminado en A9, además del descarte de 070. Las canceladas con estación ya muestran Cancelado y Descartar. Permanecen los dos productos sin estación de 004 y la cuenta 013 sin estación. Su resolución explícita está en desarrollo; la [matriz del ciclo](2026-10-13-pendientes-del-ciclo.md) registra ese pendiente. La política Manual continúa vigente.

**Resultado:** ONCA conserva la política **Manual**. Las cuatro comandas anteriores son trabajo de cocina pendiente, asociado a cuentas comerciales cobradas o canceladas.

La consulta no encontró cuentas comerciales abiertas de un día anterior. Cambiar la política a anulación automática no resolvería estas cuatro comandas.

## Herramienta y evidencia

Se usó `psql` de PostgreSQL **17.10** en el contenedor existente `umi-bv3-pg`. La transacción declaró `READ ONLY`.

La medición corresponde a **2026-10-13 21:21:02 UTC**, equivalente a 14:21:02 en el comercio. Las consultas son evidencia local; no describen producción.

- [Consulta reproducible](evidence/2026-10-13-aviso-cuenta-liberada/comandas-anteriores-readonly.sql).
- [Resultado completo](evidence/2026-10-13-aviso-cuenta-liberada/comandas-anteriores-readonly.txt).
- [Investigación de herramientas y versiones](../research/2026-10-13-jornada-correcciones-herramientas.md).

```sh
docker exec -i umi-bv3-pg psql -U postgres -d umi_local \
  < docs/reports/evidence/2026-10-13-aviso-cuenta-liberada/comandas-anteriores-readonly.sql
```

## Qué configura el cierre

**Hecho local:** la configuración reside en la columna `merchant.merchant.pos_day_close_policy`. No existe una tabla `merchant.pos_day_closure_policy`.

La fila de ONCA tiene estos valores:

| Campo                        | Valor              |
| ---------------------------- | ------------------ |
| Política                     | `manual`           |
| Zona del comercio            | `America/Mazatlan` |
| Inicio del día operativo     | `04:00:00`         |
| Día operativo en la medición | `2026-10-13`       |

**Hecho del código:** `manual` deja la resolución a una persona. `auto_void` anula cuentas sin cobrar que pertenezcan a días operativos anteriores.

El barrido `sweepCarriedOverAccounts` exige simultáneamente:

- `status` igual a `draft` o `prepared`.
- `lifecycle_state` igual a `building_cart`, `ready_for_checkout` o `recovered`.
- Fecha anterior al día operativo actual, calculado con la zona y el corte del comercio.
- Mesa, nombre de cuenta o al menos un renglón comercial.

Las cuentas guardadas (`suspended`) y las cobradas quedan fuera. El barrido tampoco toma cuentas ya canceladas.

**Hecho del código:** el barrido ocurre al consultar Cuentas; no es un trabajo programado a las 04:00. Escribe el carrito y la mesa.

No actualiza `customer_order`, `kitchen_order` ni los renglones de cocina. Por tanto, la anulación del carrito no garantiza la resolución del tablero.

Fuentes: [repositorio, método `sweepCarriedOverAccounts`](../../apps/umi-api/src/modules/pos-cart/pos-cart.repository.ts), líneas 223–277; [servicio, `listAccounts`](../../apps/umi-api/src/modules/pos-cart/pos-cart.service.ts), líneas 71–99; [migración 024](../migration/build-v3/migrations/024_pos_day_close_policy.sql).

## Estado de las comandas anteriores

**Hecho local:** todas pertenecen al día operativo **2026-10-12**. Las órdenes comerciales asociadas conservan el estado `placed`.

| Cuenta       | Estado comercial del carrito | Ventas cobradas asociadas | Estado del KDS | Detalle de ruteo                                                               |
| ------------ | ---------------------------- | ------------------------- | -------------- | ------------------------------------------------------------------------------ |
| 004 · Mesa 1 | `committed`                  | 1                         | `exception`    | Aeropress y Amanecer sin estación, `missing_route`; Capuccino en cola, Cocina. |
| 013 · Mesa 2 | `abandoned` / `cancelled`    | 0                         | `exception`    | Americano limón mineral y Americano sin estación, `missing_route`.             |
| 070          | `abandoned` / `cancelled`    | 0                         | `queued`       | Carajillo en Barra.                                                            |
| 071          | `abandoned` / `cancelled`    | 0                         | `queued`       | Aeropress en Barra.                                                            |

Las cuentas 070 y 071 tienen este motivo: `User-authorized local test reset; no payment`. La cuenta 013 no tiene motivo en esa columna.

**Inferencia:** 013, 070 y 071 presentan una proyección de cocina pendiente después de la cancelación comercial. La cuenta 004 tiene otra situación: venta cobrada y preparación sin resolver.

No corresponde recuperar ni mover estas cuentas como cuentas abiertas. Sus carritos están en estados comerciales finales.

## Por qué las acciones actuales no resuelven todos los casos

**Hecho del código:** la acción de terminar exige ítems listos. Una comanda `exception` no admite el salto directo a `completed`.

**Hecho del código:** recuperar en cocina (`recall`) permite `ready` → `in_preparation`. No corrige la falta de estación ni archiva una excepción.

**Hecho del código:** existe `cancel_ack`, protegido por `kitchen.cancel_ack`. El modelo permite `exception` → `cancelled`.

Sin embargo, el comando requiere una estación asignada. Su escritura solo alcanza ítems cuyo `station_id` pertenece al alcance autorizado.

Los ítems sin estación de 004 y 013 quedan fuera. La cuenta 013 ni siquiera tiene una estación con la cual formar ese alcance.

**Hecho del código:** los comandos de cocina no rechazan una comanda solo por su fecha anterior. El límite de fecha pertenece a otra operación.

La anulación comercial de un renglón enviado devuelve `day_closed` cuando su orden pertenece a otro día operativo. Conserva la protección de ventas cobradas.

Fuentes:

- [Transiciones de cocina](../../apps/umi-api/src/modules/kds/kitchen-domain.ts), líneas 86–103.
- [Alcance, ítems y comandos de cocina](../../apps/umi-api/src/modules/kds/kds.repository.ts), líneas 1516–1530 y 1649–1878.
- [Permiso de `cancel_ack`](../../apps/umi-api/src/modules/kds/kds.service.ts), función `kitchenPermission`, línea 1285.
- [Guardia de fecha comercial](../migration/build-v3/migrations/030_void_completed_kitchen_item.sql), líneas 39–60; [error del POS](../../apps/umi-api/src/modules/pos-cart/pos-cart.repository.ts), línea 540.

No se encontró una acción de pantalla para resolver estas excepciones antiguas sin estación, con motivo y conservación del estado comercial.

## Propuesta mínima

**Inferencia para Umi:** separar la resolución del trabajo de cocina de la modificación de la venta. Conservar las protecciones comerciales del día anterior.

1. Proyectar la cancelación de un carrito hacia su trabajo de cocina pendiente. Para datos antiguos, comprobar primero la cancelación y la ausencia de ventas cobradas.
2. Agregar una acción explícita para descartar trabajo anterior del KDS. Exigir permiso, motivo, confirmación, versión e identidad del comando.
3. Permitir que esa resolución alcance ítems de excepción sin estación dentro del comercio y la sucursal autorizados.
4. Conservar eventos, auditoría y el despertar existente del tablero. Evitar un transporte adicional.
5. Mantener intactos el cobro, el recibo, los impuestos y la venta. Descartar trabajo del KDS no implica devolver dinero ni declarar comida entregada.

Para 013, 070 y 071, la cancelación comercial existente permite justificar la resolución de su proyección pendiente. Para 004 se necesita una decisión operativa explícita.

No se propone marcar las cuatro como preparadas o entregadas para retirarlas de la pantalla. Esos estados afirmarían trabajo que esta investigación no comprobó.

## Dónde cambia la política el administrador

La opción está en **Ajustes → Información del negocio → Cierre del día y cuentas abiertas**. Tiene Manual y Anular las cuentas sin cobrar al corte.

El botón Guardar envía `posDayClosePolicy` al servidor. `PATCH /api/v1/merchants/:merchantId/settings` requiere el producto dashboard y el permiso `merchant.manage`.

Fuentes: [pantalla Ajustes](../../apps/umi-dashboard/src/screens/settings.jsx), líneas 378–385 y 493–565; [controlador de ajustes](../../apps/umi-api/src/modules/merchants/merchants.controller.ts), líneas 120–128.

**Hecho documentado externo:** Toast también distingue cierre manual, anulación automática y cierre contra un pago contable. Su modo manual conserva cuentas impagadas hasta resolverlas.

Toast documenta que su autocierre no resuelve cuentas de días anteriores. Esta regla no equivale a terminar trabajo en un KDS. [Documentación oficial de Toast](https://support.toasttab.com/en/article/Enable-Auto-Close-or-Auto-Void-for-Check-Reconciliation).

## Límites de esta revisión

Se preservó **Manual**. No se modificó configuración, producto, venta ni comanda durante este diagnóstico.

La revisión posterior abrió Ajustes mediante clics reales en el navegador CDP. El selector confirmó `manual`: [captura](evidence/2026-10-13-aviso-cuenta-liberada/dashboard-politica-manual.png).

La A9, build 91 y rol Cocinero 2, abrió Anteriores en Cocina y Expo. [Cocina](evidence/2026-10-13-aviso-cuenta-liberada/a9-cocina-anteriores.png), [Expo](evidence/2026-10-13-aviso-cuenta-liberada/a9-expo-anteriores.png).

Expo mostró 004, 070 y 071. La 013, sin estación en todos sus ítems, no apareció en ese alcance. Las cuatro constan en SQL.

La revisión no pulsó Empezar ni completó productos antiguos. Al terminar, la A9 volvió a Cocina y Hoy.

No se ejecutó la propuesta. No se probó una resolución desde la pantalla ni se confirmó la entrega real de los productos antiguos.

Las filas permiten identificar la inconsistencia actual. No prueban cuál operación histórica la produjo, salvo el motivo registrado en 070 y 071.
