---
name: repository-cartographer
description: Build a factual architectural metadata graph of a codebase — like PostgreSQL's system catalog for a repo — then report the architecture as knowledge, not documentation. Use this skill whenever the user wants to understand a codebase's real structure, module/domain/dependency map, aggregate roots, data ownership, transaction boundaries, bounded contexts / context map, dependency cycles, coupling, dead code, or "how is this system actually organized". Trigger it for onboarding onto an unfamiliar repo, architecture review, DDD analysis, detecting cyclic dependencies or layering violations, planning a refactor or extraction, or any "map/analyze/reverse-engineer this repository" request — even when the user does not say the word "cartographer". Deterministic-first (AST/SQL/imports), zero-install (Node + the repo's own TypeScript); LLM narration (optionally embedding-assisted) is a separate step that only explains the graph, never builds it.
---

# Repository Cartographer

Think about how PostgreSQL answers a query. It does not scan every table first — it
consults its **system catalog** (`pg_class`, `pg_attribute`, `pg_namespace`,
`pg_constraint`): metadata that says which relations exist, which table owns which
index, which foreign key exists. Only then does it touch data.

A Repository Cartographer does the same for a codebase. It builds a **factual
metadata graph** — not prose documentation, a graph — and derives architectural
knowledge from it. Directory names are treated as noise (`utils/`, `common/`,
`shared/` mean nothing); meaning is **inferred from real signals**: imports, exports,
decorators, SQL DDL, foreign keys, transaction callbacks, routes, config.

## When to use
Onboarding onto an unfamiliar repo; architecture/DDD review; finding dependency
cycles, coupling hot-spots, layering violations, transaction hotspots, dead code, or
data-ownership boundaries; planning an extraction/refactor. Use it whenever the ask is
"understand / map / analyze the structure of this codebase".

## Core principles
- **Deterministic first.** The graph is built from AST + SQL + imports + migrations +
  config. It is *factual*. LLM narration (optionally embedding-assisted) is a **separate**
  step that reads `catalog.json` to explain the graph in prose — it never invents nodes or
  edges. Do not skip to LLM summarization; run the analyzer.
- **Zero-install.** Pure Node (ESM) + the `typescript` package the target repo already
  has (auto-resolved). No madge / ts-morph / dependency-cruiser, no network, no install.
- **Ignore names, infer relationships.** A folder called `shared/` is not a domain; a
  file called `order.service.ts` is not automatically a domain service. Classify from
  signals, and label every inferred (non-factual) conclusion as a **prior**, not a fact.
- **Output is architectural knowledge, not code and not docs.** The deliverable is the
  9-section report + `catalog.json`, not generated source.

## How to run

```bash
node <skill>/scripts/cartograph.mjs <repo-root> [--out <dir>] [--json] [--quiet]
```
- Writes `catalog.json` (the machine "system catalog") + `report.md` (the 9-section
  human report) to `<out>` (default `<repo>/.cartographer`), and prints the report to
  stdout (`--json` prints the catalog instead).
- Runs offline in ~1s on a mid-size monorepo. Node ≥18.
- Point it at the **whole repo** when possible: the ownership layer needs the schema
  DDL, which often lives outside the app directories (e.g. `docs/migration/**`). Running
  on a subdirectory whose DDL is elsewhere disables ownership analysis (the report says so).

Then, if asked to explain the map in prose, read `catalog.json` and narrate it — the
facts come from the catalog, your job is only to make them legible.

## The seven layers

The engine maps the repo at seven levels of meaning (detection signals per layer are in
`references/layers.md`; the DDD detection rules — aggregates, value objects, the context
map — are in `references/ddd-heuristics.md`):

1. **Filesystem** — files by language, with build output / dumps / vendored code excluded.
2. **Business modules** — the architecturally meaningful component unit (NestJS features, folder rollups), not raw folders.
3. **Domain / DDD** — entities, value objects, aggregates, repositories, domain vs application services — inferred, marked as priors.
4. **Ownership** — who owns which data, from FK `ON DELETE CASCADE` (owns) vs `SET NULL`/nullable FK (references). The strongest ownership signal; the multitenancy `tenant_id` cascade is excluded as noise.
5. **Dependencies** — the import graph: Tarjan SCC cycles, Johnson elementary circuits, Ca/Ce/instability, degree + Brandes betweenness centrality. Type-only and test-only edges are excluded so they cannot fake a cycle.
6. **Transaction boundaries** — which aggregate roots are written together in one transaction (`.withTenant/.runWithTenant/.workerTx/.$transaction/.transaction` callbacks); multi-root transactions and in-transaction external I/O are flagged as candidates to split via events/outbox.
7. **Context map** — bounded contexts (apps + schema namespaces) and their Evans relationships: Open Host Service, Customer/Supplier, Conformist, Anti-Corruption Layer, Published Language, Shared Kernel, Separate Ways.

## The output report (9 sections)

`report.md` always has these sections (empty ones say so — a clean result is a real
result). Exact template + wording in `references/report-template.md`:

1. Business Capabilities · 2. Aggregate Roots · 3. Most Central Module · 4. Highest
Coupling · 5. Suspicious Dependencies · 6. Cycles · 7. Transaction Hotspots · 8. Dead
Modules · 9. Missing Boundaries.

Every run begins with **soundness caveats** — the static graph misses DI-container /
dynamic-`import()` / Deno remote-URL wiring, DDD labels are priors, dumps/migration-
history SQL is set aside. Present findings with their confidence; never launder a prior
into a fact.

## Reading the results honestly
- A stable, widely-depended-on sink (high afferent coupling, instability ≈ 0 — e.g. a DB
  access module) is **healthy**, not a defect.
- Cycles are reported at **component (folder-rollup)** granularity; a framework module
  graph (e.g. NestJS `@Module`) can be acyclic while folder rollups show a cycle —
  the report distinguishes them.
- A transaction hotspot is a **candidate for review**, not an automatic bug; genuinely
  single aggregates (order+items, card+ledger) legitimately share one transaction.

## Extending to another language / framework
Add a parser under `scripts/lib/` or `scripts/adapters/` and wire it into
`cartograph.mjs`. Per-language signal references are in `references/language-adapters.md`.

## Research basis
Every structural claim (DDD concepts, cycle/coupling theory, FK ownership semantics,
transaction/saga boundaries, the static-analysis techniques) is backed by primary/
official sources in `references/research-basis.md`, using the documented-fact /
source-backed-tradeoff / inference separation. Read it before changing a heuristic.
