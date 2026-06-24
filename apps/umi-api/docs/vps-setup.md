# umi-api — VPS setup runbook (Phase 0 deploy)

Goal: get `umi-api` running on the VPS and `GET /health` returning green.
Prereqs already done: VPS provisioned, a non-root user created, Docker + Docker
Compose installed.

The whole stack runs from `apps/umi-api/docker-compose.yml`: **web** + **worker**
+ **redis** + **caddy** (TLS). You only manage two external things: the Postgres
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
{"status":"ok","db":true,"redis":true,"ts":"..."}
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

Run `db/roles/001_api_roles.sql` in the Supabase SQL Editor, then split the two
URLs onto the dedicated roles (session pooler username = `role.project-ref`):

```ini
DATABASE_URL_APP=postgresql://umi_app.xbudknbimkgjjgohnjgp:APP_PW@aws-1-us-east-2.pooler.supabase.com:5432/postgres
DATABASE_URL_WORKER=postgresql://umi_worker.xbudknbimkgjjgohnjgp:WORKER_PW@aws-1-us-east-2.pooler.supabase.com:5432/postgres
```

`docker compose up -d` to apply. (If the custom-role pooler login fails, verify
the role/password in Supabase; worst case use the direct connection host.)

---

## Operating it

```sh
docker compose logs -f umi-worker       # worker process
docker compose restart umi-api
docker compose down                     # stop everything
docker compose up -d --build            # redeploy after a code change
```
