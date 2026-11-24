#!/usr/bin/env python3
"""Deterministic helper for onboarding a Umi Cash merchant from Instagram or local media.

Subcommands:
  fetch         Pull public Instagram metadata + avatar (or local fallback), extract brand colors, write draft.json.
  prepare-logo  Normalize upscaled logo to <=768x768 PNG/JPEG and <=256 KiB for MerchantBrandingLogoService.
  provision     Dry-run by default; with --apply, call POST /api/merchants and PUT /api/merchants/:id/branding/logo.
  cleanup       Securely delete the temporary onboarding workspace (including draft.json with initial password).
"""

from __future__ import annotations

import argparse
import base64
import http.cookiejar
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import string
import subprocess
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


MAX_LOGO_EDGE = 768
MAX_LOGO_BYTES = 262_144
HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
VALID_PLANS = ("starter", "growth", "pro")
DEFAULT_PRIMARY = "#1A1A1A"
DEFAULT_SECONDARY = "#F5F2EB"


def normalize_instagram_handle(value: str) -> str:
    raw = value.strip()
    if "instagram.com" in raw:
        parsed = urllib.parse.urlparse(raw if "://" in raw else f"https://{raw}")
        parts = [p for p in parsed.path.split("/") if p]
        if not parts:
            raise ValueError(f"Could not extract Instagram handle from URL: {value}")
        raw = parts[0]
    handle = raw.lstrip("@").strip().lower()
    if not re.fullmatch(r"[a-z0-9._]{1,30}", handle):
        raise ValueError(f"Invalid Instagram handle: {value}")
    return handle


def slugify_identifier(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    return slug or "comercio"


def derive_card_prefix(name: str) -> str:
    normalized = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    words = [re.sub(r"[^A-Za-z]", "", w).upper() for w in normalized.split()]
    words = [w for w in words if w]
    if not words:
        return "UMI"
    if len(words) == 1:
        prefix = words[0][:4]
    else:
        initials = "".join(w[0] for w in words[:4])
        prefix = initials if len(initials) >= 3 else (words[0][:3] + words[1][:1])[:4]
    if len(prefix) < 2:
        prefix = (prefix + "UM")[:3]
    return prefix[:5]


def generate_initial_password(length: int = 16) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%"
    while True:
        pwd = "".join(secrets.choice(alphabet) for _ in range(length))
        if (
            any(c.islower() for c in pwd)
            and any(c.isupper() for c in pwd)
            and any(c.isdigit() for c in pwd)
        ):
            return pwd


INSTAGRAM_FETCH_SCRIPT = Path(__file__).resolve().parent / "fetch_instagram_profile.sh"


def fetch_instagram_public(handle: str, workdir: Path, timeout: int = 75) -> dict[str, Any]:
    """Extract public Instagram metadata and avatar via sibling fetch_instagram_profile.sh."""
    script = INSTAGRAM_FETCH_SCRIPT
    if not script.exists():
        return {
            "source": "missing_script",
            "handle": handle,
            "name": handle.replace(".", " ").replace("_", " ").title(),
            "bio": "",
            "avatarUrl": None,
            "avatarFile": None,
            "warning": f"Extractor script not found: {script}",
        }

    res = subprocess.run(
        [str(script), handle, "-o", str(workdir), "--json"],
        capture_output=True,
        text=True,
        check=False,
        timeout=timeout,
    )
    json_line = next((ln.strip() for ln in reversed(res.stdout.splitlines()) if ln.strip().startswith("{")), None)
    if res.returncode == 0 and json_line:
        try:
            data = json.loads(json_line)
            return {
                "source": data.get("source") or "fetch_instagram_profile.sh",
                "handle": data.get("username") or handle,
                "name": (data.get("full_name") or handle).strip(),
                "bio": (data.get("bio") or "").strip(),
                "followers": data.get("followers"),
                "following": data.get("following"),
                "posts": data.get("posts"),
                "profileUrl": data.get("profile_url"),
                "avatarUrl": data.get("avatar_url"),
                "avatarFile": data.get("avatar_file"),
                **({"avatarError": data["avatar_error"]} if data.get("avatar_error") else {}),
            }
        except json.JSONDecodeError:
            pass

    err_detail = (res.stderr or res.stdout).strip() or f"exit {res.returncode}"
    return {
        "source": "blocked",
        "handle": handle,
        "name": handle.replace(".", " ").replace("_", " ").title(),
        "bio": "",
        "avatarUrl": None,
        "avatarFile": None,
        "warning": f"fetch_instagram_profile.sh could not extract @{handle} ({err_detail}). Provide --logo-file and --name.",
    }


def find_magick() -> list[str] | None:
    if shutil.which("magick"):
        return ["magick"]
    if shutil.which("convert"):
        return ["convert"]
    return None


def extract_brand_colors(image_path: Path) -> tuple[str, str]:
    cmd = find_magick()
    if not cmd or not image_path.exists():
        return DEFAULT_PRIMARY, DEFAULT_SECONDARY
    res = subprocess.run(
        [
            *cmd,
            str(image_path),
            "-resize",
            "64x64!",
            "-colors",
            "6",
            "-unique-colors",
            "txt:-",
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=15,
    )
    if res.returncode != 0:
        return DEFAULT_PRIMARY, DEFAULT_SECONDARY
    colors = re.findall(r"#[0-9A-Fa-f]{6}", res.stdout)
    # Deduplicate preserving order.
    unique: list[str] = []
    for c in colors:
        up = c.upper()
        if up not in unique:
            unique.append(up)
    if not unique:
        return DEFAULT_PRIMARY, DEFAULT_SECONDARY

    def luminance(hex_color: str) -> float:
        r = int(hex_color[1:3], 16)
        g = int(hex_color[3:5], 16)
        b = int(hex_color[5:7], 16)
        return 0.2126 * r + 0.7152 * g + 0.0722 * b

    # Pick a non-white dark/vibrant color for primary, and a lighter companion for secondary.
    sorted_by_lum = sorted(unique, key=luminance)
    primary = sorted_by_lum[0]
    secondary = sorted_by_lum[-1] if len(sorted_by_lum) > 1 else DEFAULT_SECONDARY
    if primary == secondary:
        secondary = DEFAULT_SECONDARY if luminance(primary) < 128 else DEFAULT_PRIMARY
    return primary, secondary


def cmd_fetch(args: argparse.Namespace) -> int:
    workdir = Path(args.workdir).expanduser().resolve()
    workdir.mkdir(parents=True, exist_ok=True)

    meta: dict[str, Any] = {"source": "manual", "handle": None, "bio": "", "avatarUrl": None, "avatarFile": None}
    if args.instagram:
        handle = normalize_instagram_handle(args.instagram)
        meta = fetch_instagram_public(handle, workdir)

    merchant_name = (args.name or meta.get("name") or "Nuevo Comercio").strip()
    handle_slug = slugify_identifier(meta.get("handle") or merchant_name)

    raw_logo_path: Path | None = None
    if args.logo_file:
        src = Path(args.logo_file).expanduser().resolve()
        if not src.exists():
            raise FileNotFoundError(f"Logo file not found: {src}")
        ext = src.suffix.lower() or ".png"
        raw_logo_path = workdir / f"raw-logo{ext}"
        shutil.copy2(src, raw_logo_path)
    elif meta.get("avatarFile") and Path(meta["avatarFile"]).exists():
        src = Path(meta["avatarFile"]).resolve()
        ext = src.suffix.lower() or ".jpg"
        raw_logo_path = workdir / f"raw-logo{ext}"
        if src != raw_logo_path:
            shutil.copy2(src, raw_logo_path)
    elif meta.get("avatarUrl"):
        try:
            req = urllib.request.Request(
                meta["avatarUrl"],
                headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64)"},
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                ctype = (resp.headers.get("Content-Type") or "").lower()
                ext = ".png" if "png" in ctype else ".jpg"
                raw_logo_path = workdir / f"raw-logo{ext}"
                raw_logo_path.write_bytes(resp.read())
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            meta["avatarDownloadWarning"] = str(exc)

    primary_color, secondary_color = (
        extract_brand_colors(raw_logo_path) if raw_logo_path else (DEFAULT_PRIMARY, DEFAULT_SECONDARY)
    )
    if args.primary_color:
        primary_color = args.primary_color
    if args.secondary_color:
        secondary_color = args.secondary_color

    card_prefix = (args.card_prefix or derive_card_prefix(merchant_name)).upper()
    admin_email = args.admin_email or f"admin+{handle_slug}@umiconsulting.co"
    admin_password = args.admin_password or generate_initial_password()

    provision_payload: dict[str, Any] = {
        "name": merchant_name,
        "city": args.city,
        "timezone": args.timezone,
        "plan": args.plan,
        "cardPrefix": card_prefix,
        "primaryColor": primary_color,
        "secondaryColor": secondary_color,
        "adminEmail": admin_email,
        "adminPassword": admin_password,
        "adminName": args.admin_name or f"Admin {merchant_name}",
        "stampsRequired": args.stamps_required,
        "rewardName": args.reward_name,
        "locations": [
            {
                "name": args.location_name or "Sucursal Principal",
                **({"address": args.address} if args.address else {}),
            }
        ],
    }

    draft = {
        "schemaVersion": 1,
        "source": meta,
        "rawLogoPath": str(raw_logo_path) if raw_logo_path else None,
        "walletStoredValueNote": (
            "plan='starter' grants Cash (loyalty + stored value); "
            "plan='growth' adds owner Dashboard + branding logo upload."
        ),
        "provisionPayload": provision_payload,
    }
    draft_path = workdir / "draft.json"
    draft_path.write_text(json.dumps(draft, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.chmod(draft_path, 0o600)

    print(
        json.dumps(
            {
                "workdir": str(workdir),
                "draftPath": str(draft_path),
                "rawLogoPath": str(raw_logo_path) if raw_logo_path else None,
                "name": merchant_name,
                "cardPrefix": card_prefix,
                "primaryColor": primary_color,
                "secondaryColor": secondary_color,
                "adminEmail": admin_email,
                "warning": meta.get("warning"),
            },
            indent=2,
            ensure_ascii=False,
        )
    )
    return 0


def cmd_prepare_logo(args: argparse.Namespace) -> int:
    src = Path(args.input).expanduser().resolve()
    if not src.exists():
        raise FileNotFoundError(f"Upscaled logo not found: {src}")
    workdir = Path(args.workdir).expanduser().resolve()
    workdir.mkdir(parents=True, exist_ok=True)
    out_png = workdir / "prepared-logo.png"
    out_jpg = workdir / "prepared-logo.jpg"

    magick = find_magick()
    if not magick:
        # Fallback: copy if already valid PNG/JPEG and within size limit.
        raw = src.read_bytes()
        if len(raw) > MAX_LOGO_BYTES:
            raise RuntimeError(
                f"ImageMagick not found and input exceeds {MAX_LOGO_BYTES} bytes ({len(raw)})."
            )
        target = out_png if raw.startswith(b"\x89PNG\r\n\x1a\n") else out_jpg
        target.write_bytes(raw)
        print(json.dumps({"preparedLogoPath": str(target), "bytes": len(raw)}))
        return 0

    # Resize inside 768x768, strip metadata, optimize PNG first.
    res = subprocess.run(
        [
            *magick,
            str(src),
            "-auto-orient",
            "-strip",
            "-resize",
            f"{MAX_LOGO_EDGE}x{MAX_LOGO_EDGE}>",
            "PNG8:" + str(out_png),
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    if res.returncode == 0 and out_png.exists() and out_png.stat().st_size <= MAX_LOGO_BYTES:
        print(
            json.dumps(
                {
                    "preparedLogoPath": str(out_png),
                    "contentType": "image/png",
                    "bytes": out_png.stat().st_size,
                },
                indent=2,
            )
        )
        return 0

    # Fallback to high-quality JPEG if PNG still exceeds 256 KiB.
    for quality in (88, 80, 72):
        res_jpg = subprocess.run(
            [
                *magick,
                str(src),
                "-auto-orient",
                "-strip",
                "-background",
                "white",
                "-flatten",
                "-resize",
                f"{MAX_LOGO_EDGE}x{MAX_LOGO_EDGE}>",
                "-quality",
                str(quality),
                str(out_jpg),
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )
        if res_jpg.returncode == 0 and out_jpg.exists() and out_jpg.stat().st_size <= MAX_LOGO_BYTES:
            if out_png.exists():
                out_png.unlink()
            print(
                json.dumps(
                    {
                        "preparedLogoPath": str(out_jpg),
                        "contentType": "image/jpeg",
                        "bytes": out_jpg.stat().st_size,
                    },
                    indent=2,
                )
            )
            return 0

    raise RuntimeError(f"Could not compress logo under {MAX_LOGO_BYTES} bytes.")


def validate_provision_payload(payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    name = str(payload.get("name") or "")
    if not (2 <= len(name) <= 100):
        errors.append("name must be 2..100 characters")
    if payload.get("plan") not in VALID_PLANS:
        errors.append(f"plan must be one of {VALID_PLANS}")
    prefix = str(payload.get("cardPrefix") or "")
    if not re.fullmatch(r"[A-Z]{2,5}", prefix):
        errors.append("cardPrefix must be 2..5 uppercase letters")
    if not HEX_RE.fullmatch(str(payload.get("primaryColor") or "")):
        errors.append("primaryColor must be #rrggbb")
    if payload.get("secondaryColor") and not HEX_RE.fullmatch(str(payload["secondaryColor"])):
        errors.append("secondaryColor must be #rrggbb")
    if "@" not in str(payload.get("adminEmail") or ""):
        errors.append("adminEmail must be a valid email")
    if len(str(payload.get("adminPassword") or "")) < 8:
        errors.append("adminPassword must be at least 8 characters")
    if "slug" in payload:
        errors.append("do not send legacy 'slug' field (build-v3 ProvisionMerchantDto forbids it)")
    return errors


def _csrf_headers(jar: http.cookiejar.CookieJar) -> dict[str, str]:
    for cookie in jar:
        if cookie.name == "umi_csrf" and cookie.value:
            return {"x-umi-csrf": cookie.value}
    return {}


def _api_json(
    opener: urllib.request.OpenerDirector,
    method: str,
    url: str,
    body: dict[str, Any] | None = None,
    extra_headers: dict[str, str] | None = None,
    jar: http.cookiejar.CookieJar | None = None,
) -> tuple[int, Any]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if jar is not None and method.upper() in ("POST", "PUT", "PATCH", "DELETE"):
        headers.update(_csrf_headers(jar))
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with opener.open(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else raw
        except json.JSONDecodeError:
            parsed = raw
        return err.code, parsed


def cmd_provision(args: argparse.Namespace) -> int:
    draft_path = Path(args.draft).expanduser().resolve()
    draft = json.loads(draft_path.read_text(encoding="utf-8"))
    payload = draft["provisionPayload"]
    errors = validate_provision_payload(payload)

    logo_bytes: bytes | None = None
    logo_ctype: str | None = None
    if args.logo:
        logo_path = Path(args.logo).expanduser().resolve()
        if not logo_path.exists():
            errors.append(f"logo not found: {logo_path}")
        else:
            logo_bytes = logo_path.read_bytes()
            if len(logo_bytes) > MAX_LOGO_BYTES:
                errors.append(f"logo exceeds {MAX_LOGO_BYTES} bytes ({len(logo_bytes)})")
            if logo_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
                logo_ctype = "image/png"
            elif logo_bytes.startswith(b"\xff\xd8\xff"):
                logo_ctype = "image/jpeg"
            else:
                errors.append("logo must be PNG or JPEG")

    if errors:
        print(json.dumps({"ok": False, "validationErrors": errors}, indent=2), file=sys.stderr)
        return 2

    api_base = args.api.rstrip("/")
    redacted_payload = {**payload, "adminPassword": "<redacted>"}
    if not args.apply:
        print(
            json.dumps(
                {
                    "dryRun": True,
                    "api": api_base,
                    "postMerchantsPayload": redacted_payload,
                    "logoUpload": (
                        {"contentType": logo_ctype, "bytes": len(logo_bytes)}
                        if logo_bytes
                        else None
                    ),
                },
                indent=2,
                ensure_ascii=False,
            )
        )
        return 0

    admin_email = os.environ.get("UMI_PLATFORM_ADMIN_EMAIL")
    admin_password = os.environ.get("UMI_PLATFORM_ADMIN_PASSWORD")
    admin_cookie = os.environ.get("UMI_PLATFORM_ADMIN_COOKIE")
    if not admin_cookie and (not admin_email or not admin_password):
        raise RuntimeError(
            "Set UMI_PLATFORM_ADMIN_EMAIL + UMI_PLATFORM_ADMIN_PASSWORD (or UMI_PLATFORM_ADMIN_COOKIE) in env."
        )

    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    extra_headers = {"Cookie": admin_cookie} if admin_cookie else {}

    if not admin_cookie:
        status, login_resp = _api_json(
            opener,
            "POST",
            f"{api_base}/api/auth/local/login",
            {"username": admin_email, "password": admin_password},
        )
        if status >= 400:
            raise RuntimeError(f"Platform admin login failed ({status}): {login_resp}")
        if isinstance(login_resp, dict) and login_resp.get("mfaRequired"):
            mfa_code = os.environ.get("UMI_PLATFORM_ADMIN_MFA_CODE")
            if not mfa_code:
                raise RuntimeError("Platform admin requires MFA: set UMI_PLATFORM_ADMIN_MFA_CODE.")
            status, mfa_resp = _api_json(
                opener,
                "POST",
                f"{api_base}/api/auth/local/mfa/verify",
                {"challengeToken": login_resp["challengeToken"], "code": mfa_code},
            )
            if status >= 400:
                raise RuntimeError(f"MFA verify failed ({status}): {mfa_resp}")

    status, created = _api_json(
        opener,
        "POST",
        f"{api_base}/api/merchants",
        payload,
        extra_headers,
        jar=jar,
    )
    if status >= 400:
        raise RuntimeError(f"POST /api/merchants failed ({status}): {created}")

    merchant_id = (created or {}).get("merchantId") or ((created or {}).get("merchant") or {}).get("id")
    logo_result: Any = None
    if logo_bytes and logo_ctype and merchant_id:
        if payload["plan"] == "starter":
            logo_result = {
                "skipped": True,
                "reason": "PUT /api/merchants/:id/branding/logo requires 'dashboard' entitlement (plan growth/pro).",
            }
        else:
            # Sign in as the new merchant admin so MerchantAccessGuard grants access.
            m_jar = http.cookiejar.CookieJar()
            m_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(m_jar))
            m_status, m_login = _api_json(
                m_opener,
                "POST",
                f"{api_base}/api/auth/local/login",
                {"username": payload["adminEmail"], "password": payload["adminPassword"]},
            )
            if m_status < 400:
                l_status, l_resp = _api_json(
                    m_opener,
                    "PUT",
                    f"{api_base}/api/merchants/{merchant_id}/branding/logo",
                    {
                        "contentType": logo_ctype,
                        "dataBase64": base64.b64encode(logo_bytes).decode("ascii"),
                    },
                    jar=m_jar,
                )
                logo_result = {"status": l_status, "response": l_resp}
            else:
                logo_result = {"skipped": True, "reason": f"merchant login returned {m_status}: {m_login}"}

    print(
        json.dumps(
            {
                "ok": True,
                "merchantId": merchant_id,
                "created": created,
                "logoUpload": logo_result,
            },
            indent=2,
            ensure_ascii=False,
        )
    )
    return 0


def cmd_cleanup(args: argparse.Namespace) -> int:
    workdir = Path(args.workdir).expanduser().resolve()
    if workdir in (Path("/"), Path.home()):
        raise ValueError(f"Refusing to remove protected path: {workdir}")
    if not workdir.exists():
        print(json.dumps({"cleaned": False, "reason": "not_found", "workdir": str(workdir)}))
        return 0
    # Overwrite draft.json (contains initial password) before removing directory.
    draft = workdir / "draft.json"
    if draft.exists() and draft.is_file():
        draft.write_bytes(b"\x00" * draft.stat().st_size)
    shutil.rmtree(workdir)
    print(json.dumps({"cleaned": True, "workdir": str(workdir)}))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Umi Cash merchant onboarding helper.")
    sub = parser.add_subparsers(dest="command", required=True)

    p_fetch = sub.add_parser("fetch", help="Fetch public IG profile (or local logo) and write draft.json.")
    p_fetch.add_argument("--instagram", help="Instagram URL or @handle.")
    p_fetch.add_argument("--logo-file", help="Fallback local logo file if IG blocks anonymous fetch.")
    p_fetch.add_argument("--name", help="Override merchant display name.")
    p_fetch.add_argument("--city", default="Culiacán", help="Merchant city.")
    p_fetch.add_argument("--timezone", default="America/Mazatlan", help="IANA timezone.")
    p_fetch.add_argument("--plan", choices=VALID_PLANS, default="growth", help="Umi plan.")
    p_fetch.add_argument("--card-prefix", help="2-5 uppercase letters.")
    p_fetch.add_argument("--primary-color", help="Override #rrggbb primary color.")
    p_fetch.add_argument("--secondary-color", help="Override #rrggbb secondary color.")
    p_fetch.add_argument("--admin-email", help="Override generic admin email.")
    p_fetch.add_argument("--admin-password", help="Override generated initial password.")
    p_fetch.add_argument("--admin-name", help="Override admin display name.")
    p_fetch.add_argument("--stamps-required", type=int, default=8, help="Default stamps for reward.")
    p_fetch.add_argument("--reward-name", default="Bebida gratis", help="Default reward name.")
    p_fetch.add_argument("--location-name", default="Sucursal Principal", help="First branch name.")
    p_fetch.add_argument("--address", help="Optional branch street address.")
    p_fetch.add_argument("--workdir", required=True, help="Temporary workspace directory.")
    p_fetch.set_defaults(func=cmd_fetch)

    p_logo = sub.add_parser("prepare-logo", help="Normalize logo to <=768x768 and <=256 KiB.")
    p_logo.add_argument("--input", required=True, help="Upscaled logo image path.")
    p_logo.add_argument("--workdir", required=True, help="Temporary workspace directory.")
    p_logo.set_defaults(func=cmd_prepare_logo)

    p_prov = sub.add_parser("provision", help="Validate or apply merchant creation + logo upload.")
    p_prov.add_argument("--draft", required=True, help="Path to draft.json.")
    p_prov.add_argument("--logo", help="Path to prepared-logo.png/jpg.")
    p_prov.add_argument("--api", default="https://api.umiconsulting.co", help="Umi API origin.")
    p_prov.add_argument("--apply", action="store_true", help="Actually send writes to API (dry-run otherwise).")
    p_prov.set_defaults(func=cmd_provision)

    p_clean = sub.add_parser("cleanup", help="Wipe draft.json and remove temporary workspace.")
    p_clean.add_argument("--workdir", required=True, help="Temporary workspace directory.")
    p_clean.set_defaults(func=cmd_cleanup)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
