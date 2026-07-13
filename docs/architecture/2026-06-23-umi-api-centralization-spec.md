# Umi API — Backend Centralization Spec & Implementation Plan

**Date:** 2026-06-23
**Status:** **Phases 0–2 LIVE in production (2026-06-25); Phase 3 BUILT + MERGED to `main`, dormant pre-cutover (2026-06-27, PR #6).** Phase 0 (deploy + health), Phase 1 (durable BullMQ work engine + adapters), and Phase 2 (dashboard backend + **live** cash on canonical `loyalty.*`) are deployed at `https://api.umiconsulting.co`; the umi-dashboard SPA is cut over to umi-api (httpOnly-cookie auth). Phase 3 (ConversaFlow conversational engine) is code-complete on `main` but inert until its cutover (VPS pull + Twilio repoint + `LIFECYCLE_CRONS_ENABLED`); its gated hours-unification backfill is **applied to prod**. Realized deploy/role model in [`apps/umi-api/docs/vps-setup.md`](../../apps/umi-api/docs/vps-setup.md). **Phase 4 (KDS endpoints) is BUILT + replica-verified, dormant pre-cutover (2026-06-27).** Remaining: Stage 4 dual-writer cutover (umi-cash still writes `loyalty.*`), the Phase 3 + Phase 4 cutovers (Twilio webhook + KDS `Info.plist` repoints), then Phases 5–7 (landing, decommission).

**Post-cutover hardening — dashboard frontend deploy model (2026-06-26):** The dashboard cookie cutover was failing in prod ("can't select tenants") because the Vercel build was shipping the local-dev `.env` (`VITE_AUTH_MODE=local`, no `VITE_API_BASE`) → the SPA compiled in same-origin/supabase mode and 401'd against `api.umiconsulting.co`. Fixed and hardened:
- **Prod config now lives in Vercel project env vars** (5 × `VITE_*`, set as *plain*: `VITE_AUTH_MODE=cookie`, `VITE_API_BASE=https://api.umiconsulting.co`, `VITE_SUPABASE_URL/ANON_KEY`, `VITE_BUSINESS_SLUG`). Local `.env` is excluded from builds via `apps/umi-dashboard/.vercelignore` (committed, PR #5).
- **Vercel project repointed** from the standalone `umiconsulting/umi-dashboard` repo to this **monorepo** `umiconsulting/umi` (root `apps/umi-dashboard`, prod branch `main`, **Install Command forced to `npm install`** — the root `pnpm-workspace.yaml` made Vercel auto-pick pnpm, which crashed). **Deploys are now git-based:** push `main` → prod, branch push → preview. No more CLI/git-author friction.
- **Staging environment:** branch **`staging`** → **`staging-dashboard.umiconsulting.co`** (cookie auth works since it's under `.umiconsulting.co`; gated by Vercel SSO for non-team; API `CORS_ORIGINS` includes both prod+staging origins). Workflow: branch off `main` → test on staging → merge to `main`.
- **Auth correctness:** `hola@umiconsulting.co` password reset in `core.users` (scrypt scheme unchanged); login errors no longer render `[object Object]` (umi-api wraps errors as `{error:{message}}` → added `errMessage()` helper). PR #5 on `main`.
- **Open (optional):** replace the explicit `CORS_ORIGINS` allowlist in `main.ts` with a `*.umiconsulting.co` regex so future first-party subdomains (`cash.`/`kds.`) need zero CORS edits (the auth cookie already spans all subdomains via `Domain=.umiconsulting.co`). Native KDS (iOS) can't use browser cookies → needs a token auth path when ported (Phase 4).
**Owner decision:** Build a single centralized backend API (`apps/umi-api`) on a VPS. Eliminate Supabase Edge Functions. Route every app except `umi-logs` to it. Keep `umi-cash` running on its own repo for now.
**Supersedes / reconciles:** `docs/architecture/2026-05-23-api-backend-centralization-audit.md` (which recommended *not* building a central API and *keeping* edge functions). That recommendation was correct for its moment — it was gated on the database consolidation completing first. The unified platform database **launched to production on 2026-06-20**, which satisfies the program's sequencing invariant (*database consolidation → backend consolidation → monorepo*). We are now at the backend-consolidation step, and the owner has chosen a single VPS-hosted API over the edge-function model.

---

## 1. Goal & Non-Goals

### 1.1 Goal

Consolidate all backend/runtime logic that is today fragmented across **four** runtimes into **one** clean, maintainable TypeScript service:

| Today (fragmented) | Becomes |
|---|---|
| `umi-conversaflow` Supabase **Edge Functions** (Deno): `whatsapp-handler`, `job-worker`, `kds-command`, `kds-board`, `kds-pairing`, `zettle-oauth-setup` | `apps/umi-api` HTTP routes + BullMQ workers |
| `umi-dashboard` Express backend (`server.js`, 2,829 lines) | `apps/umi-api` admin/owner modules |
| `umi-landing-page` lead/email backend (SQLite + Next API routes) | `apps/umi-api` leads module + Postgres |
| `pg_cron` scheduled jobs | BullMQ repeatable jobs |

### 1.2 Explicit Non-Goals (this program)

- **`umi-logs` is not migrated.** It stays a separate read-only ops/trace UI. The API keeps writing `observability.*`; Logs keeps reading it. Contract unchanged.
- **`umi-cash` is not migrated.** It keeps its own repo, stays online, and must keep working unchanged. It coexists with `umi-api` on the same platform Postgres. A future phase (§13, Phase 7) may fold it in; not now.
- **No database schema migration.** The platform Postgres is already consolidated and live (project `xbudknbimkgjjgohnjgp`). We connect to it; we do not re-migrate it. The only new tables are for landing-page leads (§9.3).
- **The KDS Swift client is not rewritten.** It is a thin client. We preserve its exact API contract and repoint its config (§8.1).
- **Supabase exit is not in scope.** The DB stays on Supabase Postgres for now. The design is host-agnostic so the DB can move later, but that is a separate decision.

---

## 2. Locked Decisions

Each decision is tagged with its basis per the workspace research standard (`AGENTS.md`): **[Fact]** documented fact, **[Tradeoff]** source-backed tradeoff, **[Owner]** owner directive, **[Inference]** Umi-specific inference.

| # | Decision | Basis |
|---|---|---|
| D1 | One centralized service, `apps/umi-api`, deployed to a **VPS** (long-running process, not serverless/edge). | [Owner] |
| D2 | **NestJS on the Fastify adapter** (`@nestjs/platform-fastify`). NestJS enforces module boundaries structurally (the strongest guardrail against spaghetti across many domains); Fastify gives throughput + TS-first ergonomics and a clean raw-body hook for Twilio signature validation. | [Owner] + [Tradeoff] |
| D3 | **BullMQ (Redis-backed)** is the job engine for all async work (turns, embeddings, summaries, fact extraction, Zettle sync, cash lifecycle crons, outbound WhatsApp). Replaces the Deno worker's hand-rolled Postgres poll-loop + `pg_cron` + HTTP-trigger. | [Owner] + [Tradeoff] |
| D4 | **Eliminate Supabase Edge Functions.** All ingress/commands/jobs become VPS routes + workers. | [Owner] |
| D5 | **Route everything to `umi-api` except `umi-logs`.** Dashboard, ConversaFlow ingress, KDS, and landing-page leads all call `umi-api`. | [Owner] |
| D6 | **`umi-cash` stays independent and online**, coexisting on the shared platform Postgres. Deferred to a later phase. | [Owner] |
| D7 | **DB stays on the consolidated platform Postgres**; `umi-api` connects directly (no PostgREST). Existing SQL functions/RPCs are reused via direct queries (DRY). | [Inference] + [Fact] |
| D8 | **No ORM. Raw SQL via `pg` (node-postgres)** — hand-written parameterized queries in repositories. Migrations stay **Supabase migrations** while the DB is on Supabase, and become **Sqitch + hand-written PostgreSQL SQL** when the database is lifted onto PostgreSQL on the VPS. (The dashboard already used only raw SQL through Prisma `$queryRaw`, so dropping the ORM is a small change.) | [Owner] |
| D9 | **Unified auth:** JWT (access + refresh) in httpOnly cookies, `scrypt` password verification (preserve existing hashes), entitlement + role guards. Replaces the dashboard's header-only "session" and the three separate JWT schemes. | [Tradeoff] + [Inference] |
| D10 | **File structure is flat, business-named, and self-describing** (§6). This is a hard requirement, not a preference. | [Owner] |
| D11 | ~~Cash write paths feature-flagged OFF and ship inert.~~ **REVERSED by owner (2026-06-25): cash ships fully LIVE.** umi-api now serves customer-facing writes on canonical `loyalty.*` (top-up, purchase, gift-card issue/redeem, scan, self-registration). `CASH_WRITE_ENABLED` is vestigial. `umi-cash` still also writes `loyalty.*` — the two coexist (append-only ledger, `balance = SUM`); retiring umi-cash's writes is the Stage 4 dual-writer decision. | [Owner] |

### 2.1 Coexistence boundaries (accepted defaults — vetoable in review)

These follow from D5 + D6 and resolve the overlap between "route everything to the API" and "don't migrate cash":

1. **Cash lifecycle WhatsApp crons come into `umi-api`.** They are *ConversaFlow* code today (`supabase/functions/job-worker/processors/cash-cron.ts`: birthday rewards, winback, streaks, welcome-no-visit), not `umi-cash` code. They only *read* `loyalty.*` and send WhatsApp. They migrate with the rest of the worker. `umi-cash` keeps its own Apple-pass push cron. No conflict (different channels).
2. **The cash domain is built in `umi-api` with reads live and writes inert (D11).** Dashboard cash *reads* (analytics, customer list, gift-cards, reward-config) go live. The customer-facing **write** paths (wallet topup/purchase, scan/visit, reward redemption, gift-card issue/redeem, account/card creation) are built and tested but **flag-gated OFF** and unmounted, because `umi-cash` is still the live writer on the shared `cash`/`loyalty` tables. No dual writes (§11.5).
3. **`umi-cash` stays the live writer and fully independent** — its own Twilio/Resend, its own customer-facing writes, its own passes/APN. We do not reroute it through `umi-api` yet, and `umi-api` does not write the customer-facing wallet tables until activation. The lifecycle-nudge `lifecycle_sends` dedup writes (existing ConversaFlow behavior, non-conflicting) stay active.

---

## 3. Target Architecture

### 3.1 Topology

```
                         ┌─────────────────────────────────────────────┐
                         │                   VPS                        │
   Twilio webhook ─────▶ │  ┌───────────┐   enqueue   ┌──────────────┐  │
   WhatsApp ingress      │  │  umi-api  │ ──────────▶ │  umi-worker  │  │
                         │  │  (HTTP)   │   BullMQ     │  (BullMQ     │  │
   Dashboard SPA ──────▶ │  │  Fastify  │ ◀────────── │   workers +  │  │
   (admin panel)         │  │  + Nest   │   Redis      │  schedulers) │  │
                         │  └─────┬─────┘             └──────┬───────┘  │
   KDS iPad ───────────▶ │        │                          │          │
   (command/board/pair)  │  ┌─────▼──────┐            ┌──────▼───────┐  │
                         │  │   Redis     │            │    Caddy     │  │
   Landing page ───────▶ │  │ (BullMQ)    │            │ (TLS/proxy)  │  │
   (leads/diagnostic)    │  └─────────────┘            └──────────────┘  │
                         └────────────────────┬────────────────────────┘
                                              │ pg (raw SQL, pooled)
                                              ▼
                         ┌─────────────────────────────────────────────┐
                         │   Platform Postgres (Supabase project        │
                         │   xbudknbimkgjjgohnjgp) — SHARED             │
                         │   canonical schemas: core/ops/comms/loyalty/ │
                         │   device/kitchen/queue/observability/grow    │
                         └─────────────────────────────────────────────┘
                                  ▲                         ▲
                                  │ (independent, online)   │ (read-only)
                         ┌────────┴────────┐       ┌────────┴────────┐
                         │    umi-cash      │       │    umi-logs     │
                         │  (own repo,      │       │  (own repo,     │
                         │   Vercel)        │       │   trace UI)     │
                         └──────────────────┘       └─────────────────┘
```

### 3.2 Two processes, one codebase

The VPS runs **two process types from the same `apps/umi-api` build**:

- **`umi-api` (web)** — `src/main.ts`. Fastify HTTP server. Handles all ingress: Twilio webhook, KDS endpoints, dashboard admin API, landing-page leads. Fast request → enqueue → return. Never does heavy work inline.
- **`umi-worker` (worker)** — `src/worker.ts`. A NestJS application context (no HTTP listener) that runs BullMQ workers and the repeatable-job scheduler. Does the slow work: AI turns, embeddings, summaries, outbound sends, cash crons.

Splitting them means a slow Claude call can never block an inbound webhook, and the two can scale independently. They share every module, service, and adapter — only the bootstrap differs.

---

## 4. Cross-Cutting Principles (KISS / DRY / no spaghetti)

These are enforceable rules, applied in code review:

1. **Layering is strict and one-directional:** `controller → service → repository → database`. Controllers only parse/validate/authorize and delegate. Services hold business logic. Repositories hold queries. No SQL in controllers, no HTTP types in services.
2. **External systems are reached only through adapters** (`src/shared/adapters/*`). No `fetch('https://api.twilio…')` outside `twilio.adapter.ts`. One canonical adapter per external service — this kills the duplicated Twilio/email code the audit flagged.
3. **One of everything cross-cutting:** one DB client, one auth layer, one logging/tracing layer, one config loader. If it's infrastructure, it lives in `src/shared/` and is injected, never re-implemented per module.
4. **DTOs + validation at the edge** (`class-validator` / `zod`). Every request body and response shape is a named DTO. The KDS contract DTOs (§8.1) are frozen and contract-tested.
5. **Modules own a domain, not a layer.** `modules/kds/` contains *everything* KDS (controller, service, guard, dto) — you never hunt across the tree to understand one feature.
6. **Idempotency and retries are declarative**, expressed via BullMQ job options + deterministic job IDs (§10.3), not hand-rolled per processor.
7. **No mystery files.** Every file is named `<thing>.<role>.ts`. A new engineer can guess any path. (§6)

---

## 5. Technology Stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js 22 LTS | Long-running on the VPS |
| Framework | NestJS + `@nestjs/platform-fastify` | D2 |
| HTTP server | Fastify | Raw-body hook for Twilio signature (§11.4) |
| Jobs/queues | BullMQ + `@nestjs/bullmq` + Redis 7 | D3 |
| Scheduling | BullMQ repeatable jobs | Replaces `pg_cron` |
| Data access | **`pg` (node-postgres)** — raw parameterized SQL, no ORM | D8; queries co-located in repositories |
| Migrations | **Supabase migrations** now → **Sqitch + hand-written SQL** after the DB moves to the VPS | D8; umi-api ships no ORM-migrate |
| AI | `@anthropic-ai/sdk` (Claude Haiku) | Port of `_shared/adapters/anthropic.ts` |
| Embeddings | Voyage AI (HTTP) | Port of `_shared/voyage.ts` |
| Messaging | Twilio REST (WhatsApp) | Port of `_shared/adapters/twilio.ts` |
| Email | Nodemailer (Brevo SMTP) | Dashboard password reset + landing sequences |
| POS | Zettle OAuth + product API | Port of `zettle-oauth-setup` + `zettle-sync` |
| Validation | `class-validator` + `class-transformer` (or `zod`) | DTOs |
| Auth | `jose` (JWT) + Node `crypto.scrypt` | Preserve existing password hashes |
| Reverse proxy / TLS | Caddy | Automatic HTTPS for the public webhook/API |
| Process/orchestration | Docker Compose | `umi-api`, `umi-worker`, `redis`, `caddy` |
| Tests | Vitest/Jest + Supertest | Unit + integration + KDS contract tests |

---

## 6. File Structure & Navigation (hard requirement)

**Principle:** you look in exactly one of three places. Folders are business names. Files say what they are. Nothing is more than ~3 levels deep. The root `README.md` is the map.

```
apps/umi-api/
  README.md                     # THE MAP: what each folder is, how to run, where things live
  package.json
  tsconfig.json
  nest-cli.json
  Dockerfile
  docker-compose.yml            # umi-api + umi-worker + redis + caddy
  Caddyfile
  .env.example
  db/
    migrations/                 # schema migrations — Supabase format now; Sqitch plan later (post-VPS DB move)
    README.md                   # how schema changes are applied (Supabase now → Sqitch on the VPS)

  src/
    main.ts                     # HTTP API bootstrap (Fastify)
    worker.ts                   # BullMQ worker + scheduler bootstrap (no HTTP)
    app.module.ts               # root module — imports every domain module

    modules/                    # ← ONE folder per BUSINESS domain. Look here first.
      auth/
        auth.module.ts
        auth.controller.ts      # login, refresh, logout, forgot/reset password
        auth.service.ts
        auth.guard.ts           # JWT guard
        entitlement.guard.ts    # product_not_active 403
        roles.decorator.ts
        dto/
      tenants/                  # tenants, locations, settings, capabilities
        tenants.module.ts
        tenants.controller.ts
        tenants.service.ts
        tenants.repository.ts
        dto/
      staff/                    # staff CRUD, roles, permissions
      hours/                    # business hours
      customers/                # Customer 360 reads: detail, timeline, identity, conversations list
      conversations/            # WhatsApp ingress + the AI turn engine (heart of the system)
        conversations.module.ts
        whatsapp.controller.ts  # the Twilio webhook (ingress only)
        turn.service.ts         # mini-harness turn pipeline
        memory.service.ts       # working memory, summaries, semantic search
        prompts.ts              # system prompt builder + PROMPT_VERSION
        intent.service.ts
        business-hours.service.ts
        security.service.ts     # rate limit, prompt-injection, output sanitization
        tools/                  # agent tools, grouped by concern (was tools.ts, 80KB)
          catalog.tools.ts      # product search
          cart.tools.ts         # add/remove/update
          checkout.tools.ts     # order confirmation
          customer.tools.ts     # preferences/facts
          location.tools.ts
      kds/                      # kds-command, kds-board, kds-pairing — exact contract
        kds.module.ts
        kds.controller.ts       # /kds/command, /kds/board, /kds/pairing (+ /functions/v1 aliases)
        kds.service.ts
        device-auth.guard.ts    # X-KDS-Device-Token
        dto/                    # FROZEN contract DTOs (§8.1)
      leads/                    # landing-page lead capture, diagnostics, email sequences
        leads.module.ts
        leads.controller.ts     # contact, diagnostic, webhook (email-response)
        leads.service.ts
        diagnostic.service.ts   # scoring
        sequences.service.ts    # email sequence engine
        leads.repository.ts
        dto/
      cash/                     # cash domain: READS live for dashboard; WRITES built but flag-gated OFF (D11)
        cash.module.ts
        cash.controller.ts      # read endpoints (stats, analytics, customers, gift-cards, reward-config) mounted now
        cash-read.service.ts    # analytics + customer cash state + gift-card/reward-config reads
        cash-write.service.ts   # wallet ledger, redemptions, gift-card issue/redeem — gated by CASH_WRITE_ENABLED
        cash-write.controller.ts# write routes — ONLY mounted when CASH_WRITE_ENABLED=true (inert until activation)
        cash.repository.ts
      health/

    jobs/                       # ← ALL async work. Named by what it does.
      queues.ts                 # the single source of truth for queue names
      turns.processor.ts        # turn.integrity, turn.process
      enrichment.processor.ts   # message.embed, conversation.summarize, customer.extract_facts, product.embed
      outbound.processor.ts     # twilio reply + status/cancel/location notifications + whatsapp lifecycle sends
      integrations.processor.ts # zettle.sync
      lifecycle.scheduler.ts    # repeatable crons: birthday, winback, streak, welcome-no-visit, reward-expiring, goal-proximity

    shared/                     # ← cross-cutting infra. Obvious names.
      database/
        database.module.ts
        pg.service.ts           # two pg pools (umi_app RLS / umi_worker) + withTenant() per-req txn
        request-context.ts      # AsyncLocalStorage store: tenant/user/requestId
        request-context.middleware.ts  # sets the request context so withTenant() can apply RLS
      adapters/                 # ONE file per external service
        twilio.adapter.ts
        anthropic.adapter.ts
        voyage.adapter.ts
        zettle.adapter.ts
        email.adapter.ts
      auth/
        jwt.service.ts
        password.service.ts     # scrypt verify/hash
      logging/
        logging.service.ts      # structured logs + pipeline traces (umi-logs reads these)
        logging.interceptor.ts
        trace.service.ts        # pipeline_traces / ai_turn_logs / security_logs → observability.*
      config/
        config.schema.ts        # typed, validated env
      http/
        all-exceptions.filter.ts
        raw-body.ts             # Fastify raw-body for Twilio signature
```

**Naming rules (one table, no exceptions):**

| Suffix | Means |
|---|---|
| `.module.ts` | NestJS module wiring |
| `.controller.ts` | HTTP routes for a domain |
| `.service.ts` | business logic |
| `.repository.ts` | DB queries for a domain |
| `.processor.ts` | BullMQ queue consumer |
| `.scheduler.ts` | repeatable/cron job producer |
| `.guard.ts` | auth/authorization |
| `.adapter.ts` | wrapper around one external system |
| `.dto.ts` (in `dto/`) | request/response shapes |

Folder names are **business nouns** (`auth`, `tenants`, `customers`, `conversations`, `kds`, `leads`, `cash-insights`, `hours`, `staff`). No abbreviations, no codenames, no `utils/`, `helpers/`, `lib/` grab-bags.

---

## 7. Business-Logic Inventory & Migration Map

This is *what moves, from where, to which module.* It is the source-of-truth checklist for the port.

### 7.1 From `umi-conversaflow` (Deno edge functions → `umi-api`)

| Source | Target | Notes |
|---|---|---|
| `whatsapp-handler/index.ts` (ingress: parse Twilio, security, MessageSid idempotency, enqueue `turn.integrity`) | `modules/conversations/whatsapp.controller.ts` | Returns empty TwiML fast; enqueues to BullMQ instead of `triggerJobWorker()` |
| `whatsapp-handler/security.ts` | `modules/conversations/security.service.ts` | Rate limit, prompt-injection, output sanitization |
| `whatsapp-handler/prompts.ts`, `intent-extractor.ts`, `business-hours.ts` | `modules/conversations/{prompts,intent,business-hours}` | |
| `whatsapp-handler/tools.ts` (80KB) | `modules/conversations/tools/*.tools.ts` | **Split by concern** (catalog/cart/checkout/customer/location). Biggest single chunk. |
| `job-worker/processors/turn-integrity.ts`, `turn-process.ts`, `turn-*.ts`, `tool-outcomes.ts` | `jobs/turns.processor.ts` + `modules/conversations/turn.service.ts` | The mini-harness loop (Claude + tools + memory) |
| `job-worker/processors/{message-embed,conversation-summarize,customer-extract-facts,product-embed,embed-backfill}.ts` | `jobs/enrichment.processor.ts` | |
| `job-worker/processors/zettle-sync.ts` + `zettle-oauth-setup/` | `jobs/integrations.processor.ts` + `shared/adapters/zettle.adapter.ts` | |
| `job-worker/processors/cash-cron.ts` (birthday/winback/streak/welcome/reward-expiring/goal-proximity) | `jobs/lifecycle.scheduler.ts` + `jobs/outbound.processor.ts` | Boundary §2.1.1 — these are ConversaFlow code |
| `job-worker/dispatchers/twilio-dispatcher.ts` (reply, status/cancel/location notifications) | `jobs/outbound.processor.ts` | |
| `kds-command/`, `kds-board/`, `kds-pairing/` | `modules/kds/` | Exact contract preserved (§8.1) |
| `_shared/adapters/{anthropic,twilio}.ts`, `_shared/voyage.ts` | `shared/adapters/` | |
| `_shared/memory.ts`, `turns.ts`, `pending-clarification.ts`, `normalize-phone.ts`, `business-config.ts`, `synonyms.ts` | `modules/conversations/memory.service.ts` + repositories | |
| `_shared/logger.ts` (slog, logAiTurn, logPipelineTrace, logSecurityEvent) | `shared/logging/` | Keeps writing `observability.*` for `umi-logs` |
| `_shared/workflow.ts` (insertJob/insertOutbox/triggerJobWorker/priorities) | `jobs/queues.ts` + BullMQ enqueue | The HTTP trigger goes away — BullMQ push |
| `_shared/kds-device-auth.ts` | `modules/kds/device-auth.guard.ts` | |

### 7.2 From `umi-dashboard` (Express `server.js` → `umi-api`)

| Source route group | Target module | Notes |
|---|---|---|
| `/api/auth/local/{login,forgot-password,reset-password}` | `modules/auth/` | Unify onto D9 (JWT cookies); keep scrypt verify; keep Brevo reset email |
| `/api/me/tenants`, `/api/tenants/:id/{capabilities,settings,locations}` | `modules/tenants/` | |
| `/api/:slug/admin/staff*` | `modules/staff/` | |
| `/api/:slug/admin/hours` | `modules/hours/` | |
| `/api/tenants/:id/customers*`, `/customers/:id/{timeline,conversations,orders,cash,identity}`, `/insights/customer-platform` | `modules/customers/` | The Customer 360 composite reads. Decompose the 120-line lateral-join query into per-domain loaders. |
| `/api/:slug/admin/{stats,analytics,reward-config,customers,gift-cards}` | `modules/cash/` (read side) | Reads go live (boundary §2.1.2). Write side built from `umi-cash` `src/lib/wallet.ts` etc. but flag-gated (D11) |
| `/api/:slug/admin/conversations` | `modules/customers/` or `conversations/` | List view (reads `comms.*`) |
| `/api/kds/*`, `/api/:slug/admin/devices*`, `/api/:slug/orders*` | `modules/kds/` | **Remove the `callKdsPairingBackend` proxy duplicate** — call the in-process KDS service directly (kills the duplication the audit flagged) |
| `createMailTransport` (Brevo) | `shared/adapters/email.adapter.ts` | One canonical email adapter |
| In-memory KDS heartbeats (`/api/kds/heartbeat`) | `modules/kds/` + Redis or `device.*` | In-memory won't survive two processes; back it with Redis/DB |

### 7.3 From `umi-landing-page` (Next API + SQLite → `umi-api` + Postgres)

| Source | Target | Notes |
|---|---|---|
| `/api/contact`, `/api/diagnostic`, `/api/leads`, `/api/webhook/email-response` | `modules/leads/` | |
| `lib/integration/diagnosticTrigger.ts` (scoring + lead create/update) | `modules/leads/diagnostic.service.ts` | |
| `lib/email/sequenceManager.ts` (diagnostic_followup, meeting_noshow sequences) | `modules/leads/sequences.service.ts` + `jobs/lifecycle.scheduler.ts` | Sequence sends become repeatable jobs (replaces `/api/cron/email-sequence`) |
| `lib/email/emailService.ts` + templates | `shared/adapters/email.adapter.ts` + `modules/leads` templates | |
| `better-sqlite3` `leads`, `email_logs` | `grow.leads`, `grow.lead_events` (§9.3) | Canonical home for prospects (`tenant_id` NULL); SQLite retired; landing page calls the API |

### 7.4 Stays put

| App | What stays | Why |
|---|---|---|
| `umi-cash` | Stays the **live writer**: customer-facing wallet/loyalty writes, Apple/Google passes, APN push, customer/staff auth, its own crons. | D6 — not migrated; coexists on shared DB |
| `umi-cash` cash *business logic* (`src/lib/wallet.ts`, rewards math, gift-card logic, lifecycle, identity) | **mirrored into `modules/cash/` (built, but write side inert)** | D11 — reads serve dashboard; writes ship dormant for later activation. Source of truth for the write port. |

**Cash passes/APN — confirm at activation, not now:** Apple PassKit `.pkpass` generation, the PassKit v1 web-service protocol, Google Wallet JWTs, and APN push are issuer-URL- and cert-bound and provide no value while cash writes are inert. Recommendation: **defer building these into `umi-api` until activation (Phase 7)**; keep them in `umi-cash` meanwhile. Flag for veto if you want them built-inert now too.
| `umi-logs` | All of it (trace UI, `observability.*` reads) | Non-goal |
| `umi-kds` | The Swift client | Thin client; only config repoint (§8.1) |

---

## 8. Backend Contracts to Preserve

### 8.1 KDS (frozen — the iPad client cannot be casually recompiled)

The Swift client calls three endpoints and depends on **exact** field names, enum values, headers, and semantics. These DTOs are frozen and contract-tested.

**Endpoints** (POST, JSON):

| Function | New path | Legacy alias (transition) | Purpose |
|---|---|---|---|
| pairing | `/kds/pairing` | `/functions/v1/kds-pairing` | `kds_start`, `kds_status` PIN flow |
| board | `/kds/board` | `/functions/v1/kds-board` | `snapshot`, `events` (poll, not realtime) |
| command | `/kds/command` | `/functions/v1/kds-command` | `transition_ticket`, `partial_cancel_items` |

**Must preserve exactly:**
- Headers: `Authorization: Bearer <anonKey>`, `apikey`, and `X-KDS-Device-Token` (after pairing).
- Revocation: when the device session (`device.sessions`) is inactive, respond `{ "error": "device_revoked" }` on 401/403 → the app clears Keychain and returns to pairing.
- Snapshot/event row shapes (`ticket_id`, `source_transaction_id`, `status`, `station_id/name`, `items[]`, `last_event_sequence`, etc.) and event `kind` values (`status_changed`, `order_upserted`, `order_removed`, `snapshot_reconciled`) with monotonic `sequence`.
- Status enum (`new|accepted|preparing|ready|completed|cancelled|partial_cancelled`) and cancel reason codes (`out_of_stock|kitchen_overload|closing_soon|customer_no_show|duplicate_order|other`).

**Canonical data source under the frozen contract:** the contract is preserved at the API boundary, but underneath it reads/writes the **canonical** model, not a `kds.*` table tree (§9.1):
- Board snapshot + ticket state come from **`ops.order_items.kitchen_status` + `ops.order_events`**, exposed via the **`v_kds_tickets`** projection view. KDS's only write is `ops.order_items.kitchen_status` (via the command RPC). Tickets are a *projection*, not a source of truth.
- Stations are **`kitchen.stations`**; device pairing/sessions are **`device.pairing_requests`/`device.sessions`**.
- A `transition_ticket`/`partial_cancel_items` command updates `ops` order state and emits a `queue.outbox_events` row (`order.status_changed`) that drives the customer status-notification send (§10.4) — replacing the old "KDS trigger writes outbox" path.
- Confirm the live projection/RPC names (`v_kds_tickets`, the transition RPC) at bind time; the iPad client never sees these names, only the frozen JSON.

**Realtime:** KDS uses **polling**, not Supabase Realtime. There is **no realtime dependency to replace** — this is a clean win for moving off Supabase infrastructure.

**Client repoint:** update `Info.plist` `KDSBackendURL` (or per-endpoint `KDSCommandURL`/`KDSBoardURL`/`KDSPairingURL`) to the VPS, then ship an app build. The legacy `/functions/v1/*` aliases let already-installed builds keep working during rollout (§13, Phase 4).

### 8.2 Twilio WhatsApp webhook

- Public HTTPS endpoint (Caddy TLS). Twilio's console webhook URL is repointed to the VPS at cutover (§13, Phase 3).
- **Signature validation** requires the raw request body + full URL — Fastify raw-body hook (`shared/http/raw-body.ts`). Preserve HMAC-SHA1 validation (SEC-01).
- Respond with empty TwiML quickly; all processing is async via BullMQ. Preserve MessageSid idempotency (FT-01) as the deterministic BullMQ job ID.

### 8.3 Observability (for `umi-logs`)

- **Confirmed live binding (Phase 1b):** `umi-logs` reads its runtime trace tables from schema **`conversaflow`** (its client default is `DB_SCHEMA || 'conversaflow'`), specifically **`ai_turn_logs`, `edge_function_logs`, `security_logs`** (it does *not* read `pipeline_traces`/`eval_traces` — those are internal). So `umi-api`'s `TraceService` writes those exact tables/columns in the configured `OBSERVABILITY_SCHEMA` (default `conversaflow`), best-effort, via the `umi_worker` pool — `umi-logs` keeps working unchanged.
- This is *not yet* the canonical `observability.ai_runs`/`pipeline_spans`/`security_events` model from `platform-database-architecture.md` — that rename hasn't been applied to the live runtime trace tables. Rebinding is a one-line `OBSERVABILITY_SCHEMA`/table-name change when/if the observability migration lands and `umi-logs` cuts over.

---

## 9. Data & Schema

### 9.1 Canonical schema map (CONFIRMED — live)

The platform DB uses **domain-named canonical schemas**, confirmed by the normative `docs/architecture/2026-06-16-canonical-schema-and-identity.md` and the source-of-truth `docs/architecture/platform-database-architecture.md`, and matching the dashboard/cash cutovers (2026-06-20). The old `platform`/`conversaflow`/`kds`/`umi_cash` names visible in `docs/migration/audit-output/supabase-prod-schema.sql` are the **pre-rename** state and must not be used — the migration moved old → new.

| Schema | Holds | Key tables (the API touches) |
|---|---|---|
| `core` | identity & tenancy | `tenants`, `locations`, `people`, `contact_methods`, `users`, `tenant_memberships`, `roles`/`membership_roles`/`permissions`, `staff_members` |
| `ops` | business operations | `businesses`, `channels`, `channel_accounts`, `products`, `product_categories`, `orders`, `order_items` (**holds `kitchen_status` — KDS tickets live here**), `order_events`, `payments`, `business_hours` |
| `comms` | AI conversations & memory | `conversations`, `messages`, `conversation_turns`, `tool_calls`, `memory_items`, `knowledge_documents`, `knowledge_chunks` (pgvector), `customer_preferences` |
| `loyalty` | points, rewards, wallet, passes | `programs`, `accounts`, `cards`, `points_ledger` (append-only), `balances` (derived), `reward_configs`, `reward_redemptions`, `gift_cards`, `gift_card_ledger`, `wallet_transactions`, `wallet_passes`, `pass_devices`, `visit_events`, `automation_rules`, `otp_verifications` |
| `device` | hardware pairing & sessions | `devices`, `sessions`, `pairing_requests`, `events` |
| `kitchen` | station config only | `stations`, `station_groups`, `station_assignments` |
| `queue` | async infra (service-role only) | `jobs`, `job_attempts`, `outbox_events`, `inbound_events`, `idempotency_keys`, `dead_letters` |
| `observability` | traces/audit/logs (service-role only) | `ai_runs`, `tool_calls`, `pipeline_spans`, `audit_log`, `security_events`, `edge_logs`, `data_quality_findings` |
| `grow` | Umi-internal: leads, subs, flags (service-role only) | `leads` (`tenant_id` NULL), `lead_events`, `subscriptions`, `feature_flags` |

**Architectural laws this imposes on `umi-api` (from `platform-database-architecture.md` §3, §5):**
- **FKs point down into `core` only.** No cross-product FK. Cross-product effects flow through **`queue.outbox_events`** (transactional outbox; §10).
- **KDS reads a projection, not a table tree.** Order state is `ops.order_items.kitchen_status` + `ops.order_events`, exposed via the **`v_kds_tickets`** view. `kitchen.*` is station *config* only. Device pairing/sessions are `device.*`. (§8.1)
- **Loyalty writes go through gated `SECURITY DEFINER` RPCs** (`FOR UPDATE` on account rows, idempotency keys, append-only `points_ledger`). This is exactly the surface kept inert under D11 (§11.5).
- **Product → schema write scope** (matrix, §5 of the architecture doc): ConversaFlow writes `comms` + `queue.outbox_events`; Cash writes `loyalty` + `queue.outbox_events`; KDS writes `ops.order_items` (`kitchen_status`); Landing writes `grow`; Dashboard writes `core`/`ops`/`loyalty`/`grow`. Each module's repository is constrained to its column in this matrix.

**One bind-time confirmation (not blocking):** confirm the live projection name (`v_kds_tickets`) and that the loyalty write RPCs exist with the names the port expects; write the repository SQL against whatever the live DB exposes.

### 9.2 Data access — raw SQL via `pg` (no ORM)

`umi-api` talks to Postgres through **`pg` (node-postgres)** with hand-written **parameterized** SQL (`$1, $2…`) — no Prisma, no query builder (D8). One thin `pg.service.ts` owns two connection pools (one per role, §11.2); each domain's queries are **co-located in its `*.repository.ts`** (large composite reads like Customer 360 may live as a `*.sql` file inside the same module folder — never a global SQL grab-bag).

- Schema-qualify every table (`comms.messages`, `loyalty.cards`, …). The repository is constrained to its write column in the product→schema matrix (§9.1).
- Sensitive writes (loyalty) call the existing `SECURITY DEFINER` RPCs via `SELECT * FROM award_points($1,…)` rather than touching tables directly — the DB enforces the invariants.
- **RLS context:** tenant-scoped schemas (`ops`/`comms`/`loyalty`/`device`/`kitchen`) are RLS-enforced and `umi_app` is non-`BYPASSRLS`. `request-context.middleware.ts` establishes the per-request tenant/user context (AsyncLocalStorage), and because `SET LOCAL` is transaction-scoped, `PgService.withTenant()` wraps each tenant-scoped web request in a transaction: check out a client, `BEGIN`, `set_config('app.tenant_id', …, true)` + `set_config('app.user_id', …, true)`, run the repository queries on that client, `COMMIT`. The worker (`umi_worker`, `BYPASSRLS`) skips this.

**Migrations (D8).** `umi-api` ships **no ORM migrate**. While the DB is on Supabase, schema changes go through **Supabase migrations** (the existing mechanism + the canonical `docs/migration/local-postgres/*.sql` scripts). When the database is lifted onto PostgreSQL on the VPS, migrations become a **Sqitch** plan of hand-written PostgreSQL SQL (`db/migrations/`). Application queries are raw SQL throughout, so the data layer is unaffected by that move — only the migration tool changes.

### 9.3 Landing-page leads → `grow.*` (existing schema, not net-new)

Leads already have a canonical home: **`grow.leads`** and **`grow.lead_events`** (per `platform-database-architecture.md` §grow — leads are Umi-internal prospects with `tenant_id` NULL, never tenant-scoped contacts). The landing migration *populates* these, it does not invent a schema:

- Map SQLite `leads` → **`grow.leads`** (id, email unique, name, phone, company, role_title, consent_state, lifecycle_status, `diagnostic_data` jsonb, diagnostic_date, attribution: first_contact_channel/campaign + utm_source/medium/campaign/content/term, referrer, landing_path, submitted_form, source_app, first_contact_at, sequence_paused, pause_reason, last_email_sent_at, timestamps). Add any of these columns the live `grow.leads` lacks via a small additive migration.
- Map SQLite `email_logs` + sequence state → **`grow.lead_events`** (event-sourced: `email_sent`, `email_failed`, `sequence_paused/resumed`, `responded`, `unsubscribed`, `converted`, with `event_data` jsonb carrying template_name/sequence_day).
- `grow` is **service-role only** → the leads module accesses it via the `umi_worker`/service connection, never `umi_app` (§11.2). A lead is promoted into tenant-scoped records (`core.people` etc.) only by a real onboarding/conversion workflow (out of scope here).

### 9.4 Connection policy

The dashboard already reaches the platform DB via the Supabase **session pooler** (`aws-1-us-east-2.pooler.supabase.com:5432`, observed in `apps/umi-dashboard/.env` as `PLATFORM_PROD_DATABASE_URL`). `umi-api` reuses the same project, with:

- **API (web)** connects as the **`umi_app`** role (RLS-enforced, non-`BYPASSRLS`) and sets `app.tenant_id` + `app.user_id` per request via `SET LOCAL` (§11.2). The **transaction** pooler (`:6543`) suits short stateless queries; the **session** pooler (`:5432`) is the current path and is fine to start with.
- **Worker** connects as **`umi_worker`** (`BYPASSRLS`, service/background) on a **session/direct connection** for long transactions. It owns all `queue.*`, `observability.*`, and `grow.*` access (service-role-only schemas). With BullMQ (Redis push) we no longer need `LISTEN/NOTIFY` for wake-ups; the session connection is for transactional work (the outbox relay, §10.4).
- **Analytics/heavy reads** may use **`umi_readonly`**.
- Credentials come from VPS env (§12.4), **never hardcoded**. ⚠️ The connection string currently in `apps/umi-dashboard/.env` carries an inline DB password and was part of the historical credential exposure — it must be **rotated** and the rotated value placed only in VPS secret storage, never committed to `umi-api`.

---

## 10. The Durable Work Engine (BullMQ)

### 10.1 Queues (single source of truth in `jobs/queues.ts`)

| Queue | Jobs | Producer |
|---|---|---|
| `turns` | `turn.integrity`, `turn.process` | whatsapp ingress; turn.process can enqueue follow-ups |
| `enrichment` | `message.embed`, `conversation.summarize`, `customer.extract_facts`, `product.embed`, `embed.backfill` | turn.process; backfill scheduler |
| `outbound` | `twilio.reply`, `twilio.status_notification`, `twilio.cancel_notification`, `twilio.location_pin`, `whatsapp.lifecycle` | turn.process; KDS triggers; lifecycle scheduler |
| `integrations` | `zettle.sync` | scheduler / manual |
| `lifecycle` | cash crons + landing email sequences | repeatable scheduler |

### 10.2 Scheduling (replaces `pg_cron`)

`jobs/lifecycle.scheduler.ts` registers BullMQ **repeatable jobs** (cron syntax) for: `birthday_rewards`, `expire_birthday_rewards`, `goal_proximity`, `reward_expiring`, `streak_recognition`, `welcome_no_visit`, `winback_inactive`, and landing email-sequence ticks. Per-tenant timezone handled in job logic with stored tenant timezone + `AT TIME ZONE` (preserve current behavior).

### 10.3 Reliability semantics (declarative, not hand-rolled)

- **Idempotency:** deterministic `jobId` — `MessageSid` for ingress, `turn_id` for reply, `card_id:journey:date` for lifecycle. BullMQ dedups duplicate enqueues.
- **Retries/backoff:** `attempts` + `backoff: { type: 'exponential' }` (replaces the manual `2^attempt` capped-at-5-min logic).
- **Dead-letter:** exhausted jobs land in BullMQ `failed`; a handler records them to **`queue.dead_letters`** (canonical, §10.5) and mirrors a span to `observability.*` for `umi-logs` visibility.
- **Priority:** interactive turns get higher BullMQ priority than background enrichment (preserves `INTERACTIVE_JOB_PRIORITY`).

### 10.4 Transactional outbox (canonical — not optional)

The platform architecture **mandates** `queue.outbox_events` as the cross-product connective tissue (`platform-database-architecture.md` §3.2): any state change that must trigger a side effect writes an outbox row **in the same transaction** as the state change; consumers are idempotent; delivery is at-least-once. Examples: `order.completed → loyalty awards points`, `order.submitted → KDS projection refreshes`, `loyalty.points_awarded → notify push`, `turn.completed → twilio reply`.

BullMQ is the **execution layer** over this durable boundary:

1. A service writes its domain change + a `queue.outbox_events` row in one DB transaction.
2. A **relay** (worker, polling `outbox_events WHERE published_at IS NULL`, ordered) enqueues each event into the matching BullMQ queue and stamps `published_at`.
3. BullMQ workers (consumers) process idempotently; deterministic `jobId` dedups; success is recorded back; exhausted jobs flow to `queue.dead_letters`.

This keeps the canonical guarantee (no lost reply/award on a crash between write and send) while honoring D3 (BullMQ does delivery, retries, scheduling).

### 10.5 Mapping to the canonical `queue.*` tables

| Canonical table | Role under BullMQ |
|---|---|
| `queue.inbound_events` | **Idempotent ingress gate** — Twilio `MessageSid`, `UNIQUE(provider, provider_event_id)`. Webhook inserts here first; duplicates are dropped before any enqueue. |
| `queue.outbox_events` | **Transactional outbox** (§10.4). The durable source the relay drains into BullMQ. |
| `queue.idempotency_keys` | Generic dedup for non-event operations. |
| `queue.dead_letters` | Sink for BullMQ-exhausted jobs, for manual inspection (preserves the current dead-letter audit trail). |
| `queue.jobs` / `job_attempts` | **Superseded for execution** by BullMQ/Redis. Keep the tables only if a Postgres-visible job audit is still wanted; otherwise execution state lives in Redis + `observability.*`. |

---

## 11. Auth & Security Model (unified)

### 11.1 Today (fragmented)

- Dashboard: scrypt password, **header `X-UMI-User-ID`** (no real token), entitlement via `product_instances`.
- Cash: JWT (jose) access/refresh — *stays in cash*.
- UMI admin: separate JWT.

### 11.2 Target for `umi-api`

Two layers, never conflated (per `2026-06-16-canonical-schema-and-identity.md` §2.1, locked 2026-06-17):

**(a) Connection identity → fixed Postgres roles + RLS.** Three roles only, they never grow with tenants/users:
- **`umi_app`** — the web request role. Non-superuser, **non-`BYPASSRLS`**. The backend connects as this and runs `SET LOCAL app.user_id = … ; SET LOCAL app.tenant_id = …` per request, so RLS on `ops`/`comms`/`loyalty`/`device`/`kitchen` is *really* enforced (a code bug cannot cross tenants). RLS policies live in `local-postgres/050_rls_tenant_isolation.sql`.
- **`umi_worker`** — `BYPASSRLS` service/background role for the worker; the only role that touches `queue.*`, `observability.*`, `grow.*` (service-role-only schemas).
- **`umi_readonly`** — analytics.
- Supabase grant mapping: `authenticated → umi_app`, `service_role → umi_worker`, `anon` dropped.

**(b) User authorization → JWT + guards + RPC re-checks.**
- **JWT access + refresh in httpOnly cookies** (`jose`). Replaces the header-only scheme (D9). CSRF-protected via SameSite + CSRF token on mutations.
- **`password.service.ts`** verifies existing `scrypt` hashes (no forced reset; optional upgrade-on-login). Hashes live in `core.users` (never in a `core.people` row surfaced by Customer 360).
- **`AuthGuard`** (valid JWT) + **`EntitlementGuard`** (`product_not_active` 403, reading `core.product_instances` status `active|trialing`) + **`@Roles`/`@RequirePermission`** decorators. Roles are **edges** — `core.tenant_memberships` + `membership_roles` + `permissions`, never a column on `people`, never a Postgres role per tenant.
- **Tier-1 sensitive writes re-check inside `SECURITY DEFINER` RPCs** (loyalty especially), so the DB is the last line of defense, not just the guard.
- **`device-auth.guard.ts`** for KDS (`X-KDS-Device-Token`), preserving the existing device contract (§8.1).
- **Twilio webhook** authed by signature (no user auth).
- **No public cron endpoints** — scheduling is in-process (BullMQ). Any internal HTTP is protected by a shared secret.

### 11.3 Secrets

All from VPS env (§12.4). **None hardcoded.** Reminder: the platform Supabase service_role + Twilio token were exposed historically and rotation is pending — set **fresh, rotated** secrets on the VPS, do not copy leaked values.

### 11.4 Raw body

Fastify is configured with a raw-body hook on the Twilio webhook route only, so signature validation sees the exact bytes.

### 11.5 Cash dual-write guard (D11 — the safety mechanism)

While `umi-cash` is the live writer, `umi-api` must never write the customer-facing wallet/loyalty tables. Two independent guards:

1. **Application flag — `CASH_WRITE_ENABLED` (default `false`).** When false, `cash-write.controller.ts` is **not mounted** (no live write routes) and no cash-write job is scheduled. `cash-write.service.ts` exists and is unit/integration-tested against staging, but is unreachable in prod. Reads (`cash-read.service.ts`) are always live.
2. **Database privilege.** Loyalty mutations only happen through gated `SECURITY DEFINER` RPCs (`award_points`, redemption, gift-card load/spend — §9.1). Until activation, **`umi_app` is granted no `EXECUTE` on those RPCs** and only `SELECT` (via `v_*` views) on `loyalty.*`. A bug cannot move points or balances. Append-only `points_ledger` (UPDATE/DELETE blocked by trigger) is the final backstop even after activation.
3. **Carve-out for lifecycle crons.** They run as `umi_worker` and only read `loyalty.*` + write their own send-dedup/idempotency record (`queue.idempotency_keys`) — never the wallet ledger. Non-conflicting with `umi-cash`'s writes.

Activation (Phase 7) flips the flag **and** grants `umi_app` `EXECUTE` on the loyalty write RPCs in one reviewed change. This makes the inert state structurally enforced, not merely a code path nobody calls.

---

## 12. Deployment & Operations (VPS)

### 12.1 Compose topology

`docker-compose.yml`: `umi-api` (web), `umi-worker` (worker), `redis` (BullMQ, AOF persistence on), `caddy` (TLS + reverse proxy). One image, two commands (`node dist/main` vs `node dist/worker`).

### 12.2 Reverse proxy / TLS

Caddy terminates HTTPS and routes the public domain to `umi-api`. Automatic certs. The public surface is just: Twilio webhook, KDS endpoints, dashboard API, landing API.

### 12.3 CI/CD

GitHub Actions: build → test (unit + integration + KDS contract) → build image → deploy to VPS (registry pull or `ssh` + `compose up`). Health-gated, rolling. `GET /health` checks DB + Redis.

### 12.4 Secrets / config

VPS env file (root-only) or SOPS/Doppler: `DATABASE_URL` (+ direct/session), `REDIS_URL`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `TWILIO_*`, `ZETTLE_*`, SMTP creds, `JWT_SECRET`, and feature flags incl. **`CASH_WRITE_ENABLED=false`** (§11.5). All secrets **rotated** (§11.3). Typed + validated at boot via `config.schema.ts` (fail fast on missing).

### 12.5 Backups / availability

- Postgres: Supabase-managed backups (unchanged).
- Redis: AOF persistence; jobs survive restart. Redis is a new dependency — note it in the risk register (§14).
- Single VPS is a SPOF for the runtime; acceptable for current volume (~1k events/hr). Document an upgrade path (managed Redis, second VPS) before scaling.

---

## 13. Phased Implementation Plan

Each phase ships independently, is reversible, and has explicit acceptance criteria. Edge functions stay deployed until each domain is verified on the VPS — **the cutover point per domain is a single webhook/URL/config flip, which can be flipped back.**

### Phase 0 — Foundations ✅ LIVE
**Scope:** Scaffold `apps/umi-api` (NestJS + Fastify, the §6 structure, root `README.md` map). `DatabaseModule` (`pg.service.ts` two pools + `request-context.middleware.ts` per-request context + `PgService.withTenant` `SET LOCAL` §9.2/§11.2), `ConfigModule` (typed env), `LoggingModule`, `HealthModule`. BullMQ + Redis wired with an empty queue. Dual bootstrap (`main.ts` / `worker.ts`). Dockerfile + compose + Caddy. CI. Deploy a hello-world to the VPS with TLS. Confirm the live `v_kds_tickets` projection + loyalty write-RPC names and write the repository SQL accordingly.
**Done when:** VPS serves `GET /health` over HTTPS (DB + Redis green); CI deploys; a tenant-scoped test query proves RLS isolation under `umi_app`.

### Phase 1 — Shared core & adapters ✅ LIVE
**Scope:** Port adapters (`twilio`, `anthropic`, `voyage`, `zettle`, `email`) as injectable providers with unit tests. Port logging/tracing (`observability.*` writes verified readable by `umi-logs`). Stand up `jobs/queues.ts` + BullMQ worker bootstrap with idempotency/retry/dead-letter policy (no domain processors yet).
**Done when:** adapters unit-tested; a no-op job round-trips through BullMQ with retry + dead-letter; a trace row appears in `umi-logs`.

### Phase 2 — Auth + admin/owner domain (dashboard backend) ✅ LIVE (cash shipped LIVE, not inert)
**Scope:** `AuthModule` (JWT cookies, scrypt verify, guards, entitlement, Brevo reset). `TenantsModule`, `StaffModule`, `HoursModule`, `CustomersModule` (Customer 360 reads, decomposed), `CashModule`. Decompose `server.js` into these. Point the **dashboard frontend** at the new API base URL (env), behind a flag.
**Shipped reality (D11 reversed):** the cash **write** side is LIVE, not inert — top-up, purchase, gift-card issue/redeem, scan, and customer self-registration write canonical `loyalty.*` directly. The dashboard SPA is cut over (`cookie` auth mode). Verified against a prod-schema replica (36/36 integration under enforced RLS, cross-tenant isolation, `server.js` parity) and in-browser.
**Done when:** ✅ the full dashboard admin-panel flow (login, tenants, staff, hours, customers, customer-360, cash analytics + writes, entitlement 403s) runs against `umi-api` on the VPS, parity-checked against `server.js`.
**Rollback:** clear the dashboard's `VITE_AUTH_MODE`/`VITE_API_BASE` Vercel vars → redeploy → back on `server.js`.

### Phase 3 — Conversational engine (ConversaFlow ingress + worker) 🟢 BUILT + MERGED (dormant, pre-cutover)
**Status (2026-06-27):** Code-complete and **merged to `main` (PR #6, merge `c6d619d`)**, CodeRabbit review fully addressed (2 rounds: 34/35 + 2 follow-ups). 199/199 vitest + tsc + build green; bindings verified on a schema-identical local replica. **Dormant** — nothing changes in prod until the VPS pulls `main`, the Twilio webhook is repointed, and `LIFECYCLE_CRONS_ENABLED` is flipped. The gated **hours-unification backfill it depends on is APPLIED to prod** (2026-06-27, via the Supabase CLI); the order-write idempotency index (`ops_orders_source_transaction_uidx`) already exists on prod. Cash lifecycle crons are **WhatsApp-only** here — 3 of the 7 legacy journeys (birthday issuance / expire / goal-proximity) are wallet-push-only and were dropped (stay in umi-cash, §2.1.1/§7.4).
**Scope:** `modules/conversations/*` (whatsapp ingress, security, prompts, intent, memory, tools split by concern), `modules/lifecycle/*`. `jobs/turns.processor.ts`, `enrichment.processor.ts`, `outbound.processor.ts`, `integrations.processor.ts` (zettle.sync), `lifecycle.processor.ts` + `lifecycle.scheduler.ts` (4 WhatsApp journeys, §2.1.1). Transactional-outbox relay for the reply path (§10.4).
**Cutover:** set Phase-3 env on the VPS (`TWILIO_*`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `GOOGLE_MAPS_API_KEY`, `ZETTLE_*`, `DEFAULT_TENANT_ID`); the webhook **fails closed** without `TWILIO_AUTH_TOKEN` (`ALLOW_INSECURE_TWILIO_WEBHOOK` is a dev-only bypass, rejected at boot in production). Repoint the **Twilio webhook URL** to `https://api.umiconsulting.co/conversations/whatsapp`; canary/soak against live WhatsApp traffic; compare replies + traces to the edge function. **Sequence Phase 4 (KDS) before/with this** so confirmed orders reach the kitchen display.
**Done when:** real WhatsApp orders flow end-to-end on the VPS (ingress → turn → tools → reply → outbound), embeddings/summaries/facts run, KDS status notifications fire, cash lifecycle nudges send, all traced in `umi-logs`.
**Rollback:** repoint the Twilio webhook to the edge function.

### Phase 4 — KDS endpoints 🟢 BUILT (dormant, pre-cutover)
**Status (2026-06-27):** Code-complete in `apps/umi-api/src/modules/kds/*`. 236/236 vitest (37 new KDS unit + contract tests) + tsc + build green; **verified end-to-end (25/25) against the local prod-schema replica** exercising the real `KdsRepository`/`KdsService` over canonical `core`/`ops`/`queue`/`device`/`kitchen`: WhatsApp order → `v_kds_tickets` board → pairing PIN → device-auth → transition (writes `ops.orders`/`order_items.kitchen_status` + append-only `ops.order_events` + `queue.outbox_events`) → events cursor → partial cancel → **device revocation** → dashboard device list. The replica run caught two real bugs the mocked tests couldn't (the `ops.order_events` **partial** unique index needs `ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL`; a just-paired device is `offline` until its first board poll touches `last_used_at`). **Dormant** — nothing changes until the iPad is repointed and `KDS_STATUS_NOTIFY_ENABLED` is flipped.
**Realized design (vs. the original plan):**
- **No canonical `kds.*` RPCs exist** (the platform build ships only the `ops.v_kds_tickets` projection + append-only `ops.order_events`, not `get_board_snapshot`/`transition_ticket`/etc.). So board reads + transitions/partial-cancels are **reimplemented in TypeScript** (`KdsRepository`) over `ops.*`, preserving the frozen iPad JSON byte-for-byte (item `unit_price` in currency units, `customer_name/phone` resolved from `core.people`, `last_event_sequence` from `order_events`).
- **Frozen iPad endpoints** (`KdsController`): `POST /kds/{pairing,board,command}` + `/functions/v1/kds-*` aliases (no global prefix, so aliases are literal paths). They own the Fastify `@Res()` reply to emit byte-exact bodies/status/headers and bypass the global `AllExceptionsFilter` (which would wrap `device_revoked`). Device auth is in-handler (a CanActivate guard couldn't produce the frozen body through the global filter).
- **Dashboard surface** (`KdsDashboardController` + `KdsAdminController`): `/api/tenants/:tenantId/kds/*` (devices, orders, ticker, stations, pairing, provision/pairing-pin, approve/deny, update/revoke, transition) + `/api/:slug/admin/{devices,orders,orders/:id/transition}` aliases — the SPA's KDS screens stop 404ing. Guard stack = `AuthGuard, TenantAccessGuard, EntitlementGuard('kds')` (same trust model as cash admin; no per-action permission).
- **Device registry (owner-directed):** pairing populates a `device.devices` row (`device_type='kds'`) and links the session to it. The canonical model is ONE `device.devices` registry discriminated by `device_type` (`kds|kiosk|printer|scanner|terminal|sensor|clock|signage`) — POS/printers later reuse the *same* `device.sessions`/`pairing_requests`/`events` lifecycle, so device-auth is written once. `kitchen.*` is the kitchen *domain* (stations/routing a KDS device attaches to), not hardware; `device.*` is the product-neutral hardware plane.
- **Heartbeat = `device.sessions.last_used_at`** (no Redis added — there is no general Redis client, only the BullMQ connection). The board/command poll touches it; the dashboard derives live/slow/offline server-side. The dashboard's broken same-origin `/api/kds/heartbeats` call was removed and folded into `GET /kds/devices` (the "remove the `callKdsPairingBackend` duplicate" deliverable; `server.js` stays dead/untouched).
- **Order→notify loop:** a transition emits `queue.outbox_events (event_type='twilio.status_notification' | 'twilio.cancel_notification')` — routes the existing OutboxRelay/OutboundProcessor already handle, so **no job-engine changes**. Gated by the new `KDS_STATUS_NOTIFY_ENABLED` (default false) to avoid double-send while the edge `kds.transition_ticket` RPC is still live.
**Cutover:** pull `main` on the VPS (`device.*`/`kitchen.*` must exist on prod — bind-time confirm before flip); update KDS `Info.plist` to the VPS; ship an app build. Aliases keep old builds working during rollout. Then flip `KDS_STATUS_NOTIFY_ENABLED=true` together with decommissioning the edge functions.
**Done when:** on staging then prod — pairing PIN flow, board snapshot+polling, transitions, partial cancels, and **device revocation** all verified against the VPS; contract tests green. *(Local-replica equivalent: ✅.)*
**Rollback:** KDS config points back at the edge functions (still deployed).

### Phase 5 — Landing-page leads
**Scope:** `modules/leads/*` (contact, diagnostic + scoring, sequences, webhook). Populate `grow.leads`/`grow.lead_events` (§9.3; additive columns if the live `grow.leads` lacks any). Email sequences as repeatable jobs. Point the landing page at the API; retire SQLite.
**Done when:** lead capture, diagnostic scoring, and the full email sequence (incl. pause/unsubscribe/convert) run on the VPS with durable Postgres state.
**Rollback:** landing page falls back to its own routes (SQLite) — local only.

### Phase 6 — Decommission & cleanup (DRY pass)
**Scope:** Remove the Supabase Edge Functions (whatsapp-handler, job-worker, kds-*, zettle-oauth) and the `pg_cron` schedules now served by BullMQ. Remove `umi-dashboard/server.js` + `api/index.js`. Consolidate any remaining duplicate Twilio/email code. Confirm `umi-logs` still reads `observability.*` and `umi-cash` still works untouched. Final spaghetti/dup sweep.
**Done when:** no live traffic hits any edge function; `umi-api` is the sole backend for all routed apps; duplication removed.

### Phase 7 — Dual-writer cutover + decommission `umi-cash` (LATER)
**Cash writes already activated early (D11 reversed, Phase 2 — LIVE).** So this phase is no longer "activate"; it's the **Stage 4 dual-writer decision**: umi-api and `umi-cash` both currently write `loyalty.*` (safe coexistence — append-only ledger, `balance = SUM`). Soak-compare the two writers, then route customer cash-write traffic off `umi-cash` and retire its writers. The remaining build at this point is **passes/APN** if deferred (§7.4) — `.pkpass` generation, the PassKit v1 web-service protocol, Google Wallet, APN push — plus repointing the pass `webServiceURL` to the VPS and moving wallet certs into VPS secrets. Highest-risk (customer-facing money/loyalty) — own soak window.

---

## 14. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Binding to a stale/wrong projection or RPC name (e.g. old `kds.*` vs `v_kds_tickets`) | Low | Medium | Schema is confirmed canonical (§9.1); only the `v_kds_tickets`/loyalty-RPC names need a bind-time check in Phase 0 |
| RLS context not set → cross-tenant data leak or empty results | Medium | High | `umi_app` is non-`BYPASSRLS`; a Nest interceptor sets `SET LOCAL app.tenant_id/user_id` on every request; Phase 0 isolation test gates it |
| Twilio webhook cutover drops/dupes messages | Low | High | MessageSid idempotency = BullMQ jobId; canary + instant rollback to edge fn |
| KDS contract regression breaks the iPad app | Medium | High | Frozen DTOs + contract tests; `/functions/v1` aliases; staging verify incl. revocation |
| Redis is a new SPOF/dependency | Medium | Medium | AOF persistence; health checks; documented managed-Redis upgrade path |
| Transactional-outbox gap drops a customer reply on crash | Low | High | Outbox relay for the reply path (§10.4) |
| VPS single point of failure / ops burden vs managed edge | Medium | Medium | Compose + health-gated CI; document 2nd-VPS path; acceptable at current volume |
| Pooler can't do session features the worker needs | Low | Medium | Worker uses a direct connection; BullMQ removes the NOTIFY need |
| Secrets copied from leaked values | Low | High | Rotate all; set fresh on VPS; never hardcode (§11.3) |
| `umi-cash` and `umi-api` write-conflict on shared cash tables (dual writers) | Low | **High** | Built-but-inert writes (D11): `CASH_WRITE_ENABLED=false` leaves write routes unmounted **and** SELECT-only DB grant makes writes structurally impossible (§11.5). Lifecycle `lifecycle_sends` writes are the only carve-out (non-conflicting). |
| `tools.ts` (80KB) port introduces behavior drift | Medium | Medium | Split by concern with tests per tool group; diff replies against edge fn during soak |

---

## 15. Open Items / Preflight Checklist

- [x] Schema is confirmed canonical (§9.1) — no longer a blocker. Remaining: bind-time confirm of `v_kds_tickets` + loyalty write-RPC names (Phase 0).
- [ ] **Cash passes/APN (§7.4):** build-now-inert vs defer to Phase 7 activation — recommend **defer**. Your call.
- [ ] Confirm process manager: Docker Compose (recommended) vs systemd+PM2.
- [ ] Provision the VPS (Node 22, Docker, domain + DNS for the public webhook).
- [ ] Confirm/rotate all secrets; set on the VPS (incl. rotating the exposed `PLATFORM_PROD_DATABASE_URL` password).
- [ ] Confirm the three coexistence boundaries (§2.1) and the inert-cash model (D11/§11.5) — accepted by default; veto here.

---

## 16. Definition of Done (program)

1. `umi-api` (NestJS + Fastify) runs on the VPS as `web` + `worker`, backed by BullMQ/Redis and the platform Postgres.
2. Dashboard, ConversaFlow ingress + jobs, KDS, and landing-page leads all run on `umi-api`. `umi-logs` and `umi-cash` are untouched and working.
3. All Supabase Edge Functions and `pg_cron` schedules are decommissioned; `umi-dashboard/server.js` is removed.
4. The codebase follows §6: three buckets, business-named folders, `<thing>.<role>.ts` files, a root `README.md` map — a new engineer can navigate it cold.
5. KISS/DRY honored: one DB layer, one auth layer, one logging layer, one adapter per external system, no duplicated Twilio/email/KDS-pairing code.
6. Tests: unit (services/adapters), integration (staging Postgres), KDS contract, and a WhatsApp soak parity check — all green.
```
