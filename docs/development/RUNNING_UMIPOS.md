# Running UmiPOS

UmiPOS uses Flutter 3.44.6, Dart 3.12.2, Node 22, and pnpm 10.29.3. Linux, macOS, Windows,
Android, iOS (from macOS), and Flutter Web are supported when their platform SDK is installed.

## Bootstrap

1. Install the repository-supported Node, pnpm, Flutter, and target platform toolchains.
2. Run `pnpm install` at the workspace root.
3. Generate contracts with `pnpm --filter @umi/contract generate`.
4. In `apps/umi-pos`, run `flutter pub get` and `flutter gen-l10n`.

No machine-specific path is required. UmiPOS never accepts Supabase service-role or database
credentials.

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
There is no plaintext fallback. Web remains online-compatible but sensitive offline journaling is
disabled.

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
