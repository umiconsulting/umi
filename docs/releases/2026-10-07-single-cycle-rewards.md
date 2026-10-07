# Single cycle reward release

Status: local implementation. Production activation has not occurred.

The tenant policy uses one reward entitlement with two choices.
The base reward costs 7 visits. The higher reward costs 9 visits.
Unused visits remain. Further visits stop at 9 until redemption or expiry.
The reward expires 30 days after visit 7. Visit 9 preserves that deadline.
Retained visits have no deadline until their next visit 7.

## Release prerequisites

1. Resolve the tenant's disputed reward balances before activation imports them.
2. Save a private database snapshot and the preflight results.
3. Confirm the active reward ladder has thresholds 7 and 9.
4. Apply `supabase/migrations/20261007000000_stamp_reward_entitlements.sql` as the database owner.
5. Deploy the matching API, worker, Cash, dashboard, and contract artifacts.
6. Verify Cash forwards scans to the canonical API through `CASH_API_ORIGIN`.
7. Verify pass requests use the canonical API through `WALLET_API_ORIGIN`.
8. Enable `OUTBOX_RELAY_ENABLED=true` for the worker's reminder delivery.
9. Enable `LIFECYCLE_CRONS_ENABLED=true` for seven-day reminders.
10. Confirm the system queue runs `stamp_reward_expiry` every 60 seconds.
11. Verify wallet provider credentials and channels in the target environment.
12. Announce the 30-day grace period for existing rewards before activation.

The migration starts no tenant policy. Activation is a separate production action.
Both build-time Cash origins need verification in the deployed artifact.
Changing environment values without rebuilding can leave earlier routes in service.
Expiry checks run inside mutations and reads even when the worker is late.
Wallet updates and reminders require a healthy worker and delivery configuration.

## Preflight and activation

Use the scripts beside this document with an explicit merchant UUID.
Run preflight after the migration and before activation.
Save results outside Git because the results contain customer balances.

```sh
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -v merchant_id="$TARGET_MERCHANT_ID" \
  -f docs/releases/sql/single-cycle-preflight.sql

psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -v merchant_id="$TARGET_MERCHANT_ID" \
  -f docs/releases/sql/single-cycle-activate.sql

psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -v merchant_id="$TARGET_MERCHANT_ID" \
  -f docs/releases/sql/single-cycle-verify.sql
```

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

Final verification evidence follows in the branch verification record.
The private stack uses PostgreSQL 16.15, Node 22.23.3, pnpm 10.29.3, and Vitest 2.1.9.
The browser proof uses Playwright 1.62.1 over CDP with a headed Brave Chromium browser.
The temporary launcher adapts the repository's Linux browser script to macOS.
All test recipients and browser accounts are private fixtures.

Decision basis: PostgreSQL row locks serialize card mutations inside transactions.
Source: https://www.postgresql.org/docs/16/explicit-locking.html.
Umi's canonical API owns writes. Cash and dashboard consume its committed result.
