# Reembolso, cobro, impresora y suspensión de ventas

Verificación local del 14 de octubre de 2026. Se trabajó sobre la misma API (`127.0.0.1:4001`), la base `umi_local` y un APK `0.1.0+120` instalado en la iMin, la A9 y la A11. No hubo migraciones.

## Cambios

- **Motivos de anulación y reembolso.** El campo de texto sólo aparece al elegir **Otro** y entonces es obligatorio. Al volver a un motivo predefinido se limpia, para no enviar texto antiguo por accidente. La misma regla se aplica a la anulación de una venta y a los flujos de excepción.
- **Comprobante EX.** El documento muestra el tipo de evento, el número de orden/cuenta, el folio EX y el número del ticket original; conserva el logo del comercio. La API reconstruye esos datos desde la venta y el recibo de origen incluso al reimprimir comprobantes EX antiguos. No se cambió el significado fiscal de los folios.
- **Cobro.** Se retiró la aprobación de gerente que se exigía por el mero uso de terminal manual, aun cuando el umbral configurado era cero. Un cajero con `checkout.commit` y `checkout.terminal.confirm` puede confirmar el cobro. Permanecen las comprobaciones de permiso de terminal y las aprobaciones independientes, como descuento y sobreventa.
- **Impresora.** Los controles **Imprimir el recibo al cobrar** y **Copias por recibo** están dentro de **Ajustes de impresora** en la tarjeta del dispositivo. Se retiró el acceso global a ajustes de hardware. Los dos controles ocupan renglones de 72 px, con etiquetas alineadas a la izquierda y una columna derecha de 96 px para el interruptor y el selector. Guardar conserva los demás campos de la política existente.
- **Suspender venta.** La confirmación ya no solicita un nombre. Identifica la venta con el folio de cuenta y el contenido de la comanda; la suspensión envía `null` como nombre opcional. La captura real muestra **Cuenta 192 · Americano limón mineral**.

## Herramientas y criterio técnico

Se usaron Flutter **3.47.5**, Dart **3.13.4**, Node **24.21.0**, pnpm **10.29.3**, Prettier **3.9.4**, Vitest **2.1.9**, ADB, PostgreSQL local y `apply_patch`. La [documentación oficial de Flutter para diálogos](https://api.flutter.dev/flutter/material/showDialog.html) y [StatefulBuilder](https://api.flutter.dev/flutter/widgets/StatefulBuilder-class.html) respaldan mantener el estado del motivo y la validación en el diálogo existente. Se reutilizaron los componentes y repositorios del proyecto; no se añadió una dependencia ni se creó una solución de impresión paralela.

La [investigación de recibos de Toast, Square, Shopify y Lightspeed](../research/2026-10-14-comprobantes-reembolso/README.md) separa los hechos documentados de la decisión de presentación de Umi. Su conclusión práctica es conservar tanto el folio del evento como la referencia a la venta y al ticket de origen.

## Pruebas y evidencia

- `flutter analyze`: sin hallazgos. `flutter test`: **971/971** (log `/tmp/umi-pos-refund-suspend-full-test.log`). Se actualizaron `sale_lifecycle_test.dart` (motivo Otro y suspensión sin nombre), `sale_exception_test.dart` (Otro en reembolso/anulación), `printer_settings_test.dart` (ubicación, conservación de política y geometría) y `thermal_logo_test.dart` (líneas del EX).
- API: **30/30** pruebas focalizadas de identidad del recibo y checkout (`/tmp/umi-api-refund-card-focused.log`); `pnpm build` correcto. Contrato: **87/87** (`/tmp/umi-contract-refund-card-tests.log`). La spec de `pos-hardware.repository.ts` ya tenía dos errores TS2322 sobre `null` ajenos a este cambio y `checkout-partial-payments.spec.ts` ya tenía avisos ESLint por aserciones `as never`; la compilación de la API y las pruebas focalizadas sí pasaron.
- El log `/tmp/umi-api-4001.log` registra a las `16:28:41.593Z` el `POST /api/v1/pos/merchants/e6b14af1-b814-4efe-a6b0-67f5f02f4d53/hardware/print-jobs/bfec4b6a-08c1-5485-859f-f7f755aebb49/reprint` con estado **201**. La [pantalla de reimpresión](evidence/2026-10-14-reembolso-cobro-impresora/imin-reprint-ex0002-result.png) muestra la copia como **Impreso**.
- La fila `merchant.hardware_print_job.id = f726bc44-89d7-49f0-a061-990cb6b7753e` tiene `safe_document.printPayload` con `orderNumber=193`, `receiptNumber=EX-0002`, `originalReceiptNumber=0001` y `logoUrl` presente. Consulta reproducible:

  ```sh
  docker exec umi-bv3-pg psql -U postgres -d umi_local -Atc "select job_type, safe_document->'printPayload'->>'orderNumber', safe_document->'printPayload'->>'receiptNumber', safe_document->'printPayload'->>'originalReceiptNumber', (safe_document->'printPayload'->>'logoUrl') is not null from merchant.hardware_print_job where id='f726bc44-89d7-49f0-a061-990cb6b7753e';"
  # receipt_copy|193|EX-0002|0001|t
  ```

- La iMin muestra [los ajustes alineados](evidence/2026-10-14-reembolso-cobro-impresora/imin-120-printer-settings-aligned.png) y [el diálogo de suspensión sin campo de nombre](evidence/2026-10-14-reembolso-cobro-impresora/imin-120-suspend-dialog.png). También se capturó el [centro de hardware](evidence/2026-10-14-reembolso-cobro-impresora/imin-120-hardware.png). `dumpsys package` confirmó `versionCode=120` y `versionName=0.1.0` en las tres terminales tras `adb install -r` y el lanzamiento con `monkey`.

No se inspeccionó físicamente el papel de la reimpresión EX; la evidencia disponible es la respuesta 201, la fila de impresión y el estado **Impreso** del POS. Tampoco se ejecutó un cobro real con tarjeta ni se confirmó la suspensión de la cuenta 192: se comprobó el diálogo sin alterar esa cuenta. La cuenta 195 mostró un cobro pendiente de confirmar, por lo que no se modificó. En A9 y A11 se verificaron instalación y versión; la inspección visual de estos dos cambios se hizo en la iMin.
