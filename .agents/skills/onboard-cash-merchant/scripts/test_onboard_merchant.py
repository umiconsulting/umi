#!/usr/bin/env python3
"""Unit tests for onboard_merchant.py (no network calls required)."""

from __future__ import annotations

import json
from pathlib import Path
import struct
import tempfile
import unittest
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


if __name__ == "__main__":
    unittest.main()
