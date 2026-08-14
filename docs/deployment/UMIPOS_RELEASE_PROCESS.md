# UmiPOS Release Process

## Release identity

Each release has one version, commit, timestamp, contract version, and schema version.
The API, worker, Dashboard, POS, and KDS expose this identity.
An artifact identity does not change after the build.
Do not use `latest` as the only pilot identity.

## Release manifest

The generated manifest uses `deploy/pilot/release-manifest.schema.json`.
It records Docker image IDs, the POS checksum, the KDS Git tree, and the migration checksum.
It contains no secret.

Verify a manifest with this command:

```sh
node scripts/verify-release-manifest.mjs \
  artifacts/releases/<version>/release-manifest.json
```

## Create a release

1. Select the exact Git commit.
2. Update the pilot environment file with the release identity.
3. Run the deployment precheck.
4. Build all available artifacts.
5. Verify the release manifest.
6. Run focused tests and builds.
7. Deploy to a clean disposable environment.
8. Run the pilot smoke suite.
9. Test backup and isolated restore.
10. Test the compatible application rollback.
11. Publish the immutable artifacts.

Use these commands:

```sh
UMIPOS_PILOT_ENV_FILE=deploy/pilot/pilot.env pnpm umipos:pilot:precheck
UMIPOS_PILOT_ENV_FILE=deploy/pilot/pilot.env pnpm umipos:pilot:build
UMIPOS_PILOT_ENV_FILE=deploy/pilot/pilot.env pnpm umipos:pilot:certify-clean
```

## Upgrade

Record the current and target manifest paths.
Then run these steps:

1. Verify the current service health.
2. Verify the target manifest and artifact hashes.
3. Create a database backup.
4. Confirm the expected forward migration range.
5. Apply the target migrations.
6. Start the target API, worker, and Dashboard.
7. Wait for readiness.
8. Run the pilot smoke suite.
9. Mark the target manifest as active.

Run the normal deploy command for steps three through nine:

```sh
UMIPOS_PILOT_ENV_FILE=deploy/pilot/pilot.env pnpm umipos:pilot:deploy
```

The command stops after a migration failure.
Do not perform a silent downgrade.

## Compatibility

The pilot compares these versions:

- API version
- contract version
- POS version
- Dashboard version
- KDS version
- database schema version

The POS returns one of these states:

- `Compatible`
- `UpgradeRequired`
- `ServerUpgradeRequiredFoundation`
- `Unsupported`

The API readiness check requires the exact expected schema version.
The Dashboard build requires its release and contract values.
The release manifest records minimum client versions.

## Update check

Run the manual POS update check:

```sh
pnpm umipos:pilot:update-check -- \
  <installed-version> artifacts/releases/<version>/release-manifest.json
```

The command verifies the local POS archive checksum.
It returns `current`, `optional`, or `required`.
It does not download or execute a binary.

For an update, copy the verified archive to the workstation.
Install it in a new version directory.
Stop UmiPOS before you change the active symbolic link.
Start UmiPOS and verify its startup diagnostics.
Keep the previous version directory until pilot verification passes.

## Rollback model

Use one of three rollback types.

### ApplicationRollback

Use this type when the previous application supports the active schema.

```sh
UMIPOS_PILOT_ENV_FILE=deploy/pilot/pilot.env \
  bash scripts/umipos-pilot.sh rollback <previous-version>
```

The command verifies schema compatibility before rollout.
It then runs readiness and smoke checks.

### ConfigurationRollback

Restore the previous reviewed environment file from the secret manager.
Keep its release identity consistent with the selected artifacts.
Restart the affected services.
Run readiness and smoke checks.

### DatabaseRecovery

Use a database restore only for an incident or disaster.
Do not run a destructive schema downgrade.
Prefer a corrective forward release after an incompatible migration.

## Rollback test limit

The pilot test changes only application artifacts.
It uses schema-compatible manifests.
It does not test a migration downgrade.
Record this limit in the release evidence.

## Publication

Publish the manifest, summary, Linux POS archive, and immutable container references together.
Retain the previous compatible release.
Link the release notes from the manifest.
Keep PR #72 open until a later authorized action changes its state.
