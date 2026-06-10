# Signoff Map

Use this map to decide what must pass before changes are considered safe.

## Backend and workflow changes

- Owner: `apps/umi-conversaflow`.
- Required evidence: repo-local tests, relevant Deno checks, mini-harness where prompts/tools are affected, and trace inspection for durable workflow behavior.

## Schema changes

- Owner: schema owner from root `AGENTS.md` and local repo contract.
- Required evidence: migration plan, rollback/forward strategy, local validation, and human review.

## KDS client changes

- Owner: `apps/umi-kds`.
- Required evidence: Swift tests or build validation plus manual review of backend contract assumptions.

## Cash changes

- Owner: `apps/umi-cash`.
- Required evidence: package scripts, Prisma validation, and explicit review for wallet/pass/cert or production cron changes.

## Logs changes

- Owner: `apps/umi-logs`.
- Required evidence: build validation and trace parser checks.

## Dashboard changes

- Owner: `apps/umi-dashboard`.
- Required evidence: build validation plus visual/function comparison against current live dashboard flows.
