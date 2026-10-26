#!/usr/bin/env bash
set -euo pipefail

serial="${1:?usage: onca-keepadb-provision.sh ADB_SERIAL [APK]}"
apk="${2:-$HOME/Downloads/KeepADB-v1.8.38.apk}"
package_name="de.hohnepeople.keepadb"
webhook_url="http://100.109.51.39:47123/keepadb"

[[ -f "$apk" ]] || {
  printf 'KeepADB APK not found: %s\n' "$apk" >&2
  exit 1
}

adb -s "$serial" wait-for-device

if ! adb -s "$serial" shell pm path "$package_name" | grep -q '^package:'; then
  adb -s "$serial" install -r "$apk"
fi

adb -s "$serial" shell pm grant "$package_name" \
  android.permission.WRITE_SECURE_SETTINGS
adb -s "$serial" shell pm grant "$package_name" \
  android.permission.POST_NOTIFICATIONS
adb -s "$serial" shell cmd deviceidle whitelist "+$package_name"
adb -s "$serial" shell settings put global adb_wifi_enabled 1
adb -s "$serial" shell am start -n "$package_name/.MainActivity"

printf '\nKeepADB is installed and permitted on %s.\n' "$serial"
printf 'Finish these two on-device settings if they are not already set:\n'
printf '  1. KeepADB: enable "Keep wireless debugging active".\n'
printf '  2. KeepADB settings: enable webhook sync with %s\n' "$webhook_url"
printf '  3. Android Wireless debugging: allow the current Wi-Fi network always.\n'
