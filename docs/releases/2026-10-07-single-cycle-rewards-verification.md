# Local verification of reward changes

The October 7 implementation used `feat/loyalty-expiry-and-redemption`, based on `affd6bc`.
All database changes and browser operations used private fixtures.
October 17 production health reports a later API deployment. Current production database activation remains unverified.
Customer balance corrections use separate private audit records.
Independent final spec and quality review passed through implementation commit `8c50526`.
The reviewer found no open Critical or Important issue.

## Database and API

The fresh build-v3 migration chain passed on PostgreSQL 16.15.
Its verification reported 22 umi tables, 149 merchant tables, and 27 runtime tables.
The reward migration also passed a second application.

The complete schema command passed 289 tests across 31 suites.
It included the real scan suite and both gated migration rerun cases.
The targeted API command passed 144 tests across nine files after the final scan copy changes.
Contract version 2.25.0 passed 80 tests and its generation check.
Its SHA-256 checksum is `c3b57ce68ce297781e90fa8bcbb62eecddf1460978f50d46869be08630c6adc7`.
Cash operation checks passed seven tests. Dashboard operation and locale checks passed three tests.
API, Cash, and dashboard builds passed with the final changes.
The dashboard catalogs passed extraction and strict compilation.
The affected source files passed lint and whitespace checks.
The production preparation also passed the complete affected build, lint, and test command.
API units passed 1,766 tests; 29 tests stayed skipped under their existing configuration.
Dashboard units passed 342 tests. The contract suite passed 80 tests.
The repository's PR check passed, including its existing 67-warning lint baseline.
The dashboard workflow now derives the contract version from the shared catalog.

The schema checks cover expiry, retained visits, concurrent claims, replay, reversals, tenant isolation, reminders, and wallet refresh retries.
The private release fixture passed preflight, activation, activation rerun, and verification SQL.

## Archive restore and activation rehearsal, October 17

The complete custom archive was created on October 11. Its checksum passed a fresh verification on October 17.
The isolated restore used PostgreSQL 17.11 and vector 0.8.7. The archive source used PostgreSQL 17.6 and vector 0.8.0.
The restore covered `umi`, `merchant`, `runtime`, `public.tg_touch_updated_at`, and supported extensions.
Provider schemas and extensions remained outside this local scope. The complete archive remains preserved.
Production login roles used local `NOLOGIN` placeholders with only the required application memberships.

All 2,680 canonical metadata rows matched after ACL default and order normalization and the reparse of two CHECK constraints.
Exact data hashes matched for the visit, redemption, card, and reward tables. Sequence states also matched.
The base migration passed two applications with all tenant policies disabled. The privilege checks passed.

The actual EGR activation migration passed against the restored application.
Original history and the gift, stored value, and points tables remained unchanged.
Partial progress and existing reward obligations remained preserved.
Further base and activation applications preserved policy timestamps, deadlines, all card data, entitlements, links, and audits.
The initial PostgreSQL guard suite passed 13 tests. The review corrections increased this suite to 20 tests, and all passed.
The revised guards reject a missing EGR tenant, including in an empty database, and require the exact transaction activation setting.
The substitute routine and table now match the real policy constraints, activation-time check, and pending-policy update.
The lock test restores its committed fixture, and a subsequent test verifies that cleanup.

The revised migration also passed a fresh archive restore with the actual activation routine.
An attempt without the activation setting failed and left the policy and entitlement tables empty.
The documented transaction command activated the policy. Its rerun preserved all data in the saved comparison.
The revised verification script reported zero unaudited candidates and zero incorrect activation grace deadlines in the restored snapshot.
For live activation, compare candidate card IDs with the saved preflight. An overlapping registration can have an earlier transaction timestamp without an activation audit.

No application consumers started, and this rehearsal made no production changes.
The worker, Cash build, and delivery checks remain open. Keep reminder flags off until the approved template adapter passes verification.

## Reproducible EGR fixture, October 17

The final follow-up passed all 20 migration guard tests on PostgreSQL 17.11.
The empty-database regression failed before removal of the successful skip. It now verifies that a failed activation makes no policy writes and that seeding EGR permits a retry.

A separate fresh database passed the actual `00_run.sh` bootstrap and all nine canonical rehearsal tests.
The synthetic fixture uses the exact EGR identity and a 7/9 reward ladder without production customer data.
It rejects unsafe database names and incompatible reward ladders. Fixture and activation reruns preserve changed progress, policy timestamps, and reward deadlines.
Another tenant's policy and cards remain unchanged.

The verification regressions first reproduced successful exits for an absent policy and an incorrect grace deadline.
The final script exits with an SQL error for those cases and for an incompatible active policy.
The tests require `psql` exit code 3 and the expected diagnostic, so connection failures cannot satisfy these assertions.
The local-only harness also passed with an inherited `PGHOSTADDR` override after removing that override from child connections.
Verification uses one read-only, repeatable-read snapshot in UTC.
The stricter script also passed against the restored archive, and the saved history and balance preservation assertions passed again.

The canonical rehearsal is part of API CI. The base reward migration and `00_run.sh` remain unchanged.
The release guide includes the libpq service setup and separate local and staging fixture instructions.
No production database was accessed or changed during this follow-up.

## Browser operations

Playwright drove the actual Cash and dashboard controls through CDP.
The fixture cards used the canonical API for visit credits and redemptions.

| Client    | Starting state       | Operation                       | Result                                             |
| --------- | -------------------- | ------------------------------- | -------------------------------------------------- |
| Cash      | 8 visits             | First reward                    | 1 retained visit, zero rewards                     |
| Cash      | 9 visits             | First reward                    | 2 retained visits, zero rewards                    |
| Cash      | 9 visits             | Second reward                   | Zero visits, zero rewards                          |
| Cash      | 7 visits             | First reward with lost response | Retry returned the same claim, zero visits         |
| Cash      | 3 historical rewards | Redeem quantity 3               | Zero historical rewards                            |
| Dashboard | 8 visits             | First reward                    | 1 retained visit and visible receipt after refresh |

At nine visits, both reward choices were available and mutually exclusive.
Further visits and bulk credits were disabled.
Customer details opened the canonical scan flow for reward choice and receipt entry.
The lost-response check dropped the response after the server committed.
Its retry preserved the complete request and returned `replayed: true`.
Confirmations displayed the reward, quantity, remaining visits, receipt, and authenticated operator.
The six browser operations produced no page errors.
The dashboard showed translated confirmation text and correct visit plurals in English and Spanish.
Its confirmation remained visible after a language change and cleared after a customer change.

The scan uses solid success and error colors.
Its first-reward confirmation uses the correct singular or plural form for retained visits.
The daily visit banner stays hidden while a reward blocks further visits.

## Tools and artifacts

The checks used Node 22.23.3, pnpm 10.29.3, Vitest 2.1.9, PostgreSQL 16.15, and Playwright 1.62.1.
The browser ran headed Brave Chromium with separate Cash and dashboard contexts.
The temporary launcher adapted the repository's Linux browser workflow to macOS.
Separate contexts avoided cookie conflicts between local ports.

Local logs and screenshots remain outside Git under `/private/tmp`.
The principal artifacts are `umi-reward-final-ci-schema.log`, `umi-reward-final-unit.log`, and `umi-reward-browser-proof.json`.
The branch records contain commands in the task reports under `.superpowers/sdd/2026-10-07-single-cycle-reward-policy/`.

The schema command was `pnpm --filter @umi/api test:integration:schema`.
It ran with private app, worker, and administrator database URLs and `REWARD_MIGRATION_RERUN=1`.
The targeted commands used Vitest for the changed API, Cash, and dashboard suites.
The browser seed and probe scripts stayed outside Git and used only private fixture identities.

## Release limits

The worker requires the origins, queue, delivery flags, and provider configuration listed in the release checklist.
A provider crash after acceptance and before database acknowledgement can duplicate an external reminder.
The implementation does not promise exactly-once external delivery.
Resolve disputed historical balances before activation imports them.
Customer reconciliation records remain outside Git.
