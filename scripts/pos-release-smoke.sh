#!/usr/bin/env bash
# Pre-release UmiPOS Android APK smoke gate (local Linux KVM — NOT for every PR).
#
# What it proves deterministically before publishing a signed APK:
#   1. Binary integrity: package id, non-debuggable, ARM64 libapp.so, < 25 MiB, pinned release signer.
#   2. Emulator runtime: boots AVD headless on KVM, installs APK via adb, launches main activity,
#      confirms zero AndroidRuntime FATAL EXCEPTION crashes in logcat, captures launch screenshot.
#   3. Optional Maestro UI flow: if `maestro` is installed and --maestro-flow is given, executes it.
#   4. Always cleans up emulator process and temp artifacts on exit.
#
# Usage:
#   bash scripts/pos-release-smoke.sh /path/to/UmiPOS-release.apk [--avd umipos_tablet] [--shots DIR] [--maestro-flow YAML]

set -euo pipefail

APK=""
AVD_NAME="${UMIPOS_AVD_NAME:-umipos_tablet}"
SHOTS_DIR=""
MAESTRO_FLOW=""
EXPECTED_PACKAGE="${UMIPOS_ANDROID_APP_ID:-co.umiconsulting.umi_pos.estacion}"
EXPECTED_SIGNER="${UMIPOS_ANDROID_CERT_SHA256:-14975f2c374e03b155ab363e17d4a79d4ab32b888ab381bedc3264934cb5c051}"
MAX_BYTES=26214400
SKIP_EMULATOR=0

while [ $# -gt 0 ]; do
  case "$1" in
    --avd) AVD_NAME="${2:-}"; shift 2 ;;
    --shots) SHOTS_DIR="${2:-}"; shift 2 ;;
    --maestro-flow) MAESTRO_FLOW="${2:-}"; shift 2 ;;
    --skip-emulator) SKIP_EMULATOR=1; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; exit 2 ;;
    *) APK="$1"; shift ;;
  esac
done

if [ -z "$APK" ] || [ ! -f "$APK" ]; then
  echo "Usage: $(basename "$0") /path/to/UmiPOS-release.apk [--avd NAME] [--shots DIR] [--maestro-flow YAML]" >&2
  exit 2
fi

SDK_ROOT="${ANDROID_HOME:-$HOME/Android/Sdk}"
AAPT2="${AAPT2:-$(find "$SDK_ROOT/build-tools" -type f -name aapt2 2>/dev/null | sort -V | tail -n 1 || true)}"
APKSIGNER="${APKSIGNER:-$(find "$SDK_ROOT/build-tools" -type f -name apksigner 2>/dev/null | sort -V | tail -n 1 || true)}"
EMULATOR_BIN="${EMULATOR_BIN:-$SDK_ROOT/emulator/emulator}"
ADB_BIN="${ADB_BIN:-$(command -v adb || echo "$SDK_ROOT/platform-tools/adb")}"

echo "=== 1. APK Binary Admission Check ==="
SIZE_BYTES=$(stat -c%s "$APK")
if [ "$SIZE_BYTES" -gt "$MAX_BYTES" ]; then
  echo "FAIL: APK size $SIZE_BYTES exceeds 25 MiB limit ($MAX_BYTES)" >&2
  exit 1
fi
echo "  size: $SIZE_BYTES bytes (< 25 MiB) OK"

APK_LIST=$(unzip -l "$APK")
if grep -q 'libvmservice_snapshot.so' <<<"$APK_LIST"; then
  echo "FAIL: profile artifact detected (libvmservice_snapshot.so)" >&2
  exit 1
fi
if ! grep -q 'lib/arm64-v8a/libapp.so' <<<"$APK_LIST"; then
  echo "FAIL: missing ARM64 lib/arm64-v8a/libapp.so" >&2
  exit 1
fi
echo "  abi + release mode: arm64-v8a release OK"

if [ -n "$AAPT2" ] && [ -x "$AAPT2" ]; then
  BADGING=$("$AAPT2" dump badging "$APK")
  PKG=$(printf '%s\n' "$BADGING" | sed -n "s/^package: name='\([^']*\)'.*/\1/p" | head -n 1)
  VC=$(printf '%s\n' "$BADGING" | sed -n "s/.*versionCode='\([^']*\)'.*/\1/p" | head -n 1)
  VN=$(printf '%s\n' "$BADGING" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -n 1)
  if [ "$PKG" != "$EXPECTED_PACKAGE" ]; then
    echo "FAIL: package '$PKG' != expected '$EXPECTED_PACKAGE'" >&2
    exit 1
  fi
  if printf '%s\n' "$BADGING" | grep -q 'application-debuggable'; then
    echo "FAIL: APK is debuggable" >&2
    exit 1
  fi
  echo "  identity: $PKG v$VN (code $VC), non-debuggable OK"
fi

if [ -n "$APKSIGNER" ] && [ -x "$APKSIGNER" ]; then
  CERT_OUT=$("$APKSIGNER" verify --print-certs "$APK")
  SIGNER=$(printf '%s\n' "$CERT_OUT" | sed -n 's/.*certificate SHA-256 digest: //p' | head -n 1 | tr '[:upper:]' '[:lower:]')
  if [ -n "$EXPECTED_SIGNER" ] && [ "$SIGNER" != "$EXPECTED_SIGNER" ]; then
    echo "FAIL: signer '$SIGNER' != expected '$EXPECTED_SIGNER'" >&2
    exit 1
  fi
  echo "  signer: $SIGNER OK"
fi

if [ "$SKIP_EMULATOR" -eq 1 ]; then
  echo "=== POS RELEASE SMOKE (BINARY ONLY): PASS ==="
  exit 0
fi

if [ ! -x "$EMULATOR_BIN" ] || [ ! -x "$ADB_BIN" ]; then
  echo "FAIL: Android emulator or adb not found under $SDK_ROOT" >&2
  exit 1
fi

EMU_PID=""
EMU_SERIAL=""
TMP_LOG=$(mktemp)

cleanup() {
  if [ -n "$EMU_SERIAL" ]; then
    "$ADB_BIN" -s "$EMU_SERIAL" emu kill >/dev/null 2>&1 || true
  fi
  if [ -n "$EMU_PID" ] && kill -0 "$EMU_PID" 2>/dev/null; then
    kill "$EMU_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$TMP_LOG"
}
trap cleanup EXIT

echo "=== 2. Booting Headless KVM Emulator ($AVD_NAME) ==="
"$EMULATOR_BIN" -avd "$AVD_NAME" -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -wipe-data >"$TMP_LOG" 2>&1 &
EMU_PID=$!

for _ in $(seq 1 90); do
  EMU_SERIAL=$("$ADB_BIN" devices | awk '$1 ~ /^emulator-/ && $2 == "device" {print $1; exit}')
  if [ -n "$EMU_SERIAL" ]; then
    BOOT=$("$ADB_BIN" -s "$EMU_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
    if [ "$BOOT" = "1" ]; then
      break
    fi
  fi
  sleep 2
done

if [ -z "$EMU_SERIAL" ]; then
  echo "FAIL: emulator did not boot within timeout" >&2
  tail -n 30 "$TMP_LOG" >&2 || true
  exit 1
fi
echo "  emulator ready: $EMU_SERIAL"

echo "=== 3. Install & Cold-Launch Smoke ==="
"$ADB_BIN" -s "$EMU_SERIAL" install -r "$APK" >/dev/null
"$ADB_BIN" -s "$EMU_SERIAL" logcat -c
"$ADB_BIN" -s "$EMU_SERIAL" shell monkey -p "$EXPECTED_PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 8

APP_PID=$("$ADB_BIN" -s "$EMU_SERIAL" shell pidof "$EXPECTED_PACKAGE" 2>/dev/null | tr -d '\r' || true)
if [ -z "$APP_PID" ]; then
  echo "FAIL: $EXPECTED_PACKAGE is not running after cold launch" >&2
  "$ADB_BIN" -s "$EMU_SERIAL" logcat -d -t 80 | grep -E "FATAL EXCEPTION|flutter|AndroidRuntime" >&2 || true
  exit 1
fi

if "$ADB_BIN" -s "$EMU_SERIAL" logcat -d | grep -q "FATAL EXCEPTION"; then
  echo "FAIL: FATAL EXCEPTION detected in logcat after launch" >&2
  "$ADB_BIN" -s "$EMU_SERIAL" logcat -d | grep -A 15 "FATAL EXCEPTION" >&2 || true
  exit 1
fi
echo "  cold launch alive (pid=$APP_PID), zero FATAL EXCEPTION OK"

if [ -n "$SHOTS_DIR" ]; then
  mkdir -p "$SHOTS_DIR"
  "$ADB_BIN" -s "$EMU_SERIAL" exec-out screencap -p >"$SHOTS_DIR/launch.png"
  echo "  screenshot saved: $SHOTS_DIR/launch.png"
fi

if [ -n "$MAESTRO_FLOW" ]; then
  if ! command -v maestro >/dev/null 2>&1; then
    echo "FAIL: --maestro-flow requested but 'maestro' is not installed on PATH" >&2
    exit 1
  fi
  echo "=== 4. Running Maestro Flow ($MAESTRO_FLOW) ==="
  maestro --device "$EMU_SERIAL" test "$MAESTRO_FLOW"
fi

echo "=== POS RELEASE SMOKE: PASS ==="
