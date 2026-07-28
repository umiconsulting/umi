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
