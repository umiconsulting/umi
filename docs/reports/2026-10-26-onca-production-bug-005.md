# ONCA, incidente de producción 005: cobro, mesas, KDS y caja

## Resultado

La API `onca-445bedac` conserva precios y modificadores en una cuenta abierta.
También libera la visita pagada de una mesa y conserva el código de cada
rechazo de efectivo. El POS 331 pide la mesa al enviar o cobrar. Además, quita
el folio manual del tramo de terminal y no convierte un pago externo fallido en
un intento de efectivo.

El pago de MXN 545.00 en terminal sigue sin venta. No se debe cobrar de nuevo.
Soporte debe conciliar la cuenta y el intento exitoso.

## Hechos comprobados

| Hecho | Evidencia |
| --- | --- |
| El cobro en terminal terminó bien | Intento `e000fc83-5ec5-4cd5-a001-a926be585289`, MXN 545.00, estado `succeeded`, resuelto a las `2026-10-26 21:38:43.101966Z` |
| La venta no se registró | No existe fila en `merchant.pos_committed_sale` para la cuenta `28ee4c62-fb7d-46d8-95d9-072b55f73053` |
| La cuenta sigue abierta | Estado `draft/recovered`, versión 15 |
| Cuatro cobros fueron rechazados | `CHECKOUT_CART_CHANGED` a las `21:38:43`, `21:38:54`, `21:39:11` y `21:39:53Z` |
| La línea de Chai no tenía modificadores | La línea `f0ab5ab0-6cd6-45af-b147-32b26b9e478f` entró a las `19:05:07Z` |
| Chai recibió un grupo obligatorio | El producto se actualizó a las `21:05:28Z`; el grupo `Leche` ahora tiene `min_select=1` |
| El cajero no podía enviar pedidos | Su sesión tenía `cart.write`, pero no `order.fire` |
| La barista sí tenía permiso KDS | Su sesión tenía `kitchen.read`, `kitchen.prepare`, `kitchen.ready`, `kitchen.complete`, `kitchen.recall` y `kitchen.cancel_ack` |

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

| Reporte | Causa | Corrección |
| --- | --- | --- |
| KDS no mostraba pedidos | El cajero podía crear la cuenta, pero no enviarla. Un filtro de estación viejo también podía ocultar todas las comandas | La migración 054 da `order.fire` sólo al cajero de ONCA. El cliente descarta una estación guardada que ya no existe |
| No se podían liberar mesas | El cobro cerraba la cuenta y no cerraba su visita de mesa | El cobro cambia la visita exacta a `dirty` y limpia la ocupación |
| Un pago en terminal mostraba un error genérico | Un rechazo definitivo entraba al camino sin conexión | Un pago externo nunca entra al efectivo sin conexión. Si el pago existe y la venta no cierra, el aviso prohíbe cobrar de nuevo |
| El cobro dividido pedía el folio de la terminal | Cada tramo externo exigía una referencia escrita | La terminal manual registra evidencia automática. La transferencia bancaria conserva su referencia |
| La salida de efectivo fallaba sin motivo | La política, la aprobación y el saldo del cajón lanzaban un `Error` sin código | Ahora usan `CashRefusal`. El contrato público es 2.45.0 |
| La mesa se elegía primero | El inicio de comer aquí abría la mesa antes de los productos | La cuenta inicia sin mesa. La mesa se elige antes de enviar o cobrar |

## Verificación

| Prueba | Resultado |
| --- | --- |
| Typecheck de la API | Aprobado |
| Suite completa de la API | 2,094 aprobadas, 29 omitidas por entorno |
| Suite POS relacionada | 155 aprobadas |
| Análisis de Flutter | Sin hallazgos en los archivos modificados |
| Pruebas del contrato | 93 aprobadas |
| SQL de liberación de mesa | Una visita pasó a `dirty` y la transacción se revirtió |
| Migración 054 | Aplicada en producción; `cashier` tiene `order.fire` |
| Salud de la API | Healthy, versión `onca-445bedac`, contrato 2.45.0, esquema `build-v3-79` |
| Caja iMin | POS 331 y KeepADB permanente verificados; `versionCode=331` |
| Barra A9+ | POS 331 y KeepADB permanente verificados; `versionCode=331` |
| Mesero A11 | POS 331 y KeepADB permanente verificados; `versionCode=331` |

APK: `/home/juan/Downloads/UmiPOS-1.0.0-production-build331.apk`

SHA-256:
`b9ee9e09bc32c63a7d0edaf0decac7299d4fa73febfb222f7c4714bd8f8e7c93`

El APK contiene el contrato 2.45.0, la URL de producción y las dos protecciones
nuevas del cobro.

## Soporte remoto

Mesero respondió en Tailscale en `100.125.102.97:42845`. Su Wi-Fi fue `UmiPOS`.
Android informó `always_on_vpn_app=com.tailscale.ipn`. Tailscale y KeepADB
estaban excluidos del ahorro de batería.

Barra necesitó una nueva vinculación. Después de vincularla, ADB conectó en
`100.90.102.41:44965` y el POS 331 quedó instalado.

Caja respondió en `100.64.178.95:37137`. Se instaló KeepADB, se habilitó
**Mantener siempre activo**, se configuró el webhook y se instaló el POS 331.

Android documenta que la depuración inalámbrica se vincula una sola vez y ofrece
la opción **Permitir siempre en esta red**. KeepADB documenta que mantiene la
depuración activa después de reinicios y cambios de red.

## Pendientes

1. Conciliar el intento `e000fc83-5ec5-4cd5-a001-a926be585289` con la venta. No
   se debe cobrar el mismo dinero otra vez.
2. Volver a conectar Cocina a Tailscale. Su endpoint ya está registrado.
3. Entrar de nuevo como Cajero ONCA. El cambio del rol cerró la sesión anterior
   para activar `order.fire`.
