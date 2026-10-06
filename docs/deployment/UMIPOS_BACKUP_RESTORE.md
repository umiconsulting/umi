# UmiPOS Backup and Restore

## Scope

This procedure protects the pilot PostgreSQL database.
It does not define a production disaster recovery service level.
Use an isolated database for every restore test.

## Backup

Load the pilot environment through the canonical command:

```sh
UMIPOS_PILOT_ENV_FILE=deploy/pilot/pilot.env \
  bash scripts/umipos-pilot.sh backup
```

The command creates a PostgreSQL custom dump.
It stores the dump below `backups/<environment>/<UTC timestamp>`.
It also creates SHA-256 and JSON metadata files.
The directory mode is `0700`.
The file mode follows a restrictive process mask.
The command returns a nonzero status after any failure.

Mount the `backups` directory on persistent host storage.
Do not keep the only backup in a container filesystem.
Encrypt backup storage outside this script.
Keep daily pilot backups for 14 days.
Set the final retention policy before production use.

## Migration checkpoint

Create a backup before each migration.
Record the current and target release manifests.
Verify the active schema version:

```sh
docker compose --env-file deploy/pilot/pilot.env \
  -f deploy/pilot/compose.yml exec -T postgres \
  psql -X -At -U postgres -d umipos_pilot \
  -c "select version from runtime.schema_migration order by applied_at desc limit 1"
```

## Isolated restore test

Run this command with a real backup path:

```sh
UMIPOS_PILOT_ENV_FILE=deploy/pilot/pilot.env \
  bash scripts/umipos-pilot.sh restore \
  backups/pilot/<timestamp>/umipos_pilot.dump \
  umipos_restore_gate6a
```

The command performs these actions:

1. It verifies the backup checksum.
2. It creates an isolated database.
3. It restores the custom dump with terminal errors.
4. It verifies the schema version.
5. It verifies forced RLS.
6. It starts isolated API and worker containers.
7. It verifies readiness.
8. It reports the measured restore time.

The command does not restore over the active database.
The target name must start with `umipos_restore_`.

## Disaster walkthrough

Use these steps for a pilot database incident:

1. Stop the API and worker.
2. Record the incident time and the last successful backup time.
3. Provision a clean PostgreSQL 16 instance.
4. Verify the selected backup checksum.
5. Restore the dump into a new database.
6. Verify the migration version and forced RLS.
7. Start the API and worker against the restored database.
8. Run the pilot smoke suite.
9. Verify sales, ledgers, commands, and audit facts.
10. Change ingress to the recovered service.

Measure RTO from the application stop to restored readiness.
Calculate RPO from the last valid backup time.
Do not claim a production RTO or RPO from this pilot test.

## Object storage

The current pilot path has no active object storage requirement.
If storage becomes active, enable provider snapshots or versioned replication.
Test a provider restore before you claim storage restore certification.

## Safety

Do not restore over a shared development database.
Do not print database URLs or passwords.
Do not attach an unencrypted backup to a support ticket.
Restrict backup and checksum files to the operator account.
