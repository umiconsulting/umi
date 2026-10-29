# ONCA, incidente de producción 005: cobro, mesas, KDS y caja

## Resultado

La API `onca-445bedac` conserva precios y modificadores en una cuenta abierta.
También libera la visita pagada de una mesa y conserva el código de cada
rechazo de efectivo. El POS 332 pide la mesa al enviar o cobrar. Además, quita
el folio manual del tramo de terminal y no convierte un pago externo fallido en
un intento de efectivo.

El 27 de octubre se conciliaron ocho cuentas por MXN 2,405.00 con autorización.
La cuenta 018 reutilizó el pago exitoso de MXN 545.00. No se repitieron cobros.

## Hechos comprobados al inicio del incidente

| Hecho                                   | Evidencia                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| El cobro en terminal terminó bien       | Intento `e000fc83-5ec5-4cd5-a001-a926be585289`, MXN 545.00, estado `succeeded`, resuelto a las `2026-10-26 21:38:43.101966Z`    |
| La venta no se registró                 | No existe fila en `merchant.pos_committed_sale` para la cuenta `28ee4c62-fb7d-46d8-95d9-072b55f73053`                           |
| La cuenta sigue abierta                 | Estado `draft/recovered`, versión 15                                                                                            |
| Cuatro cobros fueron rechazados         | `CHECKOUT_CART_CHANGED` a las `21:38:43`, `21:38:54`, `21:39:11` y `21:39:53Z`                                                  |
| La línea de Chai no tenía modificadores | La línea `f0ab5ab0-6cd6-45af-b147-32b26b9e478f` entró a las `19:05:07Z`                                                         |
| Chai recibió un grupo obligatorio       | El producto se actualizó a las `21:05:28Z`; el grupo `Leche` ahora tiene `min_select=1`                                         |
| El cajero no podía enviar pedidos       | Su sesión tenía `cart.write`, pero no `order.fire`                                                                              |
| La barista sí tenía permiso KDS         | Su sesión tenía `kitchen.read`, `kitchen.prepare`, `kitchen.ready`, `kitchen.complete`, `kitchen.recall` y `kitchen.cancel_ack` |

## Causa del fallo de MXN 545.00

1. El cobro recalculaba las líneas abiertas contra las opciones actuales del
   producto.
2. Chai entró a la cuenta antes de que `Leche` fuera obligatoria.
3. La edición posterior hizo inválida la línea histórica.
4. El cobro respondió `CHECKOUT_CART_CHANGED` después del pago físico.
5. El cliente trató un rechazo definitivo como una falla desconocida.
6. La falla desconocida entró al camino de efectivo sin conexión.
7. Ese camino rechazó la terminal y sustituyó la causa real por
   `OFFLINE_ADVANCED_TENDER_BLOCKED`.

La corrección elimina los pasos 1 y 5 a 7. El cobro ahora usa el nombre,
variante, modificadores, precio, impuesto y línea guardados al agregar el
producto. Una edición del catálogo no cambia una cuenta ya abierta.

## Otras correcciones

| Reporte                                         | Causa                                                                                                                   | Corrección                                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| KDS no mostraba pedidos                         | El cajero podía crear la cuenta, pero no enviarla. Un filtro de estación viejo también podía ocultar todas las comandas | La migración 054 da `order.fire` sólo al cajero de ONCA. El cliente descarta una estación guardada que ya no existe            |
| No se podían liberar mesas                      | El cobro cerraba la cuenta y no cerraba su visita de mesa                                                               | El cobro cambia la visita exacta a `dirty` y limpia la ocupación                                                               |
| Un pago en terminal mostraba un error genérico  | Un rechazo definitivo entraba al camino sin conexión                                                                    | Un pago externo nunca entra al efectivo sin conexión. Si el pago existe y la venta no cierra, el aviso prohíbe cobrar de nuevo |
| El cobro dividido pedía el folio de la terminal | Cada tramo externo exigía una referencia escrita                                                                        | La terminal manual registra evidencia automática. La transferencia bancaria conserva su referencia                             |
| La salida de efectivo fallaba sin motivo        | La política, la aprobación y el saldo del cajón lanzaban un `Error` sin código                                          | Ahora usan `CashRefusal`. El contrato público es 2.45.0                                                                        |
| La mesa se elegía primero                       | El inicio de comer aquí abría la mesa antes de los productos                                                            | La cuenta inicia sin mesa. La mesa se elige antes de enviar o cobrar                                                           |

## Verificación del despliegue original

| Prueba                    | Resultado                                                                   |
| ------------------------- | --------------------------------------------------------------------------- |
| Typecheck de la API       | Aprobado                                                                    |
| Suite completa de la API  | 2,094 aprobadas, 29 omitidas por entorno                                    |
| Suite POS relacionada     | 155 aprobadas                                                               |
| Análisis de Flutter       | Sin hallazgos en los archivos modificados                                   |
| Pruebas del contrato      | 93 aprobadas                                                                |
| SQL de liberación de mesa | Una visita pasó a `dirty` y la transacción se revirtió                      |
| Migración 054             | Aplicada en producción; `cashier` tiene `order.fire`                        |
| Salud de la API           | Healthy, versión `onca-445bedac`, contrato 2.45.0, esquema `build-v3-79`    |
| Caja iMin                 | POS 331 instalado; el arranque falló después. Corregido en el incidente 006 |
| Barra A9+                 | POS 331 instalado; el arranque falló después. Corregido en el incidente 006 |
| Mesero A11                | POS 331 instalado; el arranque falló después. Corregido en el incidente 006 |
| Cocina A9+                | POS 331 instalado; el arranque falló después. Corregido en el incidente 006 |

APK: `/home/juan/Downloads/UmiPOS-1.0.0-production-build331.apk`

SHA-256:
`b9ee9e09bc32c63a7d0edaf0decac7299d4fa73febfb222f7c4714bd8f8e7c93`

El código de POS contiene el contrato 2.45.0, la URL de producción y las dos
protecciones nuevas del cobro. El APK operativo vigente es la build 333 del incidente 007.

## Soporte remoto

Mesero respondió en Tailscale en `100.125.102.97:42845`. Su Wi-Fi fue `UmiPOS`.
Android informó `always_on_vpn_app=com.tailscale.ipn`. Tailscale y KeepADB
estaban excluidos del ahorro de batería.

Barra necesitó una nueva vinculación. Después de vincularla, ADB conectó en
`100.90.102.41:44965` y el POS 331 quedó instalado.

Caja respondió en `100.64.178.95:37137`. Se instaló KeepADB, se habilitó
**Mantener siempre activo**, se configuró el webhook y se instaló el POS 331.

Android documenta que la depuración inalámbrica se vincula una sola vez y ofrece
la opción **Permitir siempre en esta red**. La prueba posterior de Caja detectó
un límite de autorización de Android. El incidente 007 registra ese resultado.

## Estado del soporte al 27 de octubre

La conciliación quedó completada. El propietario entró de nuevo como Cajero ONCA.
La recuperación de ADB después de reiniciar Caja sigue pendiente en el incidente 007.

## Conciliación autorizada del 27 de octubre

Las ocho cuentas del 26 de octubre quedaron conciliadas por MXN 2,405.00.
El propietario confirmó los medios de pago y la entrega completa.

| Cuenta | Total MXN | Medio confirmado | Recibo |
| ------ | --------: | ---------------- | ------ |
| 017    |    295.00 | Efectivo         | 0032   |
| 018    |    545.00 | Terminal         | 0031   |
| 020    |    220.00 | Transferencia    | 0033   |
| 024    |    370.00 | Terminal         | 0034   |
| 031    |    185.00 | Terminal         | 0035   |
| 033    |     50.00 | Terminal         | 0036   |
| 036    |    390.00 | Terminal         | 0037   |
| 038    |    350.00 | Terminal         | 0038   |

La cuenta 018 reutilizó el intento exitoso
`e000fc83-5ec5-4cd5-a001-a926be585289`. Cada cuenta tiene una venta, un pago y
un recibo. Las ocho cuentas tienen estado `committed`.

El propietario confirmó que los MXN 295.00 de la cuenta 017 ya estaban en el
conteo del cierre del 26. La venta conserva ese turno cerrado. La recuperación
no creó movimientos de efectivo. El turno del 26 conserva la secuencia 20.
El turno del 27 sigue abierto con la secuencia 1.

La recuperación registró la entrega histórica sin enviar pedidos nuevos a
cocina. No creó tickets ni líneas KDS. No ejecutó cobros externos.
La transacción creó ocho eventos `support.sale.reconciled` y auditoría de cambios.

La cuenta 037 quedó excluida y conserva su versión 17 y su hash anterior.
Después, el propietario pidió quitar también la cuenta 011. Esa cuenta estaba
vacía. Se canceló con auditoría `onca-cleanup-20261027-011` y se liberó T1.
El recibo 0037 corresponde a la cuenta 036; no modifica la cuenta 037.

La consulta normal de la API devolvió cero cuentas abiertas.
La pantalla real de UmiPOS mostró «No hay cuentas abiertas».
Una lectura independiente de la base y de la API confirmó el resultado.

Evidencia: [conciliación verificada](./evidence/2026-10-27-onca-support/reconciliation-final.json).
Los UUID de venta, pago y recibo están en ese archivo.
La API conserva `onca-445bedac`, commit
`445bedacae9f0aeb1406f7b09b1b27e46b5b5fc8`, contrato 2.45.0.
La recuperación no desplegó código.
