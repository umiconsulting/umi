# Push de pedidos listos para meseros — ciclo local

Fecha operativa: 13 de octubre de 2026 (los logs UTC cruzan al 14). Este ciclo usa una sola base local `umi_local`, la API en `192.168.1.9:4001` y el APK Android final `0.1.0+100` instalado en la iMin, la A9 (KDS) y la A11 (POS portátil). No se creó configuración para staging ni producción.

## Decisión y herramientas

Se eligió Firebase Cloud Messaging (FCM) para la entrega con Android en segundo plano o con pantalla apagada. Es el transporte que usa el sistema para despertar y mostrar la notificación sin mantener un proceso del POS activo. Una conexión propia por WebSocket o sondeo no habría dado esa garantía al suspender la app; UnifiedPush exige un distribuidor adicional en cada terminal y no cubre de forma uniforme estas tres instalaciones. La API sigue siendo la fuente de verdad: FCM sólo transporta el aviso. Las recomendaciones técnicas vienen de la [guía oficial de recepción en Flutter](https://firebase.google.com/docs/cloud-messaging/flutter/receive-messages), el [envío con Firebase Admin](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk), la [gestión de tokens](https://firebase.google.com/docs/cloud-messaging/manage-tokens), el [plugin Google Services](https://firebase.google.com/docs/android/google-services-plugin-and-file) y los [canales de Android](https://developer.android.com/develop/ui/compose/notifications/channels).

Herramientas y versiones: Firebase CLI 15.33.0 para crear el proyecto y registrar las apps; Flutter 3.47.5 / Dart 3.13.4 para compilar y probar; Android Debug Bridge 37.0.0 para instalar y operar las terminales; Node 24.21.0 para la API y el worker. Dependencias fijadas: `firebase_core 4.15.0`, `firebase_messaging 16.7.0`, `firebase-admin 14.5.0` y plugin Gradle `com.google.gms.google-services 4.5.0`. Se usaron esas herramientas porque son las integraciones oficiales recomendadas en las guías anteriores; no se implementó a mano el protocolo FCM ni un servicio Android paralelo.

## Configuración por ambiente

Se creó el proyecto **`umiconsulting-pos-dev`** (número `1064474782021`) y se registraron los paquetes Android `co.umiconsulting.umi_pos.estacion` y `co.umiconsulting.umi_pos`. El archivo `apps/umi-pos/android/app/google-services.json` contiene sólo la configuración pública de las apps Android. La cuenta de servicio local `umi-pos-local-fcm@umiconsulting-pos-dev.iam.gserviceaccount.com` tiene el permiso específico de envío FCM; su llave está fuera del repositorio en `/home/juan/.config/umi/firebase/umiconsulting-pos-dev-fcm.json`, con modo `0600`. El archivo local e ignorado `apps/umi-api/.env`, también en modo `0600`, conserva `FCM_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS` y `OUTBOX_RELAY_ENABLED=true` para los siguientes arranques de la API y el worker. Cargando ese archivo con `node --env-file=.env`, `applicationDefault().getAccessToken()` obtuvo un token de acceso válido; un envío a un token FCM ficticio devolvió `messaging/invalid-argument` sin avisar a ningún dispositivo real.

El Gradle Android rechaza builds declarados `staging`, `pilot` o `production` mientras sólo exista la configuración Firebase de desarrollo. Antes de promover habrá que crear **proyectos separados por ambiente**, registrar sus aplicaciones y dar a cada worker identidad y credenciales propias, conforme a la [guía de múltiples proyectos Firebase](https://firebase.google.com/docs/projects/multiprojects). No se debe copiar la llave local a esos entornos.

Por petición del dueño se solicitaron las bajas de los tres proyectos anteriores: `bancos-fbab6`, `cocina-65674` y `constauditor`. La API de Google Cloud Resource Manager confirmó `DELETE_REQUESTED` para los tres; la eliminación permanente espera el periodo de recuperación de Google, documentado en [Delete and restore projects](https://docs.cloud.google.com/resource-manager/docs/delete-restore-projects). La lista de proyectos activos de Firebase sólo contiene `umiconsulting-pos-dev`.

## Flujo implementado

- El POS Android pide el permiso de notificaciones, obtiene y renueva el token FCM, y lo registra en la API para **operador, sesión, dispositivo, local, ambiente y proyecto**. Al cerrar sesión lo revoca; al bloquear al operador conserva el registro. Reintenta en reanudación y al recuperar conectividad. La API reasigna un token de forma atómica si cambia de operador en el mismo dispositivo.
- La migración `034_pos_push_tokens.sql` crea `runtime.pos_push_token` y añade `fired_by_user_id` a la línea enviada a cocina. Se aplicó dos veces sin error, comprobando que es reejecutable:

  ```sh
  docker exec -i umi-bv3-pg psql -U postgres -d umi_local -v ON_ERROR_STOP=1 < docs/migration/build-v3/migrations/034_pos_push_tokens.sql
  ```

- Al cambiar un ítem a listo, KDS escribe el evento de salida en la misma transacción que el cambio de estado. El destinatario es el mesero que **envió esa línea a cocina**, incluso si otra persona abrió o cobró la cuenta después. Si todos los ítems quedan listos, se envía un solo aviso de **pedido listo** en lugar de duplicar avisos de ítem y pedido. El worker envía por FCM y el outbox registra la entrega.
- Android usa el canal `orders_ready` de importancia alta y sonido del sistema. En primer plano el POS muestra el aviso dentro de la app y usa el audio local de cocina. Tocar una notificación abre el POS en su estado actual; no se fuerza una navegación a una cuenta que quizá ya cambió o fue cobrada.
- La primera prueba reveló que el POS creaba cuentas vacías al terminar un cobro y al entrar un operador nuevo: aparecieron los folios 177 y 178 justo después de pagar la 176 y volver a iniciar sesión. Se corrigieron `SaleLifecycleController`, `CatalogSurface` y `CheckoutSurface`: ahora la comanda sin contenido se presenta sin folio y sólo se crea una cuenta al agregar el primer producto o al confirmar una mesa. Elegir `Para llevar`, pulsar `Nuevo pedido`, cerrar el comprobante y entrar o salir de sesión no escriben un borrador vacío.

## Pruebas y evidencia real

`flutter analyze --no-pub` terminó sin hallazgos y la suite completa del POS terminó **939/939 verde** después de la corrección de folios. La prueba nueva de notificaciones y las pruebas de creación diferida se ejecutaron dentro de esa suite. Cambiaron las premisas de `sale_lifecycle_test.dart`, `order_entry_flow_test.dart`, `open_accounts_test.dart` y `cart_layout_test.dart`: antes suponían una cuenta al ingresar, al cobrar o al guardar otra; ahora exigen que el folio espere contenido. La API compiló; 93 pruebas unitarias y 7 pruebas de integración PostgreSQL de KDS quedaron verdes. El typecheck general de API conserva dos errores previos en `pos-hardware.repository.spec.ts:70,95`, ajenos a este cambio. `git diff --check` pasó. Este Markdown pasó `npx prettier --write` y `npx prettier --check`; `pnpm format:check` global sigue rojo por 68 archivos preexistentes de otras sesiones, que no se reescribieron aquí.

En la primera prueba física (build 99), Mesero 2 en la A11 aceptó el permiso Android, creó la **Cuenta 176 · Mesa 5**, añadió una Margarita de MXN 220 y la envió a cocina. En la A9, KDS la pasó de `En cola` a `En preparación` y después a `Listo`. La A11 estaba en HOME y con pantalla apagada; Android mostró `Pedido listo — Cuenta 176 · Mesa 5: orden lista para entregar`. La iMin cobró MXN 220. Esa prueba descubrió los borradores vacíos 177/178 y motivó el build 100.

En la prueba final (build 100), la A11 retomó el borrador vacío 178, eligió `Para llevar` y añadió una Margarita; la base mantuvo `max(account_number)=178`. La A9 mostró **Cuenta 178** en Cocina, la preparó y la terminó. Con la A11 otra vez en HOME y pantalla apagada, Android mostró `Pedido listo — Cuenta 178: orden lista para entregar`; al tocar la notificación abrió esa comanda. El worker entregó el evento, y KDS quedó en `Hoy (0)`. Al cerrar sesión en la A11, la cuenta 178 quedó suspendida y el token fue revocado. La iMin abrió la 178 desde Lista: eso apartó la 177 vacía y la API la marcó `abandoned/cancelled`. La iMin cobró la 178 por MXN 220 y quedó `committed`. `Nuevo pedido`, el cierre y reingreso de Admin en iMin y el reingreso de Mesero 2 en A11 dejaron el máximo en **178, sin crear la 179**. El token del mesero volvió a quedar activo tras entrar.

En una prueba adicional solicitada por el dueño, se creó desde la A11 la **Cuenta 180**, para llevar, con una Margarita de MXN 220. La A9 la mostró en Cocina en `En cola`, luego `En preparación` y `Listo`; al terminar quedó `Hoy (0)`. La A11 estaba en HOME con la pantalla apagada cuando se completó la pizza: el worker registró `pos_push_sent` a las 01:10:51 UTC y Android mostró `Pedido listo — Cuenta 180: orden lista para entregar`. La iMin cobró la cuenta en efectivo por MXN 220; la base confirmó `committed` y una línea Margarita. Durante esa prueba apareció además la **Cuenta 179**, vacía, asociada a la sesión de Admin en la iMin: la API registró `POST /sales` a las 01:10:03 UTC, antes de la creación de la 180 en la A11. No se atribuyó ese POST a una acción humana ni a un camino automático con la evidencia disponible. Al abrir la 180, la API cerró la 179 como `abandoned/cancelled`, con cero líneas; no quedó una cuenta vacía abierta, pero se consumió el folio 179. Es un hallazgo pendiente de diagnóstico, no una validación de que la creación diferida cubra todos los caminos.

Capturas directas de terminal:

- [Permiso Android](evidence/2026-10-13-fcm-local-meseros/a11-permiso-android.png), [cuenta antes de enviar](evidence/2026-10-13-fcm-local-meseros/a11-cuenta-176-antes-enviar.png) y [cuenta enviada](evidence/2026-10-13-fcm-local-meseros/a11-cuenta-176-enviada.png).
- KDS: [en cola](evidence/2026-10-13-fcm-local-meseros/a9-cuenta-176-en-cola.png), [preparando](evidence/2026-10-13-fcm-local-meseros/a9-cuenta-176-preparando.png), [lista](evidence/2026-10-13-fcm-local-meseros/a9-cuenta-176-lista.png).
- A11: [notificación real en Android](evidence/2026-10-13-fcm-local-meseros/a11-notificacion-cuenta-176.png) y [POS al abrirla](evidence/2026-10-13-fcm-local-meseros/a11-abrir-desde-notificacion.png). La captura de la pantalla de bloqueo salió negra por la protección de Android; se desbloqueó y se capturó la notificación todavía activa en la cortina. `dumpsys notification --noredact` confirmó el canal `orders_ready` con importancia 4.
- iMin: [cuenta de prueba pagada](evidence/2026-10-13-fcm-local-meseros/imin-cuenta-176-pagada.png).
- Build 100: [cuenta 178 enviada desde A11](evidence/2026-10-13-fcm-local-meseros/a11-build100-cuenta-178-enviada.png), [lista en KDS](evidence/2026-10-13-fcm-local-meseros/a9-build100-cuenta-178-lista.png), [notificación Android](evidence/2026-10-13-fcm-local-meseros/a11-build100-notificacion-cuenta-178.png), [cuenta abierta al tocarla](evidence/2026-10-13-fcm-local-meseros/a11-build100-abierta-desde-push-178.png), [KDS terminado](evidence/2026-10-13-fcm-local-meseros/a9-build100-cuenta-178-terminada.png) y [pago en iMin](evidence/2026-10-13-fcm-local-meseros/imin-build100-cuenta-178-pagada.png).
- Tras reingresar sin una venta activa: [iMin muestra Comanda sin folio](evidence/2026-10-13-fcm-local-meseros/imin-build100-reingreso-sin-folio.png) y [A11 muestra Comanda sin folio](evidence/2026-10-13-fcm-local-meseros/a11-build100-reingreso-sin-folio.png).
- Prueba adicional de la Cuenta 180: [A11 la envió](evidence/2026-10-13-fcm-local-meseros/a11-cuenta-180-enviada.png); la A9 la mostró [en cola](evidence/2026-10-13-fcm-local-meseros/a9-cuenta-180-en-cola.png), [preparando](evidence/2026-10-13-fcm-local-meseros/a9-cuenta-180-preparando.png) y [lista](evidence/2026-10-13-fcm-local-meseros/a9-cuenta-180-lista.png); Android mostró [la notificación en la A11](evidence/2026-10-13-fcm-local-meseros/a11-notificacion-cuenta-180.png) y [la iMin confirmó el pago](evidence/2026-10-13-fcm-local-meseros/imin-cuenta-180-pagada.png).

Extractos de `/tmp/umi-api-4001.log` y `/tmp/umi-worker-fcm-local.log`:

```text
00:18:55Z POST /api/v1/pos/merchants/.../push-tokens 201
00:20:10Z POST /orders/fire 201
00:21:27Z POST /kitchen/command 201
00:21:28Z pos_push_sent event=f71932cc-0a12-4fc6-afef-442067f2900c
00:25:24Z DELETE /api/v1/pos/merchants/.../push-tokens 200
00:26:47Z POST /api/v1/pos/merchants/.../push-tokens 201
00:43:07Z POST /orders/fire 201
00:43:26Z POST /kitchen/command 201
00:43:27Z pos_push_sent event=820a6b83-3fbc-4c7e-b942-4d570a02d8c0
00:44:34Z DELETE /api/v1/pos/merchants/.../push-tokens 200
00:45:37Z POST /checkout 201
00:46:41Z POST /api/v1/pos/merchants/.../push-tokens 201
01:10:03Z POST /sales 201 (sesión de Admin; cuenta vacía 179)
01:10:27Z POST /orders/fire 201 (cuenta 180)
01:10:51Z pos_push_sent event=48a4f39d-0919-45b5-9b19-a8404b52eb57
01:13:17Z POST /checkout 201 (cuenta 180)
```

Filas consultadas en `umi_local` después de la prueba, omitiendo el valor secreto del token:

```text
runtime.outbox_event: pos.kitchen_order_ready | delivered | attempts=0 | 2026-10-14 00:21:27.87745+00
runtime.outbox_event: pos.kitchen_order_ready | delivered | attempts=0 | 2026-10-14 00:43:26.713463+00
runtime.pos_push_token: Mesero 2 | development | umiconsulting-pos-dev | android | active=true
merchant.pos_cart: account_number=176 | status=committed | lifecycle_state=committed | table_name=Mesa 5
merchant.pos_cart: account_number=177 | status=abandoned | lifecycle_state=cancelled | 0 líneas
merchant.pos_cart: account_number=178 | status=committed | lifecycle_state=committed | 1 línea
merchant.pos_cart: max(account_number)=178 | cuentas >178=0 tras reingresar en ambos POS
runtime.outbox_event: pos.kitchen_order_ready | delivered | attempts=0 | 2026-10-14 01:10:51.299588+00
merchant.pos_cart: account_number=179 | status=abandoned | lifecycle_state=cancelled | 0 líneas
merchant.pos_cart: account_number=180 | status=committed | lifecycle_state=committed | 1 línea Margarita
```

El APK final `0.1.0+100` (SHA-256 `411fa30d3891dd8dbe2579ed575fd4b2cc1e1836eb2b6eff0610eef1216916f0`) se instaló con `adb install -r` en `192.168.1.10:5555` (iMin), `192.168.1.14:35559` (A9) y `192.168.1.13:38333` (A11); `dumpsys package` confirmó `versionCode=100` en las tres.

## Límites comprobados

Se verificó físicamente el aviso de **pedido completo** con app en segundo plano y pantalla apagada. No se verificó con el dispositivo completamente apagado ni el aviso de **ítem listo mientras faltan otros**; la decisión y el destinatario del aviso parcial están cubiertos por pruebas unitarias y de integración. Tampoco se midió acústicamente el sonido de la A11: se comprobó el canal Android de importancia alta y la notificación visible. No se desplegó ni probó staging/producción. La API local respondió a las rutas usadas aunque `/health` sigue en `503 degraded` por el registro local de `runtime.schema_migration` (0 filas aplicadas frente al build esperado); no se alteró ese registro para maquillar el estado.
