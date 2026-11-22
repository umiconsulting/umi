---
name: ingest-ticket
description: Turn a client WhatsApp report (photos, voice notes, screen videos, or a Twilio webhook payload) into a compact ticket folder with normalized local/UTC timestamps, ffmpeg key frames, audio transcripts, and deterministic cleanup after resolution.
---

# Ingest Ticket (WhatsApp / Twilio Media -> Ticket Brief)

Convert messy customer chat reports into a small, interpretable ticket workspace ready for diagnosis, then delete heavy raw media when the ticket closes.

## Note on Twilio & WhatsApp Groups

Twilio's official WhatsApp Business API cannot join native WhatsApp groups (Meta platform restriction).
Use the official 1:1 forward flow: forward the client's messages/photos/videos from the client group to Umi's Twilio support number with one line noting the merchant and local time (for example `Kalala 14:22`), or drop downloaded files directly into `init`.

## 1. Build the Ticket Workspace (Deterministic Script)

From a local media drop (screenshots, `.mp4`/`.mov` videos, `.ogg`/`.m4a` voice notes):

```bash
TICKET_DIR=$(mktemp -d /tmp/umi-ticket-XXXXXX)
python3 .agents/skills/ingest-ticket/scripts/ingest_ticket.py init \
  --merchant "<Merchant Name>" \
  --reported-at "2026-11-21T14:22:00" \
  --tz "America/Mazatlan" \
  --text "<Exact client message>" \
  --media /path/to/photo.jpg /path/to/screen.mp4 /path/to/voice.ogg \
  --out "$TICKET_DIR"
```

Or directly from a saved Twilio WhatsApp webhook JSON payload (`TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` in env when media URLs are protected):

```bash
python3 .agents/skills/ingest-ticket/scripts/ingest_ticket.py twilio-parse \
  --payload /path/to/twilio-webhook.json \
  --merchant "<Merchant Name>" \
  --tz "America/Mazatlan" \
  --out "$TICKET_DIR"
```

What the script does without spending LLM tokens:
- Computes both **local merchant time** and **UTC**, plus a `±5 min` log window ready to grep Caddy JSON access logs and `umi-api` logs.
- Copies and numbers images (`media/img-01.jpg`, ...).
- Uses `ffmpeg` to extract **only scene-change / key frames** from videos (capped at `--max-frames 12`) into `frames/`, plus extracts the video's audio track into `audio/`.
- Transcribes audio automatically if `OPENAI_API_KEY` is set; otherwise lists `audio/*.mp3` in `ticket.md` so the agent can read/listen to them directly via multimodal `read_file`.
- Writes `$TICKET_DIR/ticket.md` and `$TICKET_DIR/manifest.json`.

## 2. Diagnose & Solve (Fresh Context RPI)

1. Read `$TICKET_DIR/ticket.md`, inspect only the relevant key frames in `$TICKET_DIR/frames/`, and listen/read transcripts in `$TICKET_DIR/audio/`.
2. Cross-reference the exact UTC window against `umi-api` / Caddy logs before guessing.
3. Hand off to `production-support` (live incident) or normal RPI fix flow (`dev` PR + real regression test + verification).

## 3. Mandatory Cleanup After Ticket Close

Remove heavy videos, extracted frames, and audio once the ticket/PR is closed (pass `--keep-summary` if you want to keep `ticket.md` only):

```bash
python3 .agents/skills/ingest-ticket/scripts/ingest_ticket.py cleanup --dir "$TICKET_DIR"
```
