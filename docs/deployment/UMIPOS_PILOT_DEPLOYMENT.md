# UmiPOS Pilot Deployment

## Purpose

This procedure deploys the UMI API, worker, Dashboard, PostgreSQL, Redis, OpenTelemetry, and Caddy.
It also creates the Linux UmiPOS artifact.
Use one isolated host for each pilot environment.
This runtime does not require Kubernetes.

## Environment model

The platform defines five environments.

| Environment   | Purpose            | Safe defaults                                               |
| ------------- | ------------------ | ----------------------------------------------------------- |
| `development` | Local work         | HTTP and simulators can be explicit.                        |
| `test`        | Automated tests    | Test fixtures can be explicit.                              |
| `staging`     | Release validation | Production mode, HTTPS, and release identity are mandatory. |
| `pilot`       | Pilot operation    | Production mode, HTTPS, and release identity are mandatory. |
| `production`  | General operation  | Production mode, HTTPS, and release identity are mandatory. |

The API validates `UMI_ENVIRONMENT` at startup.
The POS validates `UMIPOS_ENVIRONMENT` at startup.
Pilot builds reject diagnostics, local bootstrap data, HTTP, and the hardware simulator.

## Architecture

The `deploy/pilot/compose.yml` file is the canonical server entry point.
Caddy is the only service that publishes host ports.
PostgreSQL and Redis stay on the private Docker network.
The API and worker use different PostgreSQL login roles.
The worker keeps its current asynchronous authority.
PostgreSQL keeps all financial authority.

The pilot has no active UmiPOS object storage dependency.
Set `OBJECT_STORAGE_ENABLED=false` until an approved path requires storage.
When enabled, inject S3-compatible credentials only into server services.

## Prerequisites

- Use Linux with Docker Engine and Docker Compose v2.
- Use Node.js 22 and pnpm 10.29.3.
- Install Flutter with Linux desktop support for the release builder.
- Configure DNS for the pilot host.
- Permit inbound TCP ports 80 and 443.
- Mount persistent host storage for Docker volumes.
- Keep five GiB of free disk by default.

Xcode is not available on the Linux runner.
Perform iPad signing and physical KDS tests on a supported Apple build host.

## Configuration classes

### Public client configuration

- `UMIPOS_ENVIRONMENT`
- `UMIPOS_API_BASE_URL`
- release version, commit, and timestamp
- contract version
- public feature flags
- KDS API URL and environment

Public client configuration contains no server credential.

### Non-secret server configuration

- environment name
- public URLs
- allowed origins
- trusted proxy ranges
- release identity
- schema version
- rate limits
- feature flags
- telemetry endpoint without credentials
- object storage endpoint and bucket

### Secret server configuration

- PostgreSQL passwords and URLs
- Redis password and URL
- session, HMAC, encryption, and signing keys
- object storage access keys
- OpenTelemetry headers
- webhook and provider credentials
- smoke account password

Do not put a server secret in `dart-define`, Vite variables, Flutter assets, or generated code.
The repository scan uses Gitleaks across all Git history.
The runtime logger redacts credential fields and token patterns.

## Create the environment file

Run these commands from the workspace root:

```sh
cp deploy/pilot/pilot.env.example deploy/pilot/pilot.env
chmod 0600 deploy/pilot/pilot.env
```

Set all `CHANGE_ME` values.
Set `RELEASE_GIT_COMMIT` to the exact release commit.
Set `RELEASE_BUILD_TIMESTAMP` once for the release.
Use URL-safe PostgreSQL and Redis passwords.
Use at least 24 characters for each infrastructure password.
Use independent secrets for each key purpose.

For a public PostgreSQL endpoint, set these values:

```dotenv
DATABASE_TLS_MODE=verify-full
PGSSLROOTCERT=/run/secrets/postgres-ca.crt
```

The bundled PostgreSQL network is private.
Its pilot profile uses `DATABASE_TLS_MODE=disable` inside that private network.

## Build the release

Run the precheck:

```sh
UMIPOS_PILOT_ENV_FILE=deploy/pilot/pilot.env pnpm umipos:pilot:precheck
```

Build the server images and Linux POS artifact:

```sh
UMIPOS_PILOT_ENV_FILE=deploy/pilot/pilot.env pnpm umipos:pilot:build
```

The command creates these files:

```text
artifacts/releases/<version>/release-manifest.json
artifacts/releases/<version>/release-manifest.md
artifacts/releases/<version>/umipos-linux-<version>.tar.gz
```

The build computes all artifact hashes.
Do not edit a generated hash.

## Deploy

Run the canonical deployment command:

```sh
UMIPOS_PILOT_ENV_FILE=deploy/pilot/pilot.env pnpm umipos:pilot:deploy
```

The command performs these actions:

1. It validates the environment and release manifest.
2. It starts PostgreSQL, Redis, and OpenTelemetry.
3. It creates a database backup when a schema exists.
4. It applies the forward migration chain.
5. It starts the API, worker, Dashboard, and Caddy.
6. It waits for readiness.
7. It runs the pilot smoke suite.
8. It marks the manifest as active.

The command stops after any failed action.
It does not mark a failed release as active.

## Service health

| Service       | Liveness                   | Readiness                               | Release identity      |
| ------------- | -------------------------- | --------------------------------------- | --------------------- |
| API           | `GET /health/live`         | `GET /health/ready`                     | `GET /health/release` |
| Worker        | Container process          | `/tmp/umi-worker-ready` container check | Readiness file        |
| Dashboard     | Nginx process              | `GET /health`                           | `GET /release.json`   |
| PostgreSQL    | `pg_isready`               | Migration and RLS checks                | Schema version table  |
| Redis         | Authenticated `PING`       | Authenticated `PING`                    | Image reference       |
| OpenTelemetry | Collector health extension | Collector process                       | Image reference       |

Readiness returns `Unready` when PostgreSQL, Redis, or the schema is incompatible.
Liveness stays healthy during a transient dependency failure.
Health responses contain no secret.

## PostgreSQL

The pilot uses PostgreSQL 16 with pgvector 0.8.5.
The server uses UTC and a limit of 100 connections.
The volume `postgres-data` stores database data.
The `api` role remains subject to RLS.
The `worker` role has the reviewed bypass permission.
The migration verification checks `FORCE ROW LEVEL SECURITY`.

Run migrations only through this command:

```sh
UMIPOS_PILOT_ENV_FILE=deploy/pilot/pilot.env bash scripts/umipos-pilot.sh migrate
```

The application does not change the schema at startup.

## Redis

The pilot uses Redis 7.4.10.
Redis enables AOF with a one-second append policy.
Redis uses a 256 MiB limit and the `noeviction` policy.
The worker reconnect logic uses bounded job retries.
Authentication, session state, ledgers, and financial facts remain in PostgreSQL.
Queue-dependent work stops when Redis is unavailable.
Synchronous financial writes do not move to Redis.

## Object storage

No current pilot path requires object storage.
The API configuration supports an S3-compatible endpoint when a future approved path needs it.
Enable storage only with server-side credentials and controlled object access.
Use provider snapshots or replication for storage backup.
This gate does not certify an object storage restore.

## TLS and proxy rules

Caddy terminates HTTPS.
Caddy forwards only from its fixed private address.
The API trusts only `TRUSTED_PROXY_CIDRS`.
Set that value to the exact ingress address.
Do not trust arbitrary `X-Forwarded-*` headers.
Caddy limits request bodies to one MiB.
Caddy adds HSTS and secure response headers.
Nginx adds a Dashboard CSP and frame restrictions.
CORS uses explicit origins and credentials.
Pilot cookies require the secure flag.

## Logging and telemetry

The API and worker write one JSON record per log event.
Each record includes service, environment, release, severity, timestamp, and category.
Request logs include a correlation ID where available.
The logger removes tokens, cookies, passwords, contacts, and secret query values.

The API and worker export OTLP data to the bundled collector.
The default collector writes basic diagnostic output.
Replace the exporter with an approved external backend for live operations.
Keep merchant, command, and customer identifiers out of metric labels.

The file `deploy/pilot/alerts.yaml` defines provider-neutral alert conditions.
Connect those conditions to the selected monitoring provider.

## Linux POS installation

Copy the release archive to the pilot workstation.
The workstation does not need Flutter or a source checkout.

```sh
sudo install -d -m 0755 /opt/umipos/releases/<version>
sudo tar -xzf umipos-linux-<version>.tar.gz -C /opt/umipos/releases/<version>
sudo ln -sfn /opt/umipos/releases/<version> /opt/umipos/current
/opt/umipos/current/umi_pos
```

Grant device permissions with the approved Linux group rules.
Do not run UmiPOS as `root`.

Flutter stores secure values through the operating system credential store.
Linux stores application data below the user XDG data directory.
Use `$XDG_DATA_HOME/umi_pos` when `XDG_DATA_HOME` is set.
Otherwise, use `$HOME/.local/share/umi_pos`.
Preserve this directory during an upgrade.

The directory contains the encrypted offline journal, cached public data, recovery data, and hardware state.
Store temporary print artifacts below the application cache directory.
Delete completed print artifacts after their retention period.
Remove local application data only during an approved uninstall.

## POS startup diagnostics

The POS validates configuration and secure storage before login.
It queries `/health/release` before login.
It reports safe categories for these conditions:

- `apiUnavailable`
- `upgradeRequired`
- `serverUpgradeRequiredFoundation`
- `unsupported`
- `storageUnavailable`
- `configurationInvalid`

Device enrollment then reports stale or revoked device state.
The hardware runtime reports adapter failures through its safe state model.
The application does not display a stack trace or secret.

## KDS pilot runtime

Keep the existing KDS application.
Build its Release configuration with explicit values:

```sh
xcodebuild -project apps/umi-kds/375.xcodeproj \
  -scheme UmiKDS -configuration Release \
  KDS_ENVIRONMENT=pilot \
  KDS_BACKEND_URL=https://pilot.example.com \
  KDS_RELEASE_VERSION=<version> \
  KDS_RELEASE_GIT_COMMIT=<commit> \
  KDS_RELEASE_BUILD_TIMESTAMP=<timestamp> \
  KDS_CONTRACT_VERSION=2.12.0 archive
```

Leave the business and station build values empty for pilot pairing.
Approve pairing in the Dashboard.
The API assigns the merchant, location, station, and device.
The KDS sends a heartbeat every five seconds.
The current client polls every three seconds and supports manual reconnect.
The Settings view shows connection and release data.

## Support bundle

Create a redacted support bundle:

```sh
set -a
. deploy/pilot/pilot.env
set +a
RELEASE_MANIFEST="artifacts/releases/$RELEASE_VERSION/release-manifest.json" \
  node scripts/umipos-support-bundle.mjs
```

The bundle includes release, health, and container state.
It excludes contacts, passwords, tokens, cookies, credentials, and secret keys.

## Troubleshooting

Run this command first:

```sh
UMIPOS_PILOT_ENV_FILE=deploy/pilot/pilot.env bash scripts/umipos-pilot.sh status
```

Inspect JSON logs with this command:

```sh
docker compose --env-file deploy/pilot/pilot.env \
  -f deploy/pilot/compose.yml logs --since 15m umi-api umi-worker
```

Use a correlation ID to join the API log and the operator report.
Do not copy a full environment file into a support ticket.

See `UMIPOS_BACKUP_RESTORE.md` for recovery.
See `UMIPOS_RELEASE_PROCESS.md` for release, update, and rollback steps.
