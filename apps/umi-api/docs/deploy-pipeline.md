# umi-api deploy pipeline (GitHub Actions → GHCR → VPS pull)

Automates the old manual flow (`git pull && docker compose up -d --build` on the
VPS) into push-button CD, **without building on the live box**.

## How it works

```
PR opened ─────────────▶ umi-api-ci.yml         typecheck + build + test (gate)
merge to main ─────────▶ umi-api-deploy.yml
                           └─ deploy-backend.yml (reusable)
                               1. typecheck + build + test
                               2. docker build  → push ghcr.io/umiconsulting/umi-api:sha-<git> + :latest
                               3. ssh VPS → apps/umi-api/deploy/deploy.sh
                                    git reset --hard origin/main   (refresh compose/Caddyfile; .env untouched)
                                    pin UMI_API_TAG=sha-<git> in .env
                                    docker compose pull && up -d    (no build)
                               4. curl https://api.umiconsulting.co/health
```

The image is built once in CI and the VPS only **pulls** it, so deploys don't
compete with the live API/worker for CPU/RAM. Caddy, Redis, and TLS are
untouched. `docker-compose.yml` carries both `image:` (what the VPS pulls) and
`build:` (local-dev fallback), so `docker compose up -d --build` still works for
local development.

## One-time setup

### A. VPS (run via Hermes)

```bash
# 1. Dedicated deploy key (no passphrase) so CI can SSH in
ssh-keygen -t ed25519 -N "" -C "gha-deploy-umi-api" -f ~/.ssh/umi_deploy
cat ~/.ssh/umi_deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
echo "----- PRIVATE KEY (give to the repo owner for the VPS_SSH_KEY secret) -----"
cat ~/.ssh/umi_deploy

# 2. Let the VPS pull the private GHCR image. Use a GitHub token with read:packages.
#    (Fine-grained PAT → Packages: Read-only, or a classic PAT with read:packages.)
echo "<GHCR_READ_TOKEN>" | docker login ghcr.io -u <github-username> --password-stdin

# 3. Confirm the deploy checkout exists and tracks main (default $HOME/umi).
#    If it lives elsewhere, set UMI_REPO_DIR in apps/umi-api/.env on the VPS.
cd ~/umi && git remote -v && git rev-parse --abbrev-ref HEAD
```

### B. GitHub repo secrets

Settings → Secrets and variables → Actions, or via `gh`:

```bash
gh secret set VPS_HOST     --body "<vps-ip-or-host>"        # e.g. api.umiconsulting.co or 2.24.204.15
gh secret set VPS_USER     --body "<deploy-ssh-user>"
gh secret set VPS_SSH_KEY  < ~/.ssh/umi_deploy              # the PRIVATE key from step A.1
gh secret set VPS_SSH_PORT --body "22"                      # optional; omit to default to 22
```

`GITHUB_TOKEN` (used to push to GHCR) is provided automatically — no secret needed.

## Routine deploys

Merge to `main`. That's it. Watch progress under the repo's **Actions** tab; the
run fails (and does not flip traffic blindly) if tests fail, the SSH/pull fails,
or `/health` doesn't come back.

## Rollback

Every deploy is an immutable `:sha-<git>` tag. To roll back, on the VPS:

```bash
cd ~/umi/apps/umi-api
sed -i 's/^UMI_API_TAG=.*/UMI_API_TAG=sha-<previous>/' .env
docker compose pull && docker compose up -d
```

(or re-run the deploy workflow on the older commit). Find prior tags in the
repo's **Packages → umi-api** list.

## Adding another backend service later (e.g. umi-logs)

The reusable workflow is service-agnostic. To onboard a new VPS backend:

1. Give it a `Dockerfile` + `docker-compose.yml` (with `image: ghcr.io/umiconsulting/<app>:${<APP>_TAG:-latest}`).
2. Copy `apps/umi-api/deploy/deploy.sh` to `apps/<app>/deploy/deploy.sh` (it's generic — keys off `APP_NAME`).
3. Copy `.github/workflows/umi-api-deploy.yml` to `<app>-deploy.yml` and change `app_name`, `app_dir`, `image`, `health_url`.

No change to `deploy-backend.yml`. Frontends (cash, landing, dashboard) stay on
Vercel — this pipeline is only for self-hosted Docker backends.
