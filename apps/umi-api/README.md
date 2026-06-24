# umi-api

The centralized Umi backend. **NestJS + Fastify** HTTP API and **BullMQ** workers,
one codebase running as two processes on a VPS. Talks to the platform Postgres
with **raw SQL via `pg`** (no ORM).

> Full design: `docs/architecture/2026-06-23-umi-api-centralization-spec.md`.
> This service absorbs the ConversaFlow edge functions, the dashboard backend,
> and landing-page leads. `umi-logs` and `umi-cash` stay separate.

## The map — you look in exactly one of three places

```
src/
  modules/   ← one folder per BUSINESS domain (controller + service + repository)
  jobs/      ← everything async (BullMQ queues, processors, schedulers)
  shared/    ← cross-cutting infra (database, config, logging, http, adapters…)
```

Every file is named `<thing>.<role>.ts` — `.controller`, `.service`,
`.repository`, `.guard`, `.middleware`, `.filter`, `.interceptor`,
`.processor`, `.scheduler`, `.adapter`, `.module`.
Folders are business nouns. Nothing is buried; no `utils/` grab-bags.

### Current tree (Phase 0)

```
src/
  main.ts                       # web process bootstrap (Fastify HTTP)
  worker.ts                     # worker process bootstrap (BullMQ, no HTTP)
  app.module.ts                 # web root module
  worker.module.ts              # worker root module
  modules/
    health/                     # GET /health → DB + Redis status
  jobs/
    queues.ts                   # queue names — single source of truth
    queue.module.ts             # BullMQ + Redis wiring (shared)
    system.processor.ts         # no-op processor proving the wiring
  shared/
    config/                     # typed, validated env (zod)
    database/
      pg.service.ts             # two pg pools: umi_app (RLS) + umi_worker
      request-context.ts        # AsyncLocalStorage: tenant/user/requestId
      request-context.middleware.ts
      database.module.ts
    logging/                    # structured JSON logger + request interceptor
    http/
      all-exceptions.filter.ts  # consistent JSON error envelope
db/
  migrations/                   # Supabase format now; Sqitch later
```

## Two processes, one image

- **web** (`main.ts`) — HTTP ingress; produces BullMQ jobs; never does heavy work.
- **worker** (`worker.ts`) — runs `@Processor` classes + schedulers.

So a slow Claude call can never block an inbound webhook, and the two scale
independently.

## Run it

### Local (Node)

```sh
npm install
cp .env.example .env          # fill DATABASE_URL_APP / DATABASE_URL_WORKER / REDIS_URL
npm run dev                   # web, watch mode
npm run dev:worker            # worker, watch mode (separate terminal)
```

### Local / VPS (Docker)

```sh
cp .env.example .env          # set API_DOMAIN=:80 locally, or a hostname on the VPS
docker compose up -d --build
curl http://localhost/health
```

### Checks

```sh
npm run typecheck
npm run build
npm run test
```

## Health

`GET /health` → `200 {"status":"ok","db":true,"redis":true,...}` when Postgres
and Redis are reachable, else `503 {"status":"degraded",...}`.

## Conventions (enforced in review)

- Layering is one-directional: `controller → service → repository → pg`.
- External systems are reached only through `shared/adapters/*` (one per service).
- One DB layer, one auth layer, one logging layer — infra is injected, never re-implemented.
- RLS: the web path runs as `umi_app` and sets `app.tenant_id`/`app.user_id` per
  request (a transaction in `pg.service.withTenant`); the worker runs as
  `umi_worker` (BYPASSRLS).

## Roadmap

Phase 0 (this) → 1 adapters → 2 auth + dashboard admin (incl. inert cash writes)
→ 3 conversations + worker → 4 KDS → 5 landing leads → 6 decommission edge
functions. See the spec for acceptance criteria per phase.
