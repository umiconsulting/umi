# Umi Workspace

Umi is a multi-product monorepo. This file defines product boundaries, ownership, workflow rules, and standards.

## Start here

- `WORKSPACE.md` — workspace map and cognitive layers
- `docs/architecture/agent-operating-system.md` — neutral agent OS
- `docs/architecture/maps/retrieval-map.md` — bounded progressive disclosure
- `docs/agents/run-contract.md` — run contract for task, files, bar, return, and verifier

## Product boundaries

| Path                    | Owns                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `apps/umi-api`          | Canonical backend for auth, cash, KDS, conversations, leads, passes, sales, inventory, and stored value |
| `apps/umi-pos`          | Flutter UmiPOS client for operator access, sales, checkout, shifts, hardware, and offline replay        |
| `apps/umi-cash`         | Cash compatibility UI and Cloudflare proxy. `umi-api` owns data, auth, and wallet passes                |
| `apps/umi-dashboard`    | Owner dashboard app shell and live-data UI                                                              |
| `apps/umi-landing-page` | Public landing and lead capture                                                                         |
| `db/`                   | Canonical PostgreSQL schema definitions and forward migrations (`db/migrations/`)                       |
| root `docs/`            | Architecture, governance, and cross-product planning                                                    |

## Database ownership

- `umi` owns the sealed SaaS, identity, and entitlement model. `merchant` owns café business facts and RLS policies. `runtime` owns sealed operational machinery.
- `db/` owns base schemas (`db/00_run.sh`). `db/migrations/` owns forward migrations (`db/migrate.sh`).
- Legacy schemas in `docs/migration/` are historical records only. Do not add new logic to them.

## Branch and pull request workflow

- Create each feature or fix branch from `origin/staging` and open PRs into `staging` (`gh pr create --base staging`). Do not stack unmerged feature branches.
- Pass `CI ready` before merge (`docs/development/CI.md`) and validate on `staging` before promoting to `main` via `--merge`.

## Architecture and research rules

- Keep apps thin. Keep operational truth in `apps/umi-api` and put cross-product normalization close to the write model.
- Prefer additive projections over destructive schema changes and the narrowest existing owner before adding a service or repo.
- Ground structural, security, or performance decisions in official docs and primary technical research (`docs/agents/tool-and-research-doctrine.md`). Label facts, tradeoffs, and inferences explicitly.
- Verify product surfaces locally (`docs/development/LOCAL_VERIFICATION_PLAYBOOK.md`): drive native POS directly and verify `umi-dashboard` in real Chromium (`./scripts/ux-browser.sh`).

## Writing standard

- Write English output in **ASD-STE100**, Spanish technical docs/commits/PRs in **Español Técnico Simplificado (ETS)**, and Spanish chat replies in **Lenguaje claro**.
- Keep sentences short, active, and literal. Keep technical names, paths, commands, logs, and quoted errors verbatim.
- Read the complete writing rules in `docs/agents/writing-standard.md`.

## Agent layer and skills

- Root `.agents/skills/` is the canonical procedure layer; `.claude/skills` is a symlink (`../.agents/skills`) guarded by `adapter-sync-check`.
- Hermes, Claude Code, and `codex-claude-pipeline` are external components; use them only after approved provisioning.
- Load `$product-feature-review` before creating, reviewing, researching, or explaining any feature.
- Umi no longer uses Azure Boards (Trello and Plane are also retired). Track work via the task brief, run record, and GitHub PRs (`docs/agents/issue-tracker.md`).

## Current stance and commands

- `apps/umi-api` is the canonical backend for build-v3 (`umi`, `merchant`, `runtime`) and owns business writes.
- KDS reads API-owned kitchen projections. UmiPOS consumes `packages/contract`.
- One Git repository (`git@github.com:umiconsulting/umi.git`); pnpm + Turborepo manage JS workspaces (`pnpm install|build|lint|test|dev`), while `apps/umi-cash` uses `npm ci && npm run dev`.
