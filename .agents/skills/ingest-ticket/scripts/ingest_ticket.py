#!/usr/bin/env python3
"""Deterministic media ingestor for WhatsApp / Twilio support tickets.

Subcommands:
  init          Normalize timestamps (local + UTC), extract video key frames & audio via ffmpeg, write ticket.md.
  twilio-parse  Download media from a Twilio WhatsApp webhook JSON payload and feed it into init.
  cleanup       Delete heavy media/frames/audio (or the full temporary ticket workspace).
"""

from __future__ import annotations

import argparse
import base64
from datetime import datetime, timedelta, timezone
import json
import mimetypes
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
import uuid
from zoneinfo import ZoneInfo
from typing import Any


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
VIDEO_EXTS = {".mp4", ".mov", ".webm", ".mkv", ".avi", ".3gp"}
AUDIO_EXTS = {".ogg", ".opus", ".mp3", ".m4a", ".wav", ".aac"}


def parse_reported_time(value: str | None, tz_name: str) -> tuple[datetime, datetime]:
    tz = ZoneInfo(tz_name)
    now_local = datetime.now(tz)
    if not value:
        local_dt = now_local
    else:
        raw = value.strip()
        if re.fullmatch(r"\d{1,2}:\d{2}(:\d{2})?", raw):
            parts = [int(p) for p in raw.split(":")]
            hh, mm = parts[0], parts[1]
            ss = parts[2] if len(parts) > 2 else 0
            local_dt = now_local.replace(hour=hh, minute=mm, second=ss, microsecond=0)
        else:
            iso = raw.replace("Z", "+00:00")
            parsed = datetime.fromisoformat(iso)
            local_dt = parsed.astimezone(tz) if parsed.tzinfo else parsed.replace(tzinfo=tz)
    return local_dt, local_dt.astimezone(timezone.utc)


def run_cmd(*args: str, timeout: int = 120) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, capture_output=True, text=True, check=False, timeout=timeout)


def has_audio_stream(media_path: Path) -> bool:
    if not shutil.which("ffprobe"):
        return False
    res = run_cmd(
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=index",
        "-of",
        "csv=p=0",
        str(media_path),
        timeout=20,
    )
    return res.returncode == 0 and bool(res.stdout.strip())


def video_duration_seconds(media_path: Path) -> float | None:
    if not shutil.which("ffprobe"):
        return None
    res = run_cmd(
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(media_path),
        timeout=20,
    )
    if res.returncode != 0:
        return None
    try:
        return float(res.stdout.strip())
    except ValueError:
        return None


def extract_video_frames(
    video_path: Path,
    frames_dir: Path,
    prefix: str,
    max_frames: int,
    scene_threshold: float,
) -> list[Path]:
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is required to extract video frames.")
    frames_dir.mkdir(parents=True, exist_ok=True)
    pattern = str(frames_dir / f"{prefix}-frame-%02d.jpg")

    # Pass 1: scene-change key frames (low noise, avoids duplicate static frames).
    res = run_cmd(
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-i",
        str(video_path),
        "-vf",
        f"select=eq(n\\,0)+gt(scene\\,{scene_threshold}),scale=min(1280\\,iw):-2",
        "-fps_mode",
        "vfr",
        "-frames:v",
        str(max_frames),
        "-q:v",
        "4",
        pattern,
    )
    extracted = sorted(frames_dir.glob(f"{prefix}-frame-*.jpg"))

    # Pass 2: if video is mostly static (only 1 frame caught) or Pass 1 failed, sample evenly.
    if len(extracted) <= 1:
        dur = video_duration_seconds(video_path) or 4.0
        target = min(max_frames, max(2, int(dur)))
        fps = max(0.2, target / max(dur, 1.0))
        for old in extracted:
            old.unlink(missing_ok=True)
        run_cmd(
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(video_path),
            "-vf",
            f"fps={fps:.3f},scale=min(1280\\,iw):-2",
            "-frames:v",
            str(max_frames),
            "-q:v",
            "4",
            pattern,
        )
        extracted = sorted(frames_dir.glob(f"{prefix}-frame-*.jpg"))

    return extracted


def extract_audio_mp3(source_path: Path, out_mp3: Path) -> Path | None:
    if not shutil.which("ffmpeg") or not has_audio_stream(source_path):
        return None
    out_mp3.parent.mkdir(parents=True, exist_ok=True)
    res = run_cmd(
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-i",
        str(source_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "48k",
        str(out_mp3),
    )
    return out_mp3 if res.returncode == 0 and out_mp3.exists() and out_mp3.stat().st_size > 0 else None


def transcribe_audio_openai(audio_path: Path) -> str | None:
    """Optional Whisper API transcription when OPENAI_API_KEY is present in env."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return None
    boundary = f"----UmiBoundary{uuid.uuid4().hex}"
    audio_bytes = audio_path.read_bytes()
    parts = [
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n'.encode("utf-8"),
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="language"\r\n\r\nes\r\n'.encode("utf-8"),
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{audio_path.name}"\r\n'
            f"Content-Type: audio/mpeg\r\n\r\n"
        ).encode("utf-8")
        + audio_bytes
        + b"\r\n",
        f"--{boundary}--\r\n".encode("utf-8"),
    ]
    body = b"".join(parts)
    req = urllib.request.Request(
        "https://api.openai.com/v1/audio/transcriptions",
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
            return (data.get("text") or "").strip() or None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None


def build_ticket_workspace(
    out_dir: Path,
    merchant: str,
    reported_at: str | None,
    tz_name: str,
    message_text: str,
    media_files: list[Path],
    max_frames: int = 12,
    scene_threshold: float = 0.25,
    source_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    out_dir = out_dir.expanduser().resolve()
    media_dir = out_dir / "media"
    frames_dir = out_dir / "frames"
    audio_dir = out_dir / "audio"
    out_dir.mkdir(parents=True, exist_ok=True)

    local_dt, utc_dt = parse_reported_time(reported_at, tz_name)
    win_start = (utc_dt - timedelta(minutes=5)).isoformat()
    win_end = (utc_dt + timedelta(minutes=5)).isoformat()

    images: list[str] = []
    videos: list[dict[str, Any]] = []
    audios: list[dict[str, Any]] = []

    img_idx = 0
    vid_idx = 0
    aud_idx = 0

    for src in media_files:
        src = src.expanduser().resolve()
        if not src.exists():
            raise FileNotFoundError(f"Media file not found: {src}")
        ext = src.suffix.lower()
        media_dir.mkdir(parents=True, exist_ok=True)

        if ext in IMAGE_EXTS:
            img_idx += 1
            dest = media_dir / f"img-{img_idx:02d}{ext}"
            shutil.copy2(src, dest)
            images.append(str(dest.relative_to(out_dir)))
        elif ext in VIDEO_EXTS:
            vid_idx += 1
            dest = media_dir / f"vid-{vid_idx:02d}{ext}"
            shutil.copy2(src, dest)
            prefix = f"vid-{vid_idx:02d}"
            extracted_frames = extract_video_frames(dest, frames_dir, prefix, max_frames, scene_threshold)
            extracted_audio = extract_audio_mp3(dest, audio_dir / f"{prefix}.mp3")
            transcript = transcribe_audio_openai(extracted_audio) if extracted_audio else None
            videos.append(
                {
                    "source": str(dest.relative_to(out_dir)),
                    "durationSeconds": video_duration_seconds(dest),
                    "frames": [str(f.relative_to(out_dir)) for f in extracted_frames],
                    "audio": str(extracted_audio.relative_to(out_dir)) if extracted_audio else None,
                    "transcript": transcript,
                }
            )
        elif ext in AUDIO_EXTS:
            aud_idx += 1
            dest = media_dir / f"aud-{aud_idx:02d}{ext}"
            shutil.copy2(src, dest)
            norm_mp3 = extract_audio_mp3(dest, audio_dir / f"aud-{aud_idx:02d}.mp3") or dest
            transcript = transcribe_audio_openai(norm_mp3)
            audios.append(
                {
                    "source": str(dest.relative_to(out_dir)),
                    "audio": str(norm_mp3.relative_to(out_dir)),
                    "transcript": transcript,
                }
            )
        else:
            dest = media_dir / src.name
            shutil.copy2(src, dest)

    manifest = {
        "schemaVersion": 1,
        "merchant": merchant,
        "timezone": tz_name,
        "reportedAtLocal": local_dt.isoformat(),
        "reportedAtUtc": utc_dt.isoformat(),
        "logWindowUtc": {"start": win_start, "end": win_end},
        "message": message_text,
        "source": source_meta or {"channel": "local"},
        "images": images,
        "videos": videos,
        "audios": audios,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    lines = [
        f"# Ticket — {merchant}",
        "",
        f"- **Hora local ({tz_name}):** `{local_dt.strftime('%Y-%m-%d %H:%M:%S %Z')}`",
        f"- **Hora UTC:** `{utc_dt.strftime('%Y-%m-%dT%H:%M:%SZ')}`",
        f"- **Ventana para logs (±5 min UTC):** `{win_start}` .. `{win_end}`",
        "",
        "## Reporte del cliente",
        "",
        message_text.strip() or "_(sin texto adjunto)_",
        "",
        "## Evidencia procesada",
    ]
    if images:
        lines.append("- **Imágenes:** " + ", ".join(f"`{p}`" for p in images))
    for vid in videos:
        lines.append(
            f"- **Video `{vid['source']}`** ({vid['durationSeconds'] or '?'}s): "
            f"{len(vid['frames'])} fotogramas clave en `frames/`"
        )
        if vid["audio"]:
            lines.append(f"  - Audio extraído: `{vid['audio']}`")
        if vid["transcript"]:
            lines.append(f"  - Transcripción: {vid['transcript']}")
    for aud in audios:
        lines.append(f"- **Audio `{aud['audio']}`**")
        if aud["transcript"]:
            lines.append(f"  - Transcripción: {aud['transcript']}")
    if not images and not videos and not audios:
        lines.append("- _(sin archivos multimedia)_")

    lines.extend(
        [
            "",
            "## Cierre y limpieza",
            "",
            f"- Al cerrar el ticket: `python3 .agents/skills/ingest-ticket/scripts/ingest_ticket.py cleanup --dir {out_dir}`",
        ]
    )
    (out_dir / "ticket.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return manifest


def cmd_init(args: argparse.Namespace) -> int:
    media = [Path(m) for m in (args.media or [])]
    manifest = build_ticket_workspace(
        out_dir=Path(args.out),
        merchant=args.merchant,
        reported_at=args.reported_at,
        tz_name=args.tz,
        message_text=args.text or "",
        media_files=media,
        max_frames=args.max_frames,
        scene_threshold=args.scene_threshold,
    )
    print(json.dumps({"ok": True, "ticket": str(Path(args.out).resolve() / "ticket.md"), "manifest": manifest}, indent=2, ensure_ascii=False))
    return 0


def cmd_twilio_parse(args: argparse.Namespace) -> int:
    payload = json.loads(Path(args.payload).expanduser().read_text(encoding="utf-8"))
    out_dir = Path(args.out).expanduser().resolve()
    raw_dir = out_dir / "_twilio_dl"
    raw_dir.mkdir(parents=True, exist_ok=True)

    sid = os.environ.get("TWILIO_ACCOUNT_SID")
    token = os.environ.get("TWILIO_AUTH_TOKEN")
    auth_header: dict[str, str] = {}
    if sid and token:
        encoded = base64.b64encode(f"{sid}:{token}".encode("utf-8")).decode("ascii")
        auth_header["Authorization"] = f"Basic {encoded}"

    num_media = int(payload.get("NumMedia") or 0)
    downloaded: list[Path] = []
    for idx in range(num_media):
        url = payload.get(f"MediaUrl{idx}")
        ctype = str(payload.get(f"MediaContentType{idx}") or "")
        if not url:
            continue
        ext = mimetypes.guess_extension(ctype.split(";")[0].strip()) or ".bin"
        if ext == ".jpe":
            ext = ".jpg"
        target = raw_dir / f"twilio-{idx:02d}{ext}"
        if str(url).startswith("file://"):
            shutil.copy2(Path(urllib.request.url2pathname(str(url)[7:])), target)
        else:
            req = urllib.request.Request(str(url), headers=auth_header)
            with urllib.request.urlopen(req, timeout=30) as resp:
                target.write_bytes(resp.read())
        downloaded.append(target)

    body = str(payload.get("Body") or "")
    reported_at = args.reported_at or payload.get("Timestamp") or payload.get("DateCreated")
    manifest = build_ticket_workspace(
        out_dir=out_dir,
        merchant=args.merchant,
        reported_at=str(reported_at) if reported_at else None,
        tz_name=args.tz,
        message_text=body,
        media_files=downloaded,
        max_frames=args.max_frames,
        scene_threshold=args.scene_threshold,
        source_meta={
            "channel": "twilio_whatsapp",
            "messageSid": payload.get("MessageSid"),
            "from": payload.get("From"),
        },
    )
    shutil.rmtree(raw_dir, ignore_errors=True)
    print(json.dumps({"ok": True, "ticket": str(out_dir / "ticket.md"), "manifest": manifest}, indent=2, ensure_ascii=False))
    return 0


def cmd_cleanup(args: argparse.Namespace) -> int:
    target = Path(args.dir).expanduser().resolve()
    if target in (Path("/"), Path.home()):
        raise ValueError(f"Refusing to delete protected directory: {target}")
    if not target.exists():
        print(json.dumps({"cleaned": False, "reason": "not_found", "dir": str(target)}))
        return 0
    if args.keep_summary:
        for sub in ("media", "frames", "audio", "_twilio_dl"):
            shutil.rmtree(target / sub, ignore_errors=True)
        print(json.dumps({"cleaned": True, "keptSummary": True, "dir": str(target)}))
        return 0
    shutil.rmtree(target)
    print(json.dumps({"cleaned": True, "keptSummary": False, "dir": str(target)}))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Umi WhatsApp/Twilio ticket media ingestor.")
    sub = parser.add_subparsers(dest="command", required=True)

    p_init = sub.add_parser("init", help="Create ticket workspace from local media + timestamp.")
    p_init.add_argument("--merchant", required=True, help="Merchant display name.")
    p_init.add_argument("--reported-at", help="ISO timestamp or HH:MM local time (defaults to now).")
    p_init.add_argument("--tz", default="America/Mazatlan", help="Merchant IANA timezone.")
    p_init.add_argument("--text", default="", help="Client message text.")
    p_init.add_argument("--media", nargs="*", help="Paths to photos, videos, or voice notes.")
    p_init.add_argument("--max-frames", type=int, default=12, help="Max key frames per video.")
    p_init.add_argument("--scene-threshold", type=float, default=0.25, help="ffmpeg scene change threshold.")
    p_init.add_argument("--out", required=True, help="Output ticket workspace directory.")
    p_init.set_defaults(func=cmd_init)

    p_tw = sub.add_parser("twilio-parse", help="Ingest a Twilio WhatsApp webhook JSON payload.")
    p_tw.add_argument("--payload", required=True, help="Path to Twilio webhook JSON file.")
    p_tw.add_argument("--merchant", required=True, help="Merchant display name.")
    p_tw.add_argument("--reported-at", help="Optional timestamp override.")
    p_tw.add_argument("--tz", default="America/Mazatlan", help="Merchant IANA timezone.")
    p_tw.add_argument("--max-frames", type=int, default=12, help="Max key frames per video.")
    p_tw.add_argument("--scene-threshold", type=float, default=0.25, help="ffmpeg scene change threshold.")
    p_tw.add_argument("--out", required=True, help="Output ticket workspace directory.")
    p_tw.set_defaults(func=cmd_twilio_parse)

    p_clean = sub.add_parser("cleanup", help="Remove temporary ticket media or entire workspace.")
    p_clean.add_argument("--dir", required=True, help="Ticket workspace directory.")
    p_clean.add_argument("--keep-summary", action="store_true", help="Keep ticket.md and manifest.json only.")
    p_clean.set_defaults(func=cmd_cleanup)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
