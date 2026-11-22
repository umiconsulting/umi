#!/usr/bin/env python3
"""Unit tests for merchant-agnostic fleet_doctor.py."""

from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import fleet_doctor as fd


class FleetDoctorTests(unittest.TestCase):
    def test_load_and_audit_fleet_with_mocked_tools(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fleet_path = Path(tmp) / "cafe.json"
            fleet_path.write_text(
                json.dumps(
                    {
                        "merchant": "kalala",
                        "appPackage": "co.umiconsulting.umi_pos.estacion",
                        "devices": [
                            {"role": "Caja", "name": "kalala-caja", "ip": "100.1.2.3", "model": "D3"}
                        ],
                    }
                ),
                encoding="utf-8",
            )
            fleet = fd.load_fleet(fleet_path)
            with (
                mock.patch.object(fd, "tailscale_peers", return_value={"100.1.2.3": {"Online": True}}),
                mock.patch.object(fd, "adb_devices", return_value={"100.1.2.3:5555": "device"}),
                mock.patch.object(
                    fd,
                    "inspect_app",
                    return_value={
                        "installed": True,
                        "versionCode": 338,
                        "versionName": "1.0.1",
                        "debuggable": False,
                    },
                ),
            ):
                report = fd.audit_fleet(fleet, expected_build=338, repair=False)
                self.assertTrue(report["allOk"])
                self.assertEqual(report["merchant"], "kalala")
                self.assertEqual(report["devices"][0]["app"]["versionCode"], 338)

                stale = fd.audit_fleet(fleet, expected_build=339, repair=False)
                self.assertFalse(stale["allOk"])


if __name__ == "__main__":
    unittest.main()
