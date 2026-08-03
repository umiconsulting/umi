# Running UmiPOS

UmiPOS uses Flutter 3.44.6, Dart 3.12.2, Node 22, and pnpm 10.29.3. Linux, macOS, Windows,
Android, iOS (from macOS), and Flutter Web are supported when their platform SDK is installed.

## Bootstrap

1. Install the repository-supported Node, pnpm, Flutter, and target platform toolchains.
2. Run `pnpm install` at the workspace root.
3. Generate contracts with `pnpm --filter @umi/contract generate`.
4. In `apps/umi-pos`, run `flutter pub get` and `flutter gen-l10n`.

Use paths that work on each development machine. UmiPOS accepts only client credentials.

## Configuration

Pass compile-time values with `--dart-define`:

- `UMI_ENVIRONMENT=development|staging|production`
- `UMI_API_BASE_URL=https://...`
- `UMI_TELEMETRY_ENABLED=true|false`
- `UMI_DEVELOPMENT_DIAGNOSTICS=true|false`
- `UMI_FEATURE_BOOTSTRAP_MODE=localSafeDefaults|disabled`

Production configuration fails closed. Use a local API URL for development, an approved staging
endpoint for staging, and the approved TLS production endpoint for production.

Start the backend with its documented UMI API command before running authenticated flows.

## Device enrollment

Apply migrations through `20260729000200_pos_pin_authentication.sql`.

Use this development flow:

1. Sign in to the UMI Dashboard as an owner or administrator.
2. Open **Devices**.
3. Select the tenant and branch.
4. Select **Register UmiPOS**.
5. Enter the device name, type, and platform.
6. Create the eight-character setup code.
7. Open UmiPOS.
8. Enter the setup code.
9. Return to the Dashboard.
10. Approve the matching installation reference.
11. Wait for UmiPOS to store and acknowledge its device credential.
12. Enter the personal operator PIN.

The setup code expires after five minutes. The code works once.

UmiPOS stores the pairing session and polling credential in secure storage.

Native targets use the platform credential store. Web storage has browser-origin limits.

Run these focused checks:

- Pairing API tests: `pnpm umi-pos:pairing-api-tests`.
- Pairing Flutter tests: `pnpm umi-pos:pairing-tests`.
- Pairing database check: `pnpm umi-pos:pairing-db-check`.

Do not use the old challenge ID flow. The public direct-activation route is disabled.

## Personal operator PIN

Each operator enters only a personal PIN after device enrollment. UMI derives the tenant and
branch from the trusted device. The API loads the operator identity, role, permissions, and
entitlement.

For the disposable local database, the cashier PIN is `2468`.

Seed the POS entitlement only in the disposable local database:

`UMI_POS_DEV_SEED_CONFIRM=disposable pnpm umi-pos:local-access-seed`

Run the focused PIN checks:

`pnpm umi-pos:pin-tests`

Do not use the disposable seed against a shared, staging, or production database.

## Local role and catalog demo

Seed the disposable local database with five POS roles and 12 products:

`UMI_POS_DEV_SEED_CONFIRM=disposable pnpm umi-pos:demo-seed`

Alternative command without `pnpm`:

`UMI_POS_DEV_SEED_CONFIRM=disposable bash scripts/umi-pos-demo-seed.sh`

The seed does not print or store the API JWT secret. It reads the secret from the local
environment or the active Linux API process.

Read `docs/development/UMIPOS_ROLE_TEST_GUIDE.md` for the PIN list and each role test.

## One-command targets

- Linux: `pnpm umi-pos:linux`
- macOS: `pnpm umi-pos:mac` (`pnpm umi-pos:macos` remains an alias)
- Windows: `pnpm umi-pos:windows`
- Android: `pnpm umi-pos:android`
- iPhone/iPad (macOS and Xcode required): `pnpm umi-pos:ios`
- Web (Chrome required): `pnpm umi-pos:web`

Flutter reports a clear failure when the requested SDK or device is unavailable; do not install
or bypass platform prerequisites from repository scripts.

## Online checkout development

Gate 2E checkout requires the UMI API plus the canonical migrations through
`20260728000400_gate_2e_online_checkout.sql`. Cash is the supported end-to-end development
method. The external-terminal option deliberately returns a query-only unknown outcome until an
approved provider adapter exists; never treat it as a simulated success or submit a new payment.

## Offline journal and replay

Apply migrations through `20260728000600_gate_2f_offline_closeout.sql`. Native journal payloads are
AES-256-GCM encrypted; the key lives in platform secure storage and ciphertext lives separately.
Native storage always uses encryption. Web remains online-compatible. Policy disables sensitive
offline journaling on Web.

- Run focused offline scenarios: `pnpm umi-pos:replay-check`.
- Run all focused offline client checks: `pnpm umi-pos:offline-tests`.
- Run focused replay API checks: `pnpm umi-pos:replay-api-tests`.
- Validate the clean migration chain and RLS metadata in disposable PostgreSQL:
  `pnpm umi-pos:offline-db-check`.
- Exercise recovery scenarios: `pnpm umi-pos:recovery-demo`.
- Run the development connectivity demonstration: `pnpm umi-pos:offline-demo`.
- Simulate network loss with OS/development proxy controls; never alter TLS or encryption.
- Restore connectivity, reauthenticate if required, and allow ordered replay only after device,
  tenant, branch, and operator authority are valid.
- Inspect only queue counts, schema/contract versions, safe error categories, replay time, and
  opaque context references. Never export payloads or encryption material.
- Disposable development journal data may be removed only through the platform app-data controls;
  never use that recovery step on a real pending queue.
- To test crash recovery, terminate before or after durable insertion, replay result, mapping, or
  archive; restart, verify the encrypted queue count, then query/replay from the last acknowledged
  cursor. Repeating checkout for the same persisted cart/version/totals identity recovers the
  existing provisional sale rather than creating another command.

All append, replay-result, unknown-result, policy, mapping, conflict, and compaction writes share
one serialized encrypted mutation boundary. Secure-storage or integrity failure blocks journaling
without resetting data. Migration downgrade
is unsupported. An owner-assisted recovery path must preserve ciphertext for support analysis.

Load policy while online by opening the authenticated catalog. To exercise the safe cash path,
review authoritative totals online, disconnect, confirm cash checkout, inspect the provisional
receipt and Recovery Center, then reconnect. Replay queries unknown results before reuse of the
same command identity. Simulate response loss only with a development proxy after the server
accepts the request. Simulate revocation, expiry, stale snapshots, and corruption only against
disposable identities and app data. Never delete a production journal.

Linux native builds require CMake, Ninja, Clang, GTK 3 development headers, and the platform
secure-storage dependencies. Web builds confirm online compatibility only; browser storage is
not certified for financial journaling. The completion notification endpoint is exactly
`https://ntfy.sh/nxoumipos`.

## Sale lifecycle

Apply migrations through `20260729000300_gate_3a_sale_lifecycle.sql`.

Use these commands:

- Run focused API tests: `pnpm umi-pos:sale-api-tests`.
- Run focused Flutter tests: `pnpm umi-pos:sale-tests`.
- Run the disposable PostgreSQL check: `pnpm umi-pos:sale-db-check`.

Test this cashier flow:

1. Start an empty sale.
2. Add and edit products.
3. Attach a customer or keep the anonymous customer.
4. Suspend the sale.
5. Resume the sale.
6. Cancel a separate sale with a reason.
7. Complete checkout.
8. Verify that UmiPOS opens one fresh sale and focuses search.
9. Open the latest receipt from the sale center.
10. Restart UmiPOS and verify the active or suspended sale state.

Use the existing offline checkout path for a policy-authorized offline cash sale. Lifecycle
commands require API authority. Gate 3A preserves the Gate 2F journal allowlist.

## Advanced checkout

Apply migrations through `20260729000400_gate_3b_advanced_checkout.sql`.

Use these commands:

- Run focused API tests: `pnpm umi-pos:checkout-api-tests`.
- Run focused Flutter tests: `pnpm umi-pos:checkout-tests`.
- Run the disposable PostgreSQL check: `pnpm umi-pos:checkout-db-check`.

Test the online cashier flow:

1. Enroll a development device and approve it in UMI.
2. Sign in with a cashier PIN.
3. Add products and open checkout.
4. Test exact cash and cash with change.
5. Review totals again after each tender, tip, or discount change.
6. Test cash plus manual terminal.
7. Mark a terminal result as failed. Confirm that the sale remains available.
8. Mark a terminal result as unknown. Query the same result. Do not create another charge.
9. Apply a preset tip and a custom tip.
10. Apply a percentage or fixed order discount with a reason.
11. Use a different manager PIN when approval is required.
12. Select display, print-later, or no-receipt intent.
13. Complete checkout and verify that one new empty sale starts.
14. Restart during tender collection and verify the recovered draft.

The digital receipt option is a contract foundation. Gate 3B does not send email or SMS.
Manual terminal success records an operator assertion. It is not provider proof.
Offline checkout supports one policy-authorized cash tender only. Advanced tender, tip,
discount, and live approval actions require connectivity.

## Cash shift and register operations

Apply migrations through `20260729000500_gate_3c_cash_shift.sql`.

Run these focused commands from the workspace root:

- Generate contracts: `pnpm --filter @umi/contract generate`.
- Run cash API tests: `pnpm umi-pos:cash-api-tests`.
- Run cash Flutter tests: `pnpm umi-pos:cash-tests`.
- Run the disposable database matrix: `pnpm umi-pos:cash-db-check`.
- Analyze Flutter: `cd apps/umi-pos && flutter analyze`.
- Build Linux debug: `cd apps/umi-pos && flutter build linux --debug`.

Create a development register through an authorized database seed or UMI administration flow.
Use the active tenant, branch, device, and currency. Do not copy production identifiers.

Test the operational flow:

1. Start PostgreSQL and the UMI API with the normal local commands.
2. Start UmiPOS with `flutter run -d linux` or `flutter run -d chrome`.
3. Enroll the device and approve it in UMI.
4. Sign in with a cashier PIN.
5. Select the assigned register.
6. Open a shift with a zero or total opening float.
7. Complete an exact cash sale.
8. Verify one `cash_sale` ledger fact for the active shift.
9. Test cash received with change.
10. Test mixed tender and verify that only the cash part changes expected cash.
11. Record Paid In, Paid Out, and Safe Drop with safe reason codes.
12. Suspend and resume the shift.
13. Test handoff with an incoming operator PIN.
14. Sign in again as the incoming operator.
15. Submit a blind count. Confirm that expected cash was hidden before submission.
16. Test recount and variance approval with a different manager PIN.
17. Reconcile the fixed ledger sequence.
18. Confirm the irreversible shift close.
19. Verify that the closed shift rejects a new cash fact.

To test recovery, stop UmiPOS after any command submission. Restart the app. The client queries
the current server state and uses the original idempotent result. Do not create a replacement
command after an unknown response.

When the close threshold applies, enter a different manager PIN in the close dialog. The approval
is short-lived and applies only to the selected count and ledger sequence.

The Cash Center records a no-sale drawer request only. Gate 3C does not control drawer hardware.
Advanced cash operations require connectivity. UmiPOS does not close or reconcile a shift offline.

Use the disposable database script for destructive validation. The script creates and removes its
own container. Do not point this command at a shared or production database.

## Post-sale exceptions

Apply the build-v3 chain through `34_pos_exception.sql`.

Run these focused commands from the workspace root:

- Generate contracts: `pnpm umi-pos:generate`.
- Run exception API tests: `pnpm umi-pos:exception-api-tests`.
- Run exception Flutter tests: `pnpm umi-pos:exception-tests`.
- Run the disposable PostgreSQL matrix: `pnpm umi-pos:exception-db-check`.
- Analyze Flutter: `cd apps/umi-pos && flutter analyze`.
- Build Linux debug: `cd apps/umi-pos && flutter build linux --debug`.
- Build Web compatibility: `cd apps/umi-pos && flutter build web`.

Test the exception flow:

1. Start PostgreSQL, the UMI API, and UmiPOS with the normal local commands.
2. Run `UMI_POS_DEV_SEED_CONFIRM=disposable pnpm umi-pos:demo-seed`.
3. Enroll the device and sign in with an operator PIN.
4. Open an eligible cash shift before a cash refund.
5. Complete a cash, terminal, or mixed-tender sale. This creates the refundable sale.
6. Open Sales and select the post-sale action for the committed sale.
7. Confirm server eligibility before you select an action.
8. Test a full refund and confirm the restock intent.
9. Test a partial refund with one or more remaining line quantities.
10. Test a void only when the server returns void eligibility.
11. Use a different manager PIN when the policy requires approval.
12. Verify that a cash refund reduces the current shift expected cash once.
13. Record terminal success only after the external terminal confirms the refund.
14. Record terminal failure and return to the same refund flow.
15. Record an unknown result and confirm that no replacement refund action appears.
16. Restart before commit and confirm that the client invalidates stale preview data.
17. Simulate response loss after commit and query the original command result.
18. Open the immutable compensation receipt and exception history.

Use development seed data that contains a committed sale and original receipt facts. Do not edit
the committed sale, payment, receipt, or cash facts. Reset only disposable development data.

Post-sale exceptions require connectivity. UmiPOS does not create offline refunds or voids.
Manual terminal results remain operator assertions. Restock intent does not change stock in Gate 3D.
