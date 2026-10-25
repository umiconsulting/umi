# ONCA producción · error 002 · comanda fantasma en Barra

**Fecha:** 24 de octubre de 2026. **Zona local:** `America/Mazatlan` (UTC−7).
**Prioridad:** media para la operación de Barra. **Estado:** causa corregida en
POS 329 y API `2f5ea8e6`, desplegada en producción; los dos tickets históricos
inconsistentes quedaron reparados.

## Reporte

El personal informó que una comanda continuaba visible en **Barra** después de
cerrar, cobrar y entregar el pedido. No identificó un patrón y dijo que ocurría
sólo con algunas comandas.

## Reproducción

1. La tablet de prueba se enroló como **Tablet pruebas Barra** con UmiPOS 328.
2. Se agregó un Americano a la cuenta 035 y se envió a cocina.
3. La venta se cerró por transferencia de MXN 50.00.
4. La comanda permaneció en Barra con estado **Queued**.
5. El operador la pasó por **Start**, **Ready** y **Complete**. La comanda
   desapareció en el acto.

[Enviada antes del cobro](./evidence/2026-10-24-onca-production-002/01-kds-sent-before-payment.png),
[visible después del cobro](./evidence/2026-10-24-onca-production-002/02-kds-still-queued-after-payment.png),
[en preparación](./evidence/2026-10-24-onca-production-002/03-kds-started.png),
[lista](./evidence/2026-10-24-onca-production-002/04-kds-ready.png) y
[pantalla vacía después de Complete](./evidence/2026-10-24-onca-production-002/05-kds-completed-empty.png).

## Causa

El cobro no termina una comanda. Esto es intencional: Barra debe marcar el
trabajo como listo y completo. La prueba confirmó que la API elimina la comanda
de la pantalla cuando se ejecuta **Complete**.

La causa del caso intermitente está en `LanKdsStore`. Después de un comando
local, la tablet guarda una superposición de la comanda. Cuando otra terminal la
completaba, la nube dejaba de incluirla en el tablero, pero la superposición
local todavía la devolvía. Sólo aparecían las comandas que habían recibido un
comando en esa misma tablet; por eso no había un patrón visible.

## Corrección

La revisión `8a8ec541` cambia `apps/umi-pos/lib/features/kitchen/lan_kds_store.dart`.
Una superposición de una comanda del servidor ya no se muestra cuando una
lectura válida de la nube omite esa comanda. Las comandas creadas localmente
durante una caída conservan su superposición hasta que la nube las confirma.

La prueba nueva
`a cloud refresh removes a ticket completed on another terminal` reproduce el
caso y comprueba que la caché no resucita la comanda.

### Segunda causa: el cobro reabría el ticket

La consulta de producción reveló que el problema también existía en el servidor.
Los recibos **0005** y **0024** tenían todos sus productos `ready`, sus horas de
terminado por estación y una venta `committed`, pero el encabezado del ticket
seguía `queued`.

Los eventos de cocina muestran la secuencia exacta:

1. Cocina envía `complete`; el ticket queda `completed`.
2. Minutos después, el cobro ejecuta `appendKitchenItems`.
3. Esa función vuelve a ejecutar los `INSERT ... ON CONFLICT DO NOTHING`, que no
   insertan ninguna línea nueva.
4. A pesar de no haber trabajo nuevo, incrementa la versión y cambia el estado
   otra vez a `queued`.

La revisión API `2f5ea8e6` cambia `appendKitchenItems` para contar las líneas
realmente insertadas. Si el número es cero, actualiza el mapa de rutas y termina
sin reabrir el ticket, sin publicar un evento de trabajo nuevo y sin notificar al
KDS. Si una segunda ronda sí agrega productos, el ticket se reabre como antes.

La regresión nueva comprueba ambos lados: un append idempotente no reabre un
ticket terminado y un append con una línea nueva sí lo reabre.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| Prueba focal de almacenamiento KDS | 12 pruebas aprobadas |
| `flutter analyze` | Sin hallazgos |
| Suite completa del POS | 1,151 pruebas aprobadas |
| Suite completa de API después de `2f5ea8e6` | 2,095 aprobadas; 29 omitidas |
| APK | Build 329, paquete `co.umiconsulting.umi_pos.estacion` |
| SHA-256 del APK | `0800a7e468b3516edd0a15dd7c659a124b1584af70ef989c946eb736678ca548` |
| Firma | Misma firma SHA-256 `8146b847…3346` que la compilación 328 |
| iMin instalada | Build 329 |
| Tablet de prueba | Build 329 |
| Barra | Build 329 |
| Mesero | Build 329 |

### Despliegue API

| Elemento | Valor |
| --- | --- |
| Revisión | `2f5ea8e65c032aec75150025270b6c5961b1a0a6` |
| Imagen | `ghcr.io/umiconsulting/umi-api:onca-2f5ea8e6` |
| Identidad | `1.0.0-onca.2f5ea8e6` |
| Imagen SHA-256 | `sha256:bd1bf60b49d6f7d5372c18c69e56c1e23c89df7fabfdb6c404dcc3f37c4d96e5` |
| Salud | `/health/ready` respondió `200`; API y worker sanos |
| Respaldo de configuración | `.env.before-onca-2f5ea8e6-20261025T005356Z` |
| Rollback | `UMI_API_TAG=onca-8a8ec541` |

### Reparación de los dos tickets históricos

En una transacción con validaciones se cambió a `completed` únicamente:

- ticket `0d7a192b-73b7-4b9b-94e0-5116d497fc8a`, Cuenta 005 · Capiro, recibo
  **0005**;
- ticket `23e8f557-169e-4fc3-842d-eea88fc4ec15`, Cuenta 007 · Tabachín, recibo
  **0024**.

Los dos tenían venta `committed`, cero artículos pendientes y todos sus
artículos terminados por estación. Cada cambio incrementó la versión y dejó un
evento `order_updated` con correlación
`onca-production-kds-append-repair-20261024`. No se modificaron ventas, pagos,
recibos ni movimientos de efectivo.

Después de la reparación, la consulta de ventas cobradas con ticket no terminal
devolvió cero filas.

## Prueba posterior en producción

A las 17:32 se creó una cuenta de prueba **039** desde Mesero con Corico
individual y un Latte. La comanda apareció en el KDS. Las dos líneas se
cancelaron desde la cuenta, sin cobro, y la API marcó el ticket de cocina como
`cancelled`.

Mesero conservó la tarjeta cancelada durante la primera sincronización. Caja sí
mostró el estado **Cancelado** y permitió **Descartar**. Después del acuse y de
la siguiente lectura de la nube, la Cuenta 039 desapareció también de Mesero.
No se creó venta, intento de pago ni movimiento de efectivo.

Esta prueba valida la convergencia del tablero cuando la nube deja de incluir el
ticket, pero no reproduce por sí sola el caso original de una comanda pagada y
entregada. La prueba normal de Barra debe comprobar el siguiente ticket que se
complete desde otra terminal y terminará visualmente cuando la tarjeta
desaparezca del tablero.

## Efecto secundario de la prueba

La reproducción creó la venta **0031**, por MXN 50.00, con pago declarado como
`bank_transfer`. No se recibió un depósito real. La consulta de elegibilidad
impide anularla automáticamente:

- La anulación devuelve `externally_settled`.
- La devolución devuelve `bank_transfer_refund_requires_support`.

El registro `967c35db-11cb-4c00-89ca-d0dd5057a00f` no debe contarse como ingreso
real. Su corrección requiere una ruta de soporte o una intervención financiera
autorizada. No se alteró la venta fuera de la API.
