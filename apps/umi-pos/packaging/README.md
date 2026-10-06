# UmiPOS desktop packaging (Linux AppImage)

This produces a single self-updating executable — a Linux **AppImage** — for the
UmiPOS desktop till. One file, no installer, no root. It updates itself from
GitHub Releases: only the changed blocks are fetched (zsync), and the operator
sees an **Actualizar ahora** button when the server reports the client is out of
date.

## Layout

```
packaging/
  linux/
    build_appimage.sh   # build + package script
    AppRun              # AppImage entrypoint (runs the Flutter bundle)
    umi_pos.desktop     # desktop entry (name, icon, categories)
  tools/                # downloaded appimagetool (git-ignored)
  build/AppDir/         # staging dir (git-ignored)
  dist/                 # output .AppImage + .zsync (git-ignored)
```

## One-time: fetch the packaging tool

```sh
mkdir -p packaging/tools
curl -fsSL -o packaging/tools/appimagetool \
  https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
chmod +x packaging/tools/appimagetool
```

`appimagetool` bundles `zsyncmake` and `mksquashfs`, so nothing else is needed.
FUSE must be present (`/dev/fuse`).

## Build

```sh
# Development build (points at the local API), from apps/umi-pos:
packaging/linux/build_appimage.sh

# Production build:
ENVIRONMENT=production API_BASE_URL=https://api.umiconsulting.co \
VERSION=0.2.0 packaging/linux/build_appimage.sh
```

Output: `packaging/dist/umi_pos-<version>-x86_64.AppImage` and its `.zsync`.
Reuse an existing Flutter build with `SKIP_BUILD=1`.

Key parameters (env vars): `VERSION`, `ENVIRONMENT`, `API_BASE_URL`,
`CONTRACT_VERSION`, `GH_OWNER`/`GH_REPO`. See the header of
`build_appimage.sh`.

## Publish a release (so installed copies self-update)

The AppImage carries an update feed pointing at the latest GitHub release. Each
release must attach both the `.AppImage` and its `.zsync`:

```sh
gh release create v0.2.0 \
  packaging/dist/umi_pos-0.2.0-x86_64.AppImage \
  packaging/dist/umi_pos-0.2.0-x86_64.AppImage.zsync \
  --repo umiconsulting/umi --title 'UmiPOS 0.2.0' --notes '...'
```

The filename **must** keep the `umi_pos-*-x86_64.AppImage` shape — the update
feed matches on it.

## How updating works

Two independent paths, both driven off GitHub Releases:

1. **In-app** — when `GET /health/release` reports the client is below
   `minimumPosVersion`, the bump screen shows **Actualizar ahora**. It downloads
   the latest release AppImage, keeps the old file as `*.zs-old` for rollback,
   swaps it in, and offers **Reiniciar ahora**. Enabled by the
   `UMIPOS_UPDATE_GH_OWNER` / `UMIPOS_UPDATE_GH_REPO` build defines (the build
   script sets them). Code: `lib/core/update/`, wired in
   `lib/app/umi_pos_app.dart` (`_FailureSurface`).
2. **External** — the embedded zsync update information lets the standalone
   [AppImageUpdate](https://github.com/AppImageCommunity/AppImageUpdate) GUI/CLI
   delta-update the file. Handy for kiosk/MDM-managed fleets.

## Notes

- x86_64 only for now. An arm64 build needs the aarch64 appimagetool and an
  `aarch64` asset name; the resolver already keys off an arch token.
- The public `umiconsulting/umi` repo means release assets download without a
  token. If the repo ever goes private, publish artifacts to a public releases
  repo (or Cloudflare R2) and point `GH_OWNER`/`GH_REPO` (or the zsync URL)
  there.
