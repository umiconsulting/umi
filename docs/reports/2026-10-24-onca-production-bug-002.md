# ONCA producción · error 002 · comanda fantasma en Barra

**Fecha:** 24 de octubre de 2026. **Zona local:** `America/Mazatlan` (UTC−7).
**Prioridad:** media para la operación de Barra. **Estado:** causa corregida en
la compilación POS 329; falta instalar esa compilación en la tablet de Barra.

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

## Verificación

| Comprobación | Resultado |
| --- | --- |
| Prueba focal de almacenamiento KDS | 12 pruebas aprobadas |
| `flutter analyze` | Sin hallazgos |
| Suite completa del POS | 1,151 pruebas aprobadas |
| APK | Build 329, paquete `co.umiconsulting.umi_pos.estacion` |
| SHA-256 del APK | `0800a7e468b3516edd0a15dd7c659a124b1584af70ef989c946eb736678ca548` |
| Firma | Misma firma SHA-256 `8146b847…3346` que la compilación 328 |
| iMin instalada | Build 329 |
| Tablet de prueba | Build 329 |

## Pendiente

La tablet real **Samsung A9 Barra** estaba desconectada al cerrar esta nota. Se
debe instalar en ella el APK 329. La prueba normal de Barra debe terminar con
**Complete**; esa acción es la que representa la entrega física.

## Efecto secundario de la prueba

La reproducción creó la venta **0031**, por MXN 50.00, con pago declarado como
`bank_transfer`. No se recibió un depósito real. La consulta de elegibilidad
impide anularla automáticamente:

- La anulación devuelve `externally_settled`.
- La devolución devuelve `bank_transfer_refund_requires_support`.

El registro `967c35db-11cb-4c00-89ca-d0dd5057a00f` no debe contarse como ingreso
real. Su corrección requiere una ruta de soporte o una intervención financiera
autorizada. No se alteró la venta fuera de la API.
