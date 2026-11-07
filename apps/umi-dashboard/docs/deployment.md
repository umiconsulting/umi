# UMI Dashboard Deployment

Updated: 2026-11-06

UMI Dashboard is a static Vite application. UMI API owns all authentication, reads, commands, PostgreSQL access, and RLS enforcement.

The Dashboard has no Express backend, direct database connection, Supabase credential, service-role credential, or independent identity system.

## Cloudflare Pages targets

The workflow `.github/workflows/deploy-dashboard.yml` deploys these targets:

| Git branch    | Pages project            | Public URL                                   | API                                    |
| ------------- | ------------------------ | -------------------------------------------- | -------------------------------------- |
| `main`        | `umi-dashboard`          | `https://dashboard.umiconsulting.co`         | `https://api.umiconsulting.co`         |
| `staging`     | `umi-dashboard-staging`  | `https://staging-dashboard.umiconsulting.co` | `https://api-staging.umiconsulting.co` |
| Pull requests | `umi-dashboard` previews | URL in the workflow summary                  | `https://api-staging.umiconsulting.co` |

The staging project uses `staging` as its production branch. Both of its Pages environments set `API_ORIGIN=https://api-staging.umiconsulting.co`.
Its builds use an empty `VITE_API_BASE`. The Pages Worker forwards API calls under the same origin.
The DNS record `staging-dashboard` is a CNAME to `umi-dashboard-staging.pages.dev`.

Squarespace owns the authoritative DNS. A separate project keeps the custom domain on staging with external DNS.
Cloudflare branch aliases require proxied Cloudflare DNS; an external CNAME to a preview alias can serve the production branch instead.
See [Cloudflare's branch-domain guide](https://developers.cloudflare.com/pages/how-to/custom-branch-aliases/).

## Build contract

Set these non-secret build values:

```text
VITE_UMI_ENVIRONMENT=staging|pilot|production
VITE_AUTH_MODE=cookie
VITE_PUBLIC_URL=https://dashboard.example.com
VITE_API_BASE=https://api.example.com
VITE_RELEASE_VERSION=6.0.0-pilot.rc2
VITE_RELEASE_GIT_COMMIT=<40-character certified commit>
VITE_RELEASE_BUILD_TIMESTAMP=<ISO-8601 timestamp>
VITE_CONTRACT_VERSION=2.12.0
VITE_CONFIG_SCHEMA_VERSION=1
```

`VITE_API_BASE` can be empty only when the reverse proxy serves UMI API from the same origin.

Do not add database credentials, service-role keys, provider secrets, or session tokens to a `VITE_` value. Vite embeds these values in the client artifact.

## Build

Use the root lockfile and package manager:

```sh
pnpm install --frozen-lockfile
pnpm --filter @umi/tokens build
pnpm --filter @umi/dashboard test
pnpm --filter @umi/dashboard lint
pnpm --filter @umi/dashboard build
```

The pilot Dockerfile supplies the same values as build arguments. It writes `release.json` into the static output.

## Runtime

Serve `dist/` through HTTPS. Route application paths to `index.html`.
Route API requests to the configured UMI API. Do not weaken CORS, CSRF, secure-cookie, or trusted-proxy policy.

Use `/health` on the Dashboard container for process health. Use UMI API `/health/live` and `/health/ready` for backend status.

## Verification

1. Read `release.json` and verify the release, commit, environment, contract, and schema version.
2. Authenticate through the UMI API cookie flow.
3. Verify the merchant and location context.
4. Verify Owner access and Manager scope.
5. Load one operational page and one diagnostic page.
6. Confirm that browser storage and static assets contain no credential or secret.

Use `docs/deployment/UMIPOS_PILOT_RC_DEPLOYMENT.md` for the complete RC2 deployment sequence.
