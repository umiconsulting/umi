# The Seven Layers — Detection Signals

How each layer is *detected* (the operational companion to `research-basis.md`, which
holds the sources and the "why"). Signals are deterministic unless marked `[prior]`.

## Table of contents
1. [Filesystem](#1-filesystem)
2. [Business modules](#2-business-modules)
3. [Domain / DDD](#3-domain--ddd)
4. [Ownership](#4-ownership)
5. [Dependencies](#5-dependencies)
6. [Transaction boundaries](#6-transaction-boundaries)
7. [Context map](#7-context-map)

## 1. Filesystem
`lib/walk.mjs`. Recursive walk; classify by extension (js/ts/tsx, sql, prisma, swift).
**Excluded:** `node_modules`, `dist`, `.next`, hidden dirs (`.git/.github/.claude/.agents`),
`backups/artifacts`, `*.bak/*.dump`, and `build`/`out` **only** when they sit at a package
root (has `package.json`) — so `docs/migration/build/*.sql` is kept. SQL is tagged
`primary` vs `reference` (dumps, `**/migrations/**` history, staging, compat shims); the
domain layers use `primary` only.

## 2. Business modules
`moduleOf()` in `walk.mjs`. A module is the component unit, not a raw folder: strip a
code-root (`src/app/lib/Sources`) and the `supabase` project dir, then take one segment —
or two for container dirs (`modules/`, `shared/`, `features/`, `screens/`, `functions/`).
NestJS `@Module` classes (via `adapters/nestjs.mjs`) enrich the module list. Loose files
directly under a code root collapse into a `<app>:.` bucket — cycles touching it are
flagged low-confidence.

## 3. Domain / DDD
`lib/domain-classify.mjs` + `adapters/nestjs.mjs`. Structural roles: `*.repository.ts` /
class `*Repository` = Repository; `@Controller` = controller; `*.service.ts` = service
with a `[prior]` domain-vs-application guess (injects `PgService`/`Repository`/`Http` ⇒
application) — confirm domain services via stateless `*.logic.ts`; `*.adapter.ts` /
`integrations/` / a confined integration SDK = Anti-Corruption Layer. Entities/value
objects/aggregates: see `ddd-heuristics.md`.

## 4. Ownership
`lib/sql-schema.mjs` (`parseSql` + `ownership`) and `lib/prisma-parse.mjs`. Parse
`CREATE TABLE`, inline/table-level/`ALTER` FKs, and `ON DELETE` actions (dollar-quote-aware
statement split; string literals blanked so a DEFAULT/CHECK can't fake an FK). **CASCADE to
a domain parent ⇒ parent owns child; SET NULL / nullable / NO ACTION ⇒ reference (boundary).**
Excluded from ownership: system schemas (`auth/storage/realtime/…`), the multitenancy
`tenant_id → tenants` cascade, and `*_by`/`user_id` attribution FKs. A child with multiple
cascade parents is resolved deterministically, preferring the non-config parent (a config/
catalog cascade is a reference, not ownership). Append-only tables are detected from triggers
(any timing) whose name or executed function matches append-only/immutable/restrict-mutation/
no-update/no-delete patterns (e.g. `block_append_only_mutation`).

## 5. Dependencies
`lib/graph.mjs` over the file→module rollup of `lib/ts-graph.mjs` edges. Edges carry
`typeOnly`/`dynamic`/`test` flags; the runtime graph keeps value+dynamic edges only.
- **Cycles:** Tarjan SCC (size > 1) → Johnson elementary circuits (capped at 200/SCC).
- **Coupling:** `Ca` (afferent), `Ce` (efferent), instability `I = Ce/(Ca+Ce)`; SDP
  violations = edges from lower to higher instability.
- **Centrality:** degree (= `Ca`/`Ce`) and Brandes betweenness (chokepoint/broker).
- **Dead:** no incoming edge of **any** kind (value/type/test) and not an entrypoint
  (bootstrap roots, Next.js `page/layout/route/…`, route groups `(name)`, `api/`).

## 6. Transaction boundaries
`transactionBoundaries()` in `domain-classify.mjs`. Find `.withTenant/.runWithTenant/
.workerTx/.$transaction/.transaction(` callbacks, isolate the balanced callback body (string/comment
aware), collect `INSERT/UPDATE/DELETE <schema.table>`, map each table to its **nearest
aggregate root**, and flag when >1 distinct root is written (excluding the outbox) or when
external I/O appears inside the transaction. **Blind spot:** writes done via a helper
method called inside the callback are not seen (noted in the report). If no ownership model
is in scope, hotspot detection is disabled (it would be unreliable).

## 7. Context map
`contextMap()` in `domain-classify.mjs`. Bounded contexts = apps (`apps/*`) + Postgres
schema namespaces. Relationships:
- **Open Host Service** — the app with the most controllers (≥3); a `CORS_ORIGINS` allowlist is noted as corroborating evidence when present, not required.
- **Customer/Supplier** — an app referencing another via `*_API_BASE`/`apiBase` env.
- **Anti-Corruption Layer** — an integration SDK (twilio/anthropic/passkit/…) confined to an adapter.
- **Published Language** — `*.dto.ts` contracts + the outbox event payload schema.
- **Shared Kernel** — a domain table written by ≥2 apps (dual-writer); infra/multitenancy
  tables excluded; a single-file writer (possible dead/legacy shim) → `[prior]` low confidence.
  Prisma-ORM writes are not counted (a known under-count).
- **Separate Ways** — apps with no cross-app import and no integration edge.
