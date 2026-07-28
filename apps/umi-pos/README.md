# UmiPOS

UmiPOS is the Flutter client application of the UMI platform. It is not a business or
database authority.

## Local bootstrap

Use Flutter 3.44.6 or a compatible repository-approved toolchain:

```sh
flutter pub get
flutter run \
  --dart-define=UMIPOS_ENVIRONMENT=development \
  --dart-define=UMIPOS_API_BASE_URL=https://api.example.test \
  --dart-define=UMIPOS_DEVELOPMENT_DIAGNOSTICS=true \
  --dart-define=UMIPOS_FEATURE_BOOTSTRAP=localSafeDefaults
```

Production and staging require HTTPS. Production rejects development diagnostics and local
feature bootstrap. Configuration contains no credentials. Authentication, device enrollment,
branch selection, business features, and offline synchronization are intentionally unavailable
until their gates.

## Boundaries

- Shared public API models come only from the generated `umi_contract` package.
- Sensitive values use platform secure storage; preferences are non-sensitive only.
- No client code connects directly to Supabase or stores service-role credentials.
- Hardware adapters report unsupported or unavailable until a reviewed integration exists.
- Telemetry is disabled unless configured and removes sensitive fields before export.

## Focused validation

```sh
flutter gen-l10n
dart format --output=none --set-exit-if-changed lib test
flutter analyze
flutter test
flutter build web --debug \
  --dart-define=UMIPOS_ENVIRONMENT=development \
  --dart-define=UMIPOS_API_BASE_URL=https://api.example.test
```
