# Single cycle reward release

Status: local migration rehearsal passed. Current production database activation remains unverified.

Current production gates are recorded in [the production preparation record](2026-10-07-single-cycle-rewards-production-preflight.md).

The tenant policy uses one reward entitlement with two choices.
The base reward costs 7 visits. The higher reward costs 9 visits.
Unused visits remain. Further visits stop at 9 until redemption or expiry.
The reward expires 30 days after visit 7. Visit 9 preserves that deadline.
Retained visits have no deadline until their next visit 7.

## Release prerequisites

1. Resolve the tenant's disputed reward balances before activation imports them.
2. Save a fresh private database snapshot.
3. Confirm the active reward ladder has thresholds 7 and 9.
4. Apply `supabase/migrations/20261007000000_stamp_reward_entitlements.sql` as the database owner. Then run preflight and save its results outside Git.
5. Deploy the matching API, worker, Cash, dashboard, and contract artifacts.
6. Verify Cash forwards scans to the canonical API through `CASH_API_ORIGIN`.
7. Verify pass requests use the canonical API through `WALLET_API_ORIGIN`.
8. Keep `OUTBOX_RELAY_ENABLED=false` until the approved WhatsApp template adapter is implemented and verified.
9. Keep `LIFECYCLE_CRONS_ENABLED=false` until that adapter and the effects on other scheduled jobs are reviewed.
10. Confirm the system queue runs `stamp_reward_expiry` every 60 seconds.
11. Verify wallet provider credentials and channels in the target environment.
12. Announce the 30-day grace period for existing rewards before activation.

The base migration starts no tenant policy. Apply the separate activation migration after the compatible backend and clients deploy.
The activation migration is `supabase/migrations/20261011000000_activate_elgranribera_single_cycle_rewards.sql`.
It activates only UUID `a13905a2-0319-4cc1-cacf-eee47b75e309` with handle `elgranribera`.
Apply the base migration first. Deploy the compatible API and worker next, then the compatible clients. Apply activation last.
The activation requires the transaction setting `umi.reward_policy_activation=elgranribera:20261011000000`.
Set it only after the compatible applications pass the release checks. The setting records that release decision; it does not inspect application versions.
An ordinary migration run without this setting fails when EGR exists. Do not apply this directory as one batch for this release.
Both build-time Cash origins need verification in the deployed artifact.
Changing environment values without rebuilding can leave earlier routes in service.
Expiry checks run inside mutations and reads even when the worker is late.
Wallet updates and reminders require a healthy worker and delivery configuration.

## Preflight and activation

This release activates El Gran Ribera only. All commands below use its fixed UUID.
Use the approved database connection through a protected libpq service named `umi-production-admin`.
Keep its credentials outside Git and command arguments.
Run preflight after the base migration and before activation.
Save results outside Git because the results contain customer balances.

```sh
PGSERVICE=umi-production-admin psql -X -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20261007000000_stamp_reward_entitlements.sql

PGSERVICE=umi-production-admin psql -X -v ON_ERROR_STOP=1 \
  -v merchant_id=a13905a2-0319-4cc1-cacf-eee47b75e309 \
  -f docs/releases/sql/single-cycle-preflight.sql
```

Complete the application deployments and release checks before the activation command.
After release approval, run this command separately. `SET LOCAL` and the migration share one transaction and connection.

```sh
PGSERVICE=umi-production-admin psql -X -v ON_ERROR_STOP=1 --single-transaction \
  -c "SET LOCAL umi.reward_policy_activation = 'elgranribera:20261011000000'" \
  -f supabase/migrations/20261011000000_activate_elgranribera_single_cycle_rewards.sql
```

Continue only if activation succeeds. Then run verification:

```sh
PGSERVICE=umi-production-admin psql -X -v ON_ERROR_STOP=1 \
  -v merchant_id=a13905a2-0319-4cc1-cacf-eee47b75e309 \
  -f docs/releases/sql/single-cycle-verify.sql
```

These are separate release stages. Record each migration version and result in the private deployment record.
Repeat preflight immediately before activation if deployment or verification changed the database.
The generic `single-cycle-activate.sql` script is retired. It refuses execution and points to the EGR migration.
The migration skips only an empty merchant table. A populated database without EGR stops with an error.
Either identity mismatch also stops the migration.
It holds the merchant row lock through activation and verifies the resulting 30-day policy.
The build-v3 bootstrap remains base-only. It never includes the tenant activation migration.

The migration postcondition checks the policy. The verification script also reports card state, audit candidates, and activation grace deadlines.
Compare its results with the saved preflight before the controlled staff workflow. Incorrect activation grace deadlines must be zero.
Check unaudited candidate IDs against the saved preflight card IDs. A card present in preflight must have an activation audit if it still exists.
Card creation timestamps use the start of the registration transaction. A transaction can start before activation and insert its card afterward.
Such a card needs no activation audit. Use the saved preflight IDs to identify the original cards; the timestamp filter is only a diagnostic.
Later scans and redemptions can change the displayed card balances.
The isolated snapshot rehearsal supplies the complete check that original balances and history survive activation.

Activation locks cards and imports existing obligations with a 30-day grace period.
It normalizes cycle anchors and preserves lifetime events and partial progress.
Existing balances block further visits until redemption or expiry.
Reactivation preserves the first activation time and deadlines.

Verify one controlled staff workflow in production after activation.
Use an approved fixture card and receipt. Read the committed response and history.
Do not use a customer's balance as a release test.

## Recovery and rollback

Before activation, the additive schema can remain while the application release is reverted.
Verify that no merchant policy is active before reverting to an earlier application.

After activation, keep the policy and the matching read model active.
Stop affected mutations if a defect appears. Retain the command journal and the database snapshot.
Use a forward correction or a rehearsed restoration that includes all subsequent events.
Rehearse restoration in an isolated database and compare every affected card before production writes.
Do not disable the policy or deploy the earlier mutation code after activation.
The normalized anchors and new consumption facts require the matching implementation.
Do not delete redemptions, entitlement links, or activation audit rows to repair balances.

## Delivery limits

Database markers prevent ordinary duplicate reminders and support wallet retries.
Provider delivery has a crash window after acceptance and before database acknowledgement.
A retry in that window can duplicate an external reminder.
This release does not promise exactly-once provider delivery.

## Local evidence

Final verification evidence is in [the local verification record](2026-10-07-single-cycle-rewards-verification.md).
The private stack uses PostgreSQL 16.15, Node 22.23.3, pnpm 10.29.3, and Vitest 2.1.9.
The browser proof uses Playwright 1.62.1 over CDP with a headed Brave Chromium browser.
The temporary launcher adapts the repository's Linux browser script to macOS.
All test recipients and browser accounts are private fixtures.

Decision basis: PostgreSQL row locks serialize card mutations inside transactions.
Source: https://www.postgresql.org/docs/16/explicit-locking.html.
The transaction setting uses the [psql single-transaction option](https://www.postgresql.org/docs/17/app-psql.html) and [SET LOCAL](https://www.postgresql.org/docs/17/sql-set.html).
The protected connection uses a [libpq service file](https://www.postgresql.org/docs/17/libpq-pgservice.html).
Umi's canonical API owns writes. Cash and dashboard consume its committed result.
