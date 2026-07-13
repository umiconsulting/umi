# Research Basis — Repository Cartographer

Every structural claim this skill makes is backed here by a **primary or official
source**, using the `scientific-research-check` discipline: each entry separates
**documented fact** (what the source says) from **source-backed tradeoff** from
**Umi-specific inference** (what we conclude about this repo — *not* carried by the
cited source), and states **invalidation criteria**. Popularity is never a reason.

> **Provenance note.** The DDD and dependency-graph claims below were independently
> audited by a skeptic pass; its narrowings are folded in and marked `[audit]`.
> The ownership/transaction and tooling claims were **not** in that automated audit
> pass (a truncation bug limited it to two clusters) — they rest on official
> PostgreSQL/TypeScript/NestJS/Prisma/Deno docs, which are high-provenance, but treat
> their *detection heuristics* with the same "prior, not verdict" caution.

## Table of contents
- [A. Domain-Driven Design (Layers 3, 4, 7)](#a-domain-driven-design)
- [B. Dependency structure (Layer 5)](#b-dependency-structure)
- [C. Ownership & transaction boundaries (Layers 4, 6)](#c-ownership--transaction-boundaries)
- [D. Static-analysis tooling (all layers)](#d-static-analysis-tooling)

---

## A. Domain-Driven Design

Primary sources: Eric Evans, *Domain-Driven Design* (2003) and the *DDD Reference*
(2015, domainlanguage.com); Vaughn Vernon, *Implementing Domain-Driven Design*
(2013) and *Effective Aggregate Design* I–III (2011, dddcommunity.org). Fowler's
bliki entries (`DDD_Aggregate`, `BoundedContext`) are authoritative **secondary**
practitioner sources `[audit: not "primary"]`.

**Entity.** *Fact:* "distinguished by its identity, rather than its attributes"
(Evans, DDD Reference). *Detect:* identity used elsewhere — looked up by id
(`findById`), compared by id, referenced by FK id from another aggregate.
*[audit] A primary key plus `created_at/updated_at/status` is a WEAK prior only* —
audit columns are near-universal, so they cannot by themselves distinguish an
entity from a projection or a child row. *Invalidation:* compared by value not id →
Value Object; no identity surviving attribute change → not an entity.

**Value Object.** *Fact:* "you care only about the attributes… treat as immutable…
side-effect-free" (Evans). *Detect:* `readonly`/`Object.freeze`, `equals()`,
parse/normalize factories (`normalizePhone`, `Money.of`), integer-cents money.
*[audit] Drop the "embedded prefixed columns" signal* — Umi is primitive-obsessed
and has almost no first-class VOs; frame VOs as the primitive-obsession **seam**,
not as discoverable wrapper types. *Invalidation:* has own PK / referenced by id →
Entity; mutated in place → not a VO.

**Aggregate & Aggregate Root.** *Fact:* "Cluster entities and value objects into
aggregates… choose one root… external references to the root only… use the same
boundaries to govern transactions" (Evans). *Detect:* tables co-mutated inside ONE
transaction callback; FK-cascade cluster (child → root, `ON DELETE CASCADE`, no
controller of its own); a per-root repository; `queue.outbox_events.aggregate_type`
enumerates the roots the code already reasons about. *Umi:* the card aggregate =
`loyalty.cards` + `points_ledger` + `wallet_transactions` + `balances`; `ops.orders`
+ `order_items`. *Invalidation:* tables reconciled asynchronously belong to
different aggregates; a child with its own controller is a boundary leak.

**Repository.** *Fact:* Evans, Repositories — "encapsulate… the means of finding…
objects." *Detect:* `*.repository.ts`, class `*Repository`, holds `PgService`/
`PrismaClient`, methods `findById/list/insert`, raw SQL concentrated here.
*Umi caveat:* repos are anemic (return row DTOs) and not strictly one-per-root.

**Domain vs Application Service.** *Fact:* Evans/Vernon (Services). *[audit] The
"injects a repository ⇒ application service" rule is a PRIOR, not a verdict* — a
domain service may take a read repository, and NestJS DI makes nearly every service
inject something. *Detect domain services* via stateless `*.logic.ts` pure modules
operating on domain values.

**Bounded Context.** *Fact:* Evans/Fowler — a boundary within which a model is
unambiguous. *Detect on three axes:* deployable apps (`apps/*`), Postgres schema
namespaces, and per-app persistence stacks; polysemy (Customer vs Person vs Contact)
signals distinct contexts. *Invalidation:* a folder with no distinct model is a
module, not a context.

**Context Map relationships** (Evans). Detection signals per relationship:
- **Open Host Service** — one app, many public controllers, a CORS allowlist, stable/versioned routes serving multiple consumers.
- **Customer/Supplier** — downstream targets an upstream via API base-url env AND the upstream evolves to serve it.
- **Conformist** — downstream renders the upstream's DTO shape 1:1 with **no** translation layer.
- **Anti-Corruption Layer** — `*.adapter.ts` / `integrations/*` translating an external SDK/webhook DTO into internal types; the external SDK is confined to that module.
- **Published Language** — documented DTO/event contracts (class-validator DTOs, outbox payload schema, byte-exact wire formats like the QR token). *[audit] shared secrets/formats are Published Language, NOT Shared Kernel.*
- **Shared Kernel** — genuinely co-owned model **and** DB: the same domain tables written by ≥2 apps (dual-writer), shared migration/trigger design. *[audit] reserve for dual-writer tables, not duplicated constants.*
- **Separate Ways** — two contexts with zero cross-import and no integration edge.

**Aggregate = transaction boundary.** *Fact:* Vernon, *Effective Aggregate Design*
— "one aggregate per transaction; reference other aggregates by identity; update
other aggregates via eventual consistency." *Detect violations:* a transaction
writing >1 distinct root (beyond one root + its cascade-children + an outbox row);
a repository returning a foreign aggregate's object graph. *Non-violation:* one root
+ children + a single outbox insert.

---

## B. Dependency structure

**SCC / cycles.** *Fact:* Tarjan, *Depth-First Search and Linear Graph Algorithms*,
SIAM J. Comput. 1(2), 1972 — SCCs in O(V+E); the condensation is a DAG. *Detect:*
any SCC of size >1 is a dependency cycle; the condensation gives a valid build order.

**Elementary circuits.** *Fact:* Donald B. Johnson, *Finding All the Elementary
Circuits of a Directed Graph*, SIAM J. Comput. 4(1), 1975. *Detect:* run Johnson on
each non-trivial SCC to list concrete "break-here" loops. *Invalidation:* circuit
count is worst-case super-exponential — **always cap** enumeration.

**Why cycles are bad (ADP).** *Fact:* R. C. Martin, *OO Design Quality Metrics*
(1994) + *Agile PPP* (2002) / *Clean Architecture* (2017) — the Acyclic Dependencies
Principle: the component dependency graph should be a DAG; break cycles with
Dependency Inversion or a new shared component. *[audit] State ADP as Martin's
NORMATIVE principle, not empirically-proven harm* — attribute the harm rationale
(build/test/release-coupling) to Martin's argument.

**Coupling / instability.** *Fact:* Martin — afferent `Ca` (incoming), efferent
`Ce` (outgoing), instability `I = Ce/(Ca+Ce)`; Stable Dependencies Principle:
depend in the direction of stability (toward lower `I`). *Detect:* rank raw coupling
by `Ca+Ce`; flag SDP violations where an edge points from lower to higher `I`.
*Invalidation:* `I` undefined when `Ca+Ce=0` (guard the division); a high-`Ca`,
`I≈0` sink (e.g. `shared/database`) is **healthy**, not a defect.

**Centrality.** *Fact:* Freeman, *A Set of Measures of Centrality Based on
Betweenness* (1977); Brandes, *A Faster Algorithm for Betweenness Centrality*
(2001), O(V·E). *Detect:* degree centrality = `Ca`/`Ce` (hub view); betweenness =
the chokepoint/broker whose change has widest reach. *Invalidation:* betweenness
formulas assume a chosen directed/undirected + normalization convention; high
centrality is descriptive, not automatically a defect.

---

## C. Ownership & transaction boundaries

Official PostgreSQL docs (v17): Foreign Keys (§5.5.5), CREATE TABLE `ON DELETE`,
Transaction Isolation (Ch. 13), Explicit Locking (§13.3). Plus Garcia-Molina &
Salem, *Sagas*, SIGMOD 1987 (DOI 10.1145/38713.38742); Vernon EAD (eventual
consistency); the transactional-outbox pattern.

**Ownership from FK actions.** *Fact:* `ON DELETE CASCADE` deletes children with the
parent; `SET NULL`/`NO ACTION`/`RESTRICT` do not. *Infer:* cascade to a **domain**
parent = the parent **owns** the child (aggregate part); `SET NULL` / nullable FK =
the child **references** an independent aggregate (a boundary). *Invalidation:*
cascade to a **multitenancy** root (`core.tenants`) is cleanup convention, NOT
ownership — exclude it; a `NOT NULL` FK with `NO ACTION` is a required reference,
still not ownership; a `*_by`/`staff_member_id` FK is attribution, not ownership.

**What belongs in one transaction.** *Fact:* Postgres default isolation is Read
Committed; lost updates on read-modify-write need `FOR UPDATE` or an absolute
recompute. *Umi:* balances are `SUM(delta)` over an append-only ledger + `FOR UPDATE`
on the card row → correct under Read Committed. *Invalidation:* external I/O inside a
transaction can't be rolled back — it does not belong there regardless of isolation.

**When NOT to share a transaction (Saga/outbox).** *Fact:* Garcia-Molina & Salem —
a saga is a sequence of local transactions with compensations; Vernon — update other
aggregates by eventual consistency. *Detect:* a transaction writing multiple
aggregate roots is a hotspot → split via `queue.outbox_events` drained
asynchronously; an outbox insert as the sole cross-aggregate write is the **correct**
pattern. *Invalidation:* do NOT split a genuine single aggregate (order + items,
card + ledger) into a saga — that adds compensation complexity for no benefit.

---

## D. Static-analysis tooling

**TypeScript Compiler API.** Official: microsoft/TypeScript wiki "Using the Compiler
API"; Handbook Module Resolution; TSConfig `paths`. *Use:* `ts.createSourceFile` +
`ts.forEachChild`; read `ImportDeclaration`/`ExportDeclaration`/`require`/dynamic
`import()`; `importClause.isTypeOnly` for edge kind; `ts.getDecorators` (TS5) for
NestJS. *Invalidation:* no semantic analysis — non-literal specifiers and shadowed
`require` can't be resolved; pin the version (we use whatever `typescript` the target
repo already has → zero-install).

**NestJS.** Official docs — Modules, Custom providers, Dynamic modules. *Use:*
`@Module {imports,controllers,providers,exports}`, `@Controller` prefix, constructor
DI. *Invalidation:* dynamic modules (`forRoot`), `useFactory`, spreads, `@Global`,
and string/symbol tokens are **not** fully statically visible — flag as dynamic.

**Prisma.** Official schema reference + referential actions + relation mode. *Use:*
block-scan `model`, `@relation(fields/references/onDelete)`. *Invalidation:* count
only the owning side (has `fields`+`references`); absence of `onDelete` ≠ NoAction;
`relationMode="prisma"` = no DB FK; `@@map/@@schema` ≠ real names — reconcile with
the SQL layer, don't trust Prisma delete semantics over DB triggers.

**Deno.** Official docs — Modules & import maps; WICG Import Maps. *Use:* bucket
specifiers (relative / `http(s)://` / `npm:`/`jsr:`/`node:` / bare→import-map).
*Invalidation:* Deno needs explicit extensions (no Node stripping); `deno.json` is
JSONC.

**Swift.** Official: swift.org Declarations grammar; swiftlang/swift Modules.md.
*Use:* anchored regex for `import` and `struct/class/actor/enum/protocol` after
comment stripping + brace-depth tracking. *Invalidation:* no lexer → fooled by
strings, `#if`, macros, `class func`; emit file→module and file→type edges only,
never symbol→module attribution.
