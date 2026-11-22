---
name: production-support
description: Diagnose live Umi production incidents for any merchant with verified evidence, check Android/iMin POS fleets over Tailscale/ADB, and ship safe hotfixes without corrupting financial records.
---

# Umi Production Support

Merchant-agnostic runbook for live incidents across any Umi customer (POS, API, Cash, Dashboard).
Do not hardcode merchant names, Tailscale IPs, host machine IDs, or build numbers in this repo; keep per-merchant fleet inventories outside Git in `~/.config/umi/fleets/<merchant>.json`.

## Hard Safety Limits

- Never repeat a confirmed external card/terminal payment. Inspect the payment attempt and sale first.
- Never alter sales, payments, receipts, cash shifts, or stored-value balances without explicit owner approval.
- Never guess or bypass an operator PIN.
- Never store secrets, private keys, or customer PII in the repo or run logs.
- Never collapse an unknown error into a generic message; preserve the exact error code, `correlationId`, and operation.
- Never claim "verified" from unit tests alone — verify the real failing flow before closing.

## 1. Anchor the Incident With Evidence

If the report came from WhatsApp (photos, voice notes, screen videos), run the `ingest-ticket` skill first to extract timestamps (local + UTC), key frames, and transcript.

Capture before touching code:
- Merchant, branch/location, device, operator, exact local + UTC timestamp.
- Exact error text, `correlationId`, and IDs (cart, sale, receipt, payment attempt, kitchen order).
- Production API state: `curl -fsS https://api.umiconsulting.co/health/release`.

## 2. Check the Android/iMin Fleet (When POS Is Involved)

Run the fleet doctor against the merchant's local fleet file:

```bash
python3 .agents/skills/production-support/scripts/fleet_doctor.py \
  --fleet ~/.config/umi/fleets/<merchant>.json \
  --expected-build <versionCode>
```

Add `--repair` to reconnect known ADB endpoints, or `--json` to save machine-readable evidence.

On iMin terminals, verify when ADB drops after a reboot:
- Tailscale VPN always on; `Settings > Battery > Transmission Mode` enabled.
- KeepADB enabled with "Keep always active" and excluded from battery optimization.
- Wireless debugging enabled on the store network. Do not mix UmiPOS `versionCode` across terminals in the same branch while diagnosing.

## 3. Fix at the Real Business Boundary

- Write a failing regression test reproducing the exact symptom before fixing.
- Check downstream side effects: other tablets with stale cache/version, already-approved external tenders, open tables/carts, offline replay queues, and rollback path for API/APK/schema.
- Never edit code inside a running container. Ship through PR + green CI (`dev`, or an explicitly authorized surgical branch off `main` for urgent prod hotfixes).

## 4. Verify & Close

1. Confirm `https://api.umiconsulting.co/health` and `/health/release` show the deployed commit.
2. Install the same signed production APK across the fleet (`adb -s <serial> install -r <apk>`) when POS changed.
3. Re-run the exact real flow that failed.
4. Close with a short summary: symptom, root cause, evidence, commit/PR, verification performed (and anything left unverified), and rollback path.
5. Clean up any temporary support bundles or media folders created during triage.
