#!/usr/bin/env python3
"""Install one verified UmiPOS APK on the connected ONCA fleet."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import zipfile


APP_PACKAGE = "co.umiconsulting.umi_pos.estacion"
EXPECTED_SIGNER = "14975f2c374e03b155ab363e17d4a79d4ab32b888ab381bedc3264934cb5c051"
STATE_PATH = Path.home() / ".local/state/onca-adb-endpoints.json"
FLEET = (
    ("Caja", "100.64.178.95"),
    ("Barra", "100.90.102.41"),
    ("Cocina", "100.125.137.36"),
    ("Mesero", "100.125.102.97"),
)


def command(*args: str, timeout: int = 120) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            args,
            capture_output=True,
            check=False,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return subprocess.CompletedProcess(args, 124, "", str(error))


def android_tool(name: str) -> Path:
    override = {"aapt2": "AAPT2", "apksigner": "APKSIGNER"}[name]
    if configured := os.environ.get(override):
        path = Path(configured)
    else:
        sdk = Path.home() / "Android/Sdk/build-tools"
        candidates = sorted(sdk.glob(f"*/{name}"), reverse=True)
        if not candidates:
            raise SystemExit(f"{name} was not found in {sdk}")
        path = candidates[0]
    if not path.is_file():
        raise SystemExit(f"{name} is not executable: {path}")
    return path


def connected_devices() -> dict[str, str]:
    result = command("adb", "devices")
    devices: dict[str, str] = {}
    for line in result.stdout.splitlines()[1:]:
        fields = line.split()
        if len(fields) >= 2:
            devices[fields[0]] = fields[1]
    return devices


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("apk")
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("--allow-partial", action="store_true")
    args = parser.parse_args()

    if os.geteuid() == 0:
        print("Run as juan, not as root.", file=sys.stderr)
        return 2

    apk = Path(args.apk).resolve()
    if not apk.is_file():
        print(f"APK not found: {apk}", file=sys.stderr)
        return 2

    aapt2 = android_tool("aapt2")
    apksigner = android_tool("apksigner")
    badging = command(str(aapt2), "dump", "badging", str(apk)).stdout
    package_match = re.search(
        rf"package: name='{re.escape(APP_PACKAGE)}' versionCode='(\d+)'", badging
    )
    if package_match is None:
        print("APK package or versionCode is invalid.", file=sys.stderr)
        return 2
    version_code = package_match.group(1)
    with zipfile.ZipFile(apk) as archive:
        if any(name.endswith("libvmservice_snapshot.so") for name in archive.namelist()):
            print("Refusing to install a profile artifact.", file=sys.stderr)
            return 2
    manifest = command(
        str(aapt2), "dump", "xmltree", "--file", "AndroidManifest.xml", str(apk)
    ).stdout
    if "android:debuggable(0x0101000f)=true" in manifest:
        print("Refusing to install a debuggable APK.", file=sys.stderr)
        return 2

    certificates = command(
        str(apksigner), "verify", "--print-certs", str(apk)
    ).stdout
    signer_match = re.search(r"certificate SHA-256 digest: ([0-9a-f]+)", certificates)
    signer = signer_match.group(1) if signer_match else ""
    if signer.lower() != EXPECTED_SIGNER:
        print(f"Unexpected signer: {signer or 'missing'}", file=sys.stderr)
        return 2

    try:
        endpoints = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        endpoints = {}
    devices = connected_devices()
    targets: list[tuple[str, str]] = []
    missing: list[str] = []
    for role, ip in FLEET:
        endpoint = endpoints.get(ip, {})
        target = str(endpoint.get("target") or "")
        serial = next(
            (serial for serial in devices if serial.startswith(ip + ":")),
            target,
        )
        if devices.get(serial) != "device":
            missing.append(f"{role} ({ip})")
        else:
            targets.append((role, serial))

    print(f"artifact={apk}")
    print(f"versionCode={version_code}")
    print(f"signer={signer}")
    for role, serial in targets:
        print(f"ready={role} serial={serial}")
    for item in missing:
        print(f"missing={item}")

    if missing and not args.allow_partial:
        print("The complete fleet must be online before installation.", file=sys.stderr)
        return 1
    if args.check_only:
        return 0 if not missing else 1
    if not targets:
        print("No connected ONCA devices.", file=sys.stderr)
        return 1

    failures: list[str] = []
    for role, serial in targets:
        print(f"Installing on {role}: {serial}")
        result = command(
            "adb",
            "-s",
            serial,
            "install",
            "--no-incremental",
            "-r",
            str(apk),
            timeout=300,
        )
        output = (result.stdout + result.stderr).strip()
        print(output)
        if result.returncode != 0 or "Success" not in output:
            failures.append(f"{role}: install failed")
            continue
        package = command(
            "adb",
            "-s",
            serial,
            "shell",
            "dumpsys",
            "package",
            APP_PACKAGE,
        ).stdout
        expected = f"versionCode={version_code}"
        if expected not in package:
            failures.append(f"{role}: installed version is not {version_code}")

    if failures:
        for failure in failures:
            print(f"FAIL {failure}", file=sys.stderr)
        return 1
    print(f"Installed build {version_code} on {len(targets)} device(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
