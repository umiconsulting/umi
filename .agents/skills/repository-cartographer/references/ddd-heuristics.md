# DDD Detection Heuristics

Operational rules for the domain layer (Layers 3, 4, 7). Sources and the full
documented-fact / tradeoff / invalidation for each are in `research-basis.md`. Every rule
here is a **prior** unless it rests on a hard structural fact (an FK action, a decorator).
The recurring failure mode (from the skeptic audit) is heuristics that over-fire — so each
rule below states its **positive discriminator** and what **invalidates** it.

## Entity
- **Prior:** a table with a PK + `created_at/updated_at/status`.
- **Discriminator (required):** identity is *used elsewhere* — looked up by id (`findById`),
  compared by id, or referenced by an FK id from another aggregate. Audit columns alone are
  near-universal and do NOT make something an entity.
- **Invalidates:** compared/deduped by value → Value Object; no identity surviving attribute
  change (projection/DTO/view) → not an entity; a cascade-only child never referenced by its
  own id → aggregate-internal part.

## Value Object
- **Signals:** `readonly`/`Object.freeze`, `equals()`, parse/normalize/factory functions
  (`normalizePhone`, `Money.of`, integer-cents money), `@IsISO8601`/E.164 DTO fields.
- **Framing:** in a primitive-obsessed codebase, VOs appear as the **seam** (the normalize/
  parse helper, the cents column) rather than as wrapper types. Do **not** infer VOs from
  "prefixed embedded columns" — that textbook signal over-fires and is dropped.
- **Invalidates:** own PK / referenced by id → Entity; mutated in place → not a VO.

## Aggregate & Aggregate Root
- **Aggregate:** the set of tables co-mutated inside one transaction callback, and/or a
  FK-cascade cluster (child → root, `ON DELETE CASCADE`, no controller of its own).
- **Root:** a table that directly owns ≥1 child via cascade; reported at **each level**
  (aggregates don't nest — `programs` owns `accounts`, `accounts` owns `cards`, the **card**
  owns its ledger and is the transactional root). Corroborators: a `*.repository.ts` for the
  root; `queue.outbox_events.aggregate_type` values enumerate the roots the code recognizes.
- **Invalidates:** tables reconciled asynchronously belong to different aggregates; a child
  with its own controller/route is a boundary leak; a cascade to a config/catalog table is a
  reference, not ownership.

## Repository / Services
- **Repository:** `*.repository.ts`, holds `PgService`/`PrismaClient`, `findById/insert/…`,
  raw SQL concentrated here. Umi caveat: repos are anemic and not one-per-root.
- **Domain vs Application service** `[prior]`: injecting a repository/PgService/Http suggests
  *application*; a stateless `*.logic.ts` operating on domain values suggests *domain*. This
  is a prior, not a verdict — NestJS DI makes almost everything inject something.

## Aggregate = transaction boundary (Vernon)
One aggregate per transaction; reference other aggregates by id; update others via eventual
consistency. **Violation:** one transaction writing >1 distinct aggregate root (beyond one
root + its cascade children + a single outbox insert). **Correct pattern:** state write +
one `queue.outbox_events` insert in the same transaction, drained asynchronously.
**Non-violation:** order+items, card+ledger in one transaction.

## Context Map relationships
Detected from integration shape, not names (`research-basis.md` §A has the definitions):

| Relationship | Positive signal | Distinguisher |
|---|---|---|
| Open Host Service | ≥3 public controllers (CORS allowlist corroborating), stable/aliased routes | serves *many* consumers via one protocol |
| Customer/Supplier | downstream targets upstream via `*_API_BASE` env; upstream evolves for it | upstream *changes to serve* downstream |
| Conformist | downstream renders upstream DTO shape 1:1, **no** mapper | absence of a translation layer |
| Anti-Corruption Layer | `*.adapter.ts`/`integrations/`; external SDK confined; `toDomain`/mapper | translation present at the boundary |
| Published Language | `*.dto.ts`, outbox payload schema, byte-exact wire formats (QR/JWT) | documented shared contract |
| Shared Kernel | same domain table written by ≥2 apps (dual-writer) + shared migration/trigger design | co-owned **model+DB**, not shared secrets |
| Separate Ways | zero cross-import, no integration edge | genuinely decoupled |

**Audit corrections baked in:** shared secrets/wire formats are **Published Language**, not
Shared Kernel; reserve Shared Kernel for dual-writer tables. A dual-writer flagged only via a
single legacy file (e.g. a dead `server.js`) is **low confidence**.
