# Worker database connection check

Status: prepared for human review. The production check has not run.

The local database passwords failed authentication. This manual check tests the connection in the existing production worker.
It uses the existing GitHub VPS secrets. It does not export the database password or change the deployment.

## Controls

- The workflow accepts no inputs and runs only from `main`.
- `UMI_REWARD_RELEASE_HOLD` must remain `true`.
- The workflow shares the API deployment lock.
- SSH requires the saved VPS ed25519 public key in `.github/umi-vps-ed25519.pub`.
- The public key comes from the existing local `known_hosts` entry for `2.24.204.15`. A changed key stops the check.
- The command uses the existing `umi-worker` service at `$HOME/umi/apps/umi-api`.
- The script creates a database client directly. It does not load the application or start jobs.
- The connection requires the configured CA and authenticated TLS.
- The script rejects URL query parameters that could replace connection or TLS settings.
- The SQL uses a read-only transaction, fixed queries, and the fixed El Gran Ribera tenant identifier.
- The logs contain fixed booleans, the project identifier, and the PostgreSQL major version.
- Raw SSH errors stay in private temporary runner files. The workflow removes them before it exits.
- The workflow creates no backup artifact and runs no migration.

## Interpretation

A successful result proves that the current worker connection works. The result also confirms the expected project and tenant.
The role and grant checks help select the backup route. They do not prove permission for a complete database dump.
The `rewardSchemaPresent` field reports table presence only. It does not establish migration readiness.
`serverTls` reports the database leg. `clientTlsVerified` confirms the client connection even when a pooler has a separate database connection.

After review and merge, dispatch `umi-reward-database-probe.yml` from `main`.
Keep the release hold active. Prepare the backup route from the result, then verify the archive and a local restore.

## Validation and sources

The local tests use Node 22 and a simulated driver. They test output filtering, target restrictions, TLS checks, and failure handling.
The remote check uses the deployed Node runtime and its installed `pg` package. The repository locks `pg` to 8.22.0.
The workflow validation uses actionlint 1.7.12 and ShellCheck 0.11.0.
The 21 diagnostic tests and six simulated SSH output cases passed locally.
The simulated cases include malformed output, raw error text, extra secret fields, and failed SSH status.
No local test establishes production connectivity.

- Existing deployment credentials and paths: `.github/workflows/deploy-backend.yml`.
- Existing worker configuration: `apps/umi-api/docker-compose.yml`.
- Existing CA handling: `apps/umi-api/src/shared/database/pg.service.ts`.
- TLS behavior: <https://node-postgres.com/features/ssl>.
- Transaction restrictions: <https://www.postgresql.org/docs/17/sql-set-transaction.html>.
- Workflow validation: <https://github.com/rhysd/actionlint>.
- Shell validation: <https://www.shellcheck.net>.
