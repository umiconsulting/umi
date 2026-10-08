# Local verification of reward changes

The implementation remains on `feat/loyalty-expiry-and-redemption`, based on `affd6bc`.
All database changes and browser operations used private fixtures.
Production deployment and tenant activation remain pending.
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
