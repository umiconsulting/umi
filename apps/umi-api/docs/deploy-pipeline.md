# API deployment pipeline

The CI entry point is `.github/workflows/ci.yml`.
See [the monorepo CI guide](../../../docs/development/CI.md) for app selection and release rules.

## Release order

1. Run shared checks and selected API validation.
2. Require `CI ready` to pass.
3. Build and push the image as `ghcr.io/umiconsulting/umi-api:sha-<40-character commit>`.
4. Run `apps/umi-api/deploy/deploy.sh` through SSH.
5. Fetch that exact commit for deployment files and migrations.
6. Apply unapplied migrations through `db/migrate.sh`.
7. Pull the image and start the services.
8. Check the API health endpoint.

The VPS pulls the prebuilt image.
It does not build the application.
The local `.env` and state directories remain outside Git.
Production also publishes `latest` as a reference; the running image uses the commit tag.

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

Merge a feature PR into `staging`.
The push validates and deploys the selected API release to the staging environment.
Promote validated staging changes to `main` through a PR.
The main push validates and deploys production unless `UMI_REWARD_RELEASE_HOLD=true`.

To deploy without another push, run `CI` on the release branch with `deploy=true`.
This option validates and deploys API, Dashboard, and Landing.
A manual run without this option performs validation only.
Deployment credentials are available only to deployment jobs.

## Release identity and environment

The image includes these values:

- `RELEASE_VERSION`: the Git description of the image commit.
- `RELEASE_GIT_COMMIT`: the full commit SHA.
- `RELEASE_BUILD_TIMESTAMP`: the UTC build time.
- `CONTRACT_VERSION`: the value from `packages/contract/src/catalog.ts`.

`/health/live` reports the image identity.
Keep these values in the image rather than the VPS `.env`.
Set `UMI_ENVIRONMENT` and the required service configuration in the environment state directory.
Set `EXPECTED_SCHEMA_VERSION` to the intended schema version.
The health check rejects a schema mismatch.

## Rollback

Select a previous immutable image tag from the package history.
Confirm that its code supports the current database schema.
Forward migrations are not automatically reversed.

For a production image rollback:

```sh
cd ~/umi/apps/umi-api
sed -i 's/^UMI_API_TAG=.*/UMI_API_TAG=sha-<previous-40-character-commit>/' .env
docker compose pull
docker compose up -d
```

This operation changes the image only.
For deployment files from that release, use the deploy script with the same immutable tag and environment paths.
The deploy script requires the full commit tag; it rejects `latest` and an empty argument.

## Other apps

Dashboard and Landing use Cloudflare Pages through the GitHub CI entry point.
Cash retains its existing external deployment configuration.
Their app directories share this Git repository.
