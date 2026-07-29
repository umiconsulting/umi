# UmiPOS — Resolución de arquitectura

**Fecha:** 2026-07-22
**Estado:** RESOLUCIÓN. Reafirma y cierra la decisión del 2026-07-14 (Opción B).
**Responde a:** `UMI_NEXO_PLATFORM_CONSOLIDATION_STRATEGY.md` y `UMI_NEXO_DISCOVERY_REPORT.md` (ambos 2026-07-22)
**Serie previa:** [`2026-07-14-umipos-analisis-integracion.md`](docs/architecture/2026-07-14-umipos-analisis-integracion.md) · [`2026-07-14-umipos-resumen-para-nexo.md`](docs/architecture/2026-07-14-umipos-resumen-para-nexo.md) · [`2026-07-20-umipos-contract-seam.md`](docs/architecture/2026-07-20-umipos-contract-seam.md)

---

## 0. Resolución

**UmiPOS es un módulo de la plataforma Umi, no una plataforma peer.** El backend del POS es `apps/umi-api/src/modules/pos/`, sobre la base de datos de Umi, único escritor de la orden, el pago y el evento de cocina. El repositorio Flutter es **un cliente enrolado** — como el KDS y el dashboard. No hay segunda base de datos, no hay bus de eventos entre planos, no hay sincronización, no hay reconciliación.

Esto **no es una decisión nueva**. Se tomó el 2026-07-14 tras un análisis de 902 líneas que comparó tres arquitecturas y rechazó explícitamente la que el documento recibido vuelve a proponer. Este documento no reabre esa decisión: la reafirma, la fundamenta contra literatura primaria, y la cuantifica contra nuestro modelo de negocio real.

La frontera operativa queda así:

|                            | Dueño                                                      | Contenido                                                                      |
| -------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Datos, reglas y dinero** | `apps/umi-api` (este repo)                                 | orden, pago, refund, corte de caja, catálogo, lealtad, identidad, entitlements |
| **Cliente de caja**        | repo Flutter                                               | UI, hardware, impresión, cola offline, cámara/scanner                          |
| **Frontera**               | `@umi/contract` → artefacto JSON versionado → codegen Dart | un tipo, un autor                                                              |

---

## 1. Qué es realmente el documento recibido

El documento propone una "plataforma federada": dos bases de datos, dos runtimes, dos deploy units, integradas por APIs versionadas y un bus de eventos, con NEXO como autoridad de Product, Pricing, Inventory, Sales, Payments, Cash, Receipts y Refunds, y con Umi migrando **sus propios writers** hacia allá.

Esa es, literalmente, la **Opción A** que evaluamos y rechazamos por escrito hace ocho días.

### 1.1 La prueba está en su propio índice

Las Fases 0–7 que el documento propone no son un plan de producto. Son la lista de trabajo que la Opción A **obliga a construir y a mantener para siempre**:

| El documento pide construir                                                   | Por qué existe                               |
| ----------------------------------------------------------------------------- | -------------------------------------------- |
| Registry de contratos + compatibility CI                                      | porque hay dos contratos                     |
| Event envelope versionado (`eventId`, `schemaVersion`, correlation/causation) | porque los datos cruzan un proceso           |
| Consumers idempotentes en ambos lados                                         | porque la entrega es at-least-once           |
| DLQ, quarantine, replay tests                                                 | porque los eventos se pierden y se reordenan |
| Tablas `legacySystem` / `legacyId` / `globalId`                               | porque hay dos espacios de identificadores   |
| Reconciliación, conteos y hashes                                              | porque los dos lados divergen                |
| Shadow reads, shadow authorization, canary por sucursal                       | porque no se puede confiar en el corte       |
| JWKS + token exchange                                                         | porque hay dos emisores de identidad         |
| Doble observabilidad, doble on-call, doble release train                      | porque hay dos sistemas                      |

**Ninguna de estas nueve líneas produce valor para un solo cliente.** Todas son impuesto de frontera. Y todas desaparecen —no se mitigan: desaparecen— si el POS escribe en la base de Umi.

Nuestro documento del 14 de julio ya lo decía en una frase que el documento recibido no refuta en ninguna de sus 865 líneas:

> "Cada uno de los diez riesgos que el brief pide analizar (duplicación de ventas, divergencia del wallet, diferencias de producto, conflictos de sucursal, pérdida de eventos, entrega fuera de orden…) existe **únicamente** en esta opción."

### 1.2 El argumento decisivo que quedó sin respuesta

El KDS no lee una tabla propia. Lee una **proyección derivada de la orden y su diario de eventos**. No existe una sola línea de código de integración entre el bot de WhatsApp y la cocina: la orden aparece en la pantalla porque ambos miran los mismos datos.

- Si el POS escribe la orden ahí → **aparece en el KDS y en el dashboard sin código de integración.**
- Si el POS escribe en su propia base → hay que construir, y mantener para siempre, una replicación que produzca ese mismo resultado. Y va a divergir.

El documento recibido reconoce el problema y lo convierte en trabajo: propone que NEXO publique `OrderSubmitted`, que Umi lo consuma, que el KDS emita `KitchenOrderStatusChanged` de regreso, y que se validen latencias y transiciones con "shadow feed". Es decir: propone **construir, con eventual consistency, la funcionalidad que hoy ya tenemos gratis con una FK.**

### 1.3 El error de razonamiento central

El documento parte de una premisa correcta —"un solo writer y una sola fuente de verdad por bounded context"— y deriva una conclusión que no se sigue: que cada bounded context necesita su propia base de datos y su propio proceso.

**Un bounded context es un límite de modelo, no un límite de despliegue.** Es la distinción que separa el DDD de la mitología de microservicios. Un contexto se implementa perfectamente como un esquema de Postgres con su propio rol, sus propios grants y su propia política de RLS — que es exactamente lo que ya hacemos: 11 esquemas, 64 tablas con `FORCE ROW LEVEL SECURITY`, tres roles de base de datos con privilegios distintos.

La diferencia entre las dos implementaciones del mismo principio:

|                               | Límite por esquema+rol (nuestro)               | Límite por servicio+bus (propuesto)            |
| ----------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| Cómo se hace cumplir          | `GRANT`/`REVOKE`, RLS — **el motor lo impone** | convención + code review — **aspiracional**    |
| Integridad referencial        | FK compuesta con `tenant_id`                   | imposible; se degrada a jobs de reconciliación |
| Atomicidad venta+pago+lealtad | `BEGIN…COMMIT`                                 | saga con compensaciones escritas a mano        |
| Costo de cruzar el límite     | join                                           | RTT + retry + timeout + fallo parcial          |
| Costo de mover el límite      | migración                                      | renegociar contrato entre dos sistemas         |

### 1.4 Asimetrías que conviene nombrar

1. **El scorecard se contradice con la evidencia que él mismo reporta.** Puntúa a NEXO 8–9 en Arquitectura, Backend, Seguridad y Mantenibilidad, y en la misma página registra que **NEXO no tiene un `HEAD` de git resoluble** — no hay provenance, no hay rollback, no se puede saber qué archivo pertenece a qué commit. Un sistema sin línea base reproducible no es un 9 en mantenibilidad; es un riesgo operativo P0, y el propio documento lo clasifica así en su tabla de riesgos.

2. **El argumento de ausencia se aplica en una sola dirección.** "UMI no contiene `modules/pos` → UMI no puede ser autoridad de commerce." Correcto como hecho, inválido como argumento: es una ausencia temporal en un roadmap ya acordado. Aplicado simétricamente diría "NEXO carece de KDS, loyalty, Gift Cards y RAG → NEXO no puede ser la plataforma". El documento **usa el argumento contra nosotros y lo desactiva a su favor** ("no debe reconstruir capacidades UMI").

3. **"Flutter readiness: UMI 2 / NEXO 9"** compara una app cliente con una plataforma de backend. Es una categoría distinta. Que el POS Flutter viva en su repo no es una discusión — es exactamente lo que la Opción B siempre dijo.

4. **La certificación se auto-adjudica el terreno.** El documento propone reanudar la certificación en "Refunds, Returns, Voids y Receipts NEXO", es decir, en el punto donde NEXO ya escribe dinero. Certificar un writer no lo convierte en el writer correcto.

---

## 2. La plataforma Umi: decisión, razones y circunstancias

### 2.1 La secuencia de decisiones (por qué la plataforma es así)

No es una preferencia estética. Es el resultado de una secuencia de decisiones tomadas contra problemas concretos, cada una documentada:

| Fecha         | Decisión                                                                                    | Circunstancia que la forzó                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-18/20 | **Unificación de dos bases de producción en una sola** (`docs/migration/`)                  | Existían dos DBs de producción con modelos divergentes. La fusión fue curada, verificada y lanzada. Ese trabajo es exactamente el costo que la Opción A propone volver a pagar.                           |
| 2026-06-23    | **Backend único `umi-api`** (`docs/architecture/2026-06-23-umi-api-centralization-spec.md`) | Cuatro frontends hablaban con la base de datos por su cuenta. Principio resultante: _"a single backend owns all data and secrets; everything else is a thin client."_ Fases 0/1/2 **LIVE en producción**. |
| 2026-06-26    | **Unificación de horarios** — una sola fuente (`ops.business_hours`)                        | El bot y el dashboard respondían horarios distintos. Es el mismo patrón de fallo, en miniatura, que produce tener dos fuentes de verdad.                                                                  |
| 2026-07-02    | **Borrado de `umi-logs`** (`docs/architecture/2026-07-02-observability-reserved.md`)        | Un frontend consultaba Supabase directo con `SERVICE_ROLE_KEY` (bypass de RLS) desde el navegador. Se borró, no se refactorizó.                                                                           |
| 2026-07-02    | **`umi-cash` FROZEN** (blueprint §9.4)                                                      | Segundo ORM (Prisma) contra un objetivo poco claro; se congeló para migrar por capacidad.                                                                                                                 |
| 2026-07-05    | **Modelo de dominio de plataforma**                                                         | Se reservó explícitamente el asiento del POS (§2.4).                                                                                                                                                      |
| 2026-07-14    | **UmiPOS = Opción B**                                                                       | Analizadas tres arquitecturas; A rechazada por escrito.                                                                                                                                                   |
| 2026-07-20    | **Seam de contrato Dart**                                                                   | El repo Flutter aparte crea _un_ problema —el contrato— y se resuelve con un artefacto generado, no con una capa de sincronización.                                                                       |

**El patrón es inequívoco: cada vez que esta plataforma encontró dos fuentes de verdad, las colapsó en una.** Nunca ha construido una capa de sincronización, porque cada vez que tuvo la oportunidad, comprobó que el problema era la segunda fuente.

La regla que quedó escrita en `AGENTS.md:44`: _"Prefer the narrowest existing owner before creating a new service, repo, or directory."_

### 2.2 Qué es la plataforma hoy — verificado, no declarado

**Base de datos (viva, en producción):** `db/preview/002_schema.sql`

- **11 esquemas, 96 tablas.** `core` (17: identidad, tenants, sucursales, staff, entitlements), `loyalty` (17), `ops` (14: catálogo, órdenes, pagos, refunds), `comms` (9: conversaciones, knowledge), `observability` (8), `queue` (6), `grow` (4), `device` (4), `kitchen` (3), `_migration` (14), `legacy`.
- **Multi-tenant impuesto por el motor:** 64 tablas con `ENABLE` **y** `FORCE ROW LEVEL SECURITY`, 64 políticas. El predicado es `core.rls_tenant_check(tenant_id)`, que exige que el tenant del renglón coincida con el GUC `app.tenant_id` **y** que `core.can_access_tenant()` —función `SECURITY DEFINER` con `search_path` fijo— confirme membresía activa.
- **144 foreign keys, de las cuales 65 son compuestas con `tenant_id` como primera columna**, incluidas FKs cross-schema (`comms.conversations` → `core.locations`). Ese patrón hace que un renglón de un tenant no pueda referenciar a otro tenant ni por error de programación.
- **Inmutabilidad por trigger** en los cuatro ledgers de dinero y auditoría (`loyalty.points_ledger`, `loyalty.wallet_transactions`, `loyalty.gift_card_ledger`, `observability.audit_log`) y en `ops.order_events`.
- **Tres roles de base de datos con privilegios distintos:** `umi_app` (LOGIN, **NOBYPASSRLS**), `umi_worker` (BYPASSRLS), `umi_readonly` (SELECT).
- **pgvector** en 4 columnas `vector(1024)` con índices HNSW, más `pg_trgm` para búsqueda difusa.

**Backend `apps/umi-api`:** NestJS 11.1.27 sobre Fastify 5.8.5, Node 22, 223 archivos TypeScript, 12 módulos de dominio.

- **SQL crudo parametrizado vía `pg`. Sin ORM, por decisión (D8).** Consecuencia directa: la capa de datos no está acoplada a ningún proveedor.
- **Dos pools con semántica distinta**: `withTenant()` abre transacción en el pool `umi_app` y hace `set_config('app.tenant_id', …, true)` —scope de transacción— de modo que **la aplicación corre bajo RLS**; `query()` va al pool worker.
- **Asincronía madura:** 6 colas BullMQ (`system`, `turns`, `enrichment`, `outbound`, `integrations`, `lifecycle`) con prioridades y locks diferenciados; **outbox transaccional** (`queue.outbox_events`) con claim/lease vía `FOR UPDATE SKIP LOCKED`, relay con re-entrancy guard, **dead-letter queue** (`queue.dead_letters`), y **dos mecanismos de idempotencia** (`queue.inbound_events` con unique `(tenant_id, provider, provider_event_id)` y `queue.idempotency_keys`).
- **Cadena de 4 guards**: `AuthGuard → TenantAccessGuard → EntitlementGuard → RolesGuard`. El tenant **no viaja en el JWT**, por diseño: un usuario pertenece a varios tenants y el activo se resuelve por request verificando membresía. `TenantAccessGuard` responde **404, no 403**, para no filtrar existencia de tenants.
- 6 adapters externos (Anthropic, Voyage, Twilio, email, Zettle, wallet passes), 44 archivos de test.
- **Un codebase, dos procesos**: `main.ts` (HTTP) y `worker.ts` (contexto sin listener). Los `@Processor` viven solo en `WorkerModule`.

> Esto importa para la discusión: **outbox, idempotencia, DLQ y reintentos ya existen aquí.** No son capacidades que haya que adquirir federándose. Son las que usamos _dentro_ de un proceso, donde son baratas — no _entre_ dos sistemas, donde además hay que reconciliar.

### 2.3 Infraestructura — separando lo que corre de lo que está decidido

Esta distinción es deliberada. Presentar planes como hechos es precisamente lo que hace endeble al documento recibido.

**LIVE (corriendo hoy):**

| Pieza                              | Detalle                                                                                                                                                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API en VPS propio**              | Imagen multi-stage `node:22-alpine`, usuario no-root, `pnpm deploy --prod` para bundle aislado. Compose de 4 servicios: `umi-api`, `umi-worker` (misma imagen, distinto comando), `redis:7-alpine` con AOF y healthcheck, `caddy:2-alpine`.                                      |
| **TLS automático**                 | Caddy → `api.umiconsulting.co`. Redis no expuesto: solo red interna del compose.                                                                                                                                                                                                 |
| **CD real**                        | Push a `main` → CI (build + typecheck + test) → build y push a GHCR con **doble tag** (`:sha-<git>` y `:latest`) → SSH al VPS → `docker compose pull && up -d` → **health check de 10 intentos contra `/health`**, que falla el run si no responde. Nunca se compila en la caja. |
| **Rollback en un comando**         | Cada deploy es un tag inmutable: `sed` del tag en `.env` + `pull` + `up -d`.                                                                                                                                                                                                     |
| **Base de datos**                  | PostgreSQL en Supabase (`xbudk…`) vía pooler, con dos URLs y dos roles.                                                                                                                                                                                                          |
| **Producción con clientes reales** | Kalala y El Gran Ribera operando; 501 tarjetas activas; pases de Apple y Google Wallet emitidos.                                                                                                                                                                                 |

**DECIDIDO / planeado (aún no en el repo — hay que construirlo):**

| Pieza                              | Estado real verificado                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Backups a Cloudflare R2**        | **No existe.** Cero referencias en el repo. Hoy: backups gestionados por Supabase + dumps manuales. **Es la brecha más urgente de esta lista** — hay dinero de clientes en esa base.       |
| **Migración de Vercel a CF Pages** | **No existe.** Sin `wrangler`, sin Pages, sin Workers. Hoy: 3 proyectos Vercel (dashboard, cash, landing). Lo único de Cloudflare son 5 servidores MCP en `.mcp.json` (tooling de agente). |
| **DB levantada en el VPS**         | Plan escrito (`apps/umi-api/db/README.md`): migraciones pasan a un plan **Sqitch** de SQL PostgreSQL escrito a mano. `apps/umi-api/db/migrations/` hoy contiene solo `.gitkeep`.           |
| **OpenTelemetry**                  | **No existe** ninguna dependencia OTel. Hoy: logger JSON estructurado con `requestId` desde `AsyncLocalStorage`, interceptor HTTP por request, `TraceService` a tabla.                     |
| **`build-v3`**                     | Rediseño en rama, **73 commits sin mergear**. El backend tiene **0 referencias** a los esquemas `umi/tenant/runtime`. El modelo vivo es el de 11 esquemas.                                 |
| **Facturación**                    | El motor de entitlements existe y se hace cumplir; **el cobro no está implementado**. Activar un producto es cambiar una fila.                                                             |

### 2.4 La portabilidad no es una aspiración: está verificada

Esto responde directamente a la premisa de que "Umi depende de Supabase":

1. **Sin ORM, SQL crudo en todo el backend.** El propio repo lo declara: _"Application queries are raw SQL throughout, so moving the database off Supabase changes only the migration tool — not the data-access code."_
2. **El DDL canónico escrito a mano es PostgreSQL puro.** Un `grep` de `auth.uid|supabase|pg_net|vault|realtime|pgsodium` sobre los 16 scripts de `docs/migration/local-postgres/` devuelve **cero coincidencias**. La única extensión que usa es `pgcrypto`, estándar desde PG13.
3. **Ya se aplica y valida sobre PostgreSQL vanilla local** (Homebrew PG18), con verificación de RLS haciendo `set role umi_app; set app.tenant_id = …`.
4. **Contra-evidencia, dicha en voz alta:** el dump de la DB viva sí arrastra artefactos de Supabase (`pg_net`, `supabase_vault`, `supabase_realtime`, dos funciones legacy con `auth.uid()`). Todos viven en `public`/`extensions`, **no** en los 11 esquemas canónicos — y `public` está declarado como superficie de compatibilidad temporal. Además, hoy el pool worker conecta como el rol `postgres` de Supabase porque Supabase no permite otorgar `BYPASSRLS` a un rol custom; en un VPS propio se resuelve activando `umi_worker`, que **ya existe con sus grants**.

**Conclusión:** la portabilidad fue una decisión de diseño sostenida, no un accidente. Levantar esta base en el VPS es cambiar la herramienta de migración, no el sistema.

### 2.5 El modelo de negocio: por qué esto no es negociable

Para Umi, **un producto es una fila** en `core.product_instances(tenant_id, location_id?, product_key, status, config)`:

- **Gatea el backend**: `EntitlementGuard` lee `@RequireProduct('<key>')` y responde `403 {error:'product_not_active'}` si el status no es `active`/`trialing`.
- **Gatea el frontend**: el registro de módulos del dashboard mapea 10 módulos a productos; el API devuelve `modules` en `/capabilities` y ambos lados deben coincidir exactamente.
- **Es ortogonal a los roles**: incluso `super_admin` está sujeto a entitlements.
- **Dos índices únicos parciales** codifican la regla: un producto es global por tenant (`location_id IS NULL`) **o** por sucursal.

Hoy las keys facturables son `cash`, `conversaflow`, `kds`, `dashboard`. **`pos` no existe todavía**: el `CHECK` de `core.product_instances` no la admite, `PRODUCT_KEYS` en `@umi/contract` no la incluye, y el propio código dice _"`pos` joins this list when the POS product ships."_ Solo el seed de `build-v3` la siembra, y ningún plan la referencia.

**De aquí sale la consecuencia comercial dura:**

Si el POS tiene su propia identidad, su propia organización, su propia sucursal y su propia base, entonces:

1. **No se puede facturar con nuestro motor de planes.** El entitlement vive en `core.product_instances`, ligado a `core.tenants`. Un producto cuyo tenant vive en otra base no es gateable.
2. **El alta de un cliente se duplica.** Una cafetería nueva se da de alta dos veces, con dos catálogos de sucursales y dos listas de empleados que hay que mantener sincronizadas. El primer día que alguien contrata a un cajero en un sistema y no en el otro, tenemos un incidente.
3. **Se destruye el diferenciador.** El valor de Umi no es "tenemos un POS" ni "tenemos lealtad": es que **la venta, el sello, la conversación de WhatsApp y el ticket de cocina son del mismo cliente en la misma base**. Customer 360 con las ventas en otra base es un join distribuido contra una proyección eventual — es decir, no es Customer 360.
4. **El enganche venta↔lealtad —lo de mayor valor del POS— se vuelve el problema más difícil en vez del más fácil.** Cobrar con saldo del monedero, dentro de una sola base, es una transacción. Entre dos bases es una saga con compensaciones sobre dinero real.

Y el punto que cierra la discusión comercial: **UmiPOS se vende únicamente con Umi, nunca aislado.** El único argumento a favor de la Opción A en nuestro análisis original era "NEXO podría venderse sin Umi". Si esa venta no va a ocurrir, la Opción A pierde su única ventaja y conserva todos sus costos.

---

## 3. Evaluación de NEXO — con la evidencia disponible

**Alcance y honestidad del método:** el repositorio de NEXO no está disponible para inspección directa. Todo lo siguiente sale de lo que **sus propios dos documentos declaran**. No he verificado su código. Por eso la §8 es una petición formal de evidencia, no una acusación.

### 3.1 Lo que sus documentos declaran a favor

Tomado en serio, y sin descuento:

- 4 apps, 15 packages, 62 modelos Prisma, 27 enums.
- 330 archivos de test/spec (contra 52 nuestros).
- OpenAPI 3.1.1 con 144 operaciones y SDK generado con drift-check.
- Ledger de inventario con reservations, transfers, FIFO y counts — **capacidad que nosotros no tenemos: cero tablas de inventario en las tres capas SQL del repo.**
- Cash drawer / sesiones / arqueo — tampoco existe aquí.
- Pricing con historia y determinismo; media privada en MinIO.
- POS Flutter funcional con guards de offline/recovery e impresión.
- OTel cableado en API y worker.
- Design system con Storybook, Playwright y suites de accesibilidad.

**Esto es trabajo real y no lo estoy minimizando.** Inventario, caja física, pricing con historia e impresión son exactamente las capacidades que nuestro propio análisis del 14 de julio marcó como **FALTANTES** y que el proyecto POS debe construir. La pregunta no es si ese trabajo vale; es **dónde vive el dato que produce**.

### 3.2 Lo que sus propios documentos admiten en contra

Estas son citas de su lado, no conclusiones mías:

| Hecho declarado por ellos                                                                                    | Consecuencia                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"NEXO no tiene un `HEAD` resoluble"**; _"el filesystem es la única evidencia disponible"_                  | Sin provenance ni rollback. No se puede saber qué código pertenece a qué versión. Ellos mismos lo clasifican como riesgo P0 y como blocker para migrar. |
| _"Los eventos UMI son proyecciones allowlisted a un sink local, no integración productiva"_                  | La integración que se propone como base de la estrategia **no existe ni de un lado ni del otro**.                                                       |
| _"Producción no verificada"_; _"'Producción' no se marca para ningún cliente"_                               | Su documento no afirma que NEXO tenga usuarios. Cero clientes, cero dinero cobrado, cero incidentes vividos.                                            |
| _"La documentación es extensa pero presenta riesgo de volumen, repetición y estados históricos mezclados"_   | Autocrítica correcta. El volumen documental no es evidencia de sistema.                                                                                 |
| _"NEXO carece de KDS, loyalty/Gift Cards y RAG"_                                                             | Le falta exactamente el producto que ya vendemos.                                                                                                       |
| _"Deployment: UMI tiene ruta productiva más explícita"_ / NEXO _"Compose local; cloud target no demostrado"_ | Su propia comparación de infraestructura nos da la ventaja.                                                                                             |

### 3.3 La asimetría de riesgo, en una frase

De un lado hay un sistema **con clientes, con dinero de clientes en la base, con pases de wallet emitidos y con un pipeline de despliegue que hace health check y sabe hacer rollback**. Del otro hay un sistema **sin línea base de git, sin producción verificada y cuya única integración con nosotros es un sink sin consumidor**.

La propuesta es que el primero migre su autoridad sobre venta, pago y refund hacia el segundo.

Ninguna medida de calidad de código justifica esa transferencia. Y no porque su código sea malo —probablemente no lo es— sino porque **"tener buen código" y "ser la fuente de verdad de la plataforma" son propiedades distintas**, y la segunda se gana operando, no certificando.

---

## 4. El argumento de ingeniería

Cada afirmación de esta sección está anclada a literatura primaria. Las referencias completas están en la §9.

### 4.1 Cruzar un límite de servicio degrada la semántica del dato

Pat Helland, _Data on the Outside versus Data on the Inside_ (CIDR 2005), establece la distinción fundamental: los datos **adentro** de un servicio son mutables, actuales, transaccionales y autoritativos; los datos **afuera** son inmutables, versionados y **siempre del pasado**.

Aplicado literalmente a la propuesta: mover Product, Pricing e Inventory "afuera" convierte _el precio_ en _el precio que era_, y _el stock_ en _el stock que había_. Para un POS eso no es aceptable: el precio y la disponibilidad se leen **en el instante del cobro**, no en el instante en que llegó el último evento.

El propio documento recibido lo admite sin extraer la conclusión: _"nunca usar proyección para commit"_. Correcto. Y si no se puede usar la proyección para hacer commit, entonces cada cobro necesita una llamada síncrona cross-servicio — con lo cual no se ganó desacoplamiento, se ganó latencia y un modo de falla nuevo.

### 4.2 Distribuir solo se justifica cuando ya no cabes en una sola base

Helland, _Life beyond Distributed Transactions: an Apostate's Opinion_ (CIDR 2007), es el argumento canónico. Su tesis: renunciar a las transacciones distribuidas es el **precio** que se paga para escalar más allá de lo que una base puede sostener. A cambio hay que programar con entidades, idempotencia y incertidumbre explícita — sustancialmente más difícil.

El título importa: Helland fue durante toda su carrera defensor de las transacciones y la serializabilidad global; el paper es la renuncia de un converso, y la renuncia está **condicionada a la escala extrema**.

Nosotros no estamos cerca de esa frontera por varios órdenes de magnitud. La spec de centralización dimensiona la carga en ~1k eventos/hora. **Pagar el precio de la distribución sin recibir la escala que lo justifica es costo puro.**

### 4.3 El "microservice premium", y quién lo paga

Martin Fowler acuñó el término _MicroservicePremium_ (2015): el sobrecosto de operar una suite de servicios, que **frena al equipo** y solo se amortiza si el sistema es demasiado complejo para manejarlo como monolito. Su recomendación operativa, en _MonolithFirst_: _"no deberías empezar un proyecto nuevo con microservicios, aunque estés seguro de que va a ser suficientemente grande"_. Y más directo: _"no consideres microservicios a menos que tengas un sistema demasiado complejo de manejar como monolito."_

**Somos tres desarrolladores.** El premium no se paga con un porcentaje del presupuesto: se paga con el presupuesto. Cada dev-mes gastado en un registry de contratos, un bus de eventos y jobs de reconciliación es un dev-mes **no** gastado en impuestos, propinas, corte de caja, impresión o cola offline — que es lo que un POS necesita para existir.

### 4.4 Conway y carga cognitiva: la topología propuesta requiere una organización que no tenemos

La ley de Conway (1968) predice que un sistema copia la estructura de comunicación de la organización que lo construye. _Team Topologies_ (Skelton & Pais) convierte eso en criterio de diseño: los límites de servicio se ponen según la **carga cognitiva** que un equipo puede sostener, y un equipo _stream-aligned_ —5 a 8 personas— debe poder ser dueño de su porción de extremo a extremo. Regla derivada: un equipo puede sostener dos o tres dominios simples, o **un** dominio complicado; nunca dos complicados.

La arquitectura propuesta necesita, como mínimo, cuatro equipos: UMI control plane, NEXO commerce, un equipo de plataforma/SRE que sea dueño del bus, el registry, la observabilidad compartida y la política de secretos, y eventualmente Payroll. El propio documento nombra a ese tercer equipo ("Platform/SRE") como dueño de infraestructura compartida — **un equipo que no existe**.

Construir la topología de cuatro equipos con un equipo de tres personas produce el peor resultado posible: **toda la coordinación, ninguna de la autonomía**. Se pagan los costos de la separación (contratos, versionado, compatibilidad, doble despliegue) sin obtener el beneficio (equipos que avanzan sin bloquearse), porque las mismas tres personas están de los dos lados de la frontera.

### 4.5 DORA: el acoplamiento suelto se mide entre _equipos_, no entre repos

Es previsible que la propuesta se defienda invocando "arquitectura desacoplada". Conviene ser preciso sobre qué mide esa investigación. Los cinco criterios de DORA son, textualmente:

1. Los equipos pueden hacer cambios grandes al diseño de su sistema **sin permiso de alguien fuera del equipo** ni dependencia de otros equipos.
2. Los equipos completan trabajo **sin comunicación y coordinación de grano fino con gente fuera del equipo**.
3. Los equipos despliegan bajo demanda, **independientemente de los servicios de los que dependen o que dependen de ellos**.
4. Los equipos prueban bajo demanda, sin requerir un entorno de pruebas integrado.
5. Los equipos despliegan en horario hábil con downtime despreciable.

Los cinco están formulados **respecto a otros equipos**. Con un solo equipo, un monolito modular los satisface trivialmente. Y DORA es explícita en que la tecnología no es el punto: _"Es posible lograr estos resultados con tecnología de mainframe. También es posible fallar en lograrlos usando la tecnología más nueva y de moda"_, y advierte que _"muchas arquitecturas llamadas orientadas a servicios no permiten probar y desplegar servicios independientemente"_ — y por eso no producen el beneficio.

**Federar dos sistemas propiedad de las mismas tres personas no compra independencia.** Introduce exactamente las dependencias de grano fino que la investigación identifica como el predictor negativo más fuerte.

### 4.6 El anti-patrón real que evitamos: el monolito distribuido

El monolito distribuido es lo que resulta cuando la complejidad operativa de los microservicios se combina con el acoplamiento del monolito: se obtiene la rigidez de uno, la complejidad del otro, y pocos beneficios de cualquiera.

La prueba diagnóstica es simple: **si un cambio de negocio obliga a desplegar los dos lados de forma coordinada, es un monolito distribuido.**

Aplíquese al caso concreto. Un cobro en caja que usa saldo del monedero toca: catálogo y precio (NEXO), venta y pago (NEXO), autorización y débito de lealtad (UMI), ticket de cocina (UMI), timeline del cliente (UMI) y recibo (NEXO). **Seis cruces de frontera en una sola pulsación de "Cobrar".** Agregar un campo al ticket de venta requiere versionar un contrato, desplegar dos servicios en orden y mantener compatibilidad hacia atrás durante la ventana.

Eso no es una arquitectura desacoplada. Es un monolito con latencia de red y sin transacciones.

### 4.7 Lo que cuesta la consistencia eventual cuando hay dinero

El patrón Saga (Garcia-Molina & Salem, 1987) fue concebido para transacciones de larga duración y tiene una propiedad que se cita poco: **no ofrece aislamiento**. Cada compensación se diseña a mano y cada estado intermedio es visible para el resto del sistema.

Consecuencias concretas y verificables en este dominio:

- **Inventario.** Reservar stock requiere serialización real. Con una proyección eventual, dos cajas venden la última pieza. Se llama overselling y en un restaurante es un platillo que no se puede servir.
- **Dinero.** El saldo del monedero es `SUM(ledger)` — invariante explícito de nuestro modelo: _"la tarjeta es identidad pura; nunca cachear un total"_. Autorizar un cobro contra un saldo replicado abre una ventana donde el mismo saldo se gasta dos veces.
- **Refunds.** Devolver dinero que se cobró parcialmente con saldo y parcialmente con tarjeta, a través de dos bases, es una compensación distribuida sobre dinero real de un cliente real.

Dentro de una base, los tres casos son `BEGIN … COMMIT`.

### 4.8 Disponibilidad y latencia se multiplican

Dos servicios en serie multiplican su disponibilidad: 99.9% × 99.9% = 99.8%, es decir **el doble de downtime**. Y cada cruce de frontera agrega RTT, timeouts, reintentos y modos de falla parcial que no existen en una llamada de función.

Un POS es el punto del sistema con menos tolerancia a esto: hay una fila de clientes esperando. La pregunta de diseño no es _"¿podemos hacerlo eventual?"_ sino _"¿qué hace el cajero cuando el otro plano no responde y el cliente ya entregó la tarjeta?"_.

### 4.9 La industria ya recorrió esto en la dirección contraria

Dos casos documentados, ambos relevantes por razones distintas:

- **Segment (2018), _"Goodbye Microservices"_.** Llegaron a 140+ microservicios con un equipo pequeño. El resultado, en palabras de la autora: _"nuestra velocidad se desplomó y nuestra tasa de defectos explotó"_, con _"demasiados equipos construyendo y manteniendo demasiadas integraciones"_. Consolidaron de vuelta a un solo servicio y un solo repositorio. **Es el caso más parecido al nuestro: equipo chico, muchas fronteras, colapso de velocidad.**
- **Amazon Prime Video (2023).** Migraron su servicio de monitoreo de una arquitectura serverless/microservicios a un solo proceso y reportaron **90% de reducción de costo**, además de escalar mejor. El cuello de botella era la orquestación distribuida y la transferencia de datos entre componentes.

Ninguno de los dos falló por mala ejecución. Fallaron porque la distribución **no era necesaria**, y el costo de la frontera excedía su beneficio.

### 4.10 Preempción: "una sola base es el anti-patrón de base compartida"

No lo es, y la distinción es precisa.

El anti-patrón de _shared database_ describe **N servicios desplegados independientemente que escriben las mismas tablas sin un dueño claro**. El daño es que nadie puede cambiar el esquema sin romper a otro, y el acoplamiento queda oculto.

Nuestro caso no cumple ninguna de esas condiciones: **un despliegue**, un esquema por módulo, **un writer por dominio**, y los límites impuestos por `GRANT`/`REVOKE` y RLS — no por convención. En un monolito modular cada módulo es dueño de su esquema y accede a los demás por su API interna; los límites son _ejecutables_, no aspiracionales.

La ironía es que **la propuesta federada hace los límites _más_ débiles, no más fuertes**: un contrato de eventos se viola en silencio y se descubre en reconciliación; un `REVOKE` se viola con un error de permisos, inmediatamente, en la primera prueba.

### 4.11 Síntesis

| Criterio                 | Federación (propuesta)                        | Módulo en la plataforma (resolución) |
| ------------------------ | --------------------------------------------- | ------------------------------------ |
| Fuentes de verdad        | 2 por entidad compartida                      | 1                                    |
| Venta + pago + lealtad   | saga con compensaciones                       | una transacción                      |
| Orden → KDS              | evento + shadow feed + validación de latencia | una FK                               |
| Integridad referencial   | jobs de reconciliación                        | FK compuesta con `tenant_id`         |
| Cómo se impone el límite | convención + review                           | `GRANT`/`REVOKE` + RLS               |
| Disponibilidad del cobro | producto de dos sistemas                      | uno                                  |
| Facturación del POS      | imposible con nuestro motor                   | una fila                             |
| Equipos requeridos       | ~4                                            | 1                                    |
| Trabajo de integración   | permanente                                    | ninguno                              |

---

## 5. La arquitectura resuelta

Sin cambios respecto al 2026-07-14 y 2026-07-20:

```
apps/umi-api/src/modules/pos/     ← backend del POS. NO es un servicio nuevo, NO es un esquema nuevo.
├── pos.controller.ts             ← rutas de dispositivo (crear orden, cobrar)
├── pos-dashboard.controller.ts   ← rutas de dueño (corte de caja, reportes)
├── pos.service.ts                ← impuesto, propina, descuento, redondeo
├── pos.repository.ts             ← SQL; REUSA los repositorios de orden y de cocina
└── dto/pos-contract.ts

packages/contract/                ← se EXTIENDE con rutas y esquemas del POS
        │  emit (build step)
        ▼
umi-contract-<semver>.json        ← artefacto neutral, versionado, publicado por tag
        │  codegen en el repo Flutter
        ▼
lib/umi_contract/*.dart           ← GENERADO, nunca escrito a mano
```

**Principios, en orden:**

1. **Una sola fuente de verdad.** El POS escribe en la base de Umi. No se levanta una segunda base.
2. **La cola offline del dispositivo no es una base de datos.** Guarda intenciones no confirmadas y las reproduce con llave de idempotencia; nunca responde preguntas, nunca la consulta otro sistema, **se vacía**. Una segunda base _es_ autoridad, _es_ consultada, **diverge**, y hay que reconciliarla para siempre. Esa distinción es la diferencia entre esta arquitectura y dos años de reconciliación.
3. **El POS es un dispositivo enrolado, no una página web.** Un POS accesible desde cualquier navegador permite abrir caja y mover saldo desde la casa de un empleado: es el vector de fraude interno más común en restaurantes. Reusa el modelo de pairing del KDS, endurecido con expiración y rotación de token.
4. **Una escritura, todos los consumidores.** Orden + `order_event` en la misma transacción → KDS y dashboard la ven sin código adicional.
5. **Idempotencia desde el primer commit**, no como parche. La cola offline depende de esto.
6. **El POS corre bajo RLS.** Tiene principal; no hay excusa.
7. **Nada de webhooks, sync ni reconciliación.** Si aparece cualquiera de las tres en el diseño, se coló la Opción A.
8. **Derive, don't cache.** El POS no escribe totales ni saldos; los ledgers son append-only y una devolución es una fila nueva con delta negativo, nunca un `UPDATE`.

### 5.1 Qué se conserva del trabajo del otro repo

Esta resolución **no descarta ese trabajo**; le reasigna la capa:

| Trabajo                                                                 | Destino                                                                                                                                                                                                    |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cliente Flutter POS**                                                 | Se conserva íntegro. Es el cliente. Consume `@umi/contract` generado en vez de un backend propio.                                                                                                          |
| **Design system Flutter**                                               | Se conserva. Alinea contra `@umi/tokens`.                                                                                                                                                                  |
| **Modelo de dominio de Inventory** (ledger, reservations, FIFO, counts) | **Se porta como diseño** a tablas de la base de Umi. Es la capacidad que más nos falta y el análisis del 14 de julio ya la marcó como el disparador natural. El modelo es valioso; el esquema separado no. |
| **Corte de caja / arqueo / sesiones**                                   | Igual: se porta como diseño. Modelo nuevo completo aquí.                                                                                                                                                   |
| **Pricing con historia, impresión, recovery offline**                   | Se portan como diseño y como código donde aplique.                                                                                                                                                         |
| **Suites de test y accesibilidad**                                      | Se conservan las del cliente; las de backend se reescriben contra el backend que queda.                                                                                                                    |
| **Su OpenAPI/SDK**                                                      | Se retira como autoridad. `@umi/contract` es la fuente; el artefacto Dart es derivado.                                                                                                                     |

### 5.2 Lo que hay que construir aquí (del análisis del 14 de julio)

| Componente                                                 | Talla  | Nota                                                               |
| ---------------------------------------------------------- | ------ | ------------------------------------------------------------------ |
| `pos` en el catálogo de productos + entitlement            | **XS** | **Va primero.** Sin esto UmiPOS no se puede contratar ni facturar. |
| Proyección de tickets de cocina                            | **S**  | Es lo que hace realidad "aparece en el KDS gratis".                |
| Pairing de dispositivo POS                                 | **S**  | Reusa el del KDS; el costo es endurecerlo.                         |
| `POST /orders`                                             | **M**  | Ninguna ruta crea órdenes hoy.                                     |
| Contrato del POS en `@umi/contract` + emisor del artefacto | **M**  | El seam.                                                           |
| Enganche venta ↔ lealtad                                   | **M**  | **El de mayor valor.**                                             |
| Impuesto / propina / descuento / redondeo                  | **M**  | Bloqueado por producto, no por ingeniería.                         |
| Escritor de pagos y refunds                                | **L**  | Las tablas existen **sin escritor, esperando al POS**.             |
| Caja: apertura, corte, arqueo                              | **L**  | Modelo nuevo.                                                      |
| Cola offline + replay idempotente                          | **L**  |                                                                    |
| Impresión                                                  | **L**  | Cero precedente en Umi.                                            |
| Inventario                                                 | **XL** | Recomendado fuera de fase 1.                                       |

---

## 6. Costeo comparativo

Los dos caminos tienen trabajo. La diferencia es su naturaleza.

**Opción B — trabajo de producto, se hace una vez.** Todo lo de §5.2 es funcionalidad que un POS necesita para existir: cobrar, calcular impuestos, cortar caja, imprimir, operar sin red. Termina.

**Opción A — trabajo de frontera, se paga para siempre.** Todo lo de §1.1, **más** todo lo de §5.2, que sigue siendo necesario. Y además, permanentemente:

| Costo recurrente            | Detalle                                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Dos bases de producción     | dos respaldos, dos restauraciones probadas, dos ventanas de parcheo, dos planes de recuperación. Hoy no tenemos ni uno bien resuelto (§2.3). |
| Dos runtimes                | dos pipelines, dos registries, dos rotaciones de secretos, dos rollbacks.                                                                    |
| Un bus + registry + DLQ     | infraestructura nueva sin dueño. El documento propuesto lo asigna a "Platform/SRE": un equipo que no existe.                                 |
| Doble observabilidad        | y correlación distribuida para poder depurar un cobro, que hoy es una consulta.                                                              |
| Reconciliación continua     | jobs que comparan conteos y hashes entre las dos bases, y un procedimiento para cuando difieren.                                             |
| Compatibilidad de contratos | cada cambio de campo se versiona y se despliega en orden.                                                                                    |
| Doble carga cognitiva       | sobre las mismas tres personas.                                                                                                              |

La comparación de infraestructura, en piezas a operar:

|                          | Hoy (Umi)          | Opción B | Opción A                      |
| ------------------------ | ------------------ | -------- | ----------------------------- |
| Bases de producción      | 1                  | 1        | 2                             |
| Backends                 | 1                  | 1        | 2                             |
| Pipelines de despliegue  | 1                  | 1        | 2 + bus                       |
| Message brokers          | 0 (BullMQ interno) | 0        | 1 productivo + registry + DLQ |
| Superficies de identidad | 1                  | 1        | 2 + token exchange + JWKS     |

**El cálculo económico se resume así:** con tres desarrolladores, cada dev-mes gastado en un bus de eventos es un dev-mes no gastado en el POS. La Opción A gasta primero en la frontera y después en el producto. La Opción B gasta solo en el producto.

Y hay un costo de oportunidad que conviene decir explícitamente: la brecha más urgente de la plataforma hoy **no es la arquitectura del POS** — es que hay dinero de clientes en una base sin una estrategia de respaldo propia (§2.3). Ese trabajo compite por las mismas manos.

---

## 7. Lo que sí se toma del documento recibido

Rechazar la conclusión no es rechazar el trabajo. Estas partes son correctas y se adoptan:

1. **"Un solo writer y una sola fuente de verdad por bounded context."** Es la regla correcta. Se implementa con esquema + rol + RLS dentro de una base, no con dos bases.
2. **La desambiguación de "Cash".** En Umi significa lealtad y valor almacenado; en un POS significa cajón, sesión y efectivo físico. Son dominios distintos con el mismo nombre y hay que nombrarlos explícitamente: **Loyalty Wallet** vs **Physical Cash**. Se adopta como convención.
3. **El corte de certificaciones cruzadas.** No construir KDS, lealtad, Gift Cards ni RAG fuera de Umi; no construir Inventory, Sales, Payments ni caja fuera del módulo POS. Correcto en ambas direcciones.
4. **Sin dual-write, nunca.** De acuerdo, y por eso mismo: un solo writer, en una sola base.
5. **Congelar `umi-cash`.** Ya está congelado; se confirma.
6. **Payroll como dominio separado.** De acuerdo en que no se incrusta en identidad. Difiero en que necesite base propia: es un módulo más, y su ciclo distinto se resuelve con versionado, no con distribución.
7. **Provenance antes de tocar datos.** De acuerdo, y aplica primero a su lado: sin `HEAD` resoluble no hay migración posible.
8. **Su modelo de dominio de Inventory y de caja física.** Es la mejor parte del trabajo y se porta como diseño.

---

## 8. Petición formal de análisis del repositorio

Para cerrar el plan de portado con números en vez de adjetivos, se solicita un reporte del repositorio de NEXO con **evidencia verificable**: comandos, rutas de archivo y conteos, no prosa. Las preguntas están ordenadas por lo que bloquea la decisión.

### 8.1 Procedencia (bloqueante)

1. `git log --reverse -1 --date=iso` y `git log -1 --date=iso` — fecha del primer y último commit.
2. `git rev-list --all --count` — total de commits.
3. `git shortlog -sn --all` — autores y distribución.
4. `git log --date=format:%Y-%m --pretty=%ad | sort | uniq -c` — commits por mes.
5. `git remote -v` y `git symbolic-ref HEAD`. **Sus documentos afirman que `HEAD` no resuelve. ¿Está resuelto? ¿Cuál es el commit de referencia?**
6. ¿Cuál es la política de atribución de commits generados con asistencia de IA?

### 8.2 Producción (bloqueante)

7. ¿Hay un ambiente productivo? Dominio, certificado TLS, host.
8. ¿Cuántos clientes reales lo usan hoy? ¿Cuánto dinero ha procesado?
9. ¿A qué ambientes despliega el pipeline realmente? Pegar el fragmento del archivo de CI que define las conexiones por ambiente.
10. ¿Qué ramas existen en el remoto y cuál es la fecha del último commit de cada una?
11. Estrategia de respaldo y restauración: ¿se ha probado una restauración?
12. Runbooks, on-call, alertas, SLO: ¿qué existe?
13. Facturación fiscal: ¿está contra sandbox o contra un PAC productivo? ¿Se ha timbrado un CFDI real?

### 8.3 Multi-tenant (bloqueante)

14. `grep -rn "ROW LEVEL SECURITY\|CREATE POLICY"` sobre el código y las migraciones. **¿Existe RLS?**
15. ¿Cuántas entidades tienen una columna de tenant/organización? ¿El aislamiento es por tenant o solo por sucursal?
16. ¿Cuántos roles de base de datos hay y con qué privilegios?
17. ¿Cuántos guards de autorización hay, y sobre cuántos endpoints?
18. Si el sistema resultara single-tenant: ¿cuál es su estimación para retrofitear multi-tenancy sobre el número total de entidades y migraciones?

### 8.4 Contrato y superficie

19. ¿Existe un `openapi.json` **versionado en el repo**, o el spec solo existe en runtime? Ruta exacta.
20. Número exacto de operaciones HTTP, por método.
21. ¿El SDK está generado y con drift-check en CI? ¿Qué job lo corre?
22. ¿El cliente Flutter consume tipos generados o escritos a mano?

### 8.5 Calidad ejecutada

23. Número de archivos de test por tipo, y **cuáles de ellos corren en CI**. Pegar el fragmento del pipeline que los invoca.
24. ¿Hay gate de cobertura? ¿Cuál es la cobertura actual?
25. De las suites E2E: ¿cuántas se ejecutan automáticamente y cuántas son manuales?
26. De los reportes de certificación: ¿cuántos escenarios se ejecutaron realmente y cuántos están catalogados sin ejecutar?
27. ¿Hay OpenTelemetry cableado? ¿A qué collector, en qué ambiente?

### 8.6 Profundidad por dominio

Para Product, Pricing, Inventory, Sales/Checkout, Payments, Cash y Device, por cada uno: número de archivos, líneas sin tests, y **si tiene lógica de negocio o es CRUD**. En particular:

28. **Payments**: ¿hay integración con algún procesador real, o el cobro es registro contable?
29. **Inventory**: ¿cómo se serializan las reservas? ¿locks, versiones optimistas, nivel de aislamiento?
30. **Cash**: ¿existe apertura, corte y arqueo con diferencias, o solo registro de sesión?
31. **Offline**: ¿cómo se resuelven los conflictos al reconectar? ¿Cuántas líneas tiene ese módulo?

### 8.7 Infraestructura

32. Inventario de piezas de infraestructura que requiere para operar en producción, y a qué nube están atadas.
33. ¿Existe un compose o manifiesto de **producción**, o solo local?
34. Costo mensual estimado de operar ese stack.

---

## 9. Riesgos abiertos de nuestro lado

Para que este documento sea honesto, la lista de lo que **nos falta** y compite por las mismas manos:

| Brecha                                       | Estado                                                                                                            | Prioridad       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------- |
| **Respaldo propio de la base de producción** | No existe estrategia propia. Solo respaldos gestionados de Supabase + dumps manuales. Hay dinero de clientes ahí. | **P0**          |
| Cadena de migraciones automatizada           | `apps/umi-api/db/migrations/` = `.gitkeep`. Sqitch es plan.                                                       | P0              |
| `build-v3` sin mergear                       | 73 commits de deriva entre el diseño y lo que corre.                                                              | P1              |
| Harness de integración RLS versionado        | Se verificó fuera del repo (36/36 checks); no está en CI.                                                         | P1              |
| Observabilidad                               | Sin OTel. Logs JSON en `docker compose logs`.                                                                     | P1              |
| Inventario                                   | No existe modelo. El POS es el disparador natural.                                                                | P1 (con el POS) |
| Facturación                                  | El motor de entitlements existe; el cobro no.                                                                     | P2              |
| CI de frontends                              | Cero workflows para dashboard, cash, landing, KDS.                                                                | P2              |
| Rate limit distribuido                       | `Map` en memoria por proceso.                                                                                     | P2              |
| VPS como SPOF                                | Aceptado para el volumen actual.                                                                                  | P2              |

Ninguna de estas brechas se resuelve federándose. **Varias empeoran**: la Opción A duplica la superficie de respaldo, de migraciones, de observabilidad y de CI antes de que hayamos terminado de resolverlas una sola vez.

---

## 10. Conclusión

La consolidación no crea valor fusionando repositorios ni negociando tratados entre planos. Crea valor **eliminando autoridades paralelas**. El documento recibido acierta en ese diagnóstico y falla en el remedio: propone eliminar la duplicidad de autoridad **creando una frontera permanente entre dos bases de datos**, que es la fuente de la que la duplicidad brota.

La plataforma Umi ya resolvió este problema tres veces —dos bases de producción, cuatro frontends con acceso directo a datos, dos fuentes de horarios— y las tres veces la solución fue la misma: colapsar a una fuente de verdad. Está en producción, con clientes, con dinero, con despliegue reproducible y rollback en un comando.

**UmiPOS no se integra con el módulo de ventas de Umi. UmiPOS _es_ el módulo de ventas.**

El siguiente paso concreto no es un contrato de eventos: es agregar `pos` al catálogo de productos —talla XS— para que UmiPOS se pueda contratar y facturar. Después, `POST /orders` y la proyección de tickets. En cuanto esa orden se escriba en la base de Umi, aparecerá en la cocina sin que nadie escriba una línea de integración, y esa demostración cerrará la discusión mejor que este documento.

---

## 11. Referencias

**Primarias**

- Helland, P. (2005). _Data on the Outside versus Data on the Inside_. CIDR 2005. https://www.cidrdb.org/cidr2005/papers/P12.pdf · reimpreso en ACM Queue: https://queue.acm.org/detail.cfm?id=3415014
- Helland, P. (2007). _Life beyond Distributed Transactions: an Apostate's Opinion_. CIDR 2007, pp. 132–141. https://ics.uci.edu/~cs223/papers/cidr07p15.pdf
- Garcia-Molina, H. & Salem, K. (1987). _Sagas_. ACM SIGMOD.
- Conway, M. (1968). _How Do Committees Invent?_ Datamation.
- Evans, E. (2003). _Domain-Driven Design_. Addison-Wesley. — bounded context como límite de modelo.
- Skelton, M. & Pais, M. (2019). _Team Topologies_. IT Revolution. https://itrevolution.com/team-cognitive-load-team-topologies/
- Forsgren, N., Humble, J. & Kim, G. (2018). _Accelerate_. IT Revolution.

**Industria y práctica**

- Fowler, M. (2015). _MicroservicePremium_. https://martinfowler.com/bliki/MicroservicePremium.html
- Fowler, M. (2015). _MonolithFirst_. https://martinfowler.com/bliki/MonolithFirst.html · https://martinfowler.com/microservices/
- DORA. _Loosely coupled teams_ / _Loosely coupled architecture_. https://dora.dev/capabilities/loosely-coupled-teams/ · https://dora.dev/devops-capabilities/process/loosely-coupled-architecture/
- Noonan, A. (2018). _Goodbye Microservices: From 100s of problem children to 1 superstar_. Segment/Twilio. https://www.twilio.com/en-us/blog/developers/best-practices/goodbye-microservices · análisis: https://www.infoq.com/news/2018/07/segment-microservices/
- Amazon Prime Video (2023). _Scaling up the Prime Video audio/video monitoring service and reducing costs by 90%_. https://www.devclass.com/ci-cd/2023/05/05/reduce-costs-by-90-by-moving-from-microservices-to-monolith-amazon-internal-case-study-raises-eyebrows/1621790
- Kleppmann, M. (2017). _Designing Data-Intensive Applications_. O'Reilly. — dual writes, outbox, consistencia.
- _Balancing Microservices and Monolithic Architectures_ (2026), arXiv. https://arxiv.org/pdf/2607.03898
- _Microservices Anti-Patterns: A Taxonomy_ (2019), arXiv. https://arxiv.org/pdf/1908.04101

**Internas**

- `docs/architecture/2026-07-14-umipos-analisis-integracion.md` — análisis de 902 líneas; §10 compara las tres opciones.
- `docs/architecture/2026-07-14-umipos-resumen-para-nexo.md` — resumen para el equipo del POS.
- `docs/architecture/2026-07-20-umipos-contract-seam.md` — el seam de contrato Dart.
- `docs/architecture/2026-06-23-umi-api-centralization-spec.md` — spec del backend único.
- `docs/architecture/2026-07-02-monorepo-standardization-blueprint.md` — topología objetivo.
- `apps/umi-api/db/README.md` — portabilidad de la base y plan Sqitch.
