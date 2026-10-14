# Notificación de cocina y estado real en la Comanda — 14 de octubre de 2026

La notificación de ítem listo ya abre la cuenta correspondiente en la Comanda del POS portátil. Cada renglón enviado a cocina muestra su estado real: «En cola», «Preparando», «Listo» o «Anulado». La pantalla consulta el estado cada cinco segundos mientras la orden está activa, para que también se actualice sin salir y volver a entrar.

## Cambio

- El contrato POS de cocina 2.38.0 incluye los estados por `sourceOrderItemId`. La API los lee de `merchant.kitchen_order_item`; el POS los une a los renglones de la cuenta sin usar el estado agregado del ticket como sustituto.
- El POS maneja el toque de una notificación con `onMessageOpenedApp` y `getInitialMessage()`. Busca la cuenta abierta por `sourceOrderId`, la reanuda, consulta cocina y abre la Comanda en pantalla angosta. La notificación en primer plano también puede abrirse al tocarla.
- Si la cuenta ya no está abierta, el POS informa al operador. El payload existente sólo incluye `sourceOrderId`; no se cambió el formato del envío FCM.
- Se mantiene el canal Android de avisos listos con importancia alta, globo y contenido público para la pantalla de bloqueo, implementado en el ciclo anterior.

La [documentación oficial de Firebase para Flutter](https://firebase.google.com/docs/cloud-messaging/flutter/receive-messages#handling_interaction) recomienda atender tanto `onMessageOpenedApp` como `getInitialMessage()` para cubrir aplicaciones en segundo plano y terminadas. Se usó `firebase_messaging` **16.7.0**, ya fijado en `apps/umi-pos/pubspec.yaml`, en lugar de un receptor Android hecho a mano. El contrato se regeneró con el generador del propio paquete `@umi/contract` definido en `packages/contract/package.json`. Herramientas de verificación: Flutter **3.47.5**, ADB **1.0.41** (platform-tools **37.0.0**), Node **24.21.0**, pnpm **10.29.3** y Vitest **2.1.9**.

## Pruebas y dispositivos

- `flutter analyze`: sin hallazgos. Suite completa del POS: **994 pruebas aprobadas**. Pruebas focalizadas de cocina, push y rol aprobadas; se añadieron casos para transición del renglón «En cola» → «Listo» y apertura de Comanda desde una notificación. Contrato: **87 pruebas aprobadas**. API: pruebas focalizadas de KDS y push aprobadas; `pnpm typecheck` sin errores.
- Una invocación accidental de la suite completa de API terminó con **1958 aprobadas y 5 fallidas** en tres archivos ajenos a este cambio, entre ellos `pos-cash.repository.regression.spec.ts`, ya afectado por trabajo simultáneo. No se presenta esa suite como verde.
- APK profile **0.1.0+125**, contrato **2.38.0**, instalado y comprobado con `dumpsys package` en iMin D3, A9 (KDS) y A11 (POS móvil).
- En la A11 se creó **Cuenta 213** con una pizza Margarita y se envió a cocina. La A9 mostró el ticket en cola, luego preparando y después listo. Con la A11 en segundo plano llegó el aviso emergente «Pedido listo»; al tocar la notificación en la bandeja, abrió la **Cuenta 213** con Margarita **«Listo»**. La cuenta de prueba quedó cancelada desde la iMin; en la base figura `lifecycle_state=cancelled` y el ticket de cocina `completed`.

Las [capturas de la A11 y A9](evidence/2026-10-14-kds-notificacion-comanda/), el [log de la API](evidence/2026-10-14-kds-notificacion-comanda/api-log.txt), las [filas de Postgres](evidence/2026-10-14-kds-notificacion-comanda/database.txt) y el [resultado de la suite POS](evidence/2026-10-14-kds-notificacion-comanda/pos-tests.log) quedan como evidencia. La captura de pantalla de bloqueo procede del build 124; el aviso emergente y el toque hasta Comanda sí se probaron en el build 125.

## Entorno y límites

La API local quedó con un único proceso `nest start --watch`: había dos instancias compitiendo y una devolvía errores de pool cerrado. El esquema local conservaba las tablas y los datos, pero faltaba el ancla del libro `runtime.schema_migration`; se restauró sólo su marca local con `insert into runtime.schema_migration(version,status) values ('build-v3-79','applied') on conflict (version) do nothing`. No se aplicó una migración nueva para esta función ni se tocaron datos comerciales existentes. El historial completo de migraciones de esa base no quedó reconstruido.

No se verificó en dispositivo una notificación que llegue mientras el mesero tiene **otra** cuenta abierta, ni el arranque desde proceso Android terminado; ambos caminos están implementados, pero la prueba real cubrió la misma cuenta desde segundo plano. Tampoco se validó la suite completa de API como verde. El árbol compartido permanece sucio por otros frentes y no se modificaron sus archivos fuera del alcance de esta función.
