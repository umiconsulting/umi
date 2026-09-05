# Workspace Map

This map routes work to the narrowest current owner.
It does not replace code, migrations, tests, or local contracts.

## Root

- Purpose: governance, architecture, migration planning, retrieval policy, reports, evaluations, memory policy, and agent operating-system design.
- High-authority entrypoints: `AGENTS.md`, `WORKSPACE.md`, `docs/README.md`, `docs/architecture/agent-operating-system.md`, `docs/governance/authority.md`.
- Do not put product runtime logic here.

## `apps/umi-api`

- Purpose: canonical backend, workflows, normalization, authentication, business writes, projections, and pass generation.
- Runtime surfaces: `src/`, `db/`, `passes/`, `deploy/`, and `test/`.
- Schemas: owns application access to `umi`, `merchant`, and `runtime`.
- Load first: `package.json`, relevant `src/` modules, database definitions, and tests.

## `apps/umi-pos`

- Purpose: Flutter UmiPOS client and native device workflows.
- Runtime surfaces: `lib/`, platform directories, `test/`, and `integration_test/`.
- Schemas: consumes API contracts. It does not own business truth.
- Load first: `README.md`, `pubspec.yaml`, relevant `lib/` code, and tests.

## `apps/umi-kds`

- Purpose: native SwiftUI iPad KDS client.
- Runtime surfaces: `Sources/`, KDS API client, repository state, SwiftUI views, local app docs.
- Schemas: consumes `kds` projections; does not own operational order truth.
- Load first: `AGENTS.md`, `REPO_CONTEXT.md`, `Sources/Docs/KDSArchitecture.md`, relevant Swift source.

## `apps/umi-cash`

- Purpose: Cash compatibility client, tenant sessions, Vercel jobs, and Cash-specific Prisma behavior.
- Runtime surfaces: `src/`, `prisma/`, `passes/`, `vercel.json`.
- Schemas: retains its compatibility Prisma schema. New business truth belongs in `umi-api`.
- Load first: `AGENTS.md`, `REPO_CONTEXT.md`, `package.json`, `prisma/schema.prisma`.

## `apps/umi-dashboard`

- Purpose: Umi owner dashboard app shell with live product data.
- Runtime surfaces: dashboard server/API, `src/` screens, shell, styles, icons, and legacy `Umi Dash.html` reference shell.
- Behavior contract: preserve the visible functions and flows when hardening the production app.
- Load first: `AGENTS.md`, `REPO_CONTEXT.md`, `package.json`, and the relevant `src/` files.

## `apps/umi-landing-page`

- Purpose: public marketing site and lead capture.
- Runtime surfaces: `src/`, `data/`, and `scripts/`.
- Schemas: owns local lead-capture compatibility data. Canonical lead writes belong in `umi-api`.
- Load first: `README.md`, `package.json`, relevant `src/` code, and tests.
