#!/usr/bin/env bash
# profile_build.sh - saca avatar + info publica de cualquier cuenta de Instagram.
# Rapido (~0.7s por cuenta), sin login, sin dependencias mas alla de curl+python3.
#
# Uso:
#   ./profile_build.sh <usuario|url>... [-o DIR] [--json]
#
#   <usuario|url>   shimonagimx | @shimonagimx | https://www.instagram.com/shimonagimx/
#                   acepta varias cuentas en la misma llamada
#   -o DIR          carpeta de salida (default: .)
#   --json          imprime NDJSON (un objeto por cuenta, una linea) en vez del resumen
#
# COMO FUNCIONA
#   Instagram solo sirve las <meta property="og:image|og:title|og:description"> y el
#   <meta name="description"> (bio) a user-agents de BOT. Con UA de navegador (Chrome) y
#   curl devuelve el shell de JS VACIO (pageID httpErrorPage, ssrEnabled:false), sin og.
#   Con UA de Googlebot devuelve la pagina prerenderizada: un solo curl y ya.
#   Si no salen las og, hace fallback a `chromium --headless --dump-dom`.
#
# SALIDA
#   DIR/<usuario>.json   datos + avatar_url
#   DIR/<usuario>.jpg    foto de perfil publica (150x150; HD requiere login)
#
# NOTA para agentes: para el curl NO uses un UA de navegador, rompe la extraccion.
# Codigos: 0 ok | 1 alguna cuenta sin datos | 2 uso/argumentos

set -uo pipefail

UA='Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
OUT="."
MODE="human"
USERS=()

while [ $# -gt 0 ]; do
  case "$1" in
    -o|--out) OUT="${2:-}"; shift 2 ;;
    --json)   MODE="json"; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    -*) echo "opcion desconocida: $1" >&2; exit 2 ;;
    *)  USERS+=("$1"); shift ;;
  esac
done

[ ${#USERS[@]} -gt 0 ] || { echo "uso: $(basename "$0") <usuario|url>... [-o DIR] [--json]" >&2; exit 2; }

mkdir -p "$OUT" || exit 2
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
RC=0

for RAW in "${USERS[@]}"; do
  # normaliza: url o @user -> username limpio
  USER=$(printf '%s' "$RAW" | sed -E 's#^https?://([a-z0-9-]+\.)*instagram\.com/##; s#^/##; s#[/?].*$##; s#^@##')
  case "$USER" in
    ""|*[!A-Za-z0-9._]*) echo "usuario invalido: '$RAW'" >&2; RC=2; continue ;;
  esac

  URL="https://www.instagram.com/$USER/"

  curl -fsS -A "$UA" --max-time 25 -L "$URL" -o "$TMP/p.html" 2>/dev/null
  if [ ! -s "$TMP/p.html" ] || ! grep -q 'og:image' "$TMP/p.html" 2>/dev/null; then
    if command -v chromium >/dev/null 2>&1; then
      timeout 60 chromium --headless=new --disable-gpu --no-sandbox \
        --virtual-time-budget=8000 --dump-dom "$URL" > "$TMP/p.html" 2>/dev/null
    fi
  fi

  python3 - "$TMP/p.html" "$USER" "$OUT" "$MODE" <<'PY'
import sys, re, html, json, os, urllib.request

page, user, outdir, mode = sys.argv[1:5]
raw = open(page, encoding="utf-8", errors="replace").read() if os.path.exists(page) else ""

def meta(*props):
    for p in props:
        for pat in (r'<meta[^>]+(?:property|name)="%s"[^>]*?content="([^"]*)"' % re.escape(p),
                    r'<meta[^>]+content="([^"]*)"[^>]*?(?:property|name)="%s"' % re.escape(p)):
            m = re.search(pat, raw)
            if m:
                return html.unescape(m.group(1))
    return None

title = meta("og:title")
desc = meta("og:description")
img = meta("og:image")
biometa = meta("description")

if not (title or desc) or (title or "") == "Instagram":
    print(f"  ! sin datos para @{user} (no existe, es privada, o Instagram nos bloqueo)", file=sys.stderr)
    sys.exit(1)

full = None
if title:
    m = re.match(r'^(.*?)\s*\(@' + re.escape(user) + r'\)', title)
    if m:
        full = m.group(1).strip()

stats = {}
for label, key in (("Followers", "followers"), ("Following", "following"), ("Posts", "posts")):
    # acepta 1.738 / 1,738 / 97.9M / 1.2B
    m = re.search(r'([\d.,]+\s*[KMB]?)\s+' + label, desc or "", re.I)
    if m:
        v = m.group(1).strip().upper()
        stats[key] = v if re.search(r'[KMB]', v) else int(re.sub(r'[.,]', "", v))

bio = None
if biometa:
    m = re.search(r'on Instagram:\s*"(.*)"\s*$', biometa, re.S)
    if m:
        bio = m.group(1).strip()

data = {
    "username": user,
    "full_name": full,
    "bio": bio,
    "followers": stats.get("followers"),
    "following": stats.get("following"),
    "posts": stats.get("posts"),
    "profile_url": f"https://www.instagram.com/{user}/",
    "avatar_url": img,
    "avatar_file": None,
    "source": "og:meta (bot UA)",
}

if img:
    dst = os.path.join(outdir, user + ".jpg")
    try:
        req = urllib.request.Request(img, headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": data["profile_url"]})
        with urllib.request.urlopen(req, timeout=30) as r, open(dst, "wb") as f:
            f.write(r.read())
        data["avatar_file"] = os.path.abspath(dst)
    except Exception as e:
        data["avatar_error"] = str(e)

jpath = os.path.join(outdir, user + ".json")
with open(jpath, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

if mode == "json":
    print(json.dumps(data, ensure_ascii=False))
else:
    print(f"@{user}")
    print(f"  nombre    : {full}")
    print(f"  bio       : {(bio or '').replace(chr(10), ' | ')}")
    print(f"  seguidores: {data['followers']}   siguiendo: {data['following']}   posts: {data['posts']}")
    print(f"  avatar    : {data['avatar_file']}")
    print(f"  json      : {os.path.abspath(jpath)}")
PY
  [ $? -eq 0 ] || RC=1
done

exit $RC
