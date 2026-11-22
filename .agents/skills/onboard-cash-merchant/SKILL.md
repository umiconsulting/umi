---
name: onboard-cash-merchant
description: Onboard a new Umi Cash merchant from an Instagram profile URL or local logo, upscale the logo, generate default loyalty and admin settings, provision via umi-api after human approval, and clean up temporary files.
---

# Onboard Cash Merchant

Turn an Instagram profile (or local avatar image) into a provisioned Umi Cash merchant with a clean high-resolution logo and default loyalty rules, then delete all temporary files and credentials.

## Inputs to Confirm First

Ask only what is missing:
- Instagram URL or `@handle` (or a local logo image if Instagram blocks anonymous fetches).
- Plan: `starter` (Cash loyalty + stored value only) or `growth` (Cash + owner dashboard, which also enables dashboard logo upload).
- Reward defaults if non-standard (default: `stampsRequired = 8`, `rewardName = "Bebida gratis"`).
- City and timezone (default: `America/Mazatlan` for Sinaloa or the merchant's actual IANA timezone).
- Target API (`https://api.umiconsulting.co` or staging).

Note: `POST /api/merchants` uses `ProvisionMerchantDto` (no legacy `slug` field — `build-v3` reaches new merchants by UUID, and generates `cardPrefix` as 2–5 uppercase letters).

## Workflow (Script -> Upscale -> Human OK -> Provision -> Cleanup)

### 1. Fetch public info & build draft (deterministic script)

```bash
WORKDIR=$(mktemp -d /tmp/umi-onboard-XXXXXX)
python3 .agents/skills/onboard-cash-merchant/scripts/onboard_merchant.py fetch \
  --instagram "https://www.instagram.com/<handle>/" \
  --plan growth \
  --city "<City>" \
  --timezone "America/Mazatlan" \
  --workdir "$WORKDIR"
```

Under the hood, `fetch` calls sibling `scripts/profile_build.sh` (which uses a bot User-Agent + `chromium --headless --dump-dom` fallback to pull public name, bio, stats, and avatar in ~0.7s without login; do not replace its curl UA with a Chrome UA).
You can also run `profile_build.sh <user1> <user2> -o "$WORKDIR" --json` directly for batch lookups.
If a profile is private or blocked, pass `--logo-file /path/to/avatar.jpg --name "<Merchant Name>"`.
This downloads `raw-logo.*`, extracts dominant `#rrggbb` brand colors via ImageMagick, derives `cardPrefix` + generic admin email/password, and writes `$WORKDIR/draft.json`.

### 2. Upscale & clean the logo (model step)

Because public Instagram avatars are 150x150, use the harness image editor/generator (`image-generator` in Antigravity, or Gemini) on `$WORKDIR/raw-logo.*` to produce a crisp, high-resolution, square logo (`$WORKDIR/upscaled-logo.png`) suitable for receipts and Apple/Google Wallet passes. Keep the brand's real typography and emblem faithful — do not invent a different mark.

### 3. Normalize logo for `umi-api` limits (deterministic script)

```bash
python3 .agents/skills/onboard-cash-merchant/scripts/onboard_merchant.py prepare-logo \
  --input "$WORKDIR/upscaled-logo.png" \
  --workdir "$WORKDIR"
```

Produces `$WORKDIR/prepared-logo.png` constrained to `<= 768x768` and `<= 256 KiB` (matching `MerchantBrandingLogoService` and the PostgreSQL CHECK constraint).

### 4. Human Review Gate (Required Before Writing to Production)

Show the user:
- The upscaled logo preview (`prepared-logo.png`).
- The exact `draft.json` payload (name, plan, cardPrefix, colors, adminEmail, reward rules, locations).

Wait for explicit approval before running `--apply`.

### 5. Provision & Upload Logo

Run dry-run first, then `--apply` once approved:

```bash
# Dry run (validates payload only)
python3 .agents/skills/onboard-cash-merchant/scripts/onboard_merchant.py provision \
  --draft "$WORKDIR/draft.json" \
  --logo "$WORKDIR/prepared-logo.png" \
  --api https://api.umiconsulting.co

# Live write (reads UMI_PLATFORM_ADMIN_EMAIL / UMI_PLATFORM_ADMIN_PASSWORD from env)
python3 .agents/skills/onboard-cash-merchant/scripts/onboard_merchant.py provision \
  --draft "$WORKDIR/draft.json" \
  --logo "$WORKDIR/prepared-logo.png" \
  --api https://api.umiconsulting.co \
  --apply
```

### 6. Mandatory Cleanup

Once you hand off the merchant ID and initial credentials to the owner, remove all temporary files (including `draft.json` which holds the initial password):

```bash
python3 .agents/skills/onboard-cash-merchant/scripts/onboard_merchant.py cleanup --workdir "$WORKDIR"
```
