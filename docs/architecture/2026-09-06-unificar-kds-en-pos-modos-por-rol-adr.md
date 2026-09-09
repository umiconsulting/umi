# ADR: Unificar el KDS dentro del POS con modos por rol de dispositivo

- Fecha: 2026-09-06
- Estado: Aceptado (decisión). Falta el port del KDS completo. La Fase 1 solo entrega una
  vista previa de solo lectura.
- Actualización 2026-09-06: se corrigió la sección de industria con fuentes primarias y se
  añadieron las secciones "Kiosco y agrupación natural de clientes" y "Riesgo de
  escalamiento: modo por dispositivo vs. login". La decisión de fondo se mantiene; se
  replantea su justificación (el "una sola fuente de verdad" es un logro del backend, ya
  hecho, no un motivo para fundir el cliente) y se marca el riesgo de escalamiento de la
  Fase 1 como abierto.
- Decisión: Rediseñar hacia una sola app cliente (Flutter `umi-pos`) con modos por rol de
  dispositivo (POS, KDS, Pantalla de cliente). El KDS es su propia superficie. Portar toda
  la funcionalidad del `umi-kds` nativo. Retirar `umi-kds` (SwiftUI) al alcanzar paridad.
- Base de la decisión: inferencia propia de Umi a partir de las reglas de arquitectura de
  `AGENTS.md` (dueño más estrecho; proyecciones aditivas) y del patrón de industria.

## Contexto

Umi tiene hoy **tres clientes separados**:

- `umi-dashboard` (web) — back-office.
- `umi-pos` (Flutter) — el terminal de venta. Corre en Linux y nativo.
- `umi-kds` (**SwiftUI, solo Apple**) — la pantalla de cocina.

El **backend ya es unificado**. El contrato define el rol de aplicación como
`SessionApplication = ['dashboard', 'kds', 'pos']`. La API tiene el módulo `kds`
completo (proyector de cocina, comandos, tablero, tiempo real) y el contrato
`pos-kitchen` (`KitchenOrderProjection`, `KitchenBoardRequest/Response`,
`KitchenCommandRequest`, `KitchenEventProjection`). El POS Flutter ya lee estatus de
cocina por `pos-kitchen`.

Lo único partido es el **cliente**: el KDS es una app nativa aparte, con su propio
cliente de API, cliente de tiempo real, cliente de latido (heartbeat), repositorio de
pedidos y sistema de diseño (`KDSCard`, `KDSTheme`). Además, el KDS se empareja por un
flujo propio (`kds.controller` → `kds.service.pairing` → `kds.repository.createDeviceSession`
con `station_id`), distinto del enrolamiento de dispositivo del POS
(`entry_controller.enroll`).

Problemas del estado actual (lo "legacy"):

- Dos clientes que mantener y sincronizar por separado (diseño, tiempo real, sesión).
- El KDS es **solo Apple**; no corre en el hardware Linux/genérico del POS.
- Dos flujos de emparejamiento e identidad de dispositivo divergentes.

## Inventario del KDS actual (umi-kds)

El `umi-kds` no es una pantalla simple. Tiene cerca de 2800 líneas en 27 archivos Swift,
con patrón MVVM y un contenedor de estado (`OrderRepository`, `ObservableObject`). Su
funcionalidad real (verificada con CodeGraph) marca el tamaño del port:

- Tablero de varias columnas por estado: En cola, En preparación, Parcial, Listo y
  Excepción, con conteo por columna (`Features/Board/BoardView.swift`).
- Vista maestro-detalle: al tocar un ticket abre acciones, métricas y lista de ítems
  (`Features/TicketDetail/TicketDetailView.swift`).
- Comandos de ticket: `start_preparation`, `mark_order_ready` y `complete`, a nivel de
  orden y de ítem (`Data/KDSAPIClient.swift`).
- Concurrencia optimista e idempotencia: `expectedVersion`, `commandId` e
  `idempotencyKey`. La identidad del comando persiste en `UserDefaults` y sobrevive a un
  reinicio (`Data/OrderRepository.swift`).
- Flujo de eventos por secuencia: aplica `KitchenEvent` de forma incremental, descarta
  secuencias repetidas, compara versiones y reconcilia con una instantánea cuando detecta
  un hueco (`Data/KDSRealtimeClient.swift`, `Data/OrderRepository.swift`).
- Máquina de estado de conexión: idle, connecting y connected. Muestra el estado con un
  indicador y un aviso de error. Bloquea los comandos mientras no hay conexión
  (`Data/OrderRepository.swift`, `Features/Board/BoardView.swift`).
- Latido (heartbeat): un actor envía un POST periódico con `X-KDS-Device-Token` para que
  el backend sepa que la pantalla está viva (`Data/KDSHeartbeatClient.swift`).
- Identidad y revocación de dispositivo: emparejamiento por PIN (`kds_start`,
  `kds_status`), sesión con `station_id` y `deviceToken`. Un dispositivo revocado vuelve a
  emparejar (`Data/KDSAPIClient.swift`, `App/AppEnvironment.swift`).
- Varios canales: recibe órdenes de `whatsapp`, `pos`, `web` y `dashboard`, no solo del POS
  (`Domain/KitchenModels.swift`).
- Dominio rico: estado por ítem, meta de tiempo por ítem (`targetSeconds`),
  `preparationStartedAt`, prioridad y resúmenes de accesibilidad
  (`Domain/KitchenModels.swift`).

## Cómo lo hacen los negocios modernos (corregido con fuentes primarias, 2026-09-06)

> **Corrección.** La versión previa de esta sección decía que "el patrón ganador es un
> solo código con modos por rol de dispositivo". La verificación con documentación
> primaria de cada proveedor NO sostiene esa afirmación como norma de industria. Fuentes:
> `docs/research/2026-09-06-pos-kds-client-architecture-vendor-research.md` y
> `docs/research/2026-09-06-pos-kiosk-and-device-role-boundaries-research.md`.

Hay que separar dos afirmaciones distintas:

- **Backend unificado ("una sola fuente de verdad").** Un solo backend guarda el pedido y
  el menú y los sincroniza a cada pantalla. Los cuatro proveedores lo hacen. Umi ya lo
  tiene: contrato único, módulo `kds` y la proyección `pos-kitchen` que el POS ya lee.
- **Cliente unificado (una sola app que renderiza POS o KDS por rol de dispositivo).** Es
  una afirmación más fuerte y poco común.

Lo que muestra la documentación primaria:

- **Toast**: SÍ funde el cliente. El KDS es un modo del mismo binario del POS ("switch a
  device into KDS Mode"). Aun así, licencia el KDS como producto aparte.
- **Square**: NO funde el cliente. El KDS es una app aparte (solo Android; iOS retirado el
  12 de enero de 2026), mientras el POS corre en iPad. Separación deliberada, incluso por
  sistema operativo.
- **Lightspeed**: NO funde el cliente. El KDS es una app web aparte (un "order manager"),
  un módulo con costo por pantalla.
- **NovaTab** (la cita más usada en la versión previa): solo afirma el backend unificado
  ("one platform, one source of truth"). Nunca afirma "una app con modos por rol".

Conclusión corregida: de cuatro líderes, solo **uno** (Toast) funde el cliente; dos
(Square, Lightspeed) lo mantienen separado a propósito; y NovaTab solo respalda el backend
unificado. El patrón común real es **un backend compartido con clientes de cocina
dedicados**. Fundir el cliente es una opción legítima —Toast la envía— pero se justifica
por reutilización de código y ergonomía de cocina, NO por "una sola fuente de verdad" (eso
ya se logra con el backend) ni por NovaTab.

## Kiosco y agrupación natural de clientes

Un kiosco de autoservicio reutiliza el flujo de pedido del POS (catálogo, carrito,
modificadores, cobro), no el de la cocina. En Toast el kiosco es el mismo binario en
"Kiosk Mode"; en Square es una app aparte; en Clover es un dispositivo dedicado. La
familia natural de reutilización de cliente es **{POS, kiosco, pantalla de cliente}**:
entrada de pedidos y despliegue. El **KDS** es una superficie distinta: cola y comandos,
de solo lectura desde el POS, ciega a mesas, y en Square hasta en otro sistema operativo.

Implicación para la decisión: un kiosco futuro fortalece un solo cliente de **entrada de
pedidos** (eje POS↔kiosco), no la fusión POS↔KDS. La fusión POS↔KDS debe justificarse por
sí sola (reutilización y ergonomía), no por el kiosco. Fuente:
`docs/research/2026-09-06-pos-kiosk-and-device-role-boundaries-research.md`.

## Riesgo de escalamiento: modo por dispositivo vs. login

Regla de seguridad: la superficie que renderiza un dispositivo debe depender del **rol del
dispositivo**, no de los permisos del usuario que inicia sesión. Si el modo se deriva del
usuario, un cajero que teclea su PIN en una pantalla de cocina obtiene el POS en la cocina.
Ese es un riesgo innecesario.

Cómo lo cierra **Toast** (verificado en parte): el modo del dispositivo es un "Primary
Mode" que fija un administrador ("default screen upon logging in"); cambiar de modo exige
el permiso `1.3 Kitchen Display System Mode`; y las capacidades sensibles (cajón,
reembolso) siguen atadas al permiso por usuario. Es decir: rol bloqueado al dispositivo +
cambio de modo con permiso + capacidades por usuario. Ninguna página dice de forma
explícita que el modo KDS oculte la interfaz del POS; esa parte queda como inferencia sobre
candados verificados. **Square** evita el riesgo por construcción: el KDS es otra app en
otro dispositivo, sin superficie de POS que alcanzar.

Estado en Umi (**riesgo abierto hoy**): la Fase 1 reutiliza la **sesión de operador** del
POS y exige un operador con PIN en un dispositivo enrolado como POS (ver "Cómo funciona la
Fase 1"). Por eso una "estación" de cocina de Fase 1 es, en realidad, un POS con un tablero
encima, sin candado de rol de dispositivo. La **Fase 2** (sesión de estación desatendida,
con rol de dispositivo y token propio) es el arreglo y es **condición** para llevar un
dispositivo en modo KDS a una cocina real. Un kiosco (público, no confiable) sube este
control —autorización por rol de dispositivo del lado del servidor— de "deseable en Fase 2"
a **requisito**. Fuente: la misma investigación del kiosco, Dimensión D.

## Decisión

Unificar el KDS **dentro de la app Flutter `umi-pos`** como un **modo por rol de
dispositivo**. La misma app, según el rol asignado al dispositivo, renderiza:

- **POS** — el catálogo de venta (ya rediseñado al estilo PoloTab).
- **KDS** — el tablero de cocina completo, con comandos y tiempo real.
- **Pantalla de cliente** — la vista orientada al comensal (contrato ya prevé
  `customer_display` en hardware).

El KDS es **su propia superficie**. La entrada del menú de ajustes fue solo un atajo de la
Fase 1. Hay dos accesos:

- **Dispositivo con rol KDS**: arranca directo en la superficie KDS. Usa la sesión de
  dispositivo KDS. Tiene comandos, latido y estado de conexión.
- **Terminal POS**: un elemento fijo "Cocina" en la barra inferior abre el tablero de solo
  lectura con la sesión de operador. Sirve para una consulta rápida.

Se porta toda la funcionalidad del `umi-kds` nativo (ver "Inventario del KDS actual"). Se
retira `umi-kds` (SwiftUI) al alcanzar paridad.

## Qué se reutiliza (no se reconstruye el backend)

- Contrato `pos-kitchen`: `KitchenBoardRequest/Response`, `KitchenCommandRequest/Result`,
  `KitchenEventProjection` y el tiempo real. El POS ya los consume.
- Módulo `kds` de la API: proyector, servicio, comandos, latido, guard de ubicación y
  emparejamiento por PIN. El `umi-kds` ya usa estos endpoints; el port en Dart los reutiliza.
- Del cliente `umi-kds` se porta el **comportamiento** a Dart, no solo la interfaz:
  aplicación de eventos por secuencia, idempotencia de comandos, concurrencia optimista,
  máquina de estado de conexión y latido (ver "Inventario del KDS actual").
- Tema oscuro + azul PoloTab y la infraestructura de red del POS se comparten entre modos.

## Modelo de rol de dispositivo

Estado actual (hecho documentado):

- El contrato define `SessionApplication = ['dashboard', 'kds', 'pos']` en
  `packages/contract/src/platform.ts`. Es el rol de aplicación de la sesión. No es un
  campo de rol del dispositivo.
- El contrato define `customer_display` solo como `HardwareDeviceType` (un periférico)
  en `packages/contract/src/pos-hardware.ts`. Todavía no existe un modo de aplicación
  de pantalla de cliente.
- No existe un campo de rol de dispositivo con los valores `pos | kds | customer_display`.

Cómo funciona la Fase 1 (hecho verificado en el código):

- El modo KDS reutiliza la sesión del POS y la ruta `/api/v1/pos/...`. El "modo" es una
  vista del cliente, no una sesión distinta.
- La autorización del tablero exige una sesión de operador (`operatorSessionId` en
  `authorizePos`). El tablero necesita un operador con PIN activo en el dispositivo.

Objetivo de la Fase 2 (decisión):

- Añade un atributo aditivo de rol al enrolamiento unificado del dispositivo:
  `pos | kds | customer_display`.
- Mantén un solo flujo de enrolamiento. No crees una segunda identidad de dispositivo.
- Usa el rol para una sesión de estación KDS sin operador, el token de dispositivo del
  latido y la autorización del modo cocina.
- Base de la decisión: inferencia propia de Umi a partir de `AGENTS.md` (dueño más
  estrecho; prefiere proyecciones aditivas a cambios destructivos de esquema).

## Consecuencias

Positivas:

- Un solo código cliente. Menos mantenimiento y menos divergencia.
- El KDS deja de ser solo Apple: corre en el mismo hardware Linux/genérico del POS.
- "Una sola fuente de verdad": el pedido cobrado en el POS aparece al instante en el KDS
  del mismo sistema.
- El KDS hereda el rediseño PoloTab (tema, tarjetas, tiempo real).

Costos y riesgos:

- El port es grande. Hay que replicar cerca de 2800 líneas de comportamiento del `umi-kds`
  (eventos, comandos, conexión, latido), no solo la interfaz.
- Hay que **reconciliar la identidad de dispositivo**: el KDS empareja distinto (con
  `station_id`) que el POS (`enroll`). Se debe unificar el enrolamiento y añadir un
  campo de **rol** al dispositivo/sesión.
- El tablero de la Fase 1 es de solo lectura y reutiliza la autorización de la sesión de
  operador del POS. Hoy es una vista previa, no una estación KDS desatendida.
- El tablero refresca por sondeo cada 8 s. Es un sustituto temporal del flujo de eventos.
- Migración con dos clientes en paralelo hasta lograr paridad.

## Alternativas consideradas

1. **Mantener apps separadas** (estado actual) — rechazado: es el patrón legacy;
   duplica cliente y limita el KDS a Apple.
2. **KDS como app Flutter aparte** — rechazado: sigue siendo dos clientes; no hay
   "una sola fuente de verdad" de cliente.
3. **KDS dentro del dashboard (web)** — rechazado: la ergonomía de cocina (pantalla
   dedicada, siempre encendida, táctil grande) no encaja en el back-office web.

## Plan de migración por fases

- **Fase 0 — decisión (este ADR).** Confirmar el rumbo y el modelo de rol.
- **Fase 1 — vista previa de solo lectura (HECHA).** Tablero de toda la sucursal, de solo
  lectura, con la sesión de operador. Pendiente: mover la entrada del menú Ajustes a un
  elemento fijo "Cocina" en la barra inferior. `umi-kds` sigue vivo.
- **Fase 2 — identidad de dispositivo KDS.** Añadir el rol de dispositivo, la sesión de
  estación sin operador, el token y el latido, y unificar el emparejamiento con el
  enrolamiento del POS.
- **Fase 3 — port de comportamiento.** Portar a Dart el flujo de eventos por secuencia, los
  comandos con idempotencia y concurrencia optimista, la máquina de estado de conexión y la
  reconciliación por instantánea.
- **Fase 4 — port de interfaz.** Construir el tablero de columnas, la vista maestro-detalle,
  las tarjetas con edad, canal e ítems, los conteos por columna y los avisos de conexión.
- **Fase 5 — paridad y retiro.** Cubrir varios canales, estado por ítem, metas de tiempo,
  revocación de dispositivo y accesibilidad. Al alcanzar paridad, **deprecar `umi-kds`**.

## Criterios de paridad (puerta de la Fase 5)

Depreca `umi-kds` solo cuando el modo KDS del POS cumpla todos estos puntos:

- Sesión de estación desatendida. El modo KDS no exige un operador con PIN.
- Comandos de ticket desde el modo KDS: iniciar, listo y completar.
- Idempotencia y concurrencia optimista de los comandos (`expectedVersion`,
  `idempotencyKey`).
- Flujo de eventos por secuencia que reemplaza el sondeo de 8 s, con reconciliación por
  instantánea.
- Máquina de estado de conexión que bloquea los comandos sin conexión.
- Latido, reconexión y comportamiento sin conexión al nivel de `umi-kds`.
- Tablero de columnas y vista maestro-detalle.
- Varios canales: `whatsapp`, `pos`, `web` y `dashboard`.
- Estado por ítem y metas de tiempo por ítem.
- Revocación de dispositivo y regreso al emparejamiento.
- Paridad del guard de ubicación y de los entitlements.

## Estado de implementación (2026-09-06)

**Fase 1 — vista previa de solo lectura.** El POS abre un tablero de cocina de toda la
sucursal, de solo lectura. Es una vista previa, no el KDS completo. Cubre cerca del 5% del
`umi-kds`.

- **API.** Endpoint autenticado como POS:
  `GET /api/v1/pos/merchants/:merchantId/kitchen/board`
  (`KdsService.boardForPos` en `apps/umi-api/src/modules/kds/kds.service.ts`,
  ruta en `kds-pos.controller.ts`). Autoriza la sesión de operador igual que
  `statusForPos`, lista las estaciones activas de la sucursal, toma la instantánea del
  tablero (`boardSnapshot`) y la mapea con `toSnapshotRow` — **el mismo mapeo que usa la
  ruta del tablero por dispositivo**. Es de solo lectura.
- **Flutter.** `apps/umi-pos/lib/features/kitchen/kitchen_board_controller.dart`
  (`ApiKitchenBoardRepository` + `KitchenBoardController`) y `kitchen_board_surface.dart`
  (`showKitchenBoard()` a pantalla completa; tarjetas estilo PoloTab: barra de acento por
  estado/prioridad, minutos transcurridos, renglones de ítem con variante, modificadores
  y nota; refresco automático cada 8 s). Cableado en `composition_root.dart` →
  `umi_pos_app.dart` → `CatalogSurface`.
- **Entrada.** Hoy es el menú **Ajustes** ("Cocina (KDS)"). Pendiente: promover el acceso
  a un elemento fijo "Cocina" en la barra inferior.
- **Verificación.** Analizador limpio; hot restart sin errores de ejecución; el tablero
  abre y consulta con `status:200` cada ~8 s; estado vacío "Sin comandas en cocina."
  porque los datos de prueba de Kalala no tienen tickets de cocina activos.

Falta para el KDS completo (ver "Inventario del KDS actual" y "Criterios de paridad"):
identidad de dispositivo KDS, flujo de eventos por secuencia, comandos con idempotencia,
máquina de estado de conexión, latido, tablero de columnas, vista maestro-detalle, varios
canales y estado por ítem.

## Referencias

- Código del KDS actual (via CodeGraph): `apps/umi-kds/Sources/Data/OrderRepository.swift`,
  `apps/umi-kds/Sources/Data/KDSRealtimeClient.swift`,
  `apps/umi-kds/Sources/Data/KDSHeartbeatClient.swift`,
  `apps/umi-kds/Sources/Data/KDSAPIClient.swift`,
  `apps/umi-kds/Sources/Domain/KitchenModels.swift`,
  `apps/umi-kds/Sources/Features/Board/BoardView.swift`,
  `apps/umi-kds/Sources/Features/TicketDetail/TicketDetailView.swift`,
  `apps/umi-kds/Sources/App/AppEnvironment.swift`.
- Código de la unificación (via CodeGraph): `apps/umi-api/src/modules/kds/*`
  (`kds.service.ts` → `boardForPos`, `kds-pos.controller.ts` → `GET .../kitchen/board`),
  `packages/contract/src/pos-kitchen.ts`, `packages/contract/src/platform.ts`
  (`SessionApplication`), `packages/contract/src/pos-hardware.ts`
  (`HardwareDeviceType` con `customer_display`),
  `apps/umi-pos/lib/features/kitchen/kitchen_board_controller.dart`,
  `apps/umi-pos/lib/features/kitchen/kitchen_board_surface.dart`,
  `apps/umi-pos/lib/features/entry/entry_controller.dart`.
- Industria (fuentes primarias, 2026-09-06 — reemplazan la comparación previa):
  `docs/research/2026-09-06-pos-kds-client-architecture-vendor-research.md` (arquitectura
  de cliente POS/KDS por proveedor) y
  `docs/research/2026-09-06-pos-kiosk-and-device-role-boundaries-research.md` (kiosco,
  vista de estatus en el POS, mesas, y modo por dispositivo vs. login — Dimensión D).
- Industria (secundaria, SUPERSEDED por lo anterior): Toast vs Lightspeed (sonary.com),
  NovaTab KDS (novatab.com), Square vs Toast vs Lightspeed (expertmarket.com). Se
  conservan como registro de la afirmación original que la verificación primaria corrigió.
