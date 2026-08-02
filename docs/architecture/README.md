# Architecture Docs

Architecture docs are split by authority and freshness.

## Current operating docs

- `agent-operating-system.md`
- `maps/workspace-map.md`
- `maps/retrieval-map.md`
- `maps/runtime-map.md`

### UmiPOS (current, despite the date prefix)

Read in this order. Everything stems from `build-v3`.

- `2026-07-28-umipos-branch-reconciliation.md` — state of play, findings, decisions
- `2026-07-23-umipos-fusion-implementation-plan.md` — the Gate 0–9 execution sequence
- `2026-07-22-umipos-resolucion-arquitectura.md` — UmiPOS is a module of Umi, not a peer platform
- `2026-07-20-umipos-contract-seam.md` — the `@umi/contract` → artifact → Dart boundary
- `2026-07-22-nexo-document-index.md` — full index, including the superseded federated proposal

## Dated reports and prompts

Dated files in this directory may contain valuable evidence, but they are historical unless referenced by `docs/reports/latest.md` or explicitly marked current. Check code, migrations, tests, and current maps before relying on them.

## Rule

Prefer current maps and decisions for retrieval. Load dated reports only for background, audit, or when the latest index points to them.
