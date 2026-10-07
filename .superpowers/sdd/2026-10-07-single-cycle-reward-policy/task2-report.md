# Task 2: Safe scans, credits, and reversals

Status: implemented and verified locally. Production activation belongs to the release task.

## Tools and sources

- Node 22.23.3 from the npm cache at `/Users/moon/.npm/_npx/c29883048cd047b6`.
- pnpm 10.29.3 from the same cache.
- Vitest 2.1.9 and pg 8.22.0 from the workspace lockfile.
- PostgreSQL 16 on port 5247, database `umi_reward_policy_test`.
- `AGENTS.md`, the current spec and plan, and `LOCAL_VERIFICATION_PLAYBOOK.md`.
- Existing `IntegrityService`, `IntegrityRepository`, shared card SQL, and reward profile code.

The existing command journal stores the confirmation in the mutation transaction.
The existing card SQL remains the source of policy state.
A card row lock serializes scans, bulk credits, reversals, and expiry.
These choices follow the approved spec and PostgreSQL row lock semantics.
No new database owner or service boundary was added.

## TDD evidence

Command prefix:

```sh
PATH=/Users/moon/.npm/_npx/c29883048cd047b6/node_modules/.bin:$PATH pnpm
```

1. `--filter @umi/api exec vitest run src/modules/cash/cash-scan.service.spec.ts`
   - RED: four new guard tests failed because the scan accepted prohibited requests.
   - GREEN: all 48 tests passed.
2. Same command after the fresh lock test.
   - RED: a visit used the earlier card state and passed the new cap test.
   - GREEN: all 49 tests passed.
3. Same command after the bulk credit tests.
   - RED: excess credits and credits blocked by legacy units were accepted.
   - GREEN: all 51 tests passed.
4. Same command after the repeated reversal test.
   - RED: the service returned a conflict for the second reversal.
   - GREEN: all 52 tests passed.
5. Same command after the expired QR replay test.
   - RED: the service resolved the expired QR before it read the stored command.
   - GREEN: all 53 tests passed.
6. `node --test packages/contract/test/schemas.test.mjs`
   - RED: `ScanRequest.parse` removed the receipt, quantity, and operation key.
   - GREEN after the contract build: all 20 tests passed.

The initial online npm command waited for registry access.
The offline cache provided the required tools and avoided another download.

## Database proof

The initial database suite preceded the scan cap, credit cap, and reversal changes.
The first run failed during setup because the login roles were absent.
This setup failure is not behavioral RED evidence.
Root then completed the baseline build and provisioned the login roles.

The first behavioral run passed five cases and failed seven redemption cases.
The failure exposed a command foreign key that referenced the wrong command identity.
Task 1 changed the foreign key to `business_command.command_id`.
The next run passed all 13 cases.

An expanded run had one deadlock while another agent reapplied the migration.
The PostgreSQL log identified concurrent DDL as the other transaction.
Migration reruns now have a separate gate and run outside these tests.

A recovery test then failed because the response named the current upper reward.
The helper had consumed the original base reward.
The service now uses consumed snapshot names in the response and lifecycle message.
A later reversal test exposed current names after a configuration change.
The reversal now reads its original entitlement name and tier.
The next database run passed all 15 cases.

Additional tests prove mixed legacy quantity, birthday serialization, and historical ordering.
The final command used the fixture roles and these environment variables:

```sh
DATABASE_URL_APP=postgresql://api_login:harness_api@127.0.0.1:5247/umi_reward_policy_test
DATABASE_URL_WORKER=postgresql://worker_login:harness_worker@127.0.0.1:5247/umi_reward_policy_test
DATABASE_URL_ADMIN=postgresql://postgres@127.0.0.1:5247/umi_reward_policy_test
PATH=/Users/moon/.npm/_npx/c29883048cd047b6/node_modules/.bin:$PATH
pnpm --filter @umi/api exec vitest run --config vitest.integration.config.ts cash-single-cycle cash-seals
```

Result: 26 tests passed. The new suite passed 18 tests. The disabled bulk suite passed eight tests.
The role guard confirmed the API role has RLS and the worker role has BYPASSRLS.

The new database tests prove:

- Visit seven issues one unit. Visits eight and nine retain its deadline.
- Redemption at seven, eight, and nine leaves zero cycle progress.
- A concurrent tenth stamp fails with no partial credit.
- Scans and bulk credits use the same lock.
- Two redemptions cannot consume the same unit.
- Two requests with the same key return one committed result.
- Actor, card, action, quantity, and receipt changes conflict.
- A later visit cannot alter a stored confirmation.
- A QR token conflict rolls back the redemption, entitlement, and command together.
- A reversal preserves the original deadline and later progress.
- A restored base reward retains its name during redemption and in the lifecycle message.
- An expired cycle resets before the next visit.
- A custom reward override retains policy thresholds seven and nine.
- Legacy quantity two retains both names and leaves partial cycle progress unchanged.
- Birthday claims remain separate from stamp redemption and money.
- Earlier historical units must be redeemed before the current base cycle.
- Actual scan responses pass the generated Zod response schema.

## Implementation

- Each scan checks policy, progress, configuration, profile, visit limits, cooldown, and birthday state under the card lock.
- Keyed scans use the Integrity transaction client for the reads and mutation.
- The command fingerprint contains the authenticated actor and the effective request.
- The command claim precedes QR resolution, so a committed retry can survive QR expiry or rotation.
- The confirmation stores the committed staff name, quantity, receipt, reward names, time, and remaining rewards.
- Duplicate commands return that confirmation and skip wallet and email effects.
- New cycles issue one unit at seven and upgrade it at nine through the shared helper.
- Enabled redemptions consume entitlements and reset current cycle progress through the shared helper.
- Credits reject excess quantities and preserve source-key conflict checks.
- Reversals restore the original entitlement through the shared helper.
- The disabled path retains its historical earning arithmetic.
- Contract 2.24.0 adds the request fields, policy fields, and committed response schema.

## Final checks

- Scan service suite: 55 tests passed.
- Database suites: 26 tests passed.
- Contract suite: 80 tests passed.
- Contract build and generation check: exit 0, version 2.24.0.
- Contract checksum: `4293bcb72e10e137ae88e79f6b1fbad922b9bb64db3a2dd5fb1391616d0afce7`.
- API typecheck: exit 0.
- ESLint for the owned API files: exit 0.
- Prettier for the owned files and `git diff --check`: exit 0.

Extra TDD cases rejected multiple cycle units and earlier historical bypass.
Each case first failed because the request passed. Each passed after the corresponding guard.

## Self-review

The review checked lock order, supplied client use, and final expiry checks.
It checked both enabled and disabled arithmetic.
It checked actor-bound fingerprints, original response storage, and duplicate side effects.
It checked quantity limits, receipt validation, original names, and override thresholds.
It checked birthday claims, stored value separation, reversal facts, and history ordering.

The command journal redacts keys named `cardNumber` as payment-sensitive data.
The service stores the public loyalty identifier as `displayIdentifier` and restores the API field on read.
This keeps the committed public confirmation exact without changing shared redaction rules.
Internal storage fields stay outside the HTTP response.

The final checks cover the owned backend and contract changes.
The root task owns fresh-build proof, operator browser proof, worker proof, and release instructions.
No production activation or customer correction occurred in Task 2.
