#!/usr/bin/env python3
"""Unit tests for ingest_ticket.py using real ffmpeg-synthesized video + audio."""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import unittest
import zlib

import ingest_ticket as it


def make_tiny_png(path: Path) -> None:
    raw = b"".join(b"\x00" + (b"\x10\x80\x40" * 8) for _ in range(8))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack("!I", len(data))
            + tag
            + data
            + struct.pack("!I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack("!IIBBBBB", 8, 8, 8, 2, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    )


def make_test_mp4(path: Path) -> None:
    """Synthesize a 2-second MP4 with color transition + sine wave audio via ffmpeg."""
    res = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=2:size=320x240:rate=10",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg synthetic video failed: {res.stderr}")


class IngestTicketTests(unittest.TestCase):
    def test_timestamp_normalization_mazatlan_to_utc(self) -> None:
        local_dt, utc_dt = it.parse_reported_time("2026-11-21T14:22:00", "America/Mazatlan")
        self.assertEqual(local_dt.hour, 14)
        self.assertEqual(utc_dt.hour, 21)
        self.assertEqual(utc_dt.minute, 22)

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg not installed")
    def test_init_extracts_frames_audio_and_cleans_up(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            img = root / "screen.png"
            vid = root / "clip.mp4"
            make_tiny_png(img)
            make_test_mp4(vid)

            out_dir = root / "ticket-001"
            rc = it.main(
                [
                    "init",
                    "--merchant",
                    "Kalala Café",
                    "--reported-at",
                    "2026-11-21T14:22:00",
                    "--tz",
                    "America/Mazatlan",
                    "--text",
                    "Se trabó la pantalla al cobrar en efectivo.",
                    "--media",
                    str(img),
                    str(vid),
                    "--max-frames",
                    "4",
                    "--out",
                    str(out_dir),
                ]
            )
            self.assertEqual(rc, 0)
            manifest = json.loads((out_dir / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["merchant"], "Kalala Café")
            self.assertEqual(len(manifest["images"]), 1)
            self.assertEqual(len(manifest["videos"]), 1)
            self.assertGreaterEqual(len(manifest["videos"][0]["frames"]), 1)
            self.assertLessEqual(len(manifest["videos"][0]["frames"]), 4)
            self.assertIsNotNone(manifest["videos"][0]["audio"])
            self.assertTrue((out_dir / "ticket.md").exists())

            # Partial cleanup keeps ticket.md and deletes heavy media/frames/audio.
            rc = it.main(["cleanup", "--dir", str(out_dir), "--keep-summary"])
            self.assertEqual(rc, 0)
            self.assertTrue((out_dir / "ticket.md").exists())
            self.assertFalse((out_dir / "media").exists())
            self.assertFalse((out_dir / "frames").exists())
            self.assertFalse((out_dir / "audio").exists())

            # Full cleanup removes everything.
            rc = it.main(["cleanup", "--dir", str(out_dir)])
            self.assertEqual(rc, 0)
            self.assertFalse(out_dir.exists())

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg not installed")
    def test_twilio_parse_local_file_urls(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            img = root / "wa.png"
            make_tiny_png(img)
            payload_path = root / "webhook.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "MessageSid": "SM123456",
                        "From": "whatsapp:+5216670000000",
                        "Body": "No imprime ticket en caja 2",
                        "NumMedia": "1",
                        "MediaUrl0": img.as_uri(),
                        "MediaContentType0": "image/png",
                        "Timestamp": "2026-11-21T21:30:00Z",
                    }
                ),
                encoding="utf-8",
            )
            out_dir = root / "ticket-tw"
            rc = it.main(
                [
                    "twilio-parse",
                    "--payload",
                    str(payload_path),
                    "--merchant",
                    "El Gran Ribera",
                    "--tz",
                    "America/Mazatlan",
                    "--out",
                    str(out_dir),
                ]
            )
            self.assertEqual(rc, 0)
            manifest = json.loads((out_dir / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["source"]["channel"], "twilio_whatsapp")
            self.assertEqual(len(manifest["images"]), 1)
            self.assertFalse((out_dir / "_twilio_dl").exists())


if __name__ == "__main__":
    unittest.main()
