# Cuentas abiertas por mesa — iMin

Fecha: 2026-10-12. API local `:4001`, PostgreSQL `umi_local`, aplicación Flutter nativa `co.umiconsulting.umi_pos.estacion`, versión 0.1.0 build 28. Se conservó ADB inalámbrico `192.168.1.10:5555`, el enrollment y los datos de la aplicación. Build desde snapshot aislado; cambios de la otra sesión preservados.

## Comportamiento

- Abrir cuenta desde una mesa publicada crea o recupera su cuenta persistente y la vincula con la visita actual.
- Guardar y salir conserva pendientes sin enviar cocina ni cobrar. Cuentas abiertas permite recuperar cuentas con mesa y sin mesa entre operadores autorizados.
- Una cuenta activa de otro operador exige liberación o que su sesión ya no esté activa. Las versiones obsoletas se rechazan; un operador no puede reclamar dos cuentas activas.
- Enviar agrega únicamente pendientes a la misma orden. Cobrar incorpora los pendientes restantes a esa orden dentro de la transacción de pago.
- Cancelar un enviado exige motivo, conserva la línea comercial anulada y comunica la cancelación exacta a cocina. Se admite mientras esté en cola o excepción; preparación iniciada se rechaza. No se implementó aquí aprobación de merma para productos ya preparados.
- Pagar cierra la cuenta y conserva la visita ocupada. Un consumo posterior abre otra cuenta de la misma visita. Liberar la mesa termina la visita. Mover, separar o liberar una mesa con cuenta abierta se rechaza; este cambio no implementa transferencia automática de cuentas entre mesas.
- Pagos comprometidos, pendientes o ambiguos bloquean cambios y transferencias. Abrir la pantalla de cobro sin iniciar un pago permite guardar y recuperar.
- Plantilla `waiter`: `catalog.read`, `cart.write`, `order.fire`; sin permisos de cobro ni caja. El comercio puede configurar un rol que además cobre. El tipo de equipo no concede permisos de pago.

## Recorrido físico y evidencia

ONCA no tenía plano publicado. Se agregó una sola mesa de verificación exclusivamente donde no existía plano; no se reemplazó el plano de otro comercio. La comanda anterior de MXN 345 se guardó y sigue recuperable.

Cuenta de prueba `13ec457a-7256-4c30-b798-b1fc37390ca0`, orden `d0ef02a7-1932-4681-b160-fd468e5f4747`, visita `0f0a7ad5-5879-499e-95ea-b50460458efd`:

1. Admin abrió Mesa prueba y agregó Americano caliente, MXN 50. Guardar dejó una línea pendiente, cero envíos y cero intentos de pago.
2. Mesero 1 recuperó esa misma cuenta desde otra sesión en el iMin. La transferencia conserva cuenta y visita.
3. Admin recuperó y envió; canceló con motivo Error de captura. La línea anterior queda anulada y el item de cocina cancelado.
4. Agregó Americano frío, MXN 60, y lo envió. Agregó Aeropress caliente, MXN 80, y cobró sin enviarlo antes.
5. El primer intento detectó `RESERVATION_EXPIRED`: actualizar referencias de envío disparaba el hook de edición de inventario antes del cierre. La transacción revirtió sin pago. Se corrigió el orden: cerrar inventario antes de actualizar referencias, conservando atomicidad.
6. Repetición física completa: pago en efectivo de prueba MXN 140, recibo con dos productos, una sola orden, un ticket de cocina, dos items activos y uno cancelado. Reserva y venta `committed`.
7. La mesa sigue ocupada con la misma visita. Nueva cuenta `815b1541-87fe-4f0d-a748-c1d325c5f065` conserva esa visita.
8. La comprobación del mesero encontró otro defecto: `umi.resolve_staff_permissions` había sido reemplazada por la versión anterior que ignoraba el rol personalizado. La UI mostraba inicialmente las capacidades correctas y luego adoptaba el snapshot de cajero. La migración 020 restaura el resolver y la invalidación de sesiones; el generador de 35 conserva ambos durante reaplicaciones. Se preservó el rol personalizado existente.
9. Tras renovar PIN, Mesero 1 tiene `order.fire`, sin `checkout.commit` ni `sale.lifecycle`. En el equipo abre la mesa, captura un Americano, lo envía y guarda. Cobrar permanece deshabilitado; no aparecen herramientas de caja ni acciones de mover/liberar mesas. La cuenta queda suspendida con un envío y la visita intacta.

Capturas en [evidence/2026-10-12-open-table-accounts](evidence/2026-10-12-open-table-accounts): `04-pending`, `05-saved-list`, `06-waiter-resumed`, `07-sent`, `08-cancel-reason`, `09-cancelled`, `10-second-round`, `11-checkout`, `12-paid` (fallo inicial), `13-payment-retest` (éxito), `14-receipt`, `15-table-still-seated`. Identidades, pago y estados de cocina en `physical-db-payment.txt`.

Permisos finales: `17-waiter-table-permissions`, `18-waiter-send-no-charge`, `19-waiter-sent`, `20-waiter-saved`. `16-waiter-authority` documenta el estado anterior a la corrección del resolver.

## Validación

- Flutter: 118 pruebas focales; revalidación final de 54 pruebas; análisis focal limpio. Incluye guardar al 200% de texto con geometría iMin y mesero sin `sale.lifecycle`.
- API: 40 pruebas de checkout, rondas, ciclo de venta y cocina; 17 de carrito; lint focal limpio.
- Contrato: TypeScript y 83 pruebas pasan; generación 2.29.0, hash `45c0fa9c427aa6ac259f1a508c0b7289b7564757786f8099de46a7bea484bc5f`.
- Integraciones PostgreSQL: cuentas, RLS, propietarios, versión, pagos ambiguos, planos publicados y visitas; cancelación exacta con rol API. Dos pruebas del checkout usan reserva y cierre de inventario reales; sustituyen únicamente el cierre de lealtad, con seguimiento de stock desactivado en su fixture. El recorrido físico usa el cierre completo normal de la API.
- Migraciones 018, 019 y 020 aplicadas en `umi_local`; reaplicabilidad comprobada en clones.

Límites: se probó cambio de operador en un iMin y recuperación del servidor; no hubo un segundo portátil físico. El pago de prueba fue efectivo en el entorno local, sin proveedor bancario. No se verificó aquí consumo de existencias con una receta activa ni premios de lealtad. Typecheck global API conserva dos errores previos en `pos-hardware.repository.spec.ts`, líneas 70 y 95. El barrido general de roles no fue concluyente por credenciales/rutas heredadas de su fixture; se usaron pruebas específicas de permisos.

Ampliación en build 32: [cuentas sin mesa, nombre opcional, folio y asignación posterior](2026-10-12-account-metadata.md). Incluye capturas del mesero, el conflicto de mesa y la referencia en cocina.
