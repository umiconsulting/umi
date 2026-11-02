# ONCA: mesas pagadas y ocupadas

## Causa y comportamiento

El cobro cerraba la cuenta y cambiaba la mesa a Por limpiar.
La CTE de `PosCheckoutRepository.commit` borraba personas, tiempo, grupo y visita.
Una prueba real de PostgreSQL reprodujo esa liberación después del pago.

La corrección conserva la visita y registra `paid_at` al confirmar la venta.
UmiPOS muestra **Pagada y ocupada** mientras no exista otra cuenta abierta.
**Liberar mesa** confirma la salida de los clientes y pasa a **Por limpiar**.
La limpieza explícita permite pasar a **Libre**.

Un consumo nuevo añade saldo a la misma visita.
Su cancelación o conversión a takeout conserva la ocupación que ya estaba pagada.
Los movimientos conservan el pago, las personas y el tiempo.
Una salida o una visita nueva elimina el pago anterior.

## Cambios y compatibilidad

La migración aditiva es `supabase/migrations/20261102000000_table_paid_visit.sql`.
El campo nullable conserva los seis estados físicos y las políticas RLS existentes.
Un trigger limpia el pago cuando termina la ocupación.
La unión por `table_visit_id` protege una visita nueva frente a confirmaciones tardías.

El contrato de main pasa de 2.48.0 a 2.49.0.
POS recibe el campo opcional `paidAt`.
La ruta del dashboard conserva su forma anterior para los clientes con esquema estricto.
La build 335 sigue compatible y ve la mesa ocupada.
La etiqueta nueva, las acciones y la caché necesitan una nueva build Android.

La caché conserva la respuesta aceptada de API.
Las proyecciones de cuentas abarcan todo el grupo y conservan el reloj.
La proyección inversa retira la cuenta cuando se cierra o se separa del carrito.
Un takeout rechazado restaura la cuenta en el mapa al restaurar el carrito.
La cola aplica esas proyecciones en orden.
La reconciliación usa el comercio y el local del carrito aunque la vista del mapa esté cerrada.
La mesa con una cuenta abierta rechaza la liberación local.

## Evidencia y herramientas

La reproducción inicial recibió `dirty` y valores NULL.
La prueba esperaba `seated`, dos personas y la misma visita.
Otra prueba roja reprodujo la liberación al cancelar un consumo nuevo.
Las regresiones detectaron pérdida de datos aceptados y un retroceso de 30 minutos del reloj.
La revisión independiente detectó la incompatibilidad del dashboard y el takeout rechazado.

Pruebas ejecutadas:

- PostgreSQL aislado: 3 escenarios de checkout y 42 escenarios de mesas con roles API y worker.
- Contrato: 105 pruebas.
- API de checkout, carrito y ciclo de venta: 66 pruebas.
- Juan-PC: 99 pruebas Flutter de mesas y entrada de pedidos.
- Juan-PC: prueba nativa Linux de liberar una mesa pagada con un adaptador de prueba.

La prueba nativa usa las superficies y el controlador reales.
No representa una venta ni un cobro de producción.
El intento anterior en macOS se detuvo por falta de certificado de desarrollo.
La prueba Linux se ejecutó después como `juan`.

Herramientas: Flutter 3.47.5, Dart 3.13.4, pnpm 10.29.3, PostgreSQL 17 y Vitest 2.1.9.
Juan-PC usa Node 24.21.0.
Las primeras pruebas SQL y API se ejecutaron en una copia aislada de la Mac.
El código y los informes están en `/home/juan/umi-onca-paid-occupied-tables-20261102`.
La bitácora operativa está en `/home/juan/umi-onca-bugfix-20261024/docs/reports/ONCA_PRODUCTION_BUG_LOG.md`.

## Estado operativo y entrega

Juan-PC conserva la identidad y la huella SSH autorizadas.
El doctor 335 confirma Caja, Cocina y Mesero por ADB.
Barra aparece en Tailscale y carece de ADB. El doctor devuelve 1.
La flota no está sana.

El diagnóstico KDS confirma `kitchen.cancel_ack` en Cocinero y Barista.
El propietario confirmó que Admin canceló las comandas.
Falta observar un caso seguro con la sesión KDS que tenía el problema.
La evidencia actual no justifica ampliar permisos.
Consulta el [diagnóstico KDS](./2026-11-02-onca-kds-cancel-ack-diagnosis.md).

Los cambios requieren PR y aprobación antes de merge, despliegue e instalación.
La migración debe preceder al despliegue de API.
La build nueva debe conservar la firma de producción y llegar a las cuatro tablets.
La aceptación en una cuenta real de ONCA queda pendiente de aprobación.
El soporte no modificó pagos, ventas, saldos ni comandas de producción durante este desarrollo.

La migración no reocupa mesas históricas ni deduce si sus clientes siguen presentes.
Un rollback conserva la columna nullable y revierte API y APK de forma coordinada.
La API anterior vuelve a aplicar la liberación automática que causó el incidente.
