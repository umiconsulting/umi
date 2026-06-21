"""
Live pipeline latency tracer.

Fires a real Twilio-signed WhatsApp webhook through the full pipeline,
discovers the trace_id from the inbound row, then polls pipeline_traces
until dispatch.delivered (or timeout). Reports stage-by-stage timing.

Usage:  python3 scripts/pipeline_trace.py ["message text"]
"""

import sys, time, hmac, hashlib, base64, uuid, json
import urllib.parse, urllib.request, urllib.error
from datetime import datetime, timezone

# ── credentials ────────────────────────────────────────────────────────────────
SUPABASE_URL      = "https://xbudknbimkgjjgohnjgp.supabase.co"
SERVICE_ROLE_KEY  = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    "***REMOVED***"
    "***REMOVED***"
    ".***REMOVED***"
)
TWILIO_AUTH_TOKEN  = "***REMOVED***"
TWILIO_ACCOUNT_SID = "***REMOVED***"
WEBHOOK_URL        = f"{SUPABASE_URL}/functions/v1/whatsapp-handler"

TEST_PHONE   = "whatsapp:+15005550006"   # fake Twilio test number
TEST_MESSAGE = sys.argv[1] if len(sys.argv) > 1 else "quiero un americano"
TIMEOUT_S    = 180
POLL_S       = 1.5


# ── utils ──────────────────────────────────────────────────────────────────────

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def parse_ts(ts: str) -> datetime | None:
    if not ts: return None
    try:   return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except: return None

def fmt(ms: float) -> str:
    return f"{ms:.0f}ms"

def sb_get(path: str):
    req = urllib.request.Request(
        f"{SUPABASE_URL}{path}",
        headers={"apikey": SERVICE_ROLE_KEY, "Authorization": f"Bearer {SERVICE_ROLE_KEY}"},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def twilio_sig(auth_token: str, url: str, params: dict) -> str:
    s = url + "".join(k + params[k] for k in sorted(params))
    raw = hmac.new(auth_token.encode(), s.encode(), hashlib.sha1).digest()
    return base64.b64encode(raw).decode()


# ── step 1: fire webhook ───────────────────────────────────────────────────────

def fire_webhook() -> tuple[int, str, float]:
    msg_sid = "SM" + uuid.uuid4().hex[:30]
    params  = {
        "AccountSid":  TWILIO_ACCOUNT_SID,
        "Body":        TEST_MESSAGE,
        "From":        TEST_PHONE,
        "MessageSid":  msg_sid,
        "NumMedia":    "0",
        "ProfileName": "TraceBot",
        "To":          "whatsapp:+525512345678",
    }
    sig  = twilio_sig(TWILIO_AUTH_TOKEN, WEBHOOK_URL, params)
    body = urllib.parse.urlencode(params).encode()
    req  = urllib.request.Request(
        WEBHOOK_URL, data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded",
                 "X-Twilio-Signature": sig},
        method="POST",
    )
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read().decode(), time.monotonic() - t0
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), time.monotonic() - t0


# ── step 2: discover trace_id from inbound row ─────────────────────────────────

def discover_trace(fired_at: datetime, deadline: float) -> str | None:
    """
    Poll pipeline_traces for a new inbound.enqueued row created after fired_at.
    Returns the trace_id once found.
    """
    # URL-encode the ISO timestamp for the query param
    since = urllib.parse.quote(fired_at.isoformat())
    while time.monotonic() < deadline:
        rows = sb_get(
            f"/rest/v1/pipeline_traces"
            f"?stage=eq.inbound&event=eq.enqueued"
            f"&ts=gte.{since}"
            f"&order=ts.asc&limit=5"
        )
        if isinstance(rows, list) and rows:
            return rows[0]["trace_id"]
        time.sleep(POLL_S)
    return None


# ── step 3: poll until dispatch.delivered ──────────────────────────────────────

def poll_trace(trace_id: str, deadline: float) -> list[dict]:
    rows = []
    while time.monotonic() < deadline:
        data = sb_get(
            f"/rest/v1/pipeline_traces"
            f"?trace_id=eq.{trace_id}"
            f"&select=stage,event,ts,detail,error"
            f"&order=ts.asc"
        )
        if isinstance(data, list):
            rows = data
            done = any(r["stage"] == "dispatch" and r["event"] == "delivered" for r in rows)
            if done:
                return rows
        time.sleep(POLL_S)
    return rows


# ── step 4: report ─────────────────────────────────────────────────────────────

def report(rows: list[dict], handler_ms: float, trace_id: str):
    print(f"\n{'═'*62}")
    print(f"  PIPELINE TRACE  trace={trace_id[:8]}...")
    print(f"{'═'*62}")
    print(f"  {'Stage':<13} {'Event':<20} {'t (ms)':>8}  {'Δ (ms)':>8}  Note")
    print(f"  {'-'*13} {'-'*20} {'-'*8}  {'-'*8}  {'-'*20}")

    if not rows:
        print("  (no rows)")
    else:
        t0   = parse_ts(rows[0]["ts"])
        prev = t0
        for r in rows:
            t     = parse_ts(r["ts"])
            off   = (t - t0).total_seconds() * 1000
            delta = (t - prev).total_seconds() * 1000
            note  = ""
            d = r.get("detail") or {}
            if delta > 3000 and r != rows[0]:
                note = "◄ GAP"
            if r.get("error"):
                note = f"ERR: {r['error']}"
            if "duration_ms" in d:
                note += f" worker={d['duration_ms']}ms"
            print(f"  {r['stage']:<13} {r['event']:<20} {off:>8.0f}  {delta:>8.0f}  {note}")
            prev = t

        total  = (parse_ts(rows[-1]["ts"]) - t0).total_seconds() * 1000
        end_to_end = handler_ms * 1000 + total  # handler RTT + pipeline
        done = any(r["stage"] == "dispatch" and r["event"] == "delivered" for r in rows)

        print(f"\n  Handler RTT    : {handler_ms*1000:.0f}ms  (whatsapp-handler HTTP round-trip)")
        print(f"  Pipeline total : {total:.0f}ms  ({total/1000:.1f}s)  [inbound.enqueued → dispatch.delivered]")
        print(f"  End-to-end     : {end_to_end:.0f}ms  ({end_to_end/1000:.1f}s)  [webhook fire → reply sent]")
        print(f"  Status         : {'✓ delivered' if done else '✗ timed out — reply NOT delivered'}")

    print(f"{'═'*62}\n")


# ── main ───────────────────────────────────────────────────────────────────────

def main():
    print(f"\n{'━'*62}")
    print(f"  Umi Pipeline Latency Tracer — {datetime.now().strftime('%H:%M:%S')}")
    print(f"  Message : {TEST_MESSAGE!r}")
    print(f"  Timeout : {TIMEOUT_S}s")
    print(f"{'━'*62}\n")

    t0      = time.monotonic()
    fired_at = now_utc()
    deadline = t0 + TIMEOUT_S

    print(f"  [+{0:5.0f}ms]  Firing webhook → {WEBHOOK_URL}")
    status, body, handler_elapsed = fire_webhook()
    print(f"  [+{(time.monotonic()-t0)*1000:5.0f}ms]  HTTP {status}  ({handler_elapsed*1000:.0f}ms RTT)")

    if status not in (200, 204):
        print(f"\n  [FAIL] whatsapp-handler returned {status}:")
        print(f"  {body[:300]}\n")
        sys.exit(1)

    print(f"\n  Waiting for inbound.enqueued in pipeline_traces...")
    trace_id = discover_trace(fired_at, deadline)

    if not trace_id:
        print(f"  [TIMEOUT] No inbound trace found within {TIMEOUT_S}s.")
        print("  Check: is the job-worker cron running? Is logPipelineTrace working?\n")
        sys.exit(1)

    print(f"  [+{(time.monotonic()-t0)*1000:5.0f}ms]  trace_id = {trace_id[:8]}...")
    print(f"\n  Polling for dispatch.delivered...\n")

    rows = poll_trace(trace_id, deadline)
    report(rows, handler_elapsed, trace_id)


if __name__ == "__main__":
    main()
