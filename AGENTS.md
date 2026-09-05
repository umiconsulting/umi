# Umi Workspace

Umi is a multi-product monorepo and organization workspace.
This file defines product boundaries, ownership, architecture rules, and the research standard.

## Start here

- `WORKSPACE.md` — workspace map and cognitive layers
- `docs/architecture/agent-operating-system.md` — neutral agent OS
- `docs/architecture/maps/retrieval-map.md` — bounded progressive disclosure
- `docs/migration/build-v3/GATED_CUTOVER_PLAN.md` — active cutover program

## Product boundaries

| Path                    | Owns                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `apps/umi-api`          | Canonical backend for auth, cash, KDS, conversations, leads, passes, sales, inventory, and stored value |
| `apps/umi-pos`          | Flutter UmiPOS client for operator access, sales, checkout, shifts, hardware, and offline replay        |
| `apps/umi-kds`          | Native iPad Kitchen Display System client                                                               |
| `apps/umi-cash`         | Cash compatibility client and Cash-specific Prisma. It forwards the frozen wallet-pass URL to `umi-api` |
| `apps/umi-dashboard`    | Owner dashboard app shell and live-data UI                                                              |
| `apps/umi-landing-page` | Public landing and lead capture                                                                         |
| root `docs/`            | Architecture, migration, governance, and cross-product planning                                         |

## Database ownership

- `umi` owns the sealed SaaS, identity, and entitlement model.
- `merchant` owns café business facts and row-level security policies.
- `runtime` owns sealed operational machinery.
- `docs/migration/build-v3` owns pre-cutover database definitions.
- `supabase/migrations` accepts approved post-cutover migrations only.
- Build-v2 and legacy schemas are historical inputs. Do not add new logic to them.

## Architecture rules

- Keep apps thin. Product apps consume normalized contracts, not raw channel payloads.
- Keep operational truth in the backend. KDS must not become the source of truth for orders.
- Put cross-product normalization close to the operational backend that owns the write model.
- Prefer additive projections over destructive schema changes.
- Prefer the narrowest existing owner before creating a new service, repo, or directory.
- Do not move responsibility into a new repo unless the current boundary is clearly
  failing on latency, ownership, deploy isolation, or operational simplicity.

## Research standard

For architecture, schema, backend placement, realtime, performance, security, or scaling
decisions, prefer primary sources over opinion. Check official documentation first. If
structural or performance-sensitive, consult academic or primary technical research when
it materially improves confidence. Record the decision basis explicitly:

- documented fact
- source-backed tradeoff
- Umi-specific inference

Do not cargo-cult common patterns. Choose the design that best fits measured constraints,
operational simplicity, and source-backed tradeoffs. If a recommendation adds a new repo,
service, or infrastructure boundary, justify it against simpler options with explicit criteria.

## Writing standard — ASD-STE100

Write all agent output in Simplified Technical English (ASD-STE100). This rule is
permanent and applies to every agent in this workspace. It covers chat replies,
commit messages, pull request text, code comments, and documentation.

Rules:

- Use one word for one meaning. Do not use a second word for the same thing.
- Use each word in its approved part of speech. Do not make a verb from a noun.
- Write short sentences. Use a maximum of 20 words in an instruction and 25 words
  in a description.
- Give one instruction in one sentence.
- Use the active voice. Write an instruction as a command: "Run the migration."
- Use the simple tenses: past, present, and future. Do not use the `-ing` form as a verb.
- Keep the articles "a", "an", and "the".
- Use a maximum of three words in a noun cluster. Break a longer cluster with "of" or "for".
- Write a maximum of six sentences in a descriptive paragraph.
- Write positive statements. Use a negative only for a prohibition or a danger.
- Put conditions, options, and steps in a vertical list.
- Start a warning or a caution with the command that prevents the danger.
- Do not use slang, jargon, idioms, or metaphors.

Exceptions:

- Technical names and technical verbs stay unchanged. Examples: file paths, table
  names, column names, commands, and product names.
- Quoted text, error output, log lines, and code blocks stay verbatim.

### Language

Answer in the language that the user writes. Each language has its standard:

| Content                    | Standard                               |
| -------------------------- | -------------------------------------- |
| English, all content       | ASD-STE100                             |
| Spanish, technical content | Español Técnico Simplificado (ETS)     |
| Spanish, all other content | Lenguaje claro (Red de Lenguaje Claro) |

Spanish technical content is documentation, a commit message, a pull request, a code
comment, a procedure, or a schema description. All other content is a chat reply, a
summary, a recommendation, or a message to a person.

**Español Técnico Simplificado (ETS)** applies the ASD-STE100 rules above to Spanish:

- Use one word for one meaning. Do not use a synonym.
- Use the active voice and the simple tenses.
- Write short sentences. Give one instruction in one sentence.
- Use the imperative for an instruction: "Ejecuta la migración."
- Keep the articles and the prepositions. Do not drop "de", "que", or "el".
- Do not use the gerund as a main verb.

**Lenguaje claro** applies to all other Spanish content:

- Put the main message first. The reader must find the answer in the first paragraph.
- Speak to the reader directly.
- Use common words. Explain a technical term the first time that you use it.
- Use headings, short paragraphs, and lists.
- Give the reason for a recommendation, and give the next action.

## Agent layer

Agent procedures live under `.agents/skills/`.
This path is the canonical procedure layer from the 2026-06-10 S1.5 decision.
The `.claude/skills` path is a symlink to `../.agents/skills`.
Write to `.agents/skills/`; the link reflects the change immediately.
The `adapter-sync-check` skill guards the link.
Symlinks assume macOS or Linux. Windows requires `git config core.symlinks true`.

Hermes, Claude Code, and `codex-claude-pipeline` are external components.
This repository does not install these components. Use them only after approved provisioning.

For workspace-wide work, inspect root instructions first. For project-specific work,
descend into the owning repo and follow its `AGENTS.md` / `REPO_CONTEXT.md` if present.
Prefer existing artifacts and owners over inventing parallel structures.

## Agent skills

### Issue tracker

Work items and specs live in **Azure Boards** — organization `https://dev.azure.com/umiconsulting`,
project `Umi Consulting` — through the Azure DevOps MCP. GitHub PRs are the review surface. A
commit or PR that names `AB#<id>` links the work item; `Fixes AB#<id>` links it AND moves it, so
use the bare form unless the merge truly completes the item. The `to-tickets` / `to-spec` /
`triage` skills publish there; `code-review` checks a PR against its linked item when one is
present. Agents raise work items as issues surface, rather than waiting for a person to file them.
Trello and Plane are retired as trackers.
See [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

## Current stance

- `apps/umi-api` owns authoritative business writes for build-v3.
- Build-v3 uses `umi`, `merchant`, and `runtime` as its canonical schemas.
- KDS reads the API-owned kitchen projection. KDS does not own commercial order truth.
- UmiPOS consumes contract version 2.13.0 from `packages/contract`.
- The workspace uses one Git repository at `git@github.com:umiconsulting/umi.git`.
- App directories are not separate Git repositories.
- Root pnpm workspaces and Turborepo own the active JavaScript workspace workflow.
- Umi Cash stays outside pnpm and uses its separate npm lockfile.
- The active program driver is the build-v3 gated cutover plan.
- P7 production cutover remains active. Gate 13 waits for real hardware and environment validation.

## Commands

Root monorepo (pnpm + Turborepo):

- Install: `pnpm install`
- Build: `pnpm run build` (or `turbo run build`)
- Lint: `pnpm run lint` (or `turbo run lint`)
- Test: `pnpm run test` (or `turbo run test`)
- Dev: `pnpm run dev` (or `turbo run dev`)

Umi Cash uses its separate npm workflow:

```sh
cd apps/umi-cash && npm ci && npm run dev
```
