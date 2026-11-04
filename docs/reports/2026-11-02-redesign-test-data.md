# Local test data for the redesign

Date: 2026-11-02. Code reference: staging `b3e5bf882372eeb14c3c1b2658a6947df83c5051`, contract `2.50.0`.

## Latest native run

The November4 Android run uses an isolated synthetic café, contract2.51.0 and final source2fd267ed.
Its real writes, screenshots and known failures appear in [the native runtime report](2026-11-03-pos-design2-native-runtime.md).
The November2 snapshot and earlier checks below retain their original dates and limits.

## Freshness and scope

An authenticated SSH audit checked the staging release and database on November 2.
A fresh database export completed at `2026-11-02T17:34:46Z`.
The local restore completed at `17:34:56Z`.
The aggregate source and restored counts match.
The export, checksum, detailed manifest and credentials remain outside this repository.
No remote data or configuration changed.

The earlier local inventory fixtures date from October 30–31.
They were not a current staging snapshot.
Their schema anchor also did not prove complete migration coverage.
One old database omitted the extension schema from its search path and failed SQL preflight.
The existing databases and their active sessions remain unchanged.

A separate disposable database was built from the current staging DDL, forward migrations and RBAC catalog.
All writes below use synthetic merchants in that database.
The restored staging snapshot serves only as a local comparison reference.
The public Stageshow uses example data.

## Database verification

The current API build passed.
The schema, SQL preflight and CHECK-value tests passed all ten checks.
SQL preflight prepared 1,209 literal statements and reconstructed 122 dynamic statements.
Fifteen dynamic statements remain outside that static check.

The broader `pnpm --filter @umi/api test:integration:schema` run passed 35 files and 362 tests.
Two reward-migration rerun cases require the separate `REWARD_MIGRATION_RERUN` opt-in and were skipped.
The run used isolated local PostgreSQL and Redis with the real API repositories and role boundaries.
Its first setup attempts failed on sandbox networking and then an absent `REDIS_URL`.
The configured, approved run passed.

## Dashboard checks against the local API

| Scenario             | Result and evidence                                                                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventory on a phone | Existing mobile scenario passed with fresh articles and quantities.                                                                                                                                                                           |
| Preparation          | All three existing scenarios passed, including ingredient plans, stale recipe recovery, lost responses and keyboard focus during pending commands. The required sample includes 105 extra recipes to exercise pagination.                     |
| Initial cost         | The existing scenario completed creation, validation, edits, cancellation, unchanged values, uncertain-response retry, clear and zero values, stock invariance, recipe costs, real purchase receipts, source errors and narrow controls.      |
| Archived cost        | The existing archive scenario passed for a receipt-backed article and a zero-cost article. It confirmed retained amounts and unavailable cost controls.                                                                                       |
| CSV and Excel import | All four existing scenarios passed: preview, cancellation, lost-response recovery, localized results, exact recipes, persistence, checkout consumption, history, pagination, access boundaries, tab journal isolation and template downloads. |

These checks execute the real dashboard with Chromium, real input and the current local API.
The scenarios use controlled transport failures where recovery is the subject of the test.
Those injections do not replace the successful database writes.
The ten cases that CI lists separately as live-fixture cases now have this local evidence.
They remain outside the portable CI gate because CI does not provision their live fixtures.

The import harness hardcodes the earlier stack's ports and database as a safety boundary.
A temporary copy retained those guards and pinned them to the new disposable stack.
It also paced requests and allowed assertions to wait for that pacing.
Its first run exposed a Vite dependency reload and waits longer than the default assertion timeout.
After Vite completed its dependency cache, the targeted retry passed the three affected cases.
The separate journal case had already passed.

The initial-cost scenario completed before the following archive scenario reached the API request limit.
The archive scenario passed in a separate run after the rate-limit interval.
No API rate limit or product implementation changed for these checks.

## Evidence locations and limits

Native checks use a separate synthetic café with twelve products, product photos, seven operators, six tables and two preparation stations.
Its checkout policy enables the existing manual-terminal and mixed-payment flows.
The initial cash float uses the actual denomination counter.
The `pos.incoming_orders` flag is absent by default in the production permission design.
The synthetic fixture adds that flag and its merchant override to exercise the existing incoming-order screen.
A separate synthetic station role has only kitchen read, preparation, ready, completion, recall and cancellation acknowledgment permissions.
These fixture changes do not enable a feature or change permissions for a real merchant.

Actual Android input exercised enrollment, operator PIN, a seated table, required product modifiers, the denomination opening counter, and cash payment.
A public digital order reached the native incoming list and separate kitchen and bar projections with its preparation note.
Database reconciliation after replay found one order and one table link.
A kitchen-only operator completed its preparation item without payment access.
Native input also completed the bar item. A read-only database audit at `2026-11-02T22:36:36Z`
confirmed both items ready and both station tickets complete.
The digital commercial order remains unpaid.

The current incoming-order command binds the order reference to the active cart.
It does not import the commercial lines, modifiers or customer note.
The POS incoming contract supplies an aggregate summary only.
The separate dashboard and KDS reads do not provide an authorized, complete POS import contract.
Faithful digital adoption needs backend and contract work outside this presentation branch.
The three complete order-to-payment workflows are not yet verified.

At native checkpoint `baed6da8`, the supervisor recovered a sent takeaway account from the account list.
The checkout charged MXN45, received MXN100, and displayed MXN55 change.
The sent product retained its quantity and edit restrictions.
These runtime checks do not accept unresolved visual differences or later untested code.

At checkpoint `4d7a140d`, a native tablet created and sent a takeaway account for MXN135.
The account contains a Latte with its required variant and oat milk, plus a Croissant.
The operator saved the account and the phone recovered it through the actual account list.
The backend refused recovery while the tablet still held the account.
A native partial cash payment collected MXN45, received MXN200 and displayed MXN155 change.
The partial-payment ledger confirms that charge; MXN90 remains due.
The account summary still displayed only the original total in this checkpoint.
The presentation correction and remaining payment need a subsequent native check.
Both preparation stations completed that takeaway through actual native controls.
The database confirms both items ready and both station tickets complete.

The native admin registered an explicitly named simulated printer and opened its receipt preferences.
The diagnostic reported that the device did not respond.
This verifies registration and access only; it does not establish successful printing.

Local artifacts use the `/private/tmp/umi-redesign-` prefix.
The integration log is `integration-check.log`.
The preparation log is `preparation-complete.log`.
The import logs are `import-browser.log` and `import-browser-retry.log`.
The cost logs are `cost-browser.log` and `archived-browser.log`.
The `preparation-evidence`, `import-evidence` and `cost-evidence` directories contain screenshots and scenario results.

This evidence proves the named behavior on the local stack and synthetic data.
It does not certify physical printers, cash drawers, payment terminals, provider credentials or installations at a business.
The staging release, dashboard browser behavior and native POS build require their own identified evidence.
