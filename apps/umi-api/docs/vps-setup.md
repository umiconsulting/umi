# umi-api — VPS setup + deploy runbook

> **Current state (2026-06-25): Phase 2 is LIVE in production** at
> `https://api.umiconsulting.co`, and the umi-dashboard SPA is cut over to it
> (httpOnly-cookie auth). For day-to-day deploys and the realized role/env model,
> jump to **[Phase 2 — live deployment](#phase-2--live-deployment-current-state)**.
> The Steps below are the original Phase 0 bring-up, kept for history.

Goal: get `umi-api` running on the VPS and `GET /health` returning green.
Prereqs already done: VPS provisioned, a non-root user created, Docker + Docker
Compose installed.

The whole stack runs from `apps/umi-api/docker-compose.yml`: **web** + **worker**

- **redis** + **caddy** (TLS). You only manage two external things: the Postgres
  connection string and a `.env`.

---

## Step 1 — Get the code onto the VPS

The code isn't committed yet, so the simplest path is to copy the folder up from
your Mac (excluding build artifacts):

```sh
# from the repo root on your Mac
rsync -av --exclude node_modules --exclude dist --exclude .env \
  apps/umi-api/  YOUR_USER@VPS_IP:/opt/umi-api/
```

(Alternative: commit + push to `umiconsulting/umi`, then `git clone` on the VPS
and `cd apps/umi-api`.)

## Step 2 — Create the `.env` on the VPS

```sh
ssh YOUR_USER@VPS_IP
cd /opt/umi-api
cp .env.example .env
nano .env        # fill the values below
```

Minimum for Phase 0:

```ini
NODE_ENV=production
PORT=3000

# To see it green TODAY, point both at the existing platform pooler URL with a
# ROTATED password (do not reuse the leaked one). We split these into the
# dedicated umi_app / umi_worker roles in Step 6 (before Phase 2).
DATABASE_URL_APP=postgresql://postgres.xbudknbimkgjjgohnjgp:ROTATED_PW@aws-1-us-east-2.pooler.supabase.com:5432/postgres
DATABASE_URL_WORKER=postgresql://postgres.xbudknbimkgjjgohnjgp:ROTATED_PW@aws-1-us-east-2.pooler.supabase.com:5432/postgres

# Redis is the in-stack container — reached by service name, not exposed publicly.
REDIS_URL=redis://redis:6379

# Start on plain HTTP to verify; switch to your hostname in Step 5 for TLS.
API_DOMAIN=:80

CASH_WRITE_ENABLED=false
```

## Step 3 — Open the firewall

```sh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp     # for HTTPS in Step 5
```

## Step 4 — Bring the stack up and verify

```sh
docker compose up -d --build
docker compose ps                       # all four services "Up"
docker compose logs -f umi-api          # expect: "Postgres pools ready" + "listening on :3000"
curl http://localhost/health            # on the box, through Caddy
```

Expected:

```json
{ "status": "ok", "db": true, "redis": true, "ts": "..." }
```

`200 ok` = Phase 0 deploy done. `503 degraded` → check `db`/`redis` in the body
and the `docker compose logs`.

## Step 5 — Turn on HTTPS

Point a DNS A record (e.g. `api.umiconsulting.co`) at the VPS IP, then:

```sh
sed -i 's/^API_DOMAIN=.*/API_DOMAIN=api.umiconsulting.co/' .env
docker compose up -d                    # Caddy auto-provisions the certificate
curl https://api.umiconsulting.co/health
```

## Step 6 — Harden the DB roles (before Phase 2)

Run `db/roles/001_api_roles.sql` (roles) + `db/roles/002_api_grants.sql` (grants)
in the Supabase SQL Editor. **Realized model — see the Phase 2 section for why the
worker pool stays on `postgres` rather than `umi_worker`.**

---

## Operating it

```sh
docker compose logs -f umi-worker       # worker process
docker compose restart umi-api
docker compose down                     # stop everything
docker compose up -d --build            # redeploy after a code change
```

---

## Phase 2 — live deployment (current state)

Phase 2 (dashboard backend + live cash on canonical `loyalty.*`) is deployed and
the umi-dashboard SPA is cut over to it.

### Code lives in a git checkout (not rsync)

The VPS runs a **sparse git checkout** of `umiconsulting/umi` (`main`), so deploys
are `git pull` + rebuild — no copying from a laptop, and the deployed commit is
always known:

```sh
# one-time:  git clone --filter=blob:none --no-checkout git@github.com:umiconsulting/umi.git ~/umi
#            cd ~/umi && git sparse-checkout set apps/umi-api && git checkout main
# every deploy:
cd ~/umi && git pull origin main
cd apps/umi-api && docker compose up -d --build && docker compose ps
curl -s https://api.umiconsulting.co/health     # {"status":"ok","db":true,"redis":true}
```

The remote `.env` is gitignored and preserved across pulls.

### DB roles — the realized split

Supabase will **not** let a non-superuser grant `BYPASSRLS` to a custom role from
SQL (the SQL Editor role isn't a true superuser). So:

| Pool                  | Role                                                                        | Why                                                                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL_APP`    | **`umi_app`** (NOBYPASSRLS)                                                 | The request path. RLS `tenant_isolation` enforces tenant scoping; the app sets `app.tenant_id`/`app.user_id` per request.                                                           |
| `DATABASE_URL_WORKER` | **`postgres`** (the Supabase pooler role — it already has `rolbypassrls=t`) | The service/worker + public-customer (no-member) path needs to bypass RLS. `umi_worker` exists with grants but is **unused** until BYPASSRLS can be granted (superuser / SET ROLE). |

`umi_app` connects through the Supavisor pooler with the **dotted** username
`umi_app.<project_ref>`. Passwords are set out-of-band (never in `db/roles/*.sql`,
which is grants-only).

### Phase 2 `.env` (additions over Phase 0)

```ini
DATABASE_URL_APP=postgresql://umi_app.xbudknbimkgjjgohnjgp:APP_PW@aws-1-us-east-2.pooler.supabase.com:5432/postgres
DATABASE_URL_WORKER=postgresql://postgres.xbudknbimkgjjgohnjgp:PLATFORM_PW@aws-1-us-east-2.pooler.supabase.com:5432/postgres

JWT_SECRET=<strong, stable — signs the dashboard session cookie>
# These THREE must be byte-identical to umi-cash's prod values, or wallet-pass QR
# scans and customer tokens fail to verify during coexistence:
APP_QR_SECRET=<= umi-cash>
JWT_ACCESS_SECRET=<= umi-cash>
JWT_REFRESH_SECRET=<= umi-cash>

COOKIE_SECURE=true
COOKIE_SAMESITE=lax
COOKIE_DOMAIN=.umiconsulting.co          # cookies flow dashboard.→api. (same-site)
APP_URL=https://dashboard.umiconsulting.co
CORS_ORIGINS=https://dashboard.umiconsulting.co   # required for the SPA's cross-origin cookie calls
```

`CASH_WRITE_ENABLED` is vestigial (no code reads it — cash writes are always live).

### Dashboard frontend cutover (Vercel)

The SPA repoint is flag-gated and lives in `apps/umi-dashboard` (`cookie` auth
mode). To point the dashboard at umi-api, set **Production** env vars and redeploy
(Vite bakes `VITE_*` at build time — a redeploy is required):

```ini
VITE_AUTH_MODE=cookie
VITE_API_BASE=https://api.umiconsulting.co
```

**Rollback:** delete those two vars → redeploy → the SPA is back on `server.js`
(same-origin, `X-UMI-User-ID` header) with zero backend change.

### Not yet done

- **Stage 4 — dual-writer cutover:** `umi-cash` still live-writes `loyalty.*`.
  Both writers coexist safely (append-only ledger, `balance = SUM`); retiring
  umi-cash's writes is a separate decision.
- PassKit/Google-Wallet cert port; CSRF double-submit guard (SameSite=Lax is the
  current mitigation); `TraceService` → `observability.*` rebind.
