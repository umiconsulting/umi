# UMI × NEXO Platform Discovery Audit — Parte 1

**Fecha de corte:** 2026-07-22  
**Modo:** discovery read-only; no se ejecutaron migraciones, builds, tests ni cambios de producto  
**UMI inspeccionado:** rama `build-v3`, commit `71f603e4d5c49b139ee6aefe0fac13b535d55e9c`  
**NEXO inspeccionado:** filesystem de `main`; el repositorio no tiene un `HEAD` resoluble  
**Decisiones:** candidatos, no decisiones finales; Parte 2 conserva la autoridad de consolidación

## Executive Summary

UMI y NEXO son repositorios separados y hoy no tienen dependencia de build, import de código, base de datos, Docker, pipeline o despliegue común. Sí tienen un acoplamiento conceptual bidireccional documentado: UMI define NEXO/UmiPOS como cliente futuro de UMI y `pos` como entitlement; NEXO define canales/eventos UMI y sinks locales deshabilitados. Ninguno consume actualmente el contrato o SDK del otro.

La duplicidad más relevante no es de líneas copiadas, sino de autoridad de dominio. Ambos implementan Identity/Auth, tenants/organizations, branches, staff/memberships, catálogo/productos, Customers parciales, pagos/cash con significados distintos, dashboards, contratos y workers. UMI además contiene ConversaFlow/IA, loyalty/wallet/Gift Cards y KDS nativo. NEXO contiene Inventory ledger, Sales/Checkout/Payments, Cash Drawer/Sessions, Web Admin y Flutter POS con mayor profundidad transaccional demostrable en el código.

La documentación UMI de julio declara una arquitectura objetivo de una sola base UMI y un POS cliente. El código `build-v3` aún no contiene `apps/umi-api/src/modules/pos`; sus propios documentos etiquetan el seam Dart como **PROPUESTA**. Por tanto, esa dirección no es todavía runtime. El backend operativo POS verificable está en NEXO. Este hecho impide eliminar o detener NEXO transaccional antes de una Parte 2 con plan de autoridad y migración.

Hallazgos ejecutivos:

1. UMI es autoridad actual verificable de ConversaFlow, KDS, loyalty/wallet, customer engagement, knowledge/RAG y product entitlements.
2. NEXO es autoridad actual verificable de POS Flutter, Product transaccional, Pricing, Inventory, Sales, Payments y Cash operations.
3. Organization/Branch/Identity/Staff/Product/Customer son zonas de duplicidad alta o media y no deben seguir ampliándose en paralelo hasta resolver ownership.
4. `umi-cash` está explícitamente marcado **FROZEN** en el README, aunque permanece con runtime, Prisma, API routes y UI propios; es candidato fuerte a no recibir desarrollo nuevo.
5. Los mapas UMI nombran `umi-conversaflow` y `umi-logs`, pero esos directorios no existen en este checkout. El código ConversaFlow fue portado a `umi-api`; Logs no tiene runtime localizable. Se registra drift documental.
6. NEXO no tiene Git baseline confiable: `.git` existe, rama reporta `main`, pero `HEAD` no resuelve. El filesystem es la única evidencia NEXO disponible.
7. No hay OpenAPI UMI ni SDK publicado verificable. `@umi/contract` es Zod+rutas para TypeScript; el manifiesto neutral/Dart está propuesto, no implementado. NEXO sí tiene OpenAPI 3.1.1 y SDK generado.

## Alcance y método

Se censaron manifests, roots, código fuente, controladores, repositorios, schemas/migraciones, workers/jobs/outbox, clientes, rutas UI, CI, Docker/deployment, contratos, tests y documentación de ambos repositorios. Se excluyeron `node_modules`, outputs de build y artefactos generados como autoridad funcional. Las palabras “funcional” o “maduro” significan que existe un flujo coherente en código/tests/configuración, no que esta auditoría haya certificado runtime.

## Dependency Graph

```text
UMI build-v3                                      NEXO main filesystem
┌──────────────────────────┐                     ┌──────────────────────────┐
│ umi-api + worker         │                     │ api + worker             │
│ PostgreSQL build-v3      │   NO runtime link   │ PostgreSQL/Prisma        │
│ BullMQ/Redis             │<------------------->│ Redis/outboxes           │
│ @umi/contract (Zod)      │  proposals/events   │ OpenAPI + @nexo/sdk      │
│ Dashboard / Cash / KDS   │                     │ Web Admin / Flutter POS  │
└──────────────────────────┘                     └──────────────────────────┘
```

| Pregunta                | Evidencia                                                                     | Resultado actual                            |
| ----------------------- | ----------------------------------------------------------------------------- | ------------------------------------------- |
| ¿Acoplamiento?          | Documentos UmiPOS, entitlement `pos`, canal NEXO `UMI`, eventos/sinks locales | Conceptual y contractual futuro; no runtime |
| ¿Código compartido?     | No hay imports `@umi/*` en NEXO ni `@nexo/*` en UMI                           | No                                          |
| ¿Contratos compartidos? | `@umi/contract` sólo UMI; OpenAPI/SDK sólo NEXO                               | No                                          |
| ¿OpenAPI compartido?    | UMI no contiene spec OpenAPI                                                  | No                                          |
| ¿SDK compartido?        | NEXO SDK generado; UMI manifiesto Dart sólo propuesto                         | No                                          |
| ¿Modelos compartidos?   | Entidades semejantes, schemas independientes                                  | No; duplicidad semántica                    |
| ¿Infra compartida?      | UMI VPS/Vercel/Supabase target; NEXO Compose local                            | No demostrable                              |
| ¿Pipelines compartidos? | Workflows separados                                                           | No                                          |
| ¿Docker compartido?     | Compose e imágenes independientes                                             | No                                          |
| ¿Base compartida?       | UMI build-v3 propone schemas `umi/tenant/runtime`; NEXO usa DB `nexo/public`  | No actualmente                              |
| ¿Eventos compartidos?   | NEXO produce proyecciones `nexo.*` a sink local; UMI no las consume           | No operativo                                |
| ¿Auth compartida?       | Cookies/JWT/roles y modelos separados                                         | No                                          |
| ¿Despliegue compartido? | UMI GHCR+VPS/Vercel; NEXO Compose/CI build                                    | No                                          |

## Inventario de UMI

### Estructura y aplicaciones

| Unidad                  | Stack                                   | Responsabilidad encontrada                                                                                                               | Estado por código                                                            |
| ----------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `apps/umi-api`          | NestJS 11, Fastify, `pg`, BullMQ, Redis | Backend único, auth, tenants, staff, customers, Cash loyalty, KDS, conversations, leads, voice, hours, jobs                              | Amplio; build/deploy configurado                                             |
| `apps/umi-dashboard`    | Vite, React, Supabase/API               | Shell owner/operator: overview, conversations, customers, devices, gift cards, hours, members, orders, products/billing, settings, staff | Funcional parcial; auth dual Supabase/cookie/local                           |
| `apps/umi-cash`         | Next.js, Prisma, Vercel                 | Loyalty/stored value, visits, rewards, Gift Cards, wallet passes, customer/admin UI                                                      | Código amplio pero README lo marca FROZEN y fuera del workspace              |
| `apps/umi-kds`          | SwiftUI iPad                            | Pairing, realtime board, transitions, ticket details/cancellation                                                                        | Cliente funcional por estructura y tests; App Store declarado, no verificado |
| `apps/umi-landing-page` | Next.js                                 | Marketing, leads/diagnostic, content                                                                                                     | Funcional, no dominio operativo central                                      |

`WORKSPACE.md`/maps también nombran `umi-conversaflow` y `umi-logs`; ambos están ausentes. Runtime ConversaFlow está efectivamente dentro de `umi-api`. No se atribuye un Logs app inexistente.

### Packages

| Package         | Contenido                                     | Consumers                                               |
| --------------- | --------------------------------------------- | ------------------------------------------------------- |
| `@umi/contract` | rutas byte-exactas, schemas Zod, entitlements | `umi-api`, `umi-dashboard`; Cash parcialmente duplicado |
| `@umi/tokens`   | tokens, CSS variables, Tailwind theme         | dashboard y landing según manifests/docs                |

### Bounded contexts y servicios

- Access: local auth, JWT/cookies, reset, tenant guards, roles y entitlements.
- Tenant platform: business/branch/location, staff, settings, hours y voice.
- Customer platform: customer/contact/notes, timelines, conversations, orders, Cash identity.
- ConversaFlow: WhatsApp ingress, intent, prompt, tool loop, cart/catalog/checkout tools, durable turns, memory y safety.
- Commerce/KDS: customer orders, order items/events, payments/refunds, station/device pairing y transitions.
- Loyalty/Cash: cards, visits, stored-value ledger, rewards/redemptions, Gift Cards, Apple/Google passes.
- Growth: prospects, diagnostics, sequences, lifecycle messaging.

### Persistencia build-v3

La definición SQL build-v3 contiene tres schemas y 65 tablas censadas:

- `umi` (16): users, RBAC, feature/plan/subscription/billing, prospects y audit.
- `tenant` (33): business, branch, station, integration, staff, customer/contact, loyalty, product/catalog, conversations/messages/knowledge, orders/payments/refunds, device y audit.
- `runtime` (16): sessions/OTP/reset/device session, pairing, outbox/inbound/idempotency/dead-letter, conversation state, reminders/sync/passes y tres índices de embeddings.

Incluye pgvector, pg_trgm, composite cross-schema FKs, triggers, RLS y security gate. Los SQL viven bajo `docs/migration/build-v3`; `umi-api/db/migrations` sólo contiene `.gitkeep`. Esto demuestra diseño/cutover materializado en SQL, pero no una cadena automatizada de migración dentro del app.

### Workers, jobs, eventos y outbox

- Web y Worker son procesos separados del mismo image.
- BullMQ queues: system, turns, outbound, enrichment, integrations y lifecycle.
- Schedulers: lifecycle y leads.
- `runtime.outbox_event` con claim, lease, retry, dead-letter y routing.
- Turn commit escribe estado, mensaje y outbox en una transacción.
- Eventos KDS/WhatsApp/lead/lifecycle existen; no hay contrato público de eventos compartido con NEXO.

### IA, Knowledge y Copilot

- Anthropic adapter (`claude-haiku-4-5-20251001`).
- Voyage embeddings (`voyage-4-lite`).
- `product_embedding`, `message_embedding`, `knowledge_embedding` vector(1024).
- `knowledge_document` y `knowledge_chunk` tenant-scoped.
- Prompt, tool loop, working memory, conversation state, traces y safety.
- No existe una app denominada “UMI Copilot”; sí existe el sustrato técnico completo para un copilot conversacional.

### Contratos, frontend y design system

No hay OpenAPI. El contrato canónico actual es TypeScript/Zod, limitado principalmente a auth/tenant/Cash. El seam JSON Schema/Dart está documentado como propuesta. Dashboard usa un shell propio, CSS/JSX y `@umi/tokens`; Cash mantiene otro conjunto pequeño de UI primitives; KDS tiene su propio KDSTheme/DesignSystem SwiftUI.

### Seguridad y observabilidad

Guards de auth/tenant/role/entitlement, request context, RLS SQL y roles DB están presentes. Logging JSON/traces existe. OTel/Tempo/Prometheus/Loki aparece como dirección en documentos, pero `umi-api` no depende de paquetes OTel; no se clasifica como operativo. Los security audits build-v3 registran riesgos pre-cutover y propuestas; no equivalen a un gate ejecutado aquí.

### Deployment y CI

UMI API: image no-root Node 22, GHCR, VPS Docker Compose, Redis+Caddy TLS, API/worker con el mismo image. Dashboard/Landing/Cash declaran Vercel. Workflows cubren lint, contrato, tokens, API build/test e image/deploy. KDS carece de workflow App Store en el checkout inspeccionado.

### Testing

Se censaron 70 archivos test/spec, integration harness de PostgreSQL/RLS, unit tests de services/adapters/jobs, contract CI, token CI y tests Swift/SwiftUI mínimos. No se ejecutaron.

## Inventario de NEXO

### Aplicaciones

| Unidad          | Stack          | Responsabilidad                                                                     | Estado por código                                     |
| --------------- | -------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `apps/api`      | NestJS/Fastify | Identity, Authorization, Control Plane, Product, Inventory, Sales, Cash, Device     | Amplio                                                |
| `apps/web`      | Next.js/React  | Admin: dashboard, products, inventory, sales, cash, reports, settings/control plane | Amplio                                                |
| `apps/worker`   | TS/Prisma      | expirations y outboxes Product/Inventory/Sales/Cash/Device                          | Amplio                                                |
| `apps/nexo_pos` | Flutter        | catálogo, cart, checkout, payments, cash session, recovery/offline guards, printing | Funcional por código/tests; runtime no ejecutado aquí |

### Packages y dominios

Quince packages: Identity, Authorization, Control Plane, Product, Inventory, Sales, Cash, Database, Contracts/OpenAPI, SDK, UI, Flutter Design, Observability, Config y TypeScript config. La API separa application/domain/infrastructure/interface en sus módulos principales.

### Persistencia

Prisma contiene 62 modelos y 27 enums: organizations/branches/memberships/RBAC/features, identity/session/security, Product/Variant/Category/Barcode/Price/Media, Inventory ledger/reservations/snapshots/counts/cost layers/transfers, Sales/items/payments/idempotency/receipts/refunds/events, POS devices y Cash creado por SQL complementario. Migraciones y tests SQL imponen RLS/FORCE RLS, roles runtime/worker/readonly, invariantes e historia inmutable.

### Workers/eventos/outbox

Outboxes separados por Product, Inventory, Sales, Cash y Device; worker con claims, retry/quarantine y expiraciones. Eventos UMI son proyecciones allowlisted a sink local, no integración productiva.

### Contratos/clientes/UI

OpenAPI 3.1.1 canónico con 144 operaciones en el estado inspeccionado y SDK generado/drift-checked. `@nexo/ui` ofrece primitives, Storybook, NexoSelect y módulos admin; Flutter Design replica tokens/semántica nativamente. Web Admin no es POS; POS es Flutter.

### Infra/CI/seguridad/observabilidad

Compose integra PostgreSQL, Redis, MinIO, Mailpit, OTel Collector, migrator, API, worker y Web. CI cubre format/lint/typecheck/test/build/coverage, migrations/RLS, Storybook/Playwright, Flutter, Compose y containers; CodeQL separado. Seguridad incluye cookies, CSRF/CORS/CSP, RBAC+ABAC, tenant context y FORCE RLS. OTel Node está cableado para API/worker.

### Testing y documentación

Se censaron 330 archivos test/spec fuera de outputs/deps, además de SQL, performance y abundante evidencia/certificación. La documentación es extensa pero presenta riesgo de volumen, repetición y estados históricos mezclados. NEXO carece de Git HEAD, por lo que no puede trazarse confiablemente qué archivos pertenecen a un commit.

## Owner of Record Matrix

Las columnas “migrar/eliminar/no tocar” son **candidatos para Parte 2**, no autorización de cambio. `—` significa que no existe owner operativo encontrado.

| Dominio                | Owner recomendado candidato / fuente actual              | Consumers                          | API / DB / UI / Worker / Runtime / Deploy / Docs                    | Produce / consume eventos    | Compartir                         | Migrar                                                  | Eliminar                         | No tocar ahora | Evidencia                                       |
| ---------------------- | -------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------- | ---------------------------- | --------------------------------- | ------------------------------------------------------- | -------------------------------- | -------------- | ----------------------------------------------- |
| SaaS entitlement/plans | UMI / `umi.*`                                            | dashboard, API, futuros productos  | UMI en todas las capas                                              | prospect/subscription events | Vocabulary                        | NEXO features hacia contrato futuro, sólo tras decisión | Duplicados futuros               | Sí             | `umi.feature/plan/subscription`, guards         |
| Identity/Auth          | Indeterminado; dos autoridades                           | ambos clientes                     | cada repo end-to-end                                                | security/session propios     | Sólo protocolo SSO futuro         | Candidato alto                                          | Una autoridad futura             | Sí             | modelos/guards/cookies separados                |
| Organizations/Business | Indeterminado; duplicado                                 | todos                              | UMI business vs NEXO Organization                                   | ambos producen eventos       | IDs/mapping temporal              | Candidato alto                                          | Una autoridad futura             | Sí             | `tenant.business`, `Organization`               |
| Branch/Location        | Indeterminado                                            | POS, KDS, dashboards               | ambos end-to-end                                                    | ambos                        | contrato de IDs                   | Candidato alto                                          | Duplicado futuro                 | Sí             | `tenant.branch`, NEXO Branch/Location           |
| Staff/Membership/RBAC  | Indeterminado                                            | dashboards/POS/payroll futuro      | UMI staff/RBAC; NEXO memberships/RBAC+ABAC                          | audit/security               | claims/scopes                     | Candidato alto                                          | Duplicado futuro                 | Sí             | schemas y guards                                |
| Customer/Contact       | UMI candidato / `tenant.customer/contact`                | ConversaFlow, KDS, loyalty, POS    | UMI API/DB/dashboard/worker                                         | conversation/order/loyalty   | API read contract                 | NEXO `customerId` mappings                              | NEXO customer stub futuro        | Sí             | UMI customer controllers/repos                  |
| Catalog/Product        | Indeterminado; duplicidad alta                           | ConversaFlow, KDS, POS, dashboards | UMI tenant product vs NEXO Product platform                         | ambos                        | Proyección/read contract          | Candidato alto                                          | Una write authority futura       | Sí             | ambos modelos/UI/APIs                           |
| Category               | Indeterminado                                            | catalog/POS                        | ambos DB/API/UI parcial                                             | product events               | read schema                       | Candidato                                               | duplicado futuro                 | Sí             | ambos schemas                                   |
| Media                  | NEXO candidato actual                                    | Web/POS                            | NEXO MinIO/API/UI                                                   | Product events               | URLs/asset contract               | evaluar hacia plataforma storage                        | no                               | Sí             | UMI carece media authority equivalente          |
| Pricing                | NEXO candidato actual                                    | POS/Sales                          | NEXO DB/API/UI                                                      | PriceUpdated                 | price read projection             | posible proyección a UMI                                | no                               | Sí             | UMI product no muestra price engine equivalente |
| Inventory              | NEXO                                                     | POS/Sales/Admin                    | NEXO end-to-end                                                     | Inventory outbox             | availability API                  | no antes de decisión                                    | no                               | Sí             | ledger/reservations/transfers/counts            |
| Orders/Sales           | NEXO runtime actual; UMI target documentado              | POS, KDS, reports, ConversaFlow    | UMI customer_order vs NEXO Sale                                     | ambos                        | seam requerido                    | decisión crítica Parte 2                                | una autoridad futura             | Sí             | NEXO completion; UMI order/KDS                  |
| Payments               | NEXO runtime actual; UMI schema parcial                  | POS/Cash/reports                   | ambos modelos; NEXO lifecycle más profundo                          | Sale/Payment events          | provider adapter                  | decisión crítica                                        | duplicado futuro                 | Sí             | PaymentIntent/Attempt vs tenant.payment         |
| Cash operations        | NEXO                                                     | POS/Admin                          | NEXO CashRegister/Session/Ledger                                    | Cash outbox                  | no confundir con UMI Cash         | no                                                      | no                               | Sí             | NEXO Cash domain                                |
| Loyalty/stored value   | UMI                                                      | Cash customer/admin, ConversaFlow  | UMI API/DB/Cash UI/jobs                                             | lifecycle/pass events        | redemption hook                   | no                                                      | duplicados NEXO futuros          | Sí             | loyalty ledger/GiftCard/passes                  |
| KDS                    | UMI                                                      | kitchen/operators                  | UMI API/tenant order projection/SwiftUI/worker/VPS+App Store target | order transitions            | consume POS order contract        | no                                                      | no                               | Sí             | native app + KDS module                         |
| ConversaFlow/AI        | UMI                                                      | WhatsApp/customers/orders          | UMI API/runtime/worker/VPS/docs                                     | inbound/outbox/turns         | catalog/order tools               | no                                                      | no                               | Sí             | Anthropic/Voyage/tool loop                      |
| Knowledge/RAG          | UMI                                                      | ConversaFlow/copilot futuro        | UMI DB/API worker; sin UI dedicada                                  | embeddings                   | possible shared retrieval API     | no                                                      | no                               | Sí             | vector tables/documents/chunks                  |
| Leads/Growth           | UMI                                                      | landing/operators                  | UMI API/DB/worker/landing                                           | prospect lifecycle           | no                                | no                                                      | no                               | Sí             | leads module/schedulers                         |
| Dashboard shell        | UMI para ecosystem; NEXO para producto admin             | owners/operators                   | UMI Dashboard/Vercel; NEXO Web/Compose                              | consumers                    | tokens/primitives sólo vía diseño | evaluar shell                                           | una navegación duplicada futura  | Sí             | dos dashboards reales                           |
| Reports/Analytics      | Compartido por bounded context                           | owners                             | UMI loyalty/KDS analytics; NEXO sales/cash views                    | consumers                    | aggregated contracts              | no hasta taxonomía                                      | duplicados                       | Sí             | ambas UIs/read models                           |
| Device management      | Compartido por device class                              | KDS/POS                            | UMI KDS devices; NEXO POS devices                                   | device outboxes              | identity/enrollment conventions   | no                                                      | no                               | Sí             | modelos distintos por cliente                   |
| Notifications          | UMI operativo (Twilio/email/pass), NEXO email/ntfy local | customers/operators                | cada repo/adapters                                                  | outbox                       | provider interface posible        | evaluar                                                 | no                               | Sí             | adapters/jobs                                   |
| Observability          | Indeterminado                                            | operations                         | NEXO OTel operativo; UMI logs/traces propios, OTel target           | telemetry                    | semantic conventions              | candidato                                               | obsolete UMI Logs docs if absent | Sí             | deps/código/docs                                |
| OpenAPI/SDK            | NEXO actual; UMI contract distinto                       | Web/Flutter/integrators            | NEXO owns OpenAPI/SDK; UMI owns Zod contract                        | —                            | neutral artifact future           | decidir contract authority                              | generators duplicados            | Sí             | package manifests/code                          |
| Deployment             | Separado                                                 | operations                         | UMI GHCR/VPS/Vercel; NEXO Compose/CI                                | —                            | no                                | no                                                      | no                               | Sí             | workflows/compose                               |
| Payroll                | No implementado                                          | staff/finance futuro               | —                                                                   | —                            | Identity/Branch/audit only        | no                                                      | no                               | Sí             | sólo referencias documentales                   |

## Source of Truth Matrix

Esta matriz expresa **candidato de autoridad basado en runtime existente**, no decisión final de consolidación.

| Dominio                             | Candidato                       | Motivo verificable                                               | Condición antes de hacerlo definitivo      |
| ----------------------------------- | ------------------------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| Entitlements/plans/subscriptions    | UMI                             | modelo y guards explícitos                                       | validar producción/billing                 |
| ConversaFlow, prompts, memory, RAG  | UMI                             | único runtime existente                                          | validar cutover build-v3                   |
| KDS                                 | UMI                             | único backend/cliente nativo                                     | fijar contrato order producer              |
| Loyalty, wallet, Gift Cards, passes | UMI                             | ledger/UI/adapters únicos                                        | resolver freeze/cutover `umi-cash`         |
| Leads/Growth                        | UMI                             | único dominio                                                    | validar datos/runtime                      |
| Product/Catalog                     | Compartido — decisión pendiente | dos write models                                                 | escoger un escritor y migrar IDs/history   |
| Identity/Auth/RBAC                  | Compartido — decisión pendiente | dos sistemas completos                                           | SSO/session/role mapping y threat model    |
| Business/Organization/Branch/Staff  | Compartido — decisión pendiente | duplicidad estructural                                           | ownership + migration + RLS proof          |
| Customer                            | UMI candidato                   | UMI tiene aggregate/timeline/integraciones; NEXO sólo referencia | contrato Sales/PII/history                 |
| Media/Pricing                       | NEXO candidato                  | implementación especializada existente                           | decidir si catálogo migra                  |
| Inventory                           | NEXO                            | único ledger operativo                                           | ninguna eliminación antes de Sales cutover |
| Sales/Checkout/Payments             | NEXO actual                     | único aggregate/checkout/folio/reservation/payment profundo      | UMI target requiere módulo POS aún ausente |
| Cash Drawer/Sessions                | NEXO                            | único dominio físico de caja                                     | separar semánticamente de UMI loyalty Cash |
| Dashboard                           | Compartido por audiencia        | UMI ecosystem vs NEXO admin operacional                          | IA de navegación y SSO                     |
| Reports/Analytics                   | Compartido por productor        | métricas distintas                                               | data contracts y warehouse strategy        |
| OpenAPI/SDK                         | NEXO actual                     | artefactos operativos; UMI seam es propuesta                     | decidir contrato platform-wide             |
| Payroll                             | No implementado                 | sólo puntos de integración                                       | fase futura                                |

## Comparación Arquitectónica

| Dimensión | UMI build-v3                                                | NEXO                                                 | Lectura                                                              |
| --------- | ----------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| Forma     | monorepo federado, backend+worker, apps heterogéneas        | modular monolith + worker + Web/Flutter              | ambos modulares; UMI más ecosystem, NEXO más vertical POS            |
| DDD       | módulos service/repository; schemas por business capability | packages domain puros + adapters                     | NEXO separa dominio/framework más explícitamente                     |
| DB        | SQL multi-schema `umi/tenant/runtime`                       | Prisma public + SQL constraints/RLS                  | UMI optimiza plataforma compartida; NEXO invariantes transaccionales |
| Tenancy   | business context y RLS build-v3                             | tenant IDs, composite FKs, FORCE RLS                 | ambos defense-in-depth; ejecución no validada aquí                   |
| Async     | BullMQ + transactional outbox + DLQ                         | DB outboxes + worker/retry/quarantine                | ambos maduros con modelos diferentes                                 |
| Contracts | Zod routes parcial                                          | OpenAPI 3.1.1 + SDK                                  | NEXO más interoperable hoy                                           |
| Clients   | React, Next, SwiftUI KDS                                    | Next Web, Flutter POS                                | complementarios                                                      |
| AI        | Anthropic/Voyage/RAG/tools                                  | no LLM runtime                                       | UMI claramente superior/especializado                                |
| Storage   | DB/Supabase legacy, pass assets                             | PostgreSQL, Redis, MinIO                             | NEXO tiene object storage privado explícito                          |
| Deploy    | VPS GHCR + Vercel + Caddy                                   | Compose/container builds; cloud target no demostrado | UMI tiene ruta productiva más explícita                              |

## Comparación Backend

- **DDD/modularidad:** NEXO encapsula domains en packages framework-free; UMI agrupa módulos Nest con repositories/services. UMI tiene mejor amplitud ecosystem/AI; NEXO mayor aislamiento del núcleo transaccional.
- **Persistencia:** UMI build-v3 modela plataforma completa en schemas; NEXO combina Prisma y SQL con migración ejecutable. UMI tiene SQL de cutover en docs, no wired a `umi-api/db/migrations`.
- **Workers/outbox:** ambos implementan claims, retries e idempotencia. UMI usa BullMQ+Redis y relay; NEXO workers DB-centric por bounded context.
- **Eventos:** no existe vocabulario compartido. NEXO projections UMI no tienen consumidor UMI.
- **OpenAPI/SDK:** NEXO es referencia actual. UMI contract es útil internamente pero incompleto para Flutter externo.
- **Testing:** NEXO tiene mayor volumen y variedad; UMI tiene tests focales y security/migration gates documentados.
- **Observabilidad:** NEXO tiene OTel dependency/config/collector; UMI logging/tracing interno y OTel objetivo sin cableado encontrado.
- **RLS/RBAC/ABAC:** ambos implementan RLS y roles. NEXO ABAC aparece como engine dedicado; UMI combina roles, tenant guards y entitlements.
- **CQRS:** ninguno usa un framework CQRS. Ambos separan command/query de forma pragmática.
- **Concurrencia:** NEXO evidencia locks/versiones/idempotencia en Sales/Inventory/Cash; UMI evidencia CAS/outbox/BullMQ y KDS transitions.

Referencia candidata por dominio: UMI para AI/KDS/Loyalty/Growth; NEXO para Inventory/Sales/Payments/Cash Operations/POS; decisión pendiente para plataforma core/catalog/customer.

## Comparación Frontend

UMI tiene tres lenguajes de UI: Dashboard React/Vite, Cash Next y KDS SwiftUI. NEXO tiene Web Admin Next y POS Flutter, con packages de diseño separados pero gobernados por tokens/semántica.

- UMI hace mejor la cobertura ecosystem: customers, conversations, loyalty, Gift Cards, KDS devices/orders y billing.
- NEXO hace mejor la consistencia de componentes administrativos, accesibilidad documentada, Storybook, contratos server-authoritative y separación Web Admin/POS.
- Reutilizables conceptualmente: tokens, iconografía, information architecture, KDSTheme, NEXO UI primitives y Flutter semantics. No son reutilizables por import directo entre React/Next/Swift/Flutter.
- Riesgo UMI: Dashboard soporta tres auth modes y conserva dependencia Supabase mientras `umi-api` busca ser backend único.
- Riesgo NEXO: alta densidad de UI/docs/artifacts y ausencia de baseline Git dificultan mantenibilidad/trazabilidad.

## Comparación Dashboard

| Criterio      | UMI Dashboard                                                                        | NEXO Dashboard                                                               |
| ------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Arquitectura  | Vite SPA, screen registry, data facade, auth Supabase/local/cookie                   | Next App Router, server/client shell, SDK/UI packages                        |
| Cobertura     | customers, conversations, devices, orders, loyalty/Gift Cards, hours, staff, billing | product, inventory, sales, cash, control plane, reports/settings             |
| UX            | ecosystem owner console, densidad funcional                                          | administración operacional POS, journeys y estados extensamente certificados |
| Design System | CSS/icons/tokens; Cash y KDS separados                                               | `@nexo/ui`+Storybook y Flutter Design                                        |
| Accesibilidad | no se encontró suite axe/dashboard equivalente                                       | Playwright/axe/keyboard docs y suites                                        |
| Performance   | Vite SPA; no budget runtime encontrado                                               | budgets/performance harness documentados                                     |
| Seguridad     | auth modes múltiples, tenant context                                                 | cookies/CSRF/CSP, ABAC y API SDK                                             |
| Operación     | Vercel y live-data UI                                                                | Compose y administración conectada                                           |

Pantallas duplicadas: overview, staff/team, settings, customers parciales, products/catalog, orders/sales y devices. Complementarias: UMI conversations/loyalty/KDS/billing versus NEXO inventory/cash drawer/sales administration. No se recomienda elegir por apariencia; la procedencia de datos y ownership deben decidir.

## Matriz Funcional

Madurez: `A` amplia, `P` parcial, `N` no encontrada, `T` target/propuesta. Cobertura/calidad se deriva de código/tests, no de ejecución.

| Dominio                    | UMI       | NEXO             | Dependencia cruzada | Observación                                  |
| -------------------------- | --------- | ---------------- | ------------------- | -------------------------------------------- |
| Dashboard                  | A         | A                | No                  | audiencias solapadas                         |
| Identity/Auth              | A         | A                | No                  | duplicidad alta                              |
| Usuarios                   | A         | A                | No                  | modelos distintos                            |
| Roles/Permisos             | A         | A                | No                  | UMI RBAC+entitlements; NEXO RBAC+ABAC        |
| Organizaciones/Business    | A         | A                | No                  | duplicidad alta                              |
| Sucursales/Locations       | A         | A                | No                  | duplicidad alta                              |
| Staff/Memberships          | A         | A                | No                  | duplicidad alta                              |
| Productos                  | A         | A                | No                  | UMI ConversaFlow/KDS; NEXO POS               |
| Categorías                 | A         | A                | No                  | duplicidad media                             |
| Media                      | P         | A                | No                  | NEXO MinIO privado                           |
| Pricing                    | P         | A                | No                  | NEXO price history/determinism               |
| Inventario                 | N         | A                | No                  | UMI docs lo dejan decisión de alcance        |
| Ventas/Orders              | A         | A                | No                  | semántica/autoridad crítica                  |
| Checkout                   | P tools   | A                | No                  | UMI POS backend aún ausente                  |
| Payments                   | P         | A                | No                  | UMI tenant.payment; NEXO intents/attempts    |
| Caja operativa             | N         | A                | No                  | distinto de loyalty Cash                     |
| Loyalty/Wallet             | A         | N                | No                  | UMI authority                                |
| Gift Cards                 | A         | N                | No                  | UMI authority                                |
| Clientes                   | A         | P                | No                  | UMI más profundo                             |
| Reportes                   | P         | P                | No                  | por-domain, sin warehouse común              |
| Analytics                  | P         | P                | No                  | dashboards/read models                       |
| Configuración/Hours/Voice  | A         | P                | No                  | UMI especializado                            |
| Notificaciones             | A         | P                | No                  | UMI Twilio/email/pass; NEXO email/ntfy       |
| Archivos/Object storage    | P         | A                | No                  | NEXO MinIO; UMI pass assets                  |
| SDK                        | T         | A                | No                  | UMI neutral emitter propuesto                |
| OpenAPI                    | N         | A                | No                  | UMI usa Zod routes                           |
| Workers/Jobs               | A         | A                | No                  | diferentes queues/outboxes                   |
| Feature Flags/Entitlements | A         | A                | No                  | diferente nivel: product vs org feature      |
| Seguridad                  | A         | A                | No                  | ambos con RLS; NEXO más automatizado en repo |
| Observabilidad             | P         | A                | No                  | UMI OTel target; NEXO wired                  |
| Deployment                 | A config  | P config         | No                  | producción no verificada                     |
| Testing                    | A         | A                | No                  | NEXO mayor breadth                           |
| Flutter                    | N         | A                | seam propuesto      | NEXO POS actual                              |
| POS                        | T backend | A client+backend | conceptual          | duplicidad futura, no actual UMI module      |
| KDS                        | A         | N                | futuro order seam   | UMI SwiftUI                                  |
| Customer Display           | N         | N                | No                  | no implementado                              |
| Inventory Scanner          | N         | N                | No                  | no app dedicada                              |
| Manager Companion          | N         | N                | No                  | dashboards web, no cliente dedicado          |
| Landing/Leads              | A         | N                | No                  | UMI                                          |
| ConversaFlow/WhatsApp      | A         | N                | No                  | UMI                                          |
| Knowledge/RAG              | A         | N                | No                  | UMI                                          |
| Payroll                    | N         | N                | integración futura  | no implementado                              |

## Matriz de Duplicidades

| Área                              | Nivel                       | Por qué existe / riesgo                                | Implementación más profunda hoy                |
| --------------------------------- | --------------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| Organization/Business/Branch      | Alta                        | dos tenant graphs y dos RLS; IDs/divergencia           | ambas; UMI ecosystem, NEXO POS                 |
| Identity/Auth/Roles               | Alta                        | sesiones/roles separados; doble alta/revocación        | NEXO security breadth; UMI entitlement breadth |
| Catalog/Product/Category          | Alta                        | dos write models consumidos por clientes distintos     | NEXO transaccional; UMI integration breadth    |
| Orders/Sales/Payments             | Alta semántica              | dos futuros escritores provocarían doble venta/sync    | NEXO hoy; UMI customer_order alimenta KDS      |
| Dashboard overview/settings/staff | Alta UI                     | funciones y navegación duplicadas                      | complementarias; sin ganador único             |
| Customer                          | Media                       | NEXO referencia; UMI aggregate completo                | UMI                                            |
| Cash naming                       | Alta confusión, baja código | UMI Cash=loyalty/wallet; NEXO Cash=drawer/session      | ambos, dominios diferentes                     |
| Contracts                         | Media                       | Zod routes vs OpenAPI/SDK                              | NEXO interoperabilidad; UMI internal exactness |
| Workers/outbox                    | Baja                        | cada DB necesita worker propio                         | no consolidable sin DB decision                |
| Design systems                    | Media                       | Web/Cash/KDS/Flutter por cliente                       | NEXO governance; UMI KDS native specialization |
| Observability                     | Media                       | traces/logging separados                               | NEXO OTel wired; UMI conversational traces     |
| Docs/architecture                 | Alta                        | ambos describen ownership opuesto y estados históricos | requiere curación, no borrado ahora            |
| Código literal compartido         | Sin evidencia               | no hay imports ni hashes/copia demostrada              | N/A                                            |

## Componentes Reutilizables

- UMI: KDS client/API contracts, ConversaFlow tool loop, knowledge/RAG, loyalty ledgers, Gift Cards/passes, tenant product entitlements, customer timeline, BullMQ/outbox patterns.
- NEXO: Product/Pricing/Media, Inventory ledger/reservations/FIFO/counts, Sales/Payments/Cash operations, OpenAPI/SDK pipeline, Web Design System, Flutter POS/Design, OTel setup.
- Reutilización segura significa contrato/adaptador o migración explícita; no copiar tablas/components entre repos.

## Componentes Candidatos a Consolidación

Sin decisión final:

1. Identity/session/role vocabulary y SSO.
2. Organization/Business, Branch/Location y Staff/Membership IDs.
3. Catalog/Product/Category/Price read model.
4. Order/Sale lifecycle y evento hacia KDS.
5. Customer identity/timeline reference desde Sales.
6. Device enrollment conventions para POS/KDS.
7. Un contrato neutral para Flutter/Swift/Web.
8. Dashboard navigation y reporting taxonomy.
9. Observability correlation/trace conventions.

## Componentes Candidatos a Eliminación

Ninguno está autorizado para eliminación. Candidatos a evaluar en Parte 2:

- una de las dos autoridades futuras de Organization/Branch/Auth/Catalog después de migración;
- proxies y Prisma/runtime duplicado de `umi-cash` después de confirmar su freeze/cutover;
- documentación UMI que apunta a apps ausentes (`umi-conversaflow`, `umi-logs`) una vez actualizados los mapas;
- sinks locales UMI de NEXO cuando exista consumer real o se adopte una sola DB;
- pantallas duplicadas de dashboard sólo después de definir shell/SSO/data authority.

## Estado Clientes Operativos

| Cliente                  | Estado                                                      | Evidencia                                      |
| ------------------------ | ----------------------------------------------------------- | ---------------------------------------------- |
| POS                      | Existe funcional en NEXO; producción no verificada          | Flutter source/tests + NEXO API                |
| KDS                      | Existe funcional en UMI; producción/App Store no verificada | SwiftUI source, API, tests                     |
| Customer Display         | No existe                                                   | sin app/source                                 |
| Inventory Scanner        | No existe como cliente dedicado                             | sólo flujos Inventory Web/POS                  |
| Manager Companion        | No existe como app dedicada                                 | dashboards web cubren parte del caso           |
| Flutter Shared           | Existe en NEXO                                              | `nexo_flutter_design`; UMI seam Dart propuesto |
| UMI Cash customer wallet | Existe funcional, FROZEN                                    | Next routes/UI/Prisma/passes                   |
| UMI Dashboard            | Existe funcional parcial                                    | Vite React/live API modes                      |

“Producción” no se marca para ningún cliente porque no se verificaron stores, Vercel, VPS ni telemetría live.

## Payroll Readiness

Payroll no está implementado en ninguno. Puntos de integración existentes:

- usuarios/staff/memberships y roles en ambos;
- business/organization y branch/location en ambos;
- UMI `tenant.staff`, schedules/hours parciales y audit logs;
- NEXO Membership/Branch, Authorization events y SDK/OpenAPI;
- workers/outbox de ambos pueden producir eventos futuros.

No hay nómina, wage/salary ledger, timesheets, attendance, payroll API, SDK, worker o reporting dedicado. Readiness: **fundación de identidad/branch disponible; dominio Payroll NOT IMPLEMENTED**.

## UMI Copilot Readiness

Readiness alta a nivel sustrato, no como producto Copilot:

- Knowledge Base: `knowledge_document/chunk`.
- RAG/vector DB: pgvector y tres tablas embedding.
- Embeddings: Voyage adapter.
- LLM: Anthropic adapter.
- IA: prompt/tool loop, intent, safety, memory, durable turns.
- Tools: branch, cart, catalog, checkout, customer y product search.
- Operations: queues, outbox, DLQ, traces y eval docs.
- Corpus reutilizable: documentación UMI/NEXO, FAQs/runbooks tras clasificación de autoridad y exclusión de secretos/históricos.

Faltan una UI/permission boundary Copilot explícita, ingestión gobernada del corpus conjunto, evaluación de respuestas para dominios NEXO y contrato de tools NEXO. No debe entrenarse/ingerirse toda la documentación sin curación: ambos repos contienen documentos históricos contradictorios.

## No continuar Certification hasta...

### Partes del roadmap candidatas a detener inmediatamente

- nuevas expansiones duplicadas de Organization/Branch/Identity/Staff/Catalog en cualquiera de los repos;
- integración productiva NEXO→UMI basada en sinks/webhooks antes de decidir una DB versus seam API;
- nuevo dashboard para Customers/Orders/Staff/Settings sin escoger shell y fuente;
- nuevo KDS, loyalty, Gift Card o ConversaFlow dentro de NEXO;
- nuevo Inventory/Sales/Cash Drawer dentro de UMI antes de resolver si reutiliza NEXO o migra su autoridad.

### Prompts candidatos a no ejecutar

- prompts de certificación NEXO que construyan Customers, KDS, Gift Cards, loyalty, AI/RAG, notifications ecosystem o platform dashboard;
- prompts UMI que implementen POS/Inventory/Payments/Cash desde cero sin mapear NEXO;
- prompts de “UMI integration” que asuman dos sistemas y creen sync/webhooks como solución predeterminada;
- prompts de consolidación/eliminación antes de Parte 2.

### Certificaciones que parecen duplicadas

- Identity/Auth/RBAC/RLS multi-tenant;
- Organization/Branch/Staff;
- Product/Catalog;
- Orders/Sales/Payments si UMI activa POS;
- dashboard/settings/accessibility y observability baselines.

### Dominios probablemente ya resueltos

- UMI: KDS, ConversaFlow, loyalty/wallet, Gift Cards/passes, customers y leads.
- NEXO: Product/Pricing/Media, Inventory, Sales/Checkout/Payments, Cash operations, Flutter POS, OpenAPI/SDK.

Estas son marcas de discovery, no cierres ni autorizaciones.

## Riesgos

1. **Doble autoridad:** el riesgo principal es tener dos writers para catálogo, identidad, branch y orders.
2. **Arquitectura objetivo ≠ runtime:** UMI docs afirman POS en `umi-api`, pero el módulo no existe.
3. **Drift de mapas UMI:** apps ausentes aún figuran como owners.
4. **Freeze ambiguo:** `umi-cash` sigue desplegable y con DB propia mientras se declara absorbido.
5. **Contract seam incompleto:** Flutter NEXO no consume `@umi/contract`; manifest Dart no existe.
6. **Auth triple en Dashboard UMI:** Supabase/local/cookie amplía superficie y transición.
7. **Migration chain UMI:** build-v3 SQL vive en docs y no en migrations del API.
8. **NEXO sin HEAD:** no hay provenance/rollback confiable del filesystem.
9. **Semántica “Cash”:** loyalty/stored value y physical cash son bounded contexts distintos con el mismo nombre.
10. **Docs como falsa autoridad:** reportes históricos en ambos pueden contradecir código actual.
11. **Producción no verificada:** deployment configs no demuestran estado live.
12. **PII/AI:** combinar Customers, conversations y RAG exige gobierno/retención/consentimiento.

## Evidencia

- UMI branch/commit: `build-v3` / `71f603e4d5c49b139ee6aefe0fac13b535d55e9c`.
- UMI: 5 app roots, 2 packages, 65 build-v3 tables, 70 test/spec files, 76 SQL files, 6 workflows.
- NEXO: 4 apps, 15 packages, 62 Prisma models, 27 enums, 330 test/spec files, 51 SQL files, 3 workflows principales, OpenAPI 144 operations.
- Cross-import scan: cero imports package-level entre repos.
- UMI→NEXO references: UmiPOS analysis/summary/contract seam.
- NEXO→UMI references: ADR-0037/0041, `UmiSalesIntegrationPort`, `UmiCashIntegrationPort`, worker local sinks y channel `UMI`.
- No se ejecutaron comandos mutables, tests, migrations, Docker o deploy.

## Archivos Inspeccionados

### UMI — autoridades principales

- `README.md`, `WORKSPACE.md`, `AGENTS.md`, `CONVENTIONS.md`, workspace manifests.
- `apps/umi-api/package.json`, `src/app.module.ts`, `src/worker.module.ts`, todos los nombres de archivos bajo `src/modules`, `src/jobs`, `src/shared`, controllers y route decorators.
- Auth, tenant, staff, customer, Cash, KDS, conversations, leads, hours, voice repositories/services/adapters.
- `apps/umi-api/Dockerfile`, Compose, Caddy, deploy script y docs de VPS/pipeline.
- `packages/contract/src/{routes,schemas,entitlements,index}.ts` y `packages/tokens`.
- `apps/umi-dashboard/src` completo por inventario; app/shell/data/auth/config/tenant context y todos los screens.
- `apps/umi-cash/package.json`, Prisma schema/migrations, todas las rutas App y components.
- `apps/umi-kds/Sources`, tests, project config y KDS architecture.
- `apps/umi-landing-page` manifest, routes/components/lib/scripts por inventario.
- `.github/workflows/*`.
- `docs/architecture/maps/*`, governance authority/ownership, UmiPOS analysis/summary/seam.
- `docs/migration/build-v3/*.sql`, backfills, security gate/audit y schema diagram.

### NEXO — autoridades principales

- root package/workspace/README/guardrails/decision log/compose/workflows.
- manifests y árboles fuente de `apps/api`, `apps/web`, `apps/worker`, `apps/nexo_pos`.
- módulos API Identity, Authorization, Control Plane, Product, Inventory, Sales, Cash y Device.
- Prisma schema/migrations/SQL tests y workers.
- OpenAPI, SDK generator/manifest, UI y Flutter Design packages.
- rutas Web y tests E2E/UI/performance por inventario.
- ADRs UMI/Sales/Cash, certification reports y architecture docs relevantes.

### Limitaciones de inspección

- No se validaron secretos, datos o infraestructura productiva.
- No se ejecutó runtime, CI, tests ni migraciones por alcance read-only.
- Outputs generados y dependencias no se inspeccionaron como código fuente.
- NEXO no tiene commit HEAD; no fue posible comparar contra una baseline Git.
- La Parte 1 no decide eliminaciones, migraciones ni roadmap definitivo.
