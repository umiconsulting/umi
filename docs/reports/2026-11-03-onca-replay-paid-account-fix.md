# ONCA: liberar la cuenta después del checkout offline

La build 335 conservó la cuenta 001 en Comanda después de aceptar su venta de MXN 50.
El servidor conservó una venta, un pago y el recibo 0002; el panel local quedó desfasado.
La lectura de la cuenta pagada devolvió CART_NOT_FOUND y mantuvo la copia local.

## Cambio

CartController identifica la confirmación oficial del checkout en el diario cifrado.
Exige estado accepted o duplicate, venta y recibo oficiales, correspondencia provisional y la identidad de la cuenta seleccionada.
También resuelve el alias de un carrito creado sin conexión.
Después de una lectura asíncrona comprueba otra vez la cuenta seleccionada.
Un fallo de lectura conserva el pedido.

SaleLifecycleController retira la cuenta confirmada y prepara la siguiente operación.
Conserva la pantalla de checkout hasta terminar la presentación del recibo.
Si la confirmación llega durante una apertura o una mutación, la aplica al terminar esa operación.
El diario conserva el comando, los IDs y el recibo.
Esta ruta no solicita un pago, no cancela una venta y no modifica la API.

Se añadieron las llaves que exigía el analizador en una condición de inventory_repository.dart.
El ajuste conserva su comportamiento.

## Validación

Flutter 3.47.5; Dart 3.13.4. Ejecución como juan en Juan-PC.
Las pruebas iniciales de venta y cola pasaron: 94 casos.
Las regresiones reprodujeron el panel retenido y la carrera con un guardado en curso antes de sus correcciones.
La verificación final pasó: 139 pruebas relacionadas, análisis sin incidencias, formato sin cambios y git diff --check.

Las quince regresiones cubren aceptación, duplicado, recibo ausente, otra cuenta, una selección nueva durante la lectura,
restauración posterior, alias provisional, checkout abierto, salida del checkout y guardado en curso.
La revisión añadió el caso donde el ciclo conserva el ID provisional después de mapear el carrito.
También reprodujo una restauración que liberaba el carrito antes de actualizar la venta.
La confirmación conserva el ID seleccionado y los alias de creación aceptados del mismo comercio y local.
Esto reconoce el ID provisional del ciclo incluso cuando el checkout ya usa el ID oficial.
Los mappings de otras operaciones no amplían esa identidad.
refreshCurrent aplica el estado completo antes de liberar el panel.
Las tres regresiones de la primera revisión y la variante con checkout oficial fallaron antes de sus correcciones.
Un control adicional conserva la venta cuando el mapping procede de otra operación.
Usan los controladores reales y el diario cifrado; los repositorios externos son adaptadores de prueba.
No ejecutan cobros de producción.

Logs completos: `/home/juan/.local/state/onca-support-20261103/`.
Resumen y hashes: `evidence/2026-11-03-onca-replay-release/verification.json`.

## Producción y entrega

La migración 20261102000000 quedó aplicada y las cuentas 001 y 002 del 3 de noviembre quedaron conciliadas.
La 001 conserva MXN 50 en efectivo, recibo 0002. La 002 reutilizó MXN 270 de terminal, recibo 0001.
El expediente financiero está en el checkout operativo de Juan-PC:
`/home/juan/umi-onca-bugfix-20261024/docs/reports/2026-11-03-onca-payments-migration-recovery.md`.

Barra y Cocina volvieron a vincularse con Juan-PC.
Las cuatro tablets tienen ADB y build 335. El doctor 335 terminó con código 0.
La evidencia de flota está en `/home/juan/.local/state/onca-support-20261103/fleet-after-pairing.json`.

Este cambio requiere aprobar el PR y generar una nueva build con su commit.
La prueba real en tablets con este código queda pendiente de esa entrega.
No se instaló otro APK ni se reiniciaron tablets durante esta corrección.
El rollback del cliente conserva los datos y el diario; no revierte las conciliaciones financieras.
