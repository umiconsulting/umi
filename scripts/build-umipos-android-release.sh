#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: build-umipos-android-release.sh

Required:
  UMIPOS_RELEASE_VERSION
  UMIPOS_BUILD_NUMBER
  UMIPOS_CONTRACT_VERSION

Optional:
  UMIPOS_API_BASE_URL       Default: https://api.umiconsulting.co
  UMIPOS_ANDROID_APP_ID     Default: co.umiconsulting.umi_pos.estacion
  UMIPOS_ANDROID_KEYSTORE_PATH
                             Default: ~/.local/share/umi-pos-signing/umi-pos-release.jks
  UMIPOS_ANDROID_KEY_ALIAS  Default: umi-pos-release
  UMIPOS_ANDROID_KEYSTORE_PASSWORD and UMIPOS_ANDROID_KEY_PASSWORD
                             Default: Secret Service values for service
                             umipos-android-release, account juan
  UMIPOS_ARTIFACT_PATH      Default: ~/Downloads/UmiPOS-<version>-production-release-build<code>.apk
  UMIPOS_ANDROID_CERT_SHA256
                             Expected signing certificate fingerprint
  UMIPOS_ALLOW_DEBUG_SIGNER Set to 1 only for a controlled signing migration.
EOF
}

if [[ -z "${UMIPOS_ANDROID_KEYSTORE_PATH:-}" ]]; then
  UMIPOS_ANDROID_KEYSTORE_PATH="$HOME/.local/share/umi-pos-signing/umi-pos-release.jks"
fi
if [[ -z "${UMIPOS_ANDROID_KEY_ALIAS:-}" ]]; then
  UMIPOS_ANDROID_KEY_ALIAS=umi-pos-release
fi
if [[ -z "${UMIPOS_ANDROID_KEYSTORE_PASSWORD:-}" ||
  -z "${UMIPOS_ANDROID_KEY_PASSWORD:-}" ]]; then
  signing_secret="$(
    secret-tool lookup service umipos-android-release account juan 2>/dev/null ||
      true
  )"
  if [[ -z "$signing_secret" ]]; then
    printf 'No signing password in Secret Service.\n' >&2
    exit 2
  fi
  UMIPOS_ANDROID_KEYSTORE_PASSWORD="$signing_secret"
  UMIPOS_ANDROID_KEY_PASSWORD="$signing_secret"
fi
export UMIPOS_ANDROID_KEYSTORE_PATH
export UMIPOS_ANDROID_KEY_ALIAS
export UMIPOS_ANDROID_KEYSTORE_PASSWORD
export UMIPOS_ANDROID_KEY_PASSWORD

required=(
  UMIPOS_RELEASE_VERSION
  UMIPOS_BUILD_NUMBER
  UMIPOS_CONTRACT_VERSION
)

missing=()
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    missing+=("$name")
  fi
done
if (( ${#missing[@]} > 0 )); then
  printf 'Missing required variables: %s\n' "${missing[*]}" >&2
  usage >&2
  exit 2
fi
if [[ ! "$UMIPOS_BUILD_NUMBER" =~ ^[1-9][0-9]*$ ]]; then
  printf 'UMIPOS_BUILD_NUMBER must be a positive integer.\n' >&2
  exit 2
fi
if [[ ! "$UMIPOS_CONTRACT_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf 'UMIPOS_CONTRACT_VERSION must use major.minor.patch.\n' >&2
  exit 2
fi

repo_root="$(git rev-parse --show-toplevel)"
app_dir="$repo_root/apps/umi-pos"
api_base="${UMIPOS_API_BASE_URL:-https://api.umiconsulting.co}"
app_id="${UMIPOS_ANDROID_APP_ID:-co.umiconsulting.umi_pos.estacion}"
release_commit="$(git rev-parse HEAD)"
release_timestamp="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

dirty="$(
  git -C "$repo_root" status --porcelain --untracked-files=all -- \
    apps/umi-pos packages/contract |
    grep -v '^ M apps/umi-pos/pubspec.lock$' || true
)"
if [[ -n "$dirty" ]]; then
  printf 'The POS and contract inputs have uncommitted changes:\n%s\n' "$dirty" >&2
  exit 2
fi

flutter_bin="${FLUTTER_BIN:-$HOME/.local/opt/flutter/bin/flutter}"
if [[ ! -x "$flutter_bin" ]]; then
  printf 'Flutter not found: %s\n' "$flutter_bin" >&2
  exit 2
fi

cd "$app_dir"
"$flutter_bin" build apk --release --flavor production \
  --target-platform android-arm64 \
  --build-name "$UMIPOS_RELEASE_VERSION" \
  --build-number "$UMIPOS_BUILD_NUMBER" \
  "-PumiposApplicationId=$app_id" \
  --dart-define=UMIPOS_ENVIRONMENT=production \
  "--dart-define=UMIPOS_API_BASE_URL=$api_base" \
  --dart-define=UMIPOS_DEVICE_KEY=keystore \
  "--dart-define=UMIPOS_CONTRACT_VERSION=$UMIPOS_CONTRACT_VERSION" \
  "--dart-define=UMIPOS_RELEASE_VERSION=$UMIPOS_RELEASE_VERSION" \
  "--dart-define=UMIPOS_RELEASE_GIT_COMMIT=$release_commit" \
  "--dart-define=UMIPOS_RELEASE_BUILD_TIMESTAMP=$release_timestamp" \
  --dart-define=UMIPOS_CONFIG_SCHEMA_VERSION=1 \
  --dart-define=UMIPOS_FEATURE_BOOTSTRAP=disabled \
  --dart-define=UMIPOS_LOCAL_FIRST_FAST_PATH=true \
  --dart-define=UMIPOS_DEVELOPMENT_DIAGNOSTICS=false \
  --dart-define=UMIPOS_HARDWARE_SIMULATOR_ENABLED=false

apk="$app_dir/build/app/outputs/flutter-apk/app-production-release.apk"
if [[ ! -f "$apk" ]]; then
  printf 'Flutter did not produce the release APK: %s\n' "$apk" >&2
  exit 1
fi
if unzip -l "$apk" | grep -q 'libvmservice_snapshot.so'; then
  printf 'Refusing to publish a profile artifact as production.\n' >&2
  exit 1
fi

aapt2="${AAPT2:-}"
if [[ -z "$aapt2" ]]; then
  aapt2="$(
    find "${ANDROID_HOME:-$HOME/Android/Sdk}/build-tools" \
      -type f -name aapt2 2>/dev/null |
      sort -V |
      tail -1
  )"
fi
if [[ -z "$aapt2" || ! -x "$aapt2" ]]; then
  printf 'aapt2 not found. Set AAPT2 or ANDROID_HOME.\n' >&2
  exit 2
fi

badging="$("$aapt2" dump badging "$apk")"
grep -q "package: name='$app_id' versionCode='$UMIPOS_BUILD_NUMBER'" \
  <<<"$badging" || {
  printf 'The APK package or versionCode does not match the release.\n' >&2
  exit 1
}
"$aapt2" dump xmltree --file AndroidManifest.xml "$apk" |
  grep -q 'android:debuggable(0x0101000f)=true' && {
  printf 'Refusing to publish a debuggable APK.\n' >&2
  exit 1
}

apksigner="${APKSIGNER:-$(dirname "$aapt2")/apksigner}"
certificate="$("$apksigner" verify --print-certs "$apk")"
if grep -q 'CN=Android Debug' <<<"$certificate" &&
  [[ "${UMIPOS_ALLOW_DEBUG_SIGNER:-0}" != "1" ]]; then
  printf 'Refusing to publish the Android debug certificate.\n' >&2
  exit 1
fi
certificate_sha256="$(
  grep 'certificate SHA-256 digest:' <<<"$certificate" |
    head -1 |
    sed 's/.*: //'
)"
expected_certificate_sha256="${UMIPOS_ANDROID_CERT_SHA256:-14975f2c374e03b155ab363e17d4a79d4ab32b888ab381bedc3264934cb5c051}"
if [[ "${certificate_sha256,,}" != "${expected_certificate_sha256,,}" ]]; then
  printf 'Unexpected signing certificate: %s\n' "$certificate_sha256" >&2
  exit 1
fi

destination="${UMIPOS_ARTIFACT_PATH:-$HOME/Downloads/UmiPOS-${UMIPOS_RELEASE_VERSION}-production-release-build${UMIPOS_BUILD_NUMBER}.apk}"
install -m 0644 "$apk" "$destination"
sha256="$(sha256sum "$destination" | cut -d' ' -f1)"

printf 'artifact=%s\n' "$destination"
printf 'sha256=%s\n' "$sha256"
printf 'commit=%s\n' "$release_commit"
printf 'build_timestamp=%s\n' "$release_timestamp"
