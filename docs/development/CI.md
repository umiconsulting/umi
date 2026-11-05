# Monorepo CI and deployment

`.github/workflows/ci.yml` owns validation and the deployment order.
App directories are products in one Git repository.
ONCA is a client.

## Validation order

1. Select affected apps from `.github/ci-paths.yml`.
2. Check workflow syntax, secrets, code quality, contracts, and tokens in parallel.
3. Run the selected app checks after their shared checks pass.
4. Require `CI ready` to pass.
5. Deploy selected services on release branches.

`CI ready` runs even when an earlier job fails or skips.
It requires each selected app to pass and each unselected app to skip.
Use this stable check for branch rules after its first successful GitHub run.
This change does not configure those rules.

| Change                                          | Selected app checks                                        |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `apps/umi-api/**`, `db/**`, `deploy/staging/**` | API build, typecheck, unit tests, and database integration |
| `apps/umi-dashboard/**`                         | Dashboard build                                            |
| `apps/umi-landing-page/**`                      | Landing static build                                       |
| `apps/umi-cash/**`                              | Cash tests and build with its npm lockfile                 |
| `apps/umi-pos/**`                               | Existing unsigned iOS build on macOS                       |
| `packages/contract/**`                          | API, Dashboard, and POS                                    |
| `packages/tokens/**`                            | Dashboard, Landing, and POS                                |
| Root pnpm configuration or lockfile             | API, Dashboard, and Landing                                |
| CI entry point or selection rules               | All apps                                                   |
| Documentation only                              | Shared checks                                              |

The mapping includes source imports outside package manifests.
Dashboard imports contract sources through Vite aliases.
Landing imports token files through its Tailwind configuration.
POS uses the generated Dart contract and token files.
Update the mapping when these dependencies change.

The common lint command still checks the pnpm workspace.
Selection avoids unrelated app builds and database integration checks.
It does not promise that each common check touches only one app.
Measure GitHub durations before further changes to caching or job division.

## Events and release selection

- Pull requests run validation against changes from the target branch.
- Internal, non-draft pull requests can publish affected Cloudflare previews after `CI ready` passes.
- Draft and fork pull requests run validation without deployment credentials.
- Pushes to `staging` and `main` run validation, then deploy affected services.
- Manual runs support validation. Set `deploy=true` on a release branch to validate and deploy all server and web services.
- Signed TestFlight distribution stays in its existing manual workflow.

Push selection compares against the last successful release on that branch.
A successful release has a successful `Release complete` job.
The lookup checks the most recent 100 successful push runs.
If it finds no complete release, it selects all apps.
Failed deployments therefore do not lose changes on the next push.

`UMI_REWARD_RELEASE_HOLD=true` preserves the production hold for API and Dashboard.
A held production run cannot advance the release baseline.
After the hold ends, the next push includes changes from the previous complete release.
Use a manual run with `deploy=true` to release without another push.

## Deployment owners

| App       | Deployment owner in this repository                                      |
| --------- | ------------------------------------------------------------------------ |
| API       | GitHub Actions, GHCR, and the VPS deploy script                          |
| Dashboard | GitHub Actions and Cloudflare Pages through Wrangler                     |
| Landing   | GitHub Actions and Cloudflare Pages through Wrangler                     |
| Cash      | Existing external hosting configuration; this CI adds validation only    |
| POS       | Existing unsigned iOS artifact and separate signed distribution workflow |

Give each app one automatic deployment owner.
Inspect provider Git integrations before activation to prevent duplicate deployments.
This change does not modify Cloudflare or Vercel project settings.
Cloudflare build watch paths control its Git integration, not Wrangler uploads from Actions.
Vercel can skip unaffected workspace projects when their dependencies meet its documented requirements.
Cash remains outside the pnpm workspace, so verify its provider rules explicitly.

Dashboard and Landing upload the built files during validation.
Their deployment jobs download those artifacts from the same workflow run.
They do not rebuild the apps.
API deployment waits for validation before it builds and publishes the image.
The VPS uses that image commit for Compose files and migrations.

## Repository commands

Run these commands from the repository root:

```sh
pnpm ci:release
shellcheck db/check.sh db/test/migrate.sh apps/umi-api/deploy/deploy.sh apps/umi-dashboard/scripts/build-ci.sh
```

Use a dedicated PostgreSQL 17 server with pgvector and a disposable Redis server for database checks.
The command creates and removes its own database.
It requires PostgreSQL client tools, OpenSSL, pnpm, and built API dependencies.

```sh
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres
export REDIS_URL=redis://127.0.0.1:6379
pnpm --filter @umi/api... build
pnpm ci:db
# Run only the migration runner behavior checks:
pnpm ci:migrations
```

The database check covers schema integration, realtime integration, schema freeze, RLS, and migration state.
The runner check uses synthetic migrations against another disposable database.
It proves initial application, repeat-run skipping, pending application, checksum rejection, and rejection of SQL errors.
A failed migration must not receive a ledger entry.
These checks preserve the existing transaction policy.
They do not prove rollback of partially executed files.

Cash validation uses fresh auth keys for each build.
Those keys are temporary build configuration and give no access to a deployed service.
Cash deployment does not consume this build artifact.

## Tools and decision basis

The design adapts Addy Osmani's independent checks and explicit `needs` dependencies.
His example validates a skills plugin; UMI adds its app and database boundaries.

| Tool               | Version           | Purpose                                                |
| ------------------ | ----------------- | ------------------------------------------------------ |
| Node               | 22                | Match the app engine requirements                      |
| pnpm               | 10.29.3           | Use the existing workspace lockfile                    |
| actionlint         | 1.7.12            | Check workflow syntax, expressions, and reusable calls |
| Gitleaks           | 8.30.1            | Scan fetched Git history with redacted output          |
| dorny/paths-filter | v3, pinned commit | Select affected apps without a custom diff parser      |
| Wrangler           | 4.129.0           | Preserve the existing Cloudflare deployment tool       |

Workflow validation disables actionlint's optional ShellCheck integration.
The separate ShellCheck step checks the repository scripts changed here.
Existing inline shell warnings in the POS distribution workflows remain outside this change.

Sources:

- [Addy's workflow](https://github.com/addyosmani/agent-skills/blob/301b02b12bff98e4688e6984af6556802322bbde/.github/workflows/test-plugin-install.yml)
- [Addy's CI skill](https://github.com/addyosmani/agent-skills/blob/301b02b12bff98e4688e6984af6556802322bbde/skills/ci-cd-and-automation/SKILL.md)
- [GitHub reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
- [Cloudflare monorepos](https://developers.cloudflare.com/pages/configuration/monorepos/)
- [Cloudflare build watch paths](https://developers.cloudflare.com/pages/configuration/build-watch-paths/)
- [Vercel monorepos](https://vercel.com/docs/monorepos)
- [actionlint](https://github.com/rhysd/actionlint)
- [Gitleaks](https://github.com/gitleaks/gitleaks)
- [paths-filter](https://github.com/dorny/paths-filter)
