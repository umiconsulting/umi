# ONCA, incidente de producción 009: rechazo transitorio al cobrar la cuenta 017

Fecha local: 27 de octubre de 2026.

## Resultado

El operador completó el cobro de la cuenta 017.
La venta es de MXN 360.00 por transferencia bancaria, con recibo 0015.
La lectura de producción confirmó un pago exitoso, una venta y un recibo.
El soporte no ejecutó otro cobro ni modificó esa venta.

## Reporte

La cuenta era para llevar y contenía seis panes de muerto y dos conchas.
El propietario informó un mensaje de error al intentar cobrar.
Antes de capturar ese mensaje, confirmó que ya pudo cobrar.

El texto exacto, el código y el correlationId del aviso inicial no se capturaron.
La investigación posterior recuperó errores de otras operaciones; no los vinculó con ese aviso.
La causa de ese rechazo sigue sin confirmar.
No se atribuye la recuperación a un cambio de código.

## Evidencia final

| Dato              | Valor                                        |
| ----------------- | -------------------------------------------- |
| Cuenta            | 017, `bf2b7d4b-3f6d-4217-a8ee-162c76a63613`  |
| Fecha comercial   | 27 de octubre de 2026                        |
| Tipo              | Para llevar, `takeout`                       |
| Productos         | Pan de muerto × 6; Concha × 2                |
| Total             | MXN 360.00                                   |
| Estado            | `committed`                                  |
| Venta             | `696a562b-f6e4-4403-8582-210b4216ae7f`       |
| Pago              | `8f33bf4d-aa65-4c0a-b4eb-9b1f7a1a990f`       |
| Medio             | `bank_transfer`                              |
| Estado del pago   | `succeeded`                                  |
| Recibo            | 0015, `1cda95ce-f054-4e61-a717-b2cab275cff1` |
| Momento del cobro | `2026-10-27T19:23:12.675789Z`                |

La cuenta se creó mientras la 016 seguía pendiente de pago.
La 016 quedó apartada y conserva su importe pendiente.
No se necesitó concluirla para cobrar la 017.

Evidencia: [verificación final de ambas cuentas](./evidence/2026-10-27-onca-incident-008/verification-final.json).

## Estado del diagnóstico

El flujo terminó correctamente por acción del operador.
El rechazo anterior no se reprodujo ni tiene una causa confirmada.
Si vuelve a ocurrir, conserva el mensaje y la hora antes de reintentar.
Consulta primero el estado del pago y la venta para evitar un cobro duplicado.

## Investigación del aviso al confirmar la transferencia

El propietario precisó que el aviso apareció al confirmar la transferencia.
La consulta fue de sólo lectura. No se repitió un pago ni se modificó una cuenta.

Se revisaron 515 líneas del registro de la API entre `19:18:00Z` y `19:24:00Z`.
La ventana equivale a 12:18–12:24 en America/Mazatlan.
También se consultaron los comandos de negocio y el borrador de checkout.

| Momento UTC  | Operación                            | Resultado                          | Correlation ID                         |
| ------------ | ------------------------------------ | ---------------------------------- | -------------------------------------- |
| 19:22:49.946 | Guardar cuenta, `POST /cart/suspend` | HTTP 409, `CART_VALIDATION_FAILED` | `57787df8-c4ec-48cb-8aa4-7f8505e488dd` |
| 19:22:53.610 | Guardar cuenta, `POST /cart/suspend` | HTTP 409, `CART_VALIDATION_FAILED` | `9ccc9052-6a84-4bf1-9c34-1d7f25a6bb76` |
| 19:23:12.157 | Recalcular checkout de la 017        | HTTP 201, `confirmation_required`  | `9c0be12f-7070-4d2d-9f6a-22005e4c153e` |
| 19:23:14.622 | Completar checkout de la 017         | HTTP 201, `completed`              | `f73fe413-e49f-47a7-8832-9a1d6772eabc` |
| 19:23:17.963 | Reimprimir recibo                    | HTTP 403, `PERMISSION_DENIED`      | `9165265f-2e0e-4c78-adb3-4057c4d12d68` |

Los dos comandos `pos.checkout` tienen estado `succeeded`.
El primer resultado incluye `CHECKOUT_CONFIRMATION_REQUIRED` y `recoveryState=none`.
Ese código describe la confirmación normal de totales; no demuestra un rechazo del cobro.
Ambos resultados contienen una transferencia confirmada de 36,000 centavos.
El borrador terminó en `completed`, versión 3, sin fallo ni recuperación pendiente.

Los comandos fallidos de guardado sólo conservan `failureClass=conflict`.
Sus respuestas guardadas no identifican el carrito ni explican qué condición falló.
No se les atribuye el aviso de la transferencia.
La consulta fallida de la cuenta `067bb51a-79c6-4702-9289-7a33ce316320` tampoco identifica la 017.
La reimpresión falló después de completar la venta y corresponde a otra operación.

La lectura del checkout ausente devolvió `RESOURCE_NOT_FOUND` antes de crear su borrador.
El controlador contempla ese resultado durante la recuperación.
Las lecturas de cocina devolvieron `KITCHEN_ORDER_NOT_FOUND` para la orden de pan.
Los productos de esa cuenta no requieren preparación.
Esos resultados no prueban el error de transferencia.

### Límite del registro del cliente

La captura anterior de logcat no contiene el aviso del intervalo.
El código revisado genera `checkout_failed`, pero configura `NoopTelemetryExporter`.
Ese exportador no conserva ni envía los eventos.
Los mensajes de depuración del checkout requieren `UMIPOS_TAP_LATENCY_PROBE`.
Los estados de error del controlador permanecen en memoria.

Fuentes del código revisado:

- `apps/umi-pos/lib/bootstrap/composition_root.dart:156`.
- `apps/umi-pos/lib/core/observability/telemetry.dart`.
- `apps/umi-pos/lib/features/checkout/checkout_controller.dart:1394`.
- `apps/umi-pos/lib/features/checkout/checkout_controller.dart:1432`.
- `apps/umi-pos/lib/features/checkout/checkout_surface.dart:2953`.
- `apps/umi-pos/lib/features/checkout/checkout_surface.dart:3529`.

### Conclusión y siguiente captura

La API registró el checkout correcto. No registró un rechazo de checkout en la ventana consultada.
La causa y el texto del aviso inicial siguen sin identificar.
Un fallo del cliente o de transporte sigue como posibilidad sin confirmar.
No se aplicó un parche por inferencia ni se reprodujo un cobro real.

Si el aviso vuelve a aparecer, conserva la pantalla y la hora antes de otra acción.
Consulta primero el intento de pago y la venta.
Una mejora futura del registro debe conservar operación, código, versión y correlación, con datos sanitizados.

Evidencia sanitizada: [traza histórica](./evidence/2026-10-27-onca-incident-009/historical-error-trace.json).

Herramientas: Docker logs, Node.js con pg y Python 3 por SSH con verificación estricta.
Se usaron las herramientas existentes porque conservan la evidencia de producción sin añadir un agente.
