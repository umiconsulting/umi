# ONCA producción · error 001 · cobro confirmado sin venta POS

**Fecha:** 24 de octubre de 2026. **Zona local:** `America/Mazatlan` (UTC−7). **Prioridad:** crítica para el cierre de caja. **Estado:** abierto. **Equipo:** iMin D3, caja principal. **Cuenta:** 004.

## Resumen e impacto

La terminal de tarjeta mostró un pago completado por **MXN 225.00**. El POS mostró «No fue posible completar el cobro de forma segura». La API guardó un intento de pago exitoso, pero no creó la venta ni el recibo. Por ello, la cuenta permaneció abierta y el importe quedó fuera del registro final de ventas. El personal detuvo los reintentos; no hay evidencia de un segundo cargo.

El personal confirmó que la operación era **cinco conchas a MXN 45.00 cada una**. La cuenta de la API sólo conservó tres conchas, MXN 135.00. El personal también reportó que apareció un Americano al intentar agregar las dos conchas faltantes. Aún no hay traza que confirme cómo apareció ese producto. La diferencia entre la vista inicial del personal y el carrito del servidor sigue sin explicación completa.

**Acción inmediata:** se corrigió la línea de la cuenta a cinco conchas, con autorización expresa del responsable. La transacción conservó el mismo pago y dejó un registro de auditoría. La venta y el recibo siguen pendientes. Nadie debe volver a pasar la tarjeta por esta cuenta.

Durante el diagnóstico, el personal confirmó otra operación cobrada en terminal: **Cuenta 005, mesa Capirio, MXN 245.00**. Esa cuenta tampoco tiene venta en la API. Se documenta por separado abajo porque el personal interrumpió su registro mientras se trabajaba en la caja. Aún no se recibió una foto o referencia del segundo comprobante.

## Evidencia adjunta

| Material | Qué comprueba | Límite |
| --- | --- | --- |
| [Foto del error del POS](./evidence/2026-10-24-onca-production-001/pos-error.png) | Mensaje de fallo de cobro y botones «Reintentar» y «Cerrar». | No muestra el carrito ni un identificador de pago. |
| [Foto de la terminal](./evidence/2026-10-24-onca-production-001/terminal-payment.png) | «Pago completado», MXN 225.00, 24 Oct 2026 10:36 am; referencia visible `PUGvVaq7` (lectura visual). | La foto no expone por sí sola el registro del adquirente. |
| [Estado posterior de la iMin](./evidence/2026-10-24-onca-production-001/pos-pending-sync.png) | Aviso de cambios pendientes, indicador «Sin conexión» y fallo al actuar sobre una mesa. | El sistema Android sí reportó Wi‑Fi y VPN validados. El indicador del POS requiere análisis. |
| [Cola local, comandos #33 y #34](./evidence/2026-10-24-onca-production-001/recovery-33-34.png) | El efectivo #33 requiere revisión y el cambio de cantidad #34 figura como resuelto. | El efectivo no se volvió a enviar. |
| [Cuenta 004 ya corregida](./evidence/2026-10-24-onca-production-001/account-004-five-conchas.png) | La iMin leyó cinco conchas y MXN 225.00 tras reiniciar. | La venta continuaba abierta. |
| [Segundo error después del ajuste](./evidence/2026-10-24-onca-production-001/pos-error-after-reconcile.png) | El POS repitió el mensaje genérico al confirmar un cargo ya efectuado. | En esa ventana no apareció una nueva solicitud de cobro en la API. |
| [Cuentas abiertas](./evidence/2026-10-24-onca-production-001/accounts-004-005-006.png) | La lista muestra 004 por MXN 225, 005 por MXN 245 y 006 por MXN 45. | La lista no demuestra cuáles recibieron dinero. |
| Consultas de sólo lectura a PostgreSQL de producción | Un intento de pago exitoso por MXN 225; cero ventas y cero recibos para la cuenta. | El campo `proof_source=operator_attested` registra una confirmación manual, no una confirmación electrónica del adquirente. La foto aporta evidencia adicional. |
| Auditoría de la cuenta | Cambio controlado de tres a cinco conchas, versión 8 a 9, acción `adjust`. | No cierra por sí solo la venta. |

Las fotos originales las envió el usuario durante el incidente. Las copias anteriores forman parte de esta bitácora. La captura de la iMin se tomó por ADB después del ajuste. No se copian secretos, tokens de sesión ni credenciales.

## Identificadores y estado comprobado

| Registro | Valor / resultado |
| --- | --- |
| Comercio | `dbfb6dd1-bf05-42cc-8f60-2035c1b6647b` |
| Cuenta / carrito | 004 / `b4db9f17-ce76-469a-905e-8b7b666c0e10` |
| Línea Concha | `d24accd2-745e-4a51-8231-a429b4c81b1a`; precio base 4500 centavos; sin modificadores |
| Intento de pago | `f862a978-58ec-46c4-b52f-fa097d88367d`; `succeeded`; `external_terminal`; `manual_terminal`; MXN 22500 centavos |
| Borrador de medio de pago | `72399275-e72e-4777-9d86-abc0a758332e`; `tender_id` nulo |
| Venta / recibo | Cero filas en `pos_committed_sale` y `receipt_snapshot` para esta cuenta y pago |
| Estado tras el ajuste | Carrito `draft`, ciclo `recovered`, versión 9; una línea de cinco conchas; pago sin cambio |
| Auditoría del ajuste | `c6c0cf31-6e53-42e5-8c70-f60d7b312c73`; acción `adjust`; solicitud `onca-2026-10-24-account-004` |
| POS instalado | Paquete `co.umiconsulting.umi_pos.estacion`, versión Android 324, firma SHA-256 `8146b847a358a9cd54eddecbe8921a998287d3f59e1e52bdca5e121d21da3346` |
| API activa al verificar | Revisión `f0908e175458ff7c4a8e855135a916192de39697`; contrato 2.44.0; `/health/ready` sano |

## Secuencia observada

1. A las 16:34–16:35 UTC, el registro de la API mostró `cart.line.add` y dos cambios aceptados de cantidad. El último dejó tres conchas en el servidor.
2. A las 16:36:37–16:36:39 UTC, el intento de pago manual pasó a `succeeded` por MXN 225.00. La terminal mostró el pago completado cerca de las 10:36 hora local.
3. La API rechazó cuatro solicitudes posteriores a `/checkout` con HTTP 409 y `OPTIMISTIC_VERSION_CONFLICT`. El POS mostró el mensaje genérico de la foto.
4. La cuenta quedó con tres conchas, pago exitoso, sin venta y sin recibo. La iMin conservó el carrito en su cola local.
5. Al abrir Cuenta 004, el POS cambió su ciclo a `recovered`. La vista mostraba tres conchas y MXN 135.00. El POS impidió «Guardar y salir» porque existía un cobro sin confirmar.
6. Durante el diagnóstico se pulsó una vez `+` en Concha. La vista mostró cuatro conchas y MXN 180.00, pero el servidor mantuvo tres. Ese cambio quedó como comando local **#34** pendiente. No se pulsó «Cobrar».
7. El responsable confirmó cinco conchas por MXN 225.00 y autorizó corregir la cuenta. Un primer intento de ajuste falló por una restricción del código de acción en `audit_log`. PostgreSQL revirtió toda esa transacción; la cantidad siguió en tres.
8. Se corrigió el código de auditoría a `adjust`. El ensayo de lectura volvió a validar los guardas. La transacción actualizó la cantidad a cinco, elevó la versión a 9 y guardó el antes y el después en auditoría.
9. La consulta posterior confirmó cinco conchas, el mismo único pago exitoso, cero ventas y cero recibos. La iMin aún mostró cambios pendientes y «Sin conexión».
10. Se reinició la aplicación sin borrar sus datos. El Centro de recuperación marcó el cambio #34 como resuelto. La iMin leyó cinco conchas y MXN 225.00.
11. Se eligió «Terminal manual» y se confirmó el cargo **ya efectuado** de MXN 225.00 en el POS. El POS volvió a mostrar el error genérico. No se usó la terminal de tarjeta. La consulta posterior conservó un solo intento de pago y cero ventas.
12. El personal confirmó que cobró MXN 45.00 en efectivo y entregó la concha de la Cuenta 006. También confirmó que la terminal cobró MXN 245.00 de la Cuenta 005, aunque esa venta no terminó en el POS.

## Análisis técnico

**Causa comprobada de las conchas que desaparecieron.** En la API activa, `PosCartRepository.replace` implementa cada actualización de cantidad como `remove` seguido de `addOrMerge`. Eso aumenta dos veces la versión y, al borrar e insertar, crea un ID de línea distinto. La secuencia de respuestas de producción muestra: Concha 1, línea `2d8189bb-ff80-47a2-a49c-fad35b76242b`, versión 2; Concha 2, línea `79116f6c-fab3-4850-befb-98b46c6a5a3b`, versión 4; Concha 3, línea `d24accd2-745e-4a51-8231-a429b4c81b1a`, versión 6. Los registros HTTP muestran que, inmediatamente después del cambio a 2, el POS volvió a enviar `PATCH` al primer ID ya borrado: recibió HTTP 409 `CART_VALIDATION_FAILED`. Hubo otros rechazos de actualización antes y después del cambio a 3. La cola optimista del POS sólo actualiza alias de líneas creadas provisionalmente; no cambia el alias de un ID oficial cuando la API reemplaza la línea. Esa combinación explica la pérdida de cambios sucesivos de cantidad mientras la pantalla podía mostrar un resultado provisional. El comando aceptado de repetición #20 pidió cantidad 3 al segundo ID con versión esperada 4. Los payloads de los comandos rechazados no se conservan en `business_command`, así que no se atribuye una cantidad exacta a cada rechazo.

**Rechazo del cierre después del dinero.** La API registró el intento de MXN 225.00 como `succeeded` a las 16:36:39 UTC y rechazó `/checkout` a las 16:36:40, 16:36:48, 16:37:03 y 16:37:33 con `OPTIMISTIC_VERSION_CONFLICT`. `lockCart` emite ese código cuando no coincide la versión, la sesión o el estado admitido. La última respuesta de carrito antes del cobro era versión 6, estado `draft` / `building_cart`, y no aparece otra mutación de carrito antes del primer intento de cierre; por ello una versión retenida por el POS es la explicación más fuerte, pero la API no conserva el `expectedCartVersion` de la solicitud fallida para comprobar su número exacto. El servidor evitó escribir una venta incoherente, pero lo hizo después de que ya existía el pago. El POS v324 no actualiza obligatoriamente el carrito inmediatamente antes de confirmar un cobro externo ni reconcilia el pago exitoso con el carrito vigente.

**Fallo confirmado de control del importe.** La vista del POS permitió introducir MXN 225.00 para un carrito que el servidor tenía en MXN 135.00. En el flujo de terminal manual, el botón para un único medio externo no exigía que el importe aplicado coincidiera con el total. La API sólo podía rechazar la venta después del cobro físico. Este control se corrigió en el código local, sin publicación aún.

**Alcance pendiente.** El personal dice que vio cinco conchas al cobrar; las escrituras aceptadas por la API sólo justifican tres. La secuencia de IDs y rechazos demuestra por qué una actualización al ID anterior falla. La reproducción en la iMin y la cantidad concreta de cada comando rechazado siguen pendientes. Una revisión de todas las respuestas exitosas de carrito de la Cuenta 004 durante el día encontró sólo Concha, sin alta persistida de Americano; eso no descarta que se haya pintado provisionalmente en la pantalla. El Americano reportado requiere una traza de selección y una prueba en un entorno aislado; no se atribuye ese producto al personal sin evidencia.

**Riesgo de recuperación.** El cambio local #34 quedó resuelto después de que la API lo rechazó. La caja principal aún conserva el conflicto financiero #33. El POS instalado trata esa cola global como trabajo pendiente antes de intentar un cobro en línea. Esta es una causa probable del segundo error de la Cuenta 004; falta traza de la excepción del cliente para cerrar el diagnóstico. La API no recibió otra solicitud de cobro durante ese intento. No se debe borrar la cola completa.

## Otra venta detectada durante el diagnóstico

El Centro de recuperación mostró el comando **#33**: `pos.checkout.cash`, una concha por **MXN 45.00** en la Cuenta 006. El identificador provisional `1988a09f-e64d-4897-94cf-8a5dee32598c` corresponde al carrito oficial `60e7a50a-eed9-4878-b4e6-053c5d99edb4` según el comando aceptado #30. El servidor marcó el cobro #33 como `server_validation_failed`; la resolución sigue abierta. **El personal confirmó que recibió MXN 45.00 y entregó la concha.** La Cuenta 006 conserva una concha y no tiene venta. Se debe recuperar exactamente esa operación sin crear otra entrada de efectivo.

El rechazo incluye `offline_checkout_snapshot_invalid`: el cliente envió como `null` los campos opcionales `accountOwnerActive`, `accountFolio` y `createdAt`; el esquema de la API esperaba que faltaran. Existe una corrección local de normalización, pero **no está publicada**. Además, el conflicto #33 ya existe; la corrección del esquema por sí sola no demuestra que el servidor permita repetir ese número de secuencia. Se necesita un procedimiento de recuperación idempotente después de confirmar el dinero.

## Operación adicional: Cuenta 005

La Cuenta 005 de Capirio contiene Latte MXN 80.00, Té con jazmín MXN 50.00, Peppe MXN 70.00 y Pan de muerto MXN 45.00. Total: **MXN 245.00**. El personal confirmó que la terminal de tarjeta cobró ese importe y que no terminó la venta en el POS durante la intervención. A diferencia de la Cuenta 004, la API **no tiene ningún intento de pago** para la 005. Tampoco tiene venta ni borrador de cobro. Falta la foto o referencia del comprobante de la terminal. La cuenta se mantiene abierta. El cierre debe registrar el cobro ya efectuado mediante el flujo de terminal manual, después de despejar la cola de la caja; no se debe pasar la tarjeta otra vez.

## Cambios de código preparados y pruebas

| Revisión | Cambio | Comprobación | Estado |
| --- | --- | --- | --- |
| `2ff47dff` | El POS lee el carrito vigente y comprueba su cola antes de iniciar un cobro en línea. | Pruebas Flutter del flujo de cobro. | Código local; no instalado. |
| `43f7d15d` | El POS bloquea el cobro externo cuando el importe aplicado difiere del total. También bloquea un cambio de versión después de actualizar la cuenta. | 48 pruebas del cobro; `flutter analyze` sin hallazgos. | Código local; no instalado. |
| `408abef6` | La API elimina valores nulos de campos opcionales antes de validar una venta en efectivo de la cola histórica. | 21 pruebas de cola; TypeScript, ESLint y Prettier. | Código local; no publicado. |
| `a05c44ed` | El POS limita el bloqueo por cola a la cuenta activa. El conflicto de efectivo de la 006 ya no bloquea el cobro en línea de la 004 o la 005. | 18 pruebas de diario, incluida la cuenta provisional; `flutter analyze` sin hallazgos. | Código local; no instalado. |

Se compiló un APK de producción con versión Android 326 y la misma firma de la aplicación instalada. Está en `apps/umi-pos/build/app/outputs/flutter-apk/app-production-profile.apk`; SHA-256 `04a3bd2324986f262cb301109f88541c1b49f0f84513213cb8b3f527d195098e`. **No se instaló.** La versión 324 permanece en la iMin.

Después se compiló un APK **327** desde la revisión aislada `a05c44ed`. Tiene paquete `co.umiconsulting.umi_pos.estacion`, contrato 2.44.0 y la misma firma SHA-256 de la versión 324. Su SHA-256 de archivo es `cd57de3967fd2620260aa1938053d178e50414a8860fd1a69f81d29ec5580039`. Está en `/tmp/umi-onca-hotfix/apps/umi-pos/build/app/outputs/flutter-apk/app-production-profile.apk`. **La instalación requiere autorización; aún no se instaló.** También se construyó la imagen aislada `umi-api:onca-hotfix-a05c44ed` para validar el empaquetado del cambio de la API. Esa imagen no se publicó ni se instaló en producción.

**La versión 327 no corrige el origen de la pérdida de cantidades.** Contiene defensas de cobro y cola, pero `PosCartRepository.replace` todavía cambia el ID de la línea y el cliente todavía puede mantener una referencia antigua. Antes de proponerla como solución permanente, hay que corregir la identidad estable de la línea (o reconciliar explícitamente cada ID reemplazado), probar varias pulsaciones rápidas de cantidad con respuestas diferidas y comprobar que el cobro externo se bloquea si el carrito oficial o su importe cambiaron.

Después de identificar el origen, se preparó un cambio adicional en la API local: cuando la identidad comercial de una línea no cambia, `replace` actualiza esa misma fila y su cantidad, conserva el ID y aumenta una sola vez la versión. Una prueba de regresión recorre cantidades 1→2→3→4→5 con el mismo ID y versiones sucesivas; pasaron las 25 pruebas del repositorio y `tsc --noEmit`. El cambio aún no se ha publicado ni probado en la iMin contra una API actualizada. La edición que cambia la identidad comercial de una línea todavía sigue otra ruta y necesita revisión adicional antes de declarar el defecto cerrado.

## Condiciones de cierre

1. ~~Resolver el comando #34 sin afectar el pago y comprobar que la iMin lee la Cuenta 004 en versión 9, cinco conchas y MXN 225.00.~~ Comprobado en la iMin.
2. Confirmar la venta con el intento de pago existente. No ejecutar otro cobro en la terminal de tarjeta.
3. Comprobar en la API una sola venta, un solo medio de pago enlazado y un recibo por MXN 225.00. Comparar con el cierre de la terminal.
4. Recuperar el cobro #33 de la Cuenta 006. El personal ya confirmó el dinero y la entrega. Verificar una sola venta y un recibo por MXN 45.00.
5. Obtener el comprobante de MXN 245.00 de la Cuenta 005 y cerrar esa cuenta con una confirmación manual del cargo existente. Verificar una sola venta y un recibo.
6. Reproducir el desfase de cantidad y el Americano en un entorno aislado. Añadir pruebas que cubran selección de producto, cola local, actualización de versión y pago externo.
7. Publicar el POS y la API con una recuperación para pagos externos ya exitosos. Verificar el flujo en iMin real, incluida una pérdida de conexión entre pago y venta.
8. Añadir una alerta para `payment_attempt=succeeded` sin `pos_committed_sale`, y una instrucción operativa clara que impida repetir el cargo.

El ajuste de la cuenta es una medida de recuperación de datos. **El incidente sigue abierto** hasta cerrar la venta, resolver la cola y demostrar una corrección permanente del flujo.

## Herramientas y alcance

Se usaron ADB de Android Platform Tools para leer la pantalla de la iMin y reiniciar la aplicación sin borrar datos. Se usaron `docker logs` y consultas de sólo lectura con el cliente `pg` de la API para comprobar el estado de producción. La corrección autorizada se ejecutó en PostgreSQL dentro de una transacción con validaciones de cuenta, línea, pago, venta y recibo. El primer ensayo fallido se revirtió completo. La lectura posterior confirmó el resultado. El código se revisó en la rama `release/onca-pilot-20261014`; ese código local es más reciente que el APK 324 instalado y la API `f0908e1`, por lo que sus protecciones nuevas aún no describen el comportamiento de producción.
