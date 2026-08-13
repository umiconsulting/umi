# UMI POS Pilot RC Deployment

Updated: 2026-08-13

This procedure deploys `UMI POS Pilot RC2` from source commit `1e885022b654dcecf943377ea2e1e3b739a9027a`.

## Deploy

1. Check out the certified source commit.
2. Verify the release manifest and artifact checksums.
3. Copy `deploy/pilot/pilot.env.example` to the protected pilot environment.
4. Replace all placeholders through the platform secret store.
5. Set public HTTPS origins, trusted proxy ranges, and database TLS values.
6. Keep object storage disabled unless the provider contract is complete.
7. Keep real payment providers disabled until provider certification passes.
8. Run `pnpm umipos:pilot:precheck`.
9. Create a current database backup.
10. Run the ordered build-v3 migration chain through `build-v3-48`.
11. Start PostgreSQL and Redis readiness checks.
12. Deploy the API image.
13. Deploy the worker command from the API image.
14. Deploy the Dashboard image and Caddy.
15. Install the verified Linux POS artifact on an enrolled device.
16. Install KDS only through the supported Apple release process.
17. Run `pnpm umipos:pilot:smoke`.
18. Run `pnpm umipos:pilot:readiness`.
19. Verify release version, commit, contract, and schema identity in diagnostics.

Stop the deployment if a migration, readiness check, identity check, or smoke check fails.

## Post-deploy smoke plan

1. Verify API liveness and readiness.
2. Open the Dashboard through HTTPS.
3. Authenticate the Owner.
4. Verify the merchant and location context.
5. Verify the Manager location scope.
6. Verify the device, register, and shift state.
7. Load the representative catalog.
8. Verify inventory visibility.
9. Connect the assigned KDS station.
10. Commit one safe cash transaction.
11. Verify one sale, tender, and receipt fact.
12. Verify the transaction in Dashboard history.
13. Verify that no duplicate fact exists.
14. Review diagnostics, audit, and Recovery Center.

## Rollback and recovery

Use an application rollback for an application defect. Select the last certified artifact.
Keep the current schema when it is forward-compatible. Pause the worker before an incompatible rollback.

Do not reverse a migration after authoritative facts use its schema.
Do not delete or edit sale, receipt, refund, inventory, cash, customer-value, or audit facts.
Drain or pause the outbox before a worker rollback. Preserve every pending job and command identity.

Use a verified backup restore only for database loss or corruption.
Stop all writers before a restore. Restore into an isolated database first.
Run the reconciliation and smoke checks before traffic resumes.

Provider operations can require provider-side recovery. Record the provider reference before escalation.
Re-enroll a device only through the approved device process. Reconcile KDS from the server snapshot.

## Data protection

- PostgreSQL is the authority for business facts. Take a checked backup before each deployment.
- Store backup files outside the application host according to the provider retention policy.
- Object storage needs versioning, durability, and backup before it becomes authoritative.
- UI state, Redis, KDS cards, and POS cache are not business backup sources.
- The pilot operator owns daily verification. The platform operator owns restore execution.

## Pilot go/no-go checklist

- [ ] The deployed commit is `1e885022b654dcecf943377ea2e1e3b739a9027a`.
- [ ] The environment is the approved pilot environment.
- [ ] Migrations end at `build-v3-48`.
- [ ] All required configuration is present.
- [ ] The secret store contains all pilot secrets.
- [ ] Object storage is disabled or provider-ready.
- [ ] Payment provider mode is correct.
- [ ] The merchant and locations are configured.
- [ ] Owner and Manager accounts are ready.
- [ ] Devices and registers are assigned.
- [ ] KDS is assigned and connected.
- [ ] The catalog is active.
- [ ] The inventory baseline has zero drift.
- [ ] API, worker, database, Redis, and Dashboard are ready.
- [ ] The post-deploy smoke plan passed.
- [ ] The current database backup has a valid checksum.
- [ ] Support and escalation contacts are known.
- [ ] All physical and provider observations were reviewed.
