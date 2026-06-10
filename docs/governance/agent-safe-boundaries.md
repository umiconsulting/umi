# Agent-Safe Change Boundaries

This policy defines default edit safety for autonomous coding agents.

## Usually safe

- Additive documentation indexes.
- Retrieval maps.
- Repo context manifests.
- Stale/superseded markers.
- Non-runtime report summaries.
- Diagnostic documentation.

## Requires repo-specific tests or checks

- Runtime prompts.
- Tool orchestration.
- Edge functions.
- Swift KDS API/client behavior.
- Next.js runtime behavior.
- Prisma models.
- Trace parser behavior.
- Scripts that influence operational workflows.

## Requires human review before execution or merge

- Database migrations.
- Production-affecting scripts.
- Secret handling.
- Certificate/key cleanup or rotation.
- Deployment configuration.
- Schema ownership changes.
- Repo moves or file moves that can break imports, deploys, or git history.

## Read-only by default

- Historical reports.
- Applied migration history.
- Generated files.
- Local environment files.
- Credential/certificate/key files.
- Trace exports and production logs.

## Agent behavior

Agents should prefer additive changes, preserve existing workflows, and avoid moving runtime code unless the user explicitly approves a concrete migration plan.
