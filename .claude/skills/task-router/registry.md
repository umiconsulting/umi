# Registry

## Skills
- `task-router`
  - scope: route work to the correct Umi owner slice, then to direct execution, an existing project skill, or a subagent.
  - trigger patterns: multi-repo tasks, root-level docs, cross-product planning, ownership uncertainty.
  - placement hints: start in root `.claude/skills/task-router/`, then descend into the owning repo if the task becomes local.
  - confidence: high
  - provenance: root workspace scaffold for Umi.
- `scientific-research-check`
  - scope: validate architecture and system decisions against official docs and, when useful, academic or primary technical research.
  - trigger patterns: backend-vs-app placement, schema strategy, realtime design, performance claims, scaling decisions, benchmark-sensitive tradeoffs.
  - placement hints: use before committing to structural decisions or documenting strong technical recommendations.
  - confidence: high
  - provenance: Umi research standard for source-backed technical decisions.
- `workspace-boundary-check`
  - scope: verify which repo, schema, and documentation layer should own a cross-product change.
  - trigger patterns: backend vs app placement questions, new docs at root, schema ownership questions, "where should this live?" requests.
  - placement hints: use before creating new files outside an existing project slice.
  - confidence: medium
  - provenance: created for Umi multi-product ownership decisions.

## Selection rules
- Workspace-level docs and planning: root `docs/` plus root `CLAUDE.md`.
- Source-sensitive technical decisions: `scientific-research-check` before locking the recommendation.
- Product app changes: descend into the owning app repo.
- Shared Supabase contracts, normalization, projections, jobs, and backend orchestration: `apps/umi-conversaflow`.
- ConversaFlow ops/logs UI changes: `apps/umi-logs`.
- Static Umi owner dashboard prototype changes: `apps/umi-dashboard`.
- New `kds` read models: backend SQL and functions first, KDS app second.
- Root artifact first, new repo last.
