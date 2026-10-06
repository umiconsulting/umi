# umi-api — VPS setup + deploy runbook

> **Current state: Phases 0–3 are LIVE in production** at
> `https://api.umiconsulting.co` — the umi-dashboard SPA on httpOnly-cookie auth,
> cash writing canonical `loyalty.*`, and the WhatsApp pipeline cut over to the VPS.
> **Phase 4 (KDS) and Phase 5 (landing-page leads) are merged and deployed but
> DORMANT** behind their flags — see
> **[Phases 3–5 — env, flags, and the remaining cutovers](#phases-35--env-flags-and-the-remaining-cutovers)**.
> For day-to-day deploys and the realized role/env model, jump to
> **[Phase 2 — live deployment](#phase-2--live-deployment-current-state)**.
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

---

## Phases 3–5 — env, flags, and the remaining cutovers

Phase 3 (the ConversaFlow WhatsApp engine — ingress → turn → tools → reply, plus
enrichment, Zettle catalog sync and lifecycle nudges) is **live**. Phase 4 (KDS
endpoints) and Phase 5 (landing-page leads) are merged and deployed but **dormant**:
the code runs, and the customer-visible half of each stays off until a flag flips.

[`src/shared/config/config.schema.ts`](../src/shared/config/config.schema.ts) is the
contract. This section describes it; it does not replace it. Only three values are
required — `DATABASE_URL_APP`, `DATABASE_URL_WORKER`, `REDIS_URL` — so a missing key
degrades one feature rather than failing boot. That cuts both ways: an absent
`VOYAGE_API_KEY` silently drops semantic product search back to lexical.

### `.env` — additions over Phase 2

```ini
# Conversational engine
ANTHROPIC_API_KEY=<inference key sk-ant-… — NOT an admin key>
VOYAGE_API_KEY=<embeddings; without it semantic product search degrades to lexical>
GOOGLE_MAPS_API_KEY=<optional — the location-pin tool degrades to text>

# WhatsApp ingress
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=          # the webhook FAILS CLOSED without this
TWILIO_WHATSAPP_FROM=whatsapp:+…
TWILIO_WEBHOOK_URL=https://api.umiconsulting.co/conversations/whatsapp   # the EXACT signed URL
DEFAULT_TENANT_ID=<fallback tenant when an inbound number has no channel_account row>

# Catalog sync
ZETTLE_CLIENT_ID=
ZETTLE_API_KEY=             # the adapter wants a bearer token; prod holds CLIENT_ID+SECRET (OAuth)

# Leads (Phase 5)
SMTP_HOST= / SMTP_PORT= / SMTP_USER= / SMTP_PASSWORD= / EMAIL_FROM=
CONTACT_TO_EMAIL=<falls back to EMAIL_FROM, then hola@umiconsulting.co>
LEADS_WEBHOOK_SECRET=<HMAC-SHA256 for /api/leads/webhook/email-response>
```

### The four rollout flags — and why three are OFF

| Flag                        | Default  | Why                                                                                                                                                                                 |
| --------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OUTBOX_RELAY_ENABLED`      | **true** | Reply delivery. Worker-only and idempotent (deterministic jobIds). Set false only to pause delivery in an emergency.                                                                |
| `LIFECYCLE_CRONS_ENABLED`   | false    | umi-cash still runs the same journeys. Flipping this before umi-cash stops **double-sends to customers**.                                                                           |
| `KDS_STATUS_NOTIFY_ENABLED` | false    | The iPad still calls the Supabase edge functions, whose `kds.transition_ticket` RPC already enqueues these. Transitions still execute when off — only the customer notify is gated. |
| `LEADS_SEQUENCE_ENABLED`    | false    | The landing page still runs its own SQLite/Vercel cron. Public contact/diagnostic routes stay live either way; only the background sequence tick is gated.                          |

The three OFF flags are off for one reason: **a second sender still exists.** So each
remaining cutover is "turn the old sender off, _then_ flip" — never just "flip".

A typo cannot silently disable a flag. `booleanFromEnv` accepts only
`1/true/yes/on` and `0/false/no/off`; anything else fails boot loudly, so
`LIFECYCLE_CRONS_ENABLED=ture` never ships as a quiet `false`.

### Two things the API refuses to boot with

`config.schema.ts`'s `superRefine` rejects, under `NODE_ENV=production`:

- **`ALLOW_INSECURE_TWILIO_WEBHOOK=true`** — it disables Twilio signature validation.
  It is a local-dev escape hatch and cannot reach production. Separately, the webhook
  **fails closed** when `TWILIO_AUTH_TOKEN` is unset: it drops the request instead of
  processing unsigned input. There is no unsigned-ingress path.
- **`LEADS_SEQUENCE_ENABLED=true` with no `LEADS_WEBHOOK_SECRET`** — without the
  secret the email-response webhook is rejected in production, so reply-driven
  `mark_responded` / unsubscribe never lands and we keep mailing people who already
  replied or opted out.

### TLS to Postgres

`PGSSLROOTCERT` — a path to, or an inline PEM of, the Postgres server's root CA —
puts **both** pools on `verify-full` (CA + hostname + `rejectUnauthorized`). Unset
means plaintext, which is right for local dev against localhost and wrong here. Do
**not** put `sslmode` in the connection URLs; this variable governs TLS. It is an
open item on the build-v3 deploy gate (see `docs/migration/build-v3/SECURITY_GATE.md`).

### Ad-hoc prod SQL

Through the **Supabase CLI**, linked to `xbudknbimkgjjgohnjgp`:

```sh
supabase db query --linked "SELECT …"                  # Management API, no DB password
supabase db query --db-url "$DIRECT_DATABASE_URL" …    # direct conn (DDL / CREATE INDEX CONCURRENTLY)
```

`db query` speaks the extended protocol — **one command per call**. A multi-statement
file errors `42601`, so a gated migration is run statement by statement.

### The two remaining phase cutovers

- **KDS (Phase 4).** Repoint the iPad's `Info.plist` at `api.umiconsulting.co`,
  decommission the `kds-command` / `kds-board` / `kds-pairing` edge functions, _then_
  set `KDS_STATUS_NOTIFY_ENABLED=true`. **Rollback:** point the iPad back.
- **Leads (Phase 5).** Apply `003_grow_grants.sql` (a no-op on prod) → set
  `NEXT_PUBLIC_UMI_API_BASE=https://api.umiconsulting.co` on the landing Vercel
  project and add its origin to `CORS_ORIGINS` → disable the landing SQLite/Vercel
  cron **and** set `LEADS_SEQUENCE_ENABLED=true` together → retire SQLite.
  **Rollback:** unset the base var and re-enable the landing cron.

## Plane (self-hosted) shares this Caddy

Plane runs as its **own** compose project out of `/opt/plane` — separate stack,
separate Postgres, nothing to do with umi-api beyond sharing the box and the
proxy. This Caddy terminates TLS for both.

Version in production: **Commercial Edition v3.0.1** (the commercial build runs
free at 12 seats, so it costs the same as Community while leaving the paid tiers
one license key away — no reinstall, no data migration).

### How the ports are wired — and the trap in it

Caddy already owns 80/443, so Plane's proxy must not bind them. The end state:

| File                                     | Setting                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `/opt/plane/plane.env`                   | `LISTEN_HTTP_PORT=8080`, `LISTEN_HTTPS_PORT=8443` — **plain integers** |
| `/opt/plane/docker-compose.override.yml` | `ports: !override` pinning the real binds to `172.17.0.1`              |

```yaml
services:
  proxy:
    ports: !override
      - "172.17.0.1:8080:80"
      - "172.17.0.1:8443:443"
```

Binding to the Docker bridge IP rather than `0.0.0.0` makes the port
**structurally** unreachable from the internet — no firewall rule to maintain or
forget after a reboot. `ufw` was never an option: Docker's published ports bypass
its `INPUT` chain, so `ufw deny 8080` looks correct and does nothing.

Two things had to be learned the hard way here:

1. **`plane.env` will not take `172.17.0.1:8080`.** prime-cli validates that
   value as an integer and rejects the host-IP form, which is why the bind lives
   in an override instead of the env file where it belongs.
2. **`ports:` in a compose override CONCATENATES — it does not replace.** The
   first attempt added the bridge binds without `!override`, so the base file's
   `0.0.0.0` mappings survived alongside them. Result: Plane served the full app
   in cleartext on a public port (`9080`) while `8080` looked correctly closed.
   `!override` (Compose 2.24+) is what actually replaces the list.

### ⚠ Verify the ports after every Plane upgrade

The override file is **fragile by construction**: prime-cli does not know it
exists. If an upgrade changes the proxy's service name, or the override stops
applying for any reason, Plane silently goes back to binding `0.0.0.0` and the
app is exposed in cleartext again. Nothing errors. Nothing logs.

So after any `setup.sh` upgrade, from the box:

```sh
docker ps --format '{{.Names}}\t{{.Ports}}' | grep plane   # expect ZERO 0.0.0.0
```

and from off the box — this is the check that actually counts:

```sh
for p in 8080 8443 9080 9443 20025 20465 20587; do
  nc -z -w3 <vps-ip> $p && echo "$p OPEN — FIX IT" || echo "$p closed"
done
```

Only 80 and 443 should ever answer.

### The rest of the wiring

- **`extra_hosts: host.docker.internal:host-gateway`** on the caddy service is
  what lets it reach that bridge IP. Plane is a different compose project, so
  service-name resolution is not available.
- **`PLANE_DOMAIN` lives only in the VPS `.env`** (gitignored). Never edit the
  `Caddyfile` or `docker-compose.yml` on the box: `deploy/deploy.sh` runs
  `git reset --hard` before every `compose up`, so the edit is destroyed on the
  next deploy — silently. Route changes go through a PR, like this one did.

### If you ever reinstall

- **Do not pipe the installer into `sh`.** `curl … | sh -` makes stdin the pipe,
  so the interactive prompts cannot be answered and it exits 1. Download first,
  then run: `curl -fsSL https://prime.plane.so/install/ -o /tmp/i.sh && sudo bash /tmp/i.sh`.
- **`prime-cli setup` requires port 80 to be free**, and the check is compiled
  into the binary — no flag, no env var, no config skips it. Caddy has to be
  stopped for the duration. Use a fail-safe so a hung installer cannot leave the
  API down:

  ```sh
  cd ~/umi/apps/umi-api
  docker compose stop caddy && timeout 180 sudo bash /tmp/i.sh; docker compose up -d caddy
  curl -s https://api.umiconsulting.co/health
  ```

  The `;` before `up -d` is deliberate: Caddy comes back even if the installer
  fails or the timeout kills it. With `&&`, a hung installer leaves
  `api.umiconsulting.co` down indefinitely.

### Operating it

```sh
cd /opt/plane && ./setup.sh     # 2=start 3=stop 4=restart 5=upgrade 6=logs
```

Plane's installer **regenerates its `docker-compose.yaml` on every upgrade**, so
all configuration must live in `plane.env` or the override file — never in the
generated compose.

**Rollback:** remove `PLANE_DOMAIN` from `apps/umi-api/.env`, then
`docker compose up -d caddy`. umi-api is untouched either way.

### Not yet done

- **Plane's data is not backed up.** It lives in **bind mounts**, not Docker
  volumes: `/opt/plane/data/{db,minio,mq,redis,monitor}`. This VPS has no backup
  schedule at all — for Plane or for anything else.
- **No swap is configured.** 15 GiB total with Plane at ~3.3 GiB leaves room, but
  without swap a memory spike hands the choice of what to kill to the OOM killer,
  and it may pick umi-api. Fix:
  `sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`,
  then persist in `/etc/fstab` and set `vm.swappiness=10`.
- **`plane-space-1` reports unhealthy.** Seen right after install; not yet
  reconfirmed once the stack settled.
- **Stage 4 — dual-writer cutover:** `umi-cash` still live-writes `loyalty.*`.
  Both writers coexist safely (append-only ledger, `balance = SUM`); retiring
  umi-cash's writes is a separate decision.
- PassKit/Google-Wallet cert port; CSRF double-submit guard (SameSite=Lax is the
  current mitigation).
