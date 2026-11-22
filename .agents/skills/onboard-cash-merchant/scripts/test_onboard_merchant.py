#!/usr/bin/env python3
"""Unit tests for onboard_merchant.py (no network calls required)."""

from __future__ import annotations

import http.cookiejar
import json
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest
from unittest import mock
import zlib

import onboard_merchant as om


def make_tiny_png(path: Path, width: int = 16, height: int = 16) -> None:
    """Write a valid RGB PNG without external dependencies."""
    raw = b"".join(b"\x00" + (b"\x22\x44\x88" * width) for _ in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack("!I", len(data))
            + tag
            + data
            + struct.pack("!I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack("!IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    path.write_bytes(png)


class OnboardMerchantTests(unittest.TestCase):
    def test_instagram_handle_normalization(self) -> None:
        self.assertEqual(om.normalize_instagram_handle("https://www.instagram.com/Kalala.Cafe/?hl=es"), "kalala.cafe")
        self.assertEqual(om.normalize_instagram_handle("@elgranribera"), "elgranribera")
        with self.assertRaises(ValueError):
            om.normalize_instagram_handle("https://instagram.com/")

    def test_card_prefix_and_slug_derivation(self) -> None:
        self.assertEqual(om.derive_card_prefix("Kalala Café"), "KALC")
        self.assertEqual(om.derive_card_prefix("El Gran Ribera"), "EGR")
        self.assertEqual(om.slugify_identifier("Café Árbol & Pan"), "cafe-arbol-pan")

    def test_full_local_fetch_prepare_dryrun_and_cleanup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src_logo = root / "avatar.png"
            make_tiny_png(src_logo, width=32, height=32)
            workdir = root / "job"

            rc = om.main(
                [
                    "fetch",
                    "--logo-file",
                    str(src_logo),
                    "--name",
                    "Café Brisa",
                    "--city",
                    "Mazatlán",
                    "--plan",
                    "growth",
                    "--workdir",
                    str(workdir),
                ]
            )
            self.assertEqual(rc, 0)
            draft_path = workdir / "draft.json"
            self.assertTrue(draft_path.exists())
            draft = json.loads(draft_path.read_text(encoding="utf-8"))
            payload = draft["provisionPayload"]
            self.assertEqual(om.validate_provision_payload(payload), [])
            self.assertNotIn("slug", payload)

            rc = om.main(["prepare-logo", "--input", str(src_logo), "--workdir", str(workdir)])
            self.assertEqual(rc, 0)
            prepared = workdir / "prepared-logo.png"
            self.assertTrue(prepared.exists())
            self.assertLessEqual(prepared.stat().st_size, om.MAX_LOGO_BYTES)

            # Dry-run provision validates payload + logo without network writes.
            rc = om.main(
                [
                    "provision",
                    "--draft",
                    str(draft_path),
                    "--logo",
                    str(prepared),
                    "--api",
                    "https://api.umiconsulting.co",
                ]
            )
            self.assertEqual(rc, 0)

            # Cleanup wipes draft.json and removes workdir completely.
            rc = om.main(["cleanup", "--workdir", str(workdir)])
            self.assertEqual(rc, 0)
            self.assertFalse(workdir.exists())

    def test_fetch_instagram_profile_integration(self) -> None:
        self.assertTrue(om.INSTAGRAM_FETCH_SCRIPT.exists())
        syntax = subprocess.run(["bash", "-n", str(om.INSTAGRAM_FETCH_SCRIPT)], capture_output=True, text=True, check=False)
        self.assertEqual(syntax.returncode, 0, syntax.stderr)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            avatar = root / "shimona.png"
            make_tiny_png(avatar, width=24, height=24)
            fake_script = root / "fake_fetch_instagram_profile.sh"
            fake_script.write_text(
                "#!/usr/bin/env bash\n"
                f'cp "{avatar}" "$3/$1.png"\n'
                'printf \'{"username":"%s","full_name":"Shimonagi Coffee","bio":"Specialty coffee in Culiacan","followers":1738,"following":42,"posts":120,"profile_url":"https://www.instagram.com/%s/","avatar_url":"https://example.test/a.jpg","avatar_file":"%s/%s.png","source":"og:meta (bot UA)"}\\n\' "$1" "$1" "$3" "$1"\n',
                encoding="utf-8",
            )
            os.chmod(fake_script, 0o755)
            workdir = root / "job-ig"

            with mock.patch.object(om, "INSTAGRAM_FETCH_SCRIPT", fake_script):
                rc = om.main(
                    [
                        "fetch",
                        "--instagram",
                        "https://www.instagram.com/shimonagimx/",
                        "--plan",
                        "growth",
                        "--workdir",
                        str(workdir),
                    ]
                )
            self.assertEqual(rc, 0)
            draft = json.loads((workdir / "draft.json").read_text(encoding="utf-8"))
            self.assertEqual(draft["source"]["handle"], "shimonagimx")
            self.assertEqual(draft["source"]["followers"], 1738)
            self.assertEqual(draft["provisionPayload"]["name"], "Shimonagi Coffee")
            self.assertEqual(draft["provisionPayload"]["adminEmail"], "admin+shimonagimx@umiconsulting.co")
            self.assertTrue(Path(draft["rawLogoPath"]).exists())

    def test_csrf_header_extracted_from_cookie_jar(self) -> None:
        jar = http.cookiejar.CookieJar()
        cookie = http.cookiejar.Cookie(
            version=0,
            name="umi_csrf",
            value="csrf-token-123",
            port=None,
            port_specified=False,
            domain="api-staging.umiconsulting.co",
            domain_specified=True,
            domain_initial_dot=False,
            path="/",
            path_specified=True,
            secure=True,
            expires=None,
            discard=True,
            comment=None,
            comment_url=None,
            rest={},
            rfc2109=False,
        )
        jar.set_cookie(cookie)
        self.assertEqual(om._csrf_headers(jar), {"x-umi-csrf": "csrf-token-123"})


if __name__ == "__main__":
    unittest.main()
