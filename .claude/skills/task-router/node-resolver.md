# Node Resolver

Use this note after classifying the task and inspecting the current tree.

## Resolver questions
1. Is this an organization-level fact, a product-level fact, or a platform implementation detail?
2. Which existing repo already owns the write model?
3. Which schema should own the read model?
4. Can the work be expressed by extending root docs, the owning repo, or the platform backend without adding a new service?
5. Does the user need procedure, judgment, or a local one-off implementation?

## Preferred owners
- root `CLAUDE.md` and `docs/`: organization rules, cross-product architecture, migration state, program plans.
- `apps/umi-kds`: native KDS UI, app data clients, device session handling, KDS-specific UX.
- `apps/umi-conversaflow`: normalization, write-model ownership, Supabase SQL, projections, jobs, realtime/backend contracts.
- `apps/umi-logs`: ConversaFlow ops/logs UI.
- `apps/umi-dashboard`: static Umi owner dashboard prototype.
- `apps/umi-cash`: loyalty-only logic.

## Bias
- Prefer backend ownership for shared normalization.
- Prefer `kds` projection tables over app-side reshaping of raw operational rows.
- Prefer one repo plus one database over introducing another repo or service.
- Prefer additive SQL and projection workers over destructive migrations.
