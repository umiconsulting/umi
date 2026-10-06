# Output Report Template

`scripts/lib/report.mjs` renders `report.md` in exactly this shape from `catalog.json`.
The report is **architectural knowledge**, not documentation and not generated code. Every
section always appears; an empty section states that explicitly (a clean result is a real
result). The header carries the file/module counts and the **soundness caveats** — never
drop those.

```
# Repository Cartography — <repo>

_Factual metadata graph (deterministic-first). <N> files: <by language>. <M> modules, <E> runtime edges._

## Soundness caveats
- Static import scan only (misses DI/dynamic-import/Deno-URL wiring)…
- Type-only + test-only edges excluded from cycle/coupling analysis…
- DDD role/ownership/context-map labels are inferred priors, not facts…
- Swift/Prisma parsed heuristically…
- <N> reference/historical SQL files excluded; system schemas always excluded (if any).

## 1. Business Capabilities
Data domains (Postgres schemas) · backend feature modules · deployable contexts (apps).

## 2. Aggregate Roots
Each root → the children it directly owns (+ owning repository, if one exists).
(If no authoritative DDL is in scope, this is disabled with a note.)

## 3. Most Central Module
Highest betweenness (chokepoint / max blast radius) + most depended-upon hub (highest Ca).
Note: high centrality on a stable module is expected, not a defect.

## 4. Highest Coupling
Top modules by Ca+Ce, with instability. Note: a stable sink (high Ca, I≈0) is healthy.

## 5. Suspicious Dependencies
SDP violations (edges toward less-stable modules) + layering inversions (a frontend
importing a raw DB driver).

## 6. Cycles
Unit = component (folder rollup); `.`-root cycles flagged low-confidence. Each SCC → its
elementary circuits (capped). NestJS @Module acyclicity reported separately via forwardRef.

## 7. Transaction Hotspots
Transactions writing >1 aggregate root (→ split via outbox) + external I/O inside a
transaction. Includes the helper-call blind-spot note. Disabled (with a note) when no
ownership model is in scope.

## 8. Dead Modules
Modules with no incoming edge of any kind, excluding entrypoints (bootstrap + framework-
routed files). Always hedged: "verify it is not a runtime/DI entrypoint before removing."

## 9. Missing Boundaries
Multi-aggregate transactions (should be events) + dual-writer Shared Kernels (confirm
intended) + aggregate-internal tables exposed by their own controller. Truncated with an
"(N more suppressed)" line if over the cap.
```

## Rules for whoever renders or extends this
- Preserve section order and numbering (downstream tooling and the eval expect all nine).
- Keep confidence markers — never promote a `[prior]` to a stated fact.
- If you add a finding type, give it a section or fold it into the nearest existing one;
  do not silently drop items — show an "(N more suppressed)" line when capping.
