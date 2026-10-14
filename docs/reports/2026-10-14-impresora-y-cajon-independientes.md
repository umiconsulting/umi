# Impresión y cajón independientes — 14 de octubre de 2026

El cobro ya envía el recibo a la impresora de la iMin. La venta de prueba **Cuenta 217**, por MXN 50.00, creó el ticket **0010**. La API registró un recibo original y una copia con estado `printed`. El comando del cajón terminó en `succeeded` y la pantalla de pago no mostró el aviso de fallo.

## Causa medida

La página de prueba de la Epson USB se imprimió, pero el cobro anterior no creó un trabajo de recibo. En el log de la API del 14 de octubre a las 12:00, el cobro creó un comando de cajón y recibió dos respuestas `400 VALIDATION_FAILED`: una al confirmar el cajón y otra al crear el comando de impresión.

Se reprodujeron los dos rechazos con `safeParse()` sobre el contrato real:

- El Dart generado enviaba `issuedAt: null` en `ReceiptPrintPayload`. El esquema aceptaba la ausencia del campo, pero rechazaba `null`.
- El canal del cajón enviaba `pulsePath`, `pulseNode`, `pulseValue` y `drawerSensor` como datos seguros. `SafeMetadata` era estricto y rechazaba esos cuatro campos.

Además, el POS esperaba a que terminara el cajón antes de iniciar la impresión. Se cambió el cobro para iniciar ambos trabajos por separado y conservar sus resultados individuales. Una prueba mantiene el cajón pendiente y confirma que el recibo se imprime antes de liberar ese trabajo.

## Cambio y herramientas

El contrato **2.38.1** acepta `issuedAt: null` de los clientes Dart existentes y los cuatro datos acotados del cajón. El POS toma `issuedAt` del recibo cuando existe. El cajón y la impresora se despachan de forma concurrente; el aviso del cajón sólo depende de su propio resultado. No se cambió la API de negocio ni la base.

Se usó **Zod 3.25.76** con `safeParse()` para obtener las rutas exactas que fallaban, como indica la [guía oficial de Zod](https://zod.dev/basics#handling-errors). Se usó **Dart `Future.wait`** para reunir los resultados independientes, según la [referencia oficial de Dart](https://api.dart.dev/dart-async/Future/wait.html). El contrato se regeneró con el script del repositorio y `tsup` **8.5.1**. La prueba nativa usó Flutter **3.47.5** y ADB **1.0.41** (platform-tools **37.0.0**); Node **24.21.0** y pnpm **10.29.3** ejecutaron el contrato y la API. El esquema del repositorio fue la fuente de verdad; no se creó un protocolo manual.

## Verificación

- Contrato: **88 pruebas aprobadas**. API: **12 pruebas de hardware aprobadas** y `pnpm typecheck` limpio. POS: **995 pruebas aprobadas**; `flutter analyze` sin hallazgos.
- Un único APK profile **0.1.0+126** quedó instalado en iMin D3, A9 y A11. Las tres muestran `versionCode=126`. La API local respondió `Healthy` con contrato 2.38.1.
- En la iMin, «Imprimir recibo» desde Ventas creó dos trabajos `printed` para un ticket anterior. Después, el cobro en efectivo de Cuenta 217 creó el recibo 0010. El comando `print_receipt`, su copia y `open_drawer` terminaron en `succeeded`. La respuesta del cajón incluyó `drawerSensor: 1` y el nodo de su puerto propio.

La [captura anterior](evidence/2026-10-14-impresora-cajon/umi-imin-print-issue.png) muestra el aviso del cajón. La [captura posterior](evidence/2026-10-14-impresora-cajon/umi-imin-build126-cash217.png) muestra el pago sin ese aviso. El [log de API](evidence/2026-10-14-impresora-cajon/api-log.txt), las [filas de comandos y trabajos](evidence/2026-10-14-impresora-cajon/database.txt) y los [resultados de pruebas](evidence/2026-10-14-impresora-cajon/) permiten revisar la secuencia.

ADB y Postgres confirman que la impresora aceptó los dos trabajos y que el software los marcó como impresos. No se obtuvo una foto del papel ni se observó visualmente la apertura física del cajón. La lectura `drawerSensor: 1` tampoco prueba esa apertura porque la polaridad del sensor no está documentada. No se reprodujo una falla física del cajón después de la corrección; esa independencia quedó fijada por la prueba con el cajón pendiente. Tres comandos de cajón anteriores permanecen en `dispatching` por el rechazo de validación histórico. No se alteró su registro de auditoría.
