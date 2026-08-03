# NEXO — Respuesta formal a UmiPOS Resolución de Arquitectura

Fecha de corte: 2026-07-23. Repositorio examinado: `/home/hceja/Documents/nexo`.

## 0. Executive Summary

NEXO es un monorepo funcional, ejecutable localmente y con una superficie técnica amplia: API NestJS, Web Next.js, Worker, POS Flutter, PostgreSQL/Prisma, Redis, MinIO, OpenTelemetry Collector, 47 migraciones, 62 modelos Prisma, 145 operaciones OpenAPI únicas, SDK TypeScript derivado del contrato y suites TypeScript, Playwright, Flutter y SQL. Código, restricciones SQL, tests y artefactos locales sustentan capacidades de Product, Inventory, Sales, Cash, Refunds, Receipts y Analytics. Esto demuestra implementación y validación local; no demuestra operación productiva.

Los bloqueadores de procedencia son objetivos: la rama simbólica es `main`, pero es una rama no nacida; `HEAD` no resuelve, hay 0 commits, no hay remotes/upstream y todo el árbol aparece sin rastrear. Por ello no pueden verificarse fecha, autores, evolución, último commit remoto, rollback por Git ni atribución histórica. El archivo `UMIPOS_RESOLUCION_ARQUITECTURA.md` tampoco está disponible; se respondieron las 34 preguntas transcritas en la solicitud.

No se encontró evidencia verificable de ambiente productivo activo, DNS/TLS operativo, clientes reales, dinero real procesado, despliegue cloud, publicación de imágenes, backups/restores automatizados, on-call, alertas, SLO/error budgets ni integración CFDI/PAC productiva. `compose.yaml` y las imágenes son producción-intended, pero usan dependencias y credenciales locales; CI valida, construye y ejecuta E2E, no despliega. OpenTelemetry existe para API/Worker y Collector local, sin backend productivo ni alertas verificadas.

Multi-tenancy sí está implementado: 45 de 62 modelos tienen referencia directa tenant/organization y 14 tienen branch/location; los restantes incluyen definiciones globales, identidad o relaciones. Migraciones crean RLS/FORCE RLS y políticas, y cinco roles de aplicación son `NOBYPASSRLS`. Branch isolation se complementa con ABAC/relaciones autoritativas, no con RLS de branch uniforme. Los conteos estáticos de sentencias RLS no equivalen a tablas porque varias migraciones usan bucles SQL.

Payments conserva intents/attempts y registra CASH o acknowledgements externos; no se encontró SDK/adaptador de procesador, captura real, settlement, provider refund o chargeback. Flutter usa un transporte Dart manual alineado al OpenAPI, mapeos manuales y SQLite. Permite catálogo cacheado y borradores; la ejecución financiera offline está explícitamente bloqueada y la recuperación reutiliza idempotency keys persistidas.

Para un portado futuro, el principal bloqueo no es ausencia de código sino ausencia de procedencia y baseline versionado. También requieren diseño explícito los acoplamientos NestJS, Prisma/PostgreSQL/RLS, Tenant/Branch, MinIO/Redis, contratos NEXO y el modelo manual del cliente Flutter. Este documento no recomienda federación, monolito, base única ni backend único.

## 1. Alcance y metodología

Auditoría read-only del código, SQL, manifests, contrato, CI, Docker, tests y artefactos existentes. Se usaron reportes previos solo como evidencia secundaria. No se consultó Internet, no se instalaron dependencias, no se ejecutaron migraciones, no se tocaron datos/volúmenes ni Git. Los únicos archivos nuevos son este reporte y `artifacts/architecture/nexo-formal-response-to-umi/`.

Clasificaciones: `VERIFIED`, `PARTIALLY VERIFIED`, `NOT VERIFIED`, `NOT IMPLEMENTED`, `NOT APPLICABLE`, `BLOCKED`, `UNKNOWN`.

## 2. Procedencia

### Pregunta 1 — Fecha del primer y último commit

**Respuesta:** No existen commits alcanzables. Primer/último hash, autor, fechas y asunto no pueden responderse.

**Clasificación:** BLOCKED.

**Evidencia:**

- Comando: `git log --reverse -1 --date=iso --format=fuller`; `git log -1 --date=iso --format=fuller`.
- Resultado: ambos terminan 128: `current branch 'main' does not have any commits yet`.
- Ruta: `.git/`.
- Fragmento: `## No commits yet on main`.
- Conteo: 0 commits.

**Limitaciones:** Se necesita un historial auténtico; no se creó HEAD artificial.

### Pregunta 2 — Total de commits

**Respuesta:** El conjunto de referencias Git contiene cero commits.

**Clasificación:** VERIFIED.

**Evidencia:**

- Comando: `git rev-list --all --count`.
- Resultado: `0`.
- Ruta: `.git/`.
- Fragmento: no aplica.
- Conteo: 0.

**Limitaciones:** Solo describe el repositorio entregado, no una posible fuente externa.

### Pregunta 3 — Autores y distribución

**Respuesta:** No existe distribución calculable.

**Clasificación:** BLOCKED.

**Evidencia:**

- Comando: `git shortlog -sn --all`.
- Resultado: salida vacía.
- Ruta: `.git/`.
- Fragmento: no aplica.
- Conteo: 0 autores.

**Limitaciones:** No se infiere propiedad intelectual desde archivos o timestamps.

### Pregunta 4 — Commits por mes

**Respuesta:** No existen meses con commits.

**Clasificación:** BLOCKED.

**Evidencia:**

- Comando: `git log --date=format:%Y-%m --pretty=%ad | sort | uniq -c`.
- Resultado: fatal por rama sin commits.
- Ruta: `.git/`.
- Fragmento: `main does not have any commits yet`.
- Conteo: 0.

**Limitaciones:** Requiere historial legítimo.

### Pregunta 5 — Remotes, HEAD y referencia

**Respuesta:** `HEAD` simbólico apunta a `refs/heads/main`, pero no resuelve a objeto. No hay remote, upstream ni branches listables. Working tree no está limpio: todo aparece untracked. `git fsck --full` no encontró objetos huérfanos; informó rama no nacida y ausencia de referencias. No hay rollback Git reproducible.

**Clasificación:** BLOCKED.

**Evidencia:**

- Comando: `git remote -v`; `git symbolic-ref HEAD`; `git rev-parse HEAD`; `git status --short --branch`; `git branch -a -vv`; `git fsck --full`.
- Resultado: remote/branches vacíos; symbolic HEAD `refs/heads/main`; `rev-parse` 128; árbol completo `??`.
- Ruta: `.git/`.
- Fragmento: `notice: HEAD points to an unborn branch (main)`.
- Conteo: 0 remotes, 0 commits, 0 branches materializadas.

**Limitaciones:** Sin fuente remota no puede saberse si el historial existe en otro sistema.

### Pregunta 6 — Atribución de commits con asistencia de IA

**Respuesta:** No se encontró política, DCO, sign-off obligatorio, plantilla de commit ni reglas `Co-authored-by`.

**Clasificación:** NOT IMPLEMENTED.

**Evidencia:**

- Comando: `rg -n -i 'Co-authored-by|Signed-off-by|DCO|AI assistance|asistencia.*IA' CONTRIBUTING* AGENTS.md README.md docs .github`.
- Resultado: sin política aplicable.
- Ruta: README, docs y `.github/` revisados.
- Fragmento: no aplica.
- Conteo: 0 políticas.

**Limitaciones:** Una política externa no entregada sería UNKNOWN.

## 3. Producción

### Pregunta 7 — Ambiente productivo

**Respuesta:** Hay imágenes multi-stage y configuración `NODE_ENV=production`, pero no producción verificable. Compose es local/CI: credenciales llevan `local_only`, incluye Mailpit y la documentación dice que cloud/IaC, secret manager y telemetry backend están pendientes.

**Clasificación:** NOT VERIFIED.

**Evidencia:**

- Comando: búsqueda de manifests/domains/deploy e inspección de Compose/Dockerfiles.
- Resultado: cuatro Dockerfiles y un Compose; ningún Kubernetes/Terraform/Pulumi/deploy workflow.
- Ruta: `compose.yaml`, `infra/docker/*.Dockerfile`, `docs/13-foundation-architecture.md`.
- Fragmento: `Mailpit is a developer inbox`; `Production cloud/IaC ... await`.
- Conteo: 10 servicios Compose; 0 manifests cloud.

**Limitaciones:** Un dominio configurado no fue tratado como activo; no se consultó DNS/TLS.

### Pregunta 8 — Clientes reales y dinero procesado

**Respuesta:** No se encontró evidencia sanitizada que distinga clientes reales o dinero real de seeds, fixtures y pruebas.

**Clasificación:** NOT VERIFIED.

**Evidencia:**

- Comando: búsqueda en docs/seeds/artifacts de clientes, transacciones y producción.
- Resultado: datos identificables son fixtures/certificación.
- Ruta: `packages/database/prisma/seed.ts`, `tests/e2e/`, `artifacts/certification/`.
- Fragmento: documentación marca personas/fixtures de prueba.
- Conteo: 0 clientes verificables, 0 monto verificable.

**Limitaciones:** Se necesitan registros productivos sanitizados y procedencia auditable.

### Pregunta 9 — Pipeline y ambientes reales

**Respuesta:** GitHub Actions declara validación en PR/push a main, CodeQL semanal y Flutter nativo. Ejecuta quality, migración/RLS, UI, Flutter, builds de cuatro targets y Compose E2E. No publica imágenes, no despliega ambiente, no hace health check externo ni rollback. Secrets productivos no están especificados.

**Clasificación:** PARTIALLY VERIFIED.

**Evidencia:**

- Comando: `sed -n` de workflows.
- Resultado: jobs inventariados en `ci-test-matrix.json`.
- Ruta: `.github/workflows/ci.yml`, `codeql.yml`, `flutter-native.yml`.
- Fragmento: `docker compose up --build --wait`; matrix `api, migrate, web, worker`.
- Conteo: 3 workflows, 0 deploy jobs.

**Limitaciones:** Configuración verificada; ejecución remota/status no verificable sin remote.

### Pregunta 10 — Ramas remotas y último commit

**Respuesta:** No existen referencias remotas.

**Clasificación:** NOT VERIFIED.

**Evidencia:**

- Comando: `git branch -r`; `git for-each-ref refs/remotes ...`.
- Resultado: salida vacía.
- Ruta: `.git/`.
- Fragmento: no aplica.
- Conteo: 0 ramas remotas.

**Limitaciones:** Se requiere remote auténtico.

### Pregunta 11 — Backups y restore

**Respuesta:** No se encontraron scripts `pg_dump`/restore, snapshots, cron, DR test ni registro de restauración. `SECRET_ROTATION_RUNBOOK.md` no es backup. RPO/RTO no están definidos.

**Clasificación:** NOT IMPLEMENTED.

**Evidencia:**

- Comando: búsqueda `pg_dump|pg_restore|backup|restore|RPO|RTO`.
- Resultado: notas de seguridad de disco; ningún mecanismo de backup.
- Ruta: `docs/OWNER_DISK_REPORT.md`, `docs/SECRET_ROTATION_RUNBOOK.md`.
- Fragmento: se advierte no borrar volúmenes sin backup verificado.
- Conteo: 0 automatizaciones de backup/restore.

**Limitaciones:** Infraestructura externa no entregada queda UNKNOWN.

### Pregunta 12 — Runbooks, on-call, alertas y SLO

**Respuesta:** Runbook de rotación de secretos: implementado documentalmente. On-call, alertas automáticas, SLO, error budgets e incident response operativo: no implementados/encontrados.

**Clasificación:** PARTIALLY VERIFIED.

**Evidencia:**

- Comando: búsqueda por nombre y contenido.
- Resultado: un runbook específico; ningún manifiesto de alertas/SLO.
- Ruta: `docs/SECRET_ROTATION_RUNBOOK.md`, `infra/otel/collector.yaml`.
- Fragmento: Collector local exporta debug; backend/alertas abiertos.
- Conteo: 1 runbook específico, 0 políticas on-call/SLO.

**Limitaciones:** Documentos operativos fuera del repo no son verificables.

### Pregunta 13 — CFDI/SAT/PAC

**Respuesta:** Hay investigación/referencias y tipos futuros, no adaptador PAC, timbrado, UUID fiscal, XML productivo ni cancelación fiscal.

**Clasificación:** NOT IMPLEMENTED.

**Evidencia:**

- Comando: `rg -n -i 'CFDI|SAT|PAC|timbrad|UUID fiscal|cancelación fiscal'`.
- Resultado: documentación y referencias; sin módulo runtime.
- Ruta: `docs/12-fuentes-y-trazabilidad.md`, `docs/SalesResearch.md`.
- Fragmento: UBL/receipt no se declara CFDI.
- Conteo: 0 integraciones PAC.

**Limitaciones:** Ningún sandbox externo fue probado.

## 4. Multi-Tenant

### Pregunta 14 — Evidencia de RLS

**Respuesta:** Las migraciones contienen RLS/FORCE RLS y políticas tenant/default-deny, incluidas tablas de Product, Inventory, Sales, Cash, Device y Control Plane. El grep estático encuentra 19 sentencias ENABLE, 19 FORCE y 88 CREATE POLICY; varias son bucles dinámicos que cubren listas de tablas, por lo que no son conteos de tablas.

**Clasificación:** VERIFIED.

**Evidencia:**

- Comando: grep solicitado y `rg` restringido a migraciones/roles.
- Resultado: políticas y suites SQL presentes.
- Ruta: `packages/database/prisma/migrations/**/migration.sql`, `packages/database/tests/rls*.sql`.
- Fragmento: `ENABLE ROW LEVEL SECURITY`; `FORCE ROW LEVEL SECURITY`; `tenant_id=app.current_tenant_id()`.
- Conteo: 19/19/88 sentencias estáticas; 5 suites SQL.

**Limitaciones:** Esta auditoría no reinició ni mutó DB; ejecución previa es evidencia secundaria y CI es configuración.

### Pregunta 15 — Entidades tenant-bound

**Respuesta:** Schema: 62 modelos; 45 contienen tenantId/organizationId y 14 branchId/locationId. Hay definiciones globales (roles/permisos/features), identidad y joins que se aíslan por relaciones. Tenant es aislamiento principal SQL; branch es secundario, mayormente ABAC/relacional.

**Clasificación:** VERIFIED.

**Evidencia:**

- Comando: parser awk por bloques `model`.
- Resultado: 62/45/14.
- Ruta: `packages/database/prisma/schema.prisma`.
- Fragmento: `tenantId`, `branchId`, `locationId`, relaciones.
- Conteo: indicado arriba.

**Limitaciones:** Categorías se superponen; no deben sumarse. Un modelo sin tenant directo no implica fuga.

### Pregunta 16 — Roles y privilegios DB

**Respuesta:** Se definen migration, runtime, readonly, maintenance y worker; todos `NOSUPERUSER ... NOBYPASSRLS`. Runtime no es superuser. Worker es rol separado; migration tiene CREATE/ownership de schema. Bootstrap se declara local/CI; provisioning productivo no está implementado aquí.

**Clasificación:** VERIFIED.

**Evidencia:**

- Comando: inspección de `roles.sql`.
- Resultado: cinco roles y grants.
- Ruta: `infra/postgres/bootstrap/roles.sql`.
- Fragmento: `NOSUPERUSER ... NOBYPASSRLS`.
- Conteo: 5 roles.

**Limitaciones:** Roles de una producción inexistente/no accesible no se verificaron.

### Pregunta 17 — Guards y endpoints

**Respuesta:** Hay 11 controllers y 145 operaciones. La protección no se modela principalmente con `@UseGuards`; identidad/contexto se resuelve globalmente y RBAC/ABAC se aplica en servicios/repositorios. Existen CSRF, rate limiting, tenant resolver, permisos y contexto de device/branch. Endpoints health/auth tienen semántica pública específica.

**Clasificación:** VERIFIED.

**Evidencia:**

- Comando: inventario de controllers y búsquedas de auth/CSRF/permission/tenant/branch.
- Resultado: 11 controllers; 145 operaciones.
- Ruta: `apps/api/src/main.ts`, `app.module.ts`, `modules/authorization`, `packages/authorization`.
- Fragmento: `authorization.assert(...)`, tenant resolver y CSRF middleware.
- Conteo: 11 controllers, 145 operaciones.

**Limitaciones:** No se publica un conteo engañoso “protegido por decorador”; requiere analizar protección global y por operación.

### Pregunta 18 — ¿Single-tenant?

**Respuesta:** No. Es multi-tenant por schema, RLS, roles, contexto y tests. Las brechas son operativas: no hay producción verificada y branch isolation no es RLS uniforme.

**Clasificación:** VERIFIED.

**Evidencia:**

- Comando: correlación de preguntas 14–17.
- Resultado: tenant IDs, políticas y ABAC.
- Ruta: schema, migraciones, autorización, RLS tests.
- Fragmento: `app.current_tenant_id()`.
- Conteo: 45 modelos tenant/organization-bound.

**Limitaciones:** No se estima retrofit single-tenant porque la premisa es falsa.

## 5. Contrato y superficie

### Pregunta 19 — OpenAPI versionado

**Respuesta:** Spec design-first OpenAPI 3.1.1, versión API 8.9.0, almacenado en el árbol. Se valida y compara contra baseline; no puede afirmarse “versionado en Git” porque Git no tiene commits. API expone el contrato según implementación/documentación, pero no se verificó runtime en esta auditoría.

**Clasificación:** PARTIALLY VERIFIED.

**Evidencia:**

- Comando: parser JSON y manifests.
- Resultado: formato/versión/rutas válidos estructuralmente.
- Ruta: `packages/contracts/openapi/openapi.json`, `compatibility-baseline.json`.
- Fragmento: `"openapi": "3.1.1"`, `"version": "8.9.0"`.
- Conteo: 126 paths.

**Limitaciones:** Persistencia histórica/versionado Git bloqueado.

### Pregunta 20 — Operaciones HTTP

**Respuesta:** 145 operaciones y 145 operationIds únicos; ningún duplicado.

**Clasificación:** VERIFIED.

**Evidencia:**

- Comando: parser Python read-only sobre `paths`.
- Resultado: GET 54, POST 73, PUT 4, PATCH 9, DELETE 5, OPTIONS/HEAD 0.
- Ruta: OpenAPI canónico.
- Fragmento: operations bajo `paths`.
- Conteo: total 145.

**Limitaciones:** Conteo contractual, no tráfico productivo.

### Pregunta 21 — SDK y drift

**Respuesta:** SDK TypeScript generado por script propio, output tipado, tests, build y `generate:check`. CI lo ejecuta indirectamente en `test:coverage`/`build` del workspace, no como job nominal. Ejecución remota no verificada.

**Clasificación:** VERIFIED.

**Evidencia:**

- Comando: inspección de package scripts/workflow.
- Resultado: generator y check presentes.
- Ruta: `packages/sdk/scripts/generate-openapi-operations.mjs`, `src/generated/openapi-operations.ts`.
- Fragmento: `"generate:check": "... --check"`.
- Conteo: 1 SDK package, 1 test file.

**Limitaciones:** Sin historial no puede probarse drift entre commits.

### Pregunta 22 — Contrato Flutter

**Respuesta:** Clasificación `mixed`: transporte y modelos Dart manuales alineados a rutas OpenAPI; no hay cliente Dart íntegramente generado. Existe mapping manual hacia modelos POS.

**Clasificación:** PARTIALLY VERIFIED.

**Evidencia:**

- Comando: búsquedas de OpenAPI/client/models y lectura.
- Resultado: `OpenApiPosClient` usa `http`; modelos propios.
- Ruta: `apps/nexo_pos/lib/core/api.dart`, `models.dart`, `productive_coordinator.dart`.
- Fragmento: `class OpenApiPosClient implements PosApi`.
- Conteo: 1 transporte principal; mappings distribuidos.

**Limitaciones:** El nombre OpenApiPosClient no implica generación.

## 6. Calidad ejecutada

### Pregunta 23 — Archivos de test

**Respuesta:** Inventario estático: 400 archivos test-like; 34 `.test.*`, 339 `.spec.*`, 16 `_test.dart`, 5 SQL RLS, 7 performance y 4 scripts de certificación. Categorías se superponen. CI ejecuta Vitest coverage, RLS SQL, Playwright E2E/UI y Flutter foundation/native; performance/certificación extensa es manual.

**Clasificación:** VERIFIED.

**Evidencia:**

- Comando: `rg --files` por patrones.
- Resultado: `tests-inventory.json`.
- Ruta: apps/packages/tests/scripts.
- Fragmento: jobs de `.github/workflows/ci.yml`.
- Conteo: indicado arriba.

**Limitaciones:** Existencia no prueba ejecución; reportes narrativos no se contaron como tests.

### Pregunta 24 — Cobertura

**Respuesta:** CI declara `pnpm test:coverage` y Vitest V8 genera reportes. No se encontró threshold global/package, Codecov/Sonar ni resultado verificable de CI remoto.

**Clasificación:** PARTIALLY VERIFIED.

**Evidencia:**

- Comando: búsqueda `coverageThreshold|thresholds|coverage|codecov|sonar`.
- Resultado: reporters configurados, sin thresholds.
- Ruta: `*/vitest.config.ts`, package scripts, CI.
- Fragmento: `coverage: { provider: 'v8', reporter: ... }`.
- Conteo: 0 thresholds encontrados.

**Limitaciones:** Sin resultado remoto, porcentaje actual `NOT VERIFIED`.

### Pregunta 25 — E2E automáticas vs manuales

**Respuesta:**

| Suite                     | Framework             | Comando                        | CI                      | Manual | Docker         | Flutter/browser    | Duración |
| ------------------------- | --------------------- | ------------------------------ | ----------------------- | ------ | -------------- | ------------------ | -------- |
| API/Web E2E               | Playwright            | `pnpm test:e2e:quality`        | Sí                      | Sí     | Sí             | Browser            | media    |
| UI                        | Playwright/Storybook  | `pnpm test:ui`                 | Sí                      | Sí     | No             | Browser            | media    |
| RLS                       | psql                  | `psql ... rls.integration.sql` | Sí                      | Sí     | PostgreSQL     | No                 | corta    |
| Flutter design            | flutter_test          | `pnpm flutter:check` parcial   | Sí                      | Sí     | No             | Flutter            | media    |
| Flutter POS native        | Flutter               | workflow                       | Sí, path/manual trigger | Sí     | No             | Flutter toolchains | media    |
| Performance/certificación | Node/Playwright/shell | scripts dedicados              | No                      | Sí     | frecuentemente | variable           | larga    |

**Clasificación:** VERIFIED.

**Evidencia:**

- Comando: lectura de scripts/workflows.
- Resultado: matriz anterior.
- Ruta: root package, workflows, Playwright configs.
- Fragmento: `authentication-e2e`.
- Conteo: 6 familias.

**Limitaciones:** CI remoto no ejecutado.

### Pregunta 26 — Certificaciones ejecutadas vs catalogadas

**Respuesta:** Metodología: cuenta test runner output/evidencia estructurada como ejecución; secciones narrativas solo como catálogo; estados PASS/FAIL/BLOCKED/NOT TESTED se conservan. Los artefactos previos contienen ejecuciones, pero no se recomputó un “total de escenarios” porque formatos y granularidad no son homogéneos. Se verificó directamente la existencia de 400 archivos test-like y evidencia secundaria por fase.

**Clasificación:** PARTIALLY VERIFIED.

**Evidencia:**

- Comando: inventario de reportes/artefactos y test files.
- Resultado: reports Part 1A–3B y directorios de evidencia.
- Ruta: `docs/PRODUCT_CERTIFICATION_*`, `artifacts/certification/`.
- Fragmento: estados explícitos por gate.
- Conteo: total ejecutado consolidado `UNKNOWN`; inventario de archivos 400.

**Limitaciones:** Sumar títulos, requests concurrentes o assertions produciría una cifra falsa.

### Pregunta 27 — OpenTelemetry

**Respuesta:** API y Worker inicializan SDK OTEL/OTLP; Collector local recibe traces/metrics/logs y exporta debug. Web/Flutter no muestran SDK OTEL productivo equivalente. No hay persistencia/backend/alertas productivos verificados.

**Clasificación:** PARTIALLY VERIFIED.

**Evidencia:**

- Comando: búsqueda dependencies/instrumentation/collector.
- Resultado: package observability, bootstrap API/Worker y Collector.
- Ruta: `packages/observability`, `apps/api/src/main.ts`, `apps/worker/src/main.ts`, `infra/otel/collector.yaml`.
- Fragmento: `OTEL_EXPORTER_OTLP_ENDPOINT`.
- Conteo: 2 runtimes Node instrumentados; 1 Collector local.

**Limitaciones:** Observabilidad productiva `NOT VERIFIED`.

## 7. Profundidad por dominio

Método: se inspeccionaron packages, módulos API, schema/migraciones, contrato, consumidores y tests. Los conteos de archivos/LOC por coincidencia textual son aproximados y no son puntuación. Detalle estructurado: `domain-depth.json`.

### Product

`DOMAIN LOGIC`. `packages/product`, módulo API y modelos Product/Variant/Category/Barcode/Price/Media/Outbox/Event. Incluye validación, effective pricing, media lifecycle, eventos, idempotencia/RLS y consumidores Web/Flutter; no es CRUD puro.

### Pricing

`DOMAIN LOGIC`. Integrado en Product/Sales: price kinds, vigencia y snapshots históricos. No es bounded package separado; las líneas/archivos atribuibles exclusivamente a “pricing” no son separables sin doble conteo.

### Inventory

`TRANSACTIONAL DOMAIN`. Ledger append-only, estados de stock, reservations, snapshots, counts, FIFO/cost layers, transfers, outbox/events, locks e idempotencia. SQL y pruebas cubren last-stock/overselling.

### Sales / Checkout

`FINANCIAL DOMAIN`. Aggregate/lifecycle, items, totals minor-unit, checkout, payment allocation, folios, idempotency, receipts, refund intents, outbox/events y coordinación Inventory/Cash.

### Payments

`FINANCIAL DOMAIN` como registro/autorización interna, no como acquiring. Intent/attempt, CASH/external acknowledgement, provider reference opcional, recovery/idempotency y conciliación; no captura provider real.

### Physical Cash

`FINANCIAL DOMAIN`. Registers/drawers/policies/sessions, append-only ledger, cash in/out, counts, reconciliations, variance, approvals, deposits/transfers, close protection, outbox/events, branch scope y RLS.

### Device

`TRANSACTIONAL DOMAIN`. Enrollment, credentials, authorization context, device outbox y POS Flutter con secure storage/SQLite/recovery. Distribución productiva no verificada.

### Refunds

`FINANCIAL DOMAIN`. Intents/lines, límites cantidad/monto, Cash/Payment/Inventory compensation, return destination, idempotency y eventos. Provider refund externo no implementado.

### Receipts

`FINANCIAL DOMAIN`. Snapshot histórico/folio único, generación idempotente y reprint sin nuevo receipt. Impresión física y fiscalización no equivalen al snapshot y no están verificadas productivamente.

### Reports

`DOMAIN LOGIC`. Aggregations read-only sobre Commerce para revenue, sales, payments, cash, inventory/time series; Web reports consume API. No hay warehouse/BI/materialized-view platform.

## 8. Preguntas específicas

### Pregunta 28 — Payments

**Respuesta:** No hay integración real con procesador. CASH usa ledger NEXO; CARD_EXTERNAL/BANK_TRANSFER/OTHER registran acknowledgement/reference externo. Hay port conceptual, pero no adapter/SDK, capture, settlement, refund provider ni chargeback.

**Clasificación:** PARTIALLY VERIFIED.

**Evidencia:**

- Comando: búsqueda de SDKs/providers y lectura del repository.
- Resultado: `provider: 'EXTERNAL_RECORD'`.
- Ruta: `packages/sales/src/ports.ts`, `apps/api/.../prisma-sales.repository.ts`.
- Fragmento: `PaymentProviderPort`; `CARD_EXTERNAL`.
- Conteo: 0 adapters de provider.

**Limitaciones:** No llamar procesamiento a un asiento/acknowledgement.

### Pregunta 29 — Inventory

**Respuesta:** Serialización combina transacciones PostgreSQL, locks/`FOR UPDATE` en rutas críticas, constraints/unique keys, idempotencia, reservation state machine y ledger append-only. Tests específicos intentan last-stock/overselling.

**Clasificación:** VERIFIED.

**Evidencia:**

- Comando: búsqueda `FOR UPDATE|idempotency|unique|reservation`.
- Resultado: controles en repository/migraciones/tests.
- Ruta: `apps/api/src/modules/inventory/infrastructure/prisma-inventory.repository.ts`, inventory migrations, `tests/e2e/*stock*`.
- Fragmento: row locks y unique constraints.
- Conteo: múltiples constraints/tests; detalle por archivo en inventario.

**Limitaciones:** No se afirma serializable global ni ausencia imposible de todo deadlock.

### Pregunta 30 — Cash

**Respuesta:** Están implementados apertura, sesión, cash in/out, venta cash, refund cash, expected/counted/variance, reconcile/close, bloqueo de postings pendientes, doble-close/version protection, branch scope y audit append-only.

**Clasificación:** VERIFIED.

**Evidencia:**

- Comando: inspección package/módulo/schema/migraciones/tests.
- Resultado: 16 tablas Cash creadas en migración base, más completion/delivery.
- Ruta: `packages/cash`, `apps/api/src/modules/cash`, cash migrations.
- Fragmento: `cash_ledger_entries`, `cash_sessions`, `cash_variances`.
- Conteo: 16 tablas en loop inicial.

**Limitaciones:** Operación física productiva/cliente real no verificada.

### Pregunta 31 — Offline

**Respuesta:** SQLite guarda catálogo/cache, cart drafts, payment recovery checkpoints y local outbox. Stable idempotency key se persiste; recovery consulta outcome autoritativo. Offline permite catálogo/borrador; bloquea finalizar venta/pago/refund financiero. Logout/login y tenant/branch se protegen mediante storage/contexto y tests.

**Clasificación:** VERIFIED.

**Evidencia:**

- Comando: búsqueda SQLite/offline/recovery/idempotency.
- Resultado: tablas `payment_recovery` y `local_outbox`.
- Ruta: `apps/nexo_pos/lib/core/local_database.dart`, `offline.dart`, `recovery.dart`, `pos_controller.dart`.
- Fragmento: `La venta no puede finalizarse offline`.
- Conteo: 4 archivos centrales, 16 test files Flutter totales.

**Limitaciones:** No hay sincronización financiera offline ni conflict merge general.

## 9. Infraestructura

### Pregunta 32 — Inventario productivo

**Respuesta:**

| Pieza                                          | Estado                             | Uso                | Cloud/alternativa        |
| ---------------------------------------------- | ---------------------------------- | ------------------ | ------------------------ |
| API/Web/Worker                                 | production-intended, no verificado | requeridos         | contenedor portable      |
| PostgreSQL                                     | requerido                          | autoridad/RLS      | self-hosted o managed    |
| Redis                                          | requerido por config actual        | abuso/coordinación | self-hosted o managed    |
| MinIO                                          | requerido por readiness/media      | objetos            | S3-compatible            |
| OTEL Collector                                 | opcional para negocio              | telemetría local   | backend OTEL             |
| Mailpit                                        | development-only                   | email local        | proveedor real pendiente |
| Reverse proxy/registry/secrets/backups/DNS/TLS | no implementado en repo            | producción         | UNKNOWN                  |
| Logging/metrics/tracing persistence            | no verificado                      | operación          | UNKNOWN                  |
| Flutter distribution                           | no implementada                    | cliente            | stores/MDM UNKNOWN       |

**Clasificación:** PARTIALLY VERIFIED.

**Evidencia:**

- Comando: `docker compose config --services`; inspección infra.
- Resultado: 10 servicios.
- Ruta: Compose, Dockerfiles, collector, foundation docs.
- Fragmento: servicios listados.
- Conteo: 10 Compose.

**Limitaciones:** “production-intended” no significa desplegado.

### Pregunta 33 — Compose/manifests

**Respuesta:** Solo `compose.yaml` y cuatro Dockerfiles son ejecutables. Sirven local/manual acceptance/CI y fueron certificados localmente según evidencia secundaria. No hay Compose productivo separado, Kubernetes ni cloud manifests.

**Clasificación:** PARTIALLY VERIFIED.

**Evidencia:**

- Comando: inventario de Docker/compose/IaC.
- Resultado: 1 Compose, 4 Dockerfiles.
- Ruta: raíz e `infra/docker/`.
- Fragmento: CI `docker compose up --build --wait`.
- Conteo: 5 manifests ejecutables.

**Limitaciones:** Ningún deployment productivo fue verificado.

### Pregunta 34 — Costo mensual

**Respuesta:** El repo no fija proveedor, región, sizing, HA, tráfico, retención ni precios; el total es UNKNOWN. Se entrega plantilla sin cifras para Compute, Database, Redis, Object Storage, OTEL, Registry, Backups, DNS/TLS, Email, Payment Provider, Monitoring y Bandwidth.

**Clasificación:** UNKNOWN.

**Evidencia:**

- Comando: búsqueda de manifests/provider/sizing/pricing.
- Resultado: sin BOM productivo costable.
- Ruta: `cost-assumptions.json`.
- Fragmento: variables con precio `null`.
- Conteo: 12 rubros.

**Limitaciones:** Requiere cotización real; no se consultó Internet ni se inventó total.

## 10. Matriz de afirmaciones UMI

| Claim                                  | Verdict             | Evidencia / comando / archivo                          | Limitación                                   |
| -------------------------------------- | ------------------- | ------------------------------------------------------ | -------------------------------------------- |
| “NEXO no tiene HEAD resoluble.”        | CONFIRMED           | `git rev-parse HEAD` 128; `.git/`                      | Puede existir otro repo no entregado         |
| “NEXO no tiene producción verificada.” | CONFIRMED           | sin deploy/IaC; Compose local                          | producción externa desconocida               |
| “NEXO no tiene clientes.”              | NOT VERIFIABLE      | fixtures/seeds no prueban clientes                     | ausencia de evidencia no prueba inexistencia |
| “NEXO no tiene rollback.”              | PARTIALLY CONFIRMED | 0 commits/deploy rollback; reinicio local existe       | rollback externo desconocido                 |
| “NEXO no tiene KDS.”                   | CONFIRMED           | búsqueda runtime: solo feature/seed                    | KDS pertenece a UMI por estrategia           |
| “NEXO no tiene loyalty.”               | CONFIRMED           | solo registry/contract feature                         | no aggregate/runtime                         |
| “NEXO no tiene Gift Cards.”            | PARTIALLY CONFIRMED | enums `GIFT_CARD`/future; sin aggregate                | placeholders existen                         |
| “NEXO no tiene RAG.”                   | CONFIRMED           | sin módulo/dependency RAG                              | coincidencias textuales irrelevantes         |
| “NEXO solo tiene sink UMI local.”      | PARTIALLY CONFIRMED | `docs/UmiSalesIntegrationFoundation.md`, outbox mapper | integración runtime UMI no verificada        |
| “NEXO tiene Inventory avanzado.”       | CONFIRMED           | ledger/reservations/counts/transfers/cost/RLS/tests    | producción no verificada                     |
| “NEXO tiene Cash físico.”              | CONFIRMED           | package/módulo/tablas/ledger/tests                     | uso real no verificado                       |
| “NEXO tiene Flutter funcional.”        | PARTIALLY CONFIRMED | app, SQLite, API client, tests/workflow                | distribución/producción no verificada        |
| “NEXO tiene OpenAPI y SDK.”            | CONFIRMED           | OpenAPI 3.1.1/145 ops; SDK generator/check             | Git versioning bloqueado                     |
| “NEXO tiene OpenTelemetry.”            | PARTIALLY CONFIRMED | API/Worker + Collector local                           | backend/alertas productivos ausentes         |

## 11. Inventario preliminar de portabilidad

| Componente                                         | Clasificación                           | Dependencia/condición                    |
| -------------------------------------------------- | --------------------------------------- | ---------------------------------------- |
| OpenAPI y schemas de error/money/idempotency       | REUSE AS-IS / ADAPT                     | conservar compatibilidad y ownership     |
| Tests de invariantes financieros/stock             | ADAPT                                   | fixture/auth/DB harness NEXO             |
| Packages domain puros Product/Inventory/Sales/Cash | ADAPT                                   | ports TS reutilizables; adapters cambian |
| Controllers/modules API                            | PORT DESIGN                             | NestJS, middleware/contexto              |
| Repositories                                       | PORT DESIGN                             | Prisma, PostgreSQL, SQL/RLS              |
| Schema/migraciones                                 | PORT DESIGN                             | no copiar a DB UMI; tenant/ownership     |
| RLS policies/roles                                 | ADAPT                                   | PostgreSQL y modelo Tenant NEXO          |
| Worker/outbox                                      | ADAPT                                   | PostgreSQL leases y contratos            |
| Media                                              | ADAPT                                   | MinIO/S3                                 |
| Rate limiting/coordinación                         | ADAPT                                   | Redis                                    |
| SDK TypeScript                                     | REUSE AS-IS mientras OpenAPI permanezca | contrato NEXO                            |
| Flutter UI/design system                           | REUSE AS-IS                             | visualmente desacoplado                  |
| Flutter transport/mappings                         | ADAPT                                   | rutas OpenAPI NEXO/manual mappings       |
| Flutter SQLite recovery                            | ADAPT                                   | payment outcome/idempotency contract     |
| Web Admin                                          | ADAPT                                   | SDK/auth/context NEXO                    |
| Placeholders KDS/Loyalty/Gift Card                 | RETIRE del runtime NEXO                 | ownership UMI                            |
| Integración provider payment/CFDI                  | UNKNOWN                                 | no implementada                          |

Invariantes a conservar: minor units exactos; server-authoritative totals/actor/timestamps; idempotency key+fingerprint; payment ≤ sale; refund ≤ captured/quantity sold; receipt snapshot inmutable/folio scoped; inventory ledger append-only/reservas/compensación exactly-once; Cash ledger append-only/sesión/variance; tenant RLS y branch ABAC; outbox after commit.

## 12. Riesgos y bloqueadores

1. Procedencia bloqueada: 0 commits, HEAD no resoluble, sin remote/upstream.
2. No existe baseline versionado para diff, autoría, rollback o reproducción histórica.
3. Producción, clientes, dinero, CI remoto y telemetría productiva no verificados.
4. Backup/restore, alertas, on-call, SLO y deployment cloud no implementados en el repo.
5. Portado seguro requiere resolver ownership/modelo Tenant y preservar invariantes/RLS antes de trasladar schema.
6. Flutter mezcla contrato y mappings manuales; cambiar backend exige adaptación y drift tests.
7. Payments externo es acknowledgement, no integración provider; CFDI/settlement/chargeback no existen.

## 13. Limitaciones

- `UMIPOS_RESOLUCION_ARQUITECTURA.md` no está disponible.
- Repositorios/remotes UMI relacionados no fueron parte de esta auditoría salvo documentos locales.
- Sin credenciales, producción, datos reales ni CI remoto.
- Git history incompleto/inexistente en la entrega.
- Shell host: Node 12.22.9 y `pnpm` ausente del PATH; no se instaló toolchain.
- No se ejecutaron suites que requirieran modificar/resetear DB o Docker volumes.
- Ambiente examinado es local; reportes de certificación son evidencia secundaria.
- Conteos RLS estáticos no expanden bucles SQL.

## 14. Archivos y comandos revisados

Listados completos:

- `artifacts/architecture/nexo-formal-response-to-umi/files-reviewed.txt`
- `artifacts/architecture/nexo-formal-response-to-umi/commands-executed.txt`

Artefactos JSON: procedencia, producción, multi-tenancy, autorización, RLS, OpenAPI, SDK, Flutter, tests, CI, profundidad, infraestructura, deployment, costos, limitaciones y archivos creados.

## 15. Conclusión factual

Está demostrado en el repositorio: código funcional y tests profundos de Commerce; multi-tenancy con RLS/ABAC; roles no-superuser/NOBYPASSRLS; OpenAPI 145 operaciones sin duplicados; SDK con drift check; Flutter con SQLite/recovery y finanzas offline bloqueadas; imágenes/Compose ejecutables localmente; CI declarada para quality, migrations/RLS, E2E, Flutter, CodeQL y builds.

No está demostrado: procedencia Git, autoría/evolución, producción activa, clientes, dinero real, ejecución CI remota, deployment/publishing, backups/restores, DNS/TLS, alertas/on-call/SLO, provider payments, CFDI/PAC, observabilidad productiva o costo mensual.

Necesita evidencia adicional: repositorio canónico con historial/remotes; ejecuciones CI firmadas; inventario y acceso read-only de producción; deployment/IaC; restore drill; telemetría/alertas; evidencia sanitizada de clientes/transacciones; contratos con payment/email/CFDI providers.

Bloquea un portado seguro: ausencia de baseline/procedencia; falta de decisión y mapping explícito para Tenant/Branch/Identity autoritativos; acoplamientos Prisma/PostgreSQL/RLS/NestJS/Redis/MinIO; preservación verificable de invariantes financieras, inventory/cash ledgers, idempotencia, folios y tests. No se recomienda aún arquitectura final.
