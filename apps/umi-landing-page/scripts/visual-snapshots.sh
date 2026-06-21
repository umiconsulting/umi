#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
OUT_DIR="${OUT_DIR:-.visual}"

mkdir -p "$OUT_DIR"

npx playwright screenshot --browser chromium --viewport-size=1440,1000 --wait-for-timeout=3000 \
  "$BASE_URL" "$OUT_DIR/hero-desktop.png"

npx playwright screenshot --browser chromium --viewport-size=390,844 --wait-for-timeout=3000 \
  "$BASE_URL" "$OUT_DIR/hero-mobile.png"

npx playwright screenshot --browser chromium --viewport-size=1440,1000 --wait-for-timeout=2000 \
  "$BASE_URL/#productos" "$OUT_DIR/products-desktop.png"

npx playwright screenshot --browser chromium --viewport-size=1440,1000 --wait-for-timeout=2000 \
  "$BASE_URL/#diagnostico" "$OUT_DIR/diagnostic-desktop.png"

npx playwright screenshot --browser chromium --viewport-size=1440,1000 --wait-for-timeout=2000 \
  "$BASE_URL/#proceso" "$OUT_DIR/process-desktop.png"
