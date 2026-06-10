# Authority Hierarchy

Use this hierarchy when files disagree.

1. Runtime code, migrations, schemas, and tests/evals.
2. Root `AGENTS.md` and local repo `AGENTS.md`.
3. Active architecture decisions and current operating-system docs.
4. `WORKSPACE.md`, `REPO_CONTEXT.md`, retrieval maps, runbooks, and current report indexes.
5. Current reports and signoff reviews.
6. Tool adapters such as `CLAUDE.md`, `.claude/`, `.codex/`, and generated agent instructions.
7. Historical audits, superseded plans, default scaffold docs, and unindexed notes.

## Conflict rules

- If docs disagree with code, code wins until a tested migration or code change lands.
- If adapter instructions disagree with `AGENTS.md`, `AGENTS.md` wins.
- If a report disagrees with a current runtime file, treat the report as historical unless it is explicitly marked current and validated.
- If a schema contract appears in both docs and migrations, migrations win; docs should be updated or marked stale.

## Canonical contract files

- Workspace-wide rules: root `AGENTS.md`.
- Workspace orientation: `WORKSPACE.md`.
- Repo-local rules: local `AGENTS.md`.
- Repo-local entry context: local `REPO_CONTEXT.md`.
- Adapter behavior: adapter files, generated or maintained from neutral contracts.
