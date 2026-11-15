# Node Resolver

Use this note after classifying the task and inspecting the current tree.

## Resolver questions

1. Is this an organization-level fact, a product-level fact, or a platform implementation detail?
2. Which existing directory already owns the write model?
3. Which schema should own the read model?
4. Can the work be expressed by extending root docs, the owning app, or the canonical backend without adding a new service?
5. Does the user need a procedure, a judgment, or a local one-off implementation?
6. Does the inherited recommendation name a path that exists at the target commit?

## Preferred owners

- root `AGENTS.md` and `docs/`: organization rules, cross-product architecture, migration state, and program plans.
- root docs and the named run record: current requirements, pending work, and evidence. No external tracker is active.
- `apps/umi-api`: canonical backend for auth, cash, KDS, conversations, leads, passes, sales, inventory, stored value, normalization, projections, jobs, and backend contracts.
- `apps/umi-pos`: POS operator access, sales, checkout, shifts, hardware, offline replay, and the KDS board.
- `apps/umi-pos/lib/features/kitchen/`: the KDS board, which lives inside the POS app as a device-role mode. The separate `apps/umi-kds` client was retired on 2026-09-16.
- `apps/umi-dashboard`: owner dashboard app shell and live-data UI.
- `apps/umi-cash`: Cash compatibility client and its separate Prisma. It forwards the frozen wallet-pass URL to `apps/umi-api`.
- `apps/umi-landing-page`: public landing and lead capture.

## Applicability check before an effect

A path in an inherited brief can be stale. Check it before a write, merge, closure, or deployment.

1. Resolve the exact target commit or branch.
2. Confirm that each owner path exists at that commit.
3. If a path is missing, reject the inherited recommendation and route again.
4. Record the target commit, the path check, and the rejected stale path in `routing-ledger.md`.
5. Recheck the target again immediately before the effect. A mutable branch can move.

Historical paths `apps/umi-conversaflow` and `apps/umi-logs` are not in the current tree. Do not use them as owners. Keep old references as history only.

## Bias

- Prefer backend ownership for shared normalization.
- Prefer `kds` projection tables over app-side reshaping of raw operational rows.
- Prefer one repository plus one database over a new repository or service.
- Prefer additive SQL and projection workers over destructive migrations.
- Prefer the current tree over an inherited statement about the tree.
