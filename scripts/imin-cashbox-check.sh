#!/usr/bin/env bash
# Everything about the iMin till's cash drawer that can be known before the drawer
# itself is on site.
#
# The drawer is a dumb box on a board line, so the two questions that decide
# whether UmiPOS can open it are answered by the terminal alone: is the port
# there, and may an installed app write it? This asks both, in one command, and
# reads the drawer-detect pin so that the reading with a drawer attached has a
# "before" to be compared with.
#
#   usage: ./scripts/imin-cashbox-check.sh [serial]
#          ./scripts/imin-cashbox-check.sh 192.168.1.10:5555
#          ./scripts/imin-cashbox-check.sh --pulse 192.168.1.10:5555
#
# Without `--pulse` this writes nothing to the board. With `--pulse` it writes
# the same value UmiPOS writes, which opens a drawer that is attached — that is
# the go-live test, and it is the only step here that moves hardware.
set -euo pipefail

PULSE=0
SERIAL=""
for argument in "$@"; do
  case "$argument" in
    --pulse) PULSE=1 ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) SERIAL="$argument" ;;
  esac
done

if [[ -z "$SERIAL" ]]; then
  SERIAL="$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
fi
if [[ -z "$SERIAL" ]]; then
  echo "no device: attach one, or pass a serial" >&2
  exit 1
fi
echo "device: $SERIAL"

shell() { adb -s "$SERIAL" shell "$@"; }

CASHBOX_NODE="/sys/class/neostra_gpioctl/dev/gpioctl"
SENSOR_NODE="/sys/class/neostra_gpioctl/dev/gpioctl_sns"

echo
echo "identity"
shell 'getprop ro.product.model; getprop ro.build.version.release; getprop persist.sys.imin.sn' |
  paste -d' ' - - - | sed 's/^/  model, android, serial: /'

echo
echo "cashbox port"
for node in "$CASHBOX_NODE" /sys/extcon-usb-gpio/cashbox_en /sys/devices/platform/112b1000.usb/cashbox_en; do
  if shell "[ -e $node ]" >/dev/null 2>&1; then
    printf '  %s %s\n' "$(shell "ls -ld $node" | awk '{print $1}')" "$node"
  else
    printf '  %-12s %s\n' "absent" "$node"
  fi
done
printf '  drawer-detect reading now: %s\n' "$(shell "cat $SENSOR_NODE 2>/dev/null" | tr -d '\r')"
printf '  drive value in use: %s\n' "$(shell 'getprop persist.sys.CASHBOX_ENABLE' | tr -d '\r' | sed 's/^$/1 (factory default)/')"
printf '  vendor service present: %s\n' "$(shell 'getprop ro.build.version.sdk' | tr -d '\r' | awk '{print ($1>=33) ? "android 13+, service path applies" : "no (android < 13)"}')"

echo
echo "can an installed app write it"
APP="$(shell 'pm list packages -3' | sed 's/package://' | tr -d '\r' | grep -m1 umiconsulting || true)"
if [[ -z "$APP" ]]; then
  echo "  no UmiPOS package installed: install the till build, then re-run"
elif ! shell "run-as $APP id" >/dev/null 2>&1; then
  # A release build refuses `run-as`, so the check cannot run from here. The
  # in-app button asks the same question from inside the app.
  echo "  package: $APP (not debuggable)"
  echo "  this build refuses run-as: press \"Buscar cajón de la terminal\" in the till instead"
else
  echo "  package: $APP"
  if shell "run-as $APP sh -c 'test -w $CASHBOX_NODE && echo writable || echo not-writable'" |
    grep -q writable; then
    echo "  app domain: writable"
  else
    echo "  app domain: NOT writable — the node path cannot pulse on this build"
  fi
fi

echo
echo "printer link"
shell 'for d in /sys/bus/usb/devices/*/; do if [ -f "$d/idVendor" ]; then echo "$(cat $d/idVendor):$(cat $d/idProduct) $(cat $d/product 2>/dev/null)"; fi; done' |
  grep -v 1d6b | sed 's/^/  usb: /' || echo "  no USB peripheral attached"
printf '  printer status node: %s\n' "$(shell 'cat /dev/imin/printer_status 2>/dev/null' | tr -d '\r')"

if [[ "$PULSE" == "1" ]]; then
  echo
  echo "pulse"
  echo "  writing the drive value to $CASHBOX_NODE — a drawer on the CashBox socket must open"
  shell "run-as $APP sh -c 'echo \$(getprop persist.sys.CASHBOX_ENABLE | grep . || echo 1) > $CASHBOX_NODE; echo rc=\$?'"
  printf '  drawer-detect reading after: %s\n' "$(shell "cat $SENSOR_NODE 2>/dev/null" | tr -d '\r')"
  echo "  if the drawer did not move: check the cable is on CashBox RJ12 and the drawer's rated voltage"
fi
