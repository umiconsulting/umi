#!/usr/bin/env python3
"""Merchant-agnostic read-only readiness audit for a UmiPOS Android/iMin fleet.

Reads fleet inventory from an out-of-repo JSON file (never commit merchant IPs):
{
  "merchant": "example-cafe",
  "appPackage": "co.umiconsulting.umi_pos.estacion",
  "expectedSignerSha256": "14975f2c374e03b155ab363e17d4a79d4ab32b888ab381bedc3264934cb5c051",
  "adbStatePath": "~/.local/state/umi-adb-endpoints.json",
  "devices": [
    {"role": "Caja", "name": "cafe-caja", "ip": "100.x.y.z", "model": "D3"}
  ]
}
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
from typing import Any


DEFAULT_PACKAGE = "co.umiconsulting.umi_pos.estacion"


def run_cmd(*args: str, timeout: int = 20) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            args,
            capture_output=True,
            check=False,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return subprocess.CompletedProcess(args, 124, "", str(exc))


def tailscale_peers() -> dict[str, dict[str, Any]]:
    res = run_cmd("tailscale", "status", "--json")
    if res.returncode != 0:
        return {}
    try:
        data = json.loads(res.stdout)
    except json.JSONDecodeError:
        return {}
    by_ip: dict[str, dict[str, Any]] = {}
    for peer in (data.get("Peer") or {}).values():
        for ip in peer.get("TailscaleIPs") or []:
            by_ip[ip] = peer
    return by_ip


def adb_devices() -> dict[str, str]:
    res = run_cmd("adb", "devices")
    if res.returncode != 0:
        return {}
    out: dict[str, str] = {}
    for line in res.stdout.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2:
            out[parts[0]] = parts[1]
    return out


def load_saved_endpoints(path_str: str | None) -> dict[str, str]:
    if not path_str:
        return {}
    path = Path(path_str).expanduser()
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    endpoints: dict[str, str] = {}
    if isinstance(raw, dict):
        for key, val in raw.items():
            if isinstance(val, str):
                endpoints[key] = val
            elif isinstance(val, dict) and isinstance(val.get("endpoint"), str):
                endpoints[key] = val["endpoint"]
    return endpoints


def inspect_app(serial: str, package: str) -> dict[str, Any]:
    res = run_cmd("adb", "-s", serial, "shell", "dumpsys", "package", package)
    if res.returncode != 0:
        return {"installed": False, "error": res.stderr.strip() or res.stdout.strip()}
    text = res.stdout
    if f"Package [{package}]" not in text:
        return {"installed": False}
    vc_match = re.search(r"versionCode=(\d+)", text)
    vn_match = re.search(r"versionName=([^\s]+)", text)
    debuggable = "DEBUGGABLE" in text
    return {
        "installed": True,
        "versionCode": int(vc_match.group(1)) if vc_match else None,
        "versionName": vn_match.group(1) if vn_match else None,
        "debuggable": debuggable,
    }


def load_fleet(path: Path) -> dict[str, Any]:
    data = json.loads(path.expanduser().read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("devices"), list):
        raise ValueError("Fleet JSON must be an object with a 'devices' array.")
    return data


def audit_fleet(
    fleet: dict[str, Any],
    expected_build: int | None,
    repair: bool,
) -> dict[str, Any]:
    package = str(fleet.get("appPackage") or DEFAULT_PACKAGE)
    peers = tailscale_peers()
    saved_endpoints = load_saved_endpoints(fleet.get("adbStatePath"))
    connected = adb_devices()

    results: list[dict[str, Any]] = []
    all_ok = True

    for dev in fleet["devices"]:
        ip = str(dev.get("ip", ""))
        name = str(dev.get("name", ip))
        role = str(dev.get("role", "POS"))
        peer = peers.get(ip)
        ts_online = bool(peer and peer.get("Online"))

        serial = next((s for s, st in connected.items() if s.startswith(f"{ip}:") and st == "device"), None)
        if not serial and repair:
            candidate = saved_endpoints.get(name) or saved_endpoints.get(ip)
            if candidate:
                run_cmd("adb", "connect", candidate, timeout=10)
                connected = adb_devices()
                if connected.get(candidate) == "device":
                    serial = candidate

        entry: dict[str, Any] = {
            "role": role,
            "name": name,
            "ip": ip,
            "tailscaleOnline": ts_online,
            "adbSerial": serial,
            "ok": False,
        }

        if serial:
            app = inspect_app(serial, package)
            entry["app"] = app
            build_ok = (
                expected_build is None
                or (app.get("versionCode") is not None and int(app["versionCode"]) >= expected_build)
            )
            entry["ok"] = bool(ts_online and app.get("installed") and not app.get("debuggable") and build_ok)
        else:
            entry["app"] = None
            entry["ok"] = False

        if not entry["ok"]:
            all_ok = False
        results.append(entry)

    return {
        "merchant": fleet.get("merchant", "unknown"),
        "appPackage": package,
        "expectedBuild": expected_build,
        "tools": {
            "tailscale": shutil.which("tailscale") is not None,
            "adb": shutil.which("adb") is not None,
        },
        "allOk": all_ok,
        "devices": results,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Audit a merchant's UmiPOS Android/iMin fleet.")
    parser.add_argument("--fleet", required=True, help="Path to out-of-repo fleet JSON file.")
    parser.add_argument("--expected-build", type=int, default=None, help="Minimum expected UmiPOS versionCode.")
    parser.add_argument("--repair", action="store_true", help="Attempt adb connect on saved endpoints.")
    parser.add_argument("--json", dest="as_json", action="store_true", help="Print JSON output.")
    args = parser.parse_args(argv)

    fleet = load_fleet(Path(args.fleet))
    report = audit_fleet(fleet, args.expected_build, args.repair)

    if args.as_json:
        print(json.dumps(report, indent=2))
    else:
        print(f"Fleet audit: {report['merchant']} ({report['appPackage']})")
        for dev in report["devices"]:
            status = "OK" if dev["ok"] else "ISSUE"
            app = dev["app"] or {}
            vc = app.get("versionCode", "-")
            print(
                f"  [{status}] {dev['role']} ({dev['name']} / {dev['ip']}) "
                f"ts={dev['tailscaleOnline']} adb={dev['adbSerial'] or 'offline'} build={vc}"
            )
    return 0 if report["allOk"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
