#!/usr/bin/env bash
#
# Build a self-updating UmiPOS AppImage for Linux desktop.
#
# Output: packaging/dist/umi_pos-<version>-x86_64.AppImage  (+ .zsync delta index)
#
# The AppImage carries GitHub-Releases update information, so `AppImageUpdate`
# (or the in-app updater) can pull only the changed blocks of a newer release.
# The in-app "Actualizar" button (shown when the server reports the client is
# below minimumPosVersion) downloads the latest release asset and swaps it in.
#
# Parameters (env vars, all optional):
#   VERSION          release version, e.g. 0.1.0        (default: pubspec version)
#   ENVIRONMENT      UMIPOS_ENVIRONMENT                 (default: development)
#   API_BASE_URL     UMIPOS_API_BASE_URL                (default: http://127.0.0.1:4001)
#   CONTRACT_VERSION UMIPOS_CONTRACT_VERSION            (default: 2.13.0)
#   GH_OWNER/GH_REPO GitHub repo for the update feed    (default: umiconsulting/umi)
#   SKIP_BUILD=1     reuse an existing release bundle (skip `flutter build linux`)
#
# Production example:
#   ENVIRONMENT=production API_BASE_URL=https://api.umiconsulting.co \
#   VERSION=0.2.0 packaging/linux/build_appimage.sh
set -euo pipefail

POS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PKG_DIR="${POS_DIR}/packaging"
TOOLS_DIR="${PKG_DIR}/tools"
DIST_DIR="${PKG_DIR}/dist"
APPDIR="${PKG_DIR}/build/AppDir"
APPIMAGETOOL="${TOOLS_DIR}/appimagetool"

ENVIRONMENT="${ENVIRONMENT:-development}"
API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:4001}"
CONTRACT_VERSION="${CONTRACT_VERSION:-2.13.0}"
CONFIG_SCHEMA_VERSION="${CONFIG_SCHEMA_VERSION:-1}"
GH_OWNER="${GH_OWNER:-umiconsulting}"
GH_REPO="${GH_REPO:-umi}"

# Default the version from pubspec (strip the +build suffix).
if [ -z "${VERSION:-}" ]; then
  VERSION="$(grep -E '^version:' "${POS_DIR}/pubspec.yaml" | head -1 | sed -E 's/^version:[[:space:]]*//; s/\+.*$//')"
fi

BUNDLE="${POS_DIR}/build/linux/x64/release/bundle"
OUTPUT="${DIST_DIR}/umi_pos-${VERSION}-x86_64.AppImage"
UPDATE_INFO="gh-releases-zsync|${GH_OWNER}|${GH_REPO}|latest|umi_pos-*-x86_64.AppImage.zsync"

echo "==> UmiPOS AppImage  version=${VERSION}  env=${ENVIRONMENT}  api=${API_BASE_URL}"
echo "    update feed: ${UPDATE_INFO}"

if [ ! -x "${APPIMAGETOOL}" ]; then
  echo "!! appimagetool missing at ${APPIMAGETOOL}" >&2
  echo "   Fetch it: curl -fsSL -o '${APPIMAGETOOL}' https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage && chmod +x '${APPIMAGETOOL}'" >&2
  exit 1
fi

# 1. Flutter release bundle -------------------------------------------------
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "==> flutter build linux --release"
  ( cd "${POS_DIR}" && flutter build linux --release \
      --dart-define=UMIPOS_ENVIRONMENT="${ENVIRONMENT}" \
      --dart-define=UMIPOS_API_BASE_URL="${API_BASE_URL}" \
      --dart-define=UMIPOS_DEVELOPMENT_DIAGNOSTICS="${DEVELOPMENT_DIAGNOSTICS:-true}" \
      --dart-define=UMIPOS_FEATURE_BOOTSTRAP=disabled \
      --dart-define=UMIPOS_HARDWARE_SIMULATOR_ENABLED="${HARDWARE_SIMULATOR_ENABLED:-true}" \
      --dart-define=UMIPOS_RELEASE_VERSION="${VERSION}" \
      --dart-define=UMIPOS_CONTRACT_VERSION="${CONTRACT_VERSION}" \
      --dart-define=UMIPOS_CONFIG_SCHEMA_VERSION="${CONFIG_SCHEMA_VERSION}" \
      --dart-define=UMIPOS_UPDATE_GH_OWNER="${GH_OWNER}" \
      --dart-define=UMIPOS_UPDATE_GH_REPO="${GH_REPO}" )
fi
[ -x "${BUNDLE}/umi_pos" ] || { echo "!! release bundle not found at ${BUNDLE}" >&2; exit 1; }

# 2. Assemble the AppDir -----------------------------------------------------
echo "==> assembling AppDir"
rm -rf "${APPDIR}"
mkdir -p "${APPDIR}/usr/bin" "${APPDIR}/usr/share/icons/hicolor/512x512/apps" \
         "${APPDIR}/usr/share/applications"
cp -a "${BUNDLE}/." "${APPDIR}/usr/bin/"

install -m 0755 "${PKG_DIR}/linux/AppRun" "${APPDIR}/AppRun"
install -m 0644 "${PKG_DIR}/linux/umi_pos.desktop" "${APPDIR}/umi_pos.desktop"
install -m 0644 "${PKG_DIR}/linux/umi_pos.desktop" "${APPDIR}/usr/share/applications/umi_pos.desktop"

ICON_SRC="${POS_DIR}/web/icons/Icon-512.png"
install -m 0644 "${ICON_SRC}" "${APPDIR}/usr/share/icons/hicolor/512x512/apps/umi_pos.png"
install -m 0644 "${ICON_SRC}" "${APPDIR}/umi_pos.png"
cp "${APPDIR}/umi_pos.png" "${APPDIR}/.DirIcon"

# 3. Package with embedded update information --------------------------------
echo "==> appimagetool (embedding update feed)"
mkdir -p "${DIST_DIR}"
rm -f "${OUTPUT}" "${OUTPUT}.zsync"
# appimagetool writes the .zsync into its CWD (basename only), so run it from the
# dist directory to keep the AppImage and its delta index together.
( cd "${DIST_DIR}" && ARCH=x86_64 "${APPIMAGETOOL}" \
    --no-appstream \
    --updateinformation "${UPDATE_INFO}" \
    "${APPDIR}" "${OUTPUT}" )

chmod +x "${OUTPUT}"
echo ""
echo "==> built: ${OUTPUT}"
[ -f "${OUTPUT}.zsync" ] && echo "    delta index: ${OUTPUT}.zsync"
echo "    size: $(du -h "${OUTPUT}" | cut -f1)"
echo ""
echo "Publish a release so installed copies can self-update:"
echo "  gh release create v${VERSION} '${OUTPUT}' '${OUTPUT}.zsync' --repo ${GH_OWNER}/${GH_REPO} --title 'UmiPOS ${VERSION}' --notes '...'"
