#!/usr/bin/env python3
"""Read-only readiness audit for the ONCA support host and Android fleet."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


EXPECTED_MACHINE_ID = "97d302e7018b42eb80e9a56e78dab7b6"
EXPECTED_SUPPORT_IP = "100.109.51.39"
APP_PACKAGE = "co.umiconsulting.umi_pos.estacion"
KEEPADB_PACKAGE = "de.hohnepeople.keepadb"
STATE_PATH = Path.home() / ".local/state/onca-adb-endpoints.json"

DEVICES = (
    {
        "role": "Caja",
        "name": "onca-caja-principal",
        "ip": "100.64.178.95",
        "model": "D3",
    },
    {
        "role": "Barra",
        "name": "onca-barra",
        "ip": "100.90.102.41",
        "model": "SM-X210",
    },
    {
        "role": "Cocina",
        "name": "onca-cocina",
        "ip": "100.125.137.36",
        "model": "SM-X210",
    },
    {
        "role": "Mesero",
        "name": "onca-mesero",
        "ip": "100.125.102.97",
        "model": "SM-X133",
    },
)


def command(*args: str, timeout: int = 20) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            args,
            capture_output=True,
            check=False,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return subprocess.CompletedProcess(
            args=args,
            returncode=124,
            stdout="",
            stderr=str(error),
        )


def read_machine_id() -> str:
    try:
        return Path("/etc/machine-id").read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def tailscale_state() -> dict[str, object]:
    result = command("tailscale", "status", "--json")
    if result.returncode != 0:
        return {}
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {}


def adb_devices() -> dict[str, str]:
    result = command("adb", "devices")
    devices: dict[str, str] = {}
    for line in result.stdout.splitlines()[1:]:
        columns = line.split()
        if len(columns) >= 2:
            devices[columns[0]] = columns[1]
    return devices


def load_endpoints() -> dict[str, object]:
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def package_field(serial: str, package: str, expression: str) -> str | None:
    result = command("adb", "-s", serial, "shell", "dumpsys", "package", package)
    match = re.search(expression, result.stdout, flags=re.MULTILINE)
    return match.group(1).strip() if match else None


def adb_shell(serial: str, *args: str) -> str:
    result = command("adb", "-s", serial, "shell", *args)
    return result.stdout.strip() if result.returncode == 0 else ""


def check_device(
    device: dict[str, str],
    peers: dict[str, dict[str, object]],
    adb: dict[str, str],
    endpoints: dict[str, object],
    expected_build: str | None,
) -> dict[str, object]:
    ip = device["ip"]
    peer = peers.get(ip, {})
    endpoint = endpoints.get(ip, {})
    endpoint_target = str(endpoint.get("target") or "")
    adb_state = adb.get(endpoint_target)
    if adb_state is None:
        adb_state = next(
            (state for serial, state in adb.items() if serial.startswith(ip + ":")),
            "missing",
        )
    serial = next(
        (serial for serial in adb if serial.startswith(ip + ":")),
        endpoint_target,
    )

    checks: dict[str, object] = {
        "tailscaleOnline": bool(peer.get("Online")),
        "endpointActive": bool(endpoint.get("active")),
        "adbState": adb_state,
    }
    failures: list[str] = []
    if not checks["tailscaleOnline"]:
        failures.append("Tailscale peer is offline")
    if not checks["endpointActive"]:
        failures.append("KeepADB has no active endpoint")
    if adb_state != "device":
        failures.append("ADB is not connected")

    if adb_state == "device":
        model = adb_shell(serial, "getprop", "ro.product.model")
        android = adb_shell(serial, "getprop", "ro.build.version.release")
        adb_wifi = adb_shell(serial, "settings", "get", "global", "adb_wifi_enabled")
        always_on_vpn = adb_shell(
            serial, "settings", "get", "secure", "always_on_vpn_app"
        )
        keepadb_version = package_field(
            serial, KEEPADB_PACKAGE, r"^\s*versionName=(\S+)"
        )
        keepadb_running = "KeepADBService" in adb_shell(
            serial, "dumpsys", "activity", "services", KEEPADB_PACKAGE
        )
        battery_allowlist = adb_shell(
            serial, "dumpsys", "deviceidle", "whitelist"
        )
        app_version = package_field(
            serial, APP_PACKAGE, r"^\s*versionCode=(\d+)"
        )
        app_flags = package_field(
            serial, APP_PACKAGE, r"^\s*flags=\[(.*?)\]"
        )
        boot_count = adb_shell(serial, "settings", "get", "global", "boot_count")

        checks.update(
            {
                "serial": serial,
                "model": model,
                "android": android,
                "umiposVersion": app_version,
                "umiposDebuggable": "DEBUGGABLE" in (app_flags or ""),
                "adbWifiEnabled": adb_wifi,
                "alwaysOnVpn": always_on_vpn,
                "keepadbVersion": keepadb_version,
                "keepadbService": keepadb_running,
                "keepadbBatteryExempt": KEEPADB_PACKAGE in battery_allowlist,
                "tailscaleBatteryExempt": "com.tailscale.ipn" in battery_allowlist,
                "bootCount": boot_count,
            }
        )
        if model and model != device["model"]:
            failures.append(f"Model is {model}, expected {device['model']}")
        if adb_wifi != "1":
            failures.append("Wireless debugging is disabled")
        if always_on_vpn != "com.tailscale.ipn":
            failures.append("Tailscale is not the always-on VPN")
        if not keepadb_running:
            failures.append("KeepADBService is not running")
        if KEEPADB_PACKAGE not in battery_allowlist:
            failures.append("KeepADB is not battery-exempt")
        if "com.tailscale.ipn" not in battery_allowlist:
            failures.append("Tailscale is not battery-exempt")
        if expected_build is not None and app_version != expected_build:
            failures.append(
                f"UmiPOS is build {app_version or 'unknown'}, expected {expected_build}"
            )
        if "DEBUGGABLE" in (app_flags or ""):
            failures.append("UmiPOS is debuggable")

    return {
        "role": device["role"],
        "tailscaleName": device["name"],
        "tailscaleIp": ip,
        "checks": checks,
        "failures": failures,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-build")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--repair", action="store_true")
    args = parser.parse_args()

    if read_machine_id() != EXPECTED_MACHINE_ID:
        print("Refusing: this is not the ONCA support host.", file=sys.stderr)
        return 2
    if shutil.which("tailscale") is None or shutil.which("adb") is None:
        print("Tailscale and adb must both be installed.", file=sys.stderr)
        return 2

    if args.repair:
        command("systemctl", "--user", "restart", "onca-adb-register.service")

    tailscale = tailscale_state()
    self_ips = list(tailscale.get("Self", {}).get("TailscaleIPs", []))
    if EXPECTED_SUPPORT_IP not in self_ips:
        print("Refusing: support Tailscale address does not match.", file=sys.stderr)
        return 2

    peers = {
        ip: peer
        for peer in tailscale.get("Peer", {}).values()
        for ip in peer.get("TailscaleIPs", [])
    }
    endpoints = load_endpoints()

    if args.repair:
        for endpoint in endpoints.values():
            if endpoint.get("active") and endpoint.get("target"):
                command("adb", "connect", str(endpoint["target"]))

    adb = adb_devices()
    results = [
        check_device(device, peers, adb, endpoints, args.expected_build)
        for device in DEVICES
    ]

    service = command(
        "systemctl", "--user", "is-active", "onca-adb-register.service"
    ).stdout.strip()
    health = command(
        "curl",
        "-fsS",
        "--max-time",
        "10",
        "https://api.umiconsulting.co/health/release",
        timeout=15,
    )
    summary = {
        "host": {
            "machineId": EXPECTED_MACHINE_ID,
            "tailscaleIp": EXPECTED_SUPPORT_IP,
            "keepadbService": service,
            "adapterCount": len(adb),
        },
        "apiHealthy": health.returncode == 0,
        "devices": results,
    }
    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print(
            f"host=OK tailscale={EXPECTED_SUPPORT_IP} "
            f"keepadb={service} adb={len(adb)} api="
            f"{'OK' if summary['apiHealthy'] else 'FAIL'}"
        )
        for device in results:
            status = "OK" if not device["failures"] else "FAIL"
            checks = device["checks"]
            print(
                f"{device['role']}: {status} "
                f"build={checks.get('umiposVersion', '-')} "
                f"adb={checks['adbState']} "
                f"boot={checks.get('bootCount', '-')}"
            )
            for failure in device["failures"]:
                print(f"  - {failure}")

    failed = not summary["apiHealthy"] or service != "active"
    failed = failed or any(device["failures"] for device in results)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
