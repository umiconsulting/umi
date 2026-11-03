# umi native assets

The approved mark is `umi` in Bricolage Grotesque SemiBold.
The source is `umi-wordmark.svg` in this directory.
All native and web development assets use its exact path.
The app adds no runtime dependency.

## Source and license

The tracked font is `../fonts/BricolageGrotesque12pt-SemiBold.ttf`.
Its license is `../fonts/Bricolage-OFL.txt` (SIL OFL 1.1).
The font SHA256 is `b3c5133bc53549fdac082b999117efd76f52c92ed6032895bc91e01aa14d93d2`.
The copyright belongs to the Bricolage Grotesque Project Authors (2022).

`tool/export_umi_wordmark.swift` reads the font file directly through CoreText.
It preserves shaped glyph positions and the approved tracking: `-1px` at `29px`, or `-1/29 em`.
It exports the outlines at 1000 units and normalizes their upper-left origin.
The source measures 1626.034483 × 747 units.
It uses navy `#172440`, the approved `PosPalette.onSurface` for light mode.
The opaque background is `#FFFEFA`, the approved light surface.
The existing Flutter presentation retains its own theme behavior.

## Generate

Run these commands from the repository root.
The source SVG is versioned. Only font or tracking changes require the first command.

```sh
xcrun swift -module-cache-path /private/tmp/umi-brand-swift-module-cache apps/umi-pos/tool/export_umi_wordmark.swift
node apps/umi-pos/tool/generate_umi_branding.cjs /path/to/node_modules/sharp
node apps/umi-pos/tool/generate_umi_branding.cjs /path/to/node_modules/sharp --check
python3 apps/umi-pos/tool/verify_umi_branding.py
```

The development tools use Swift 6.3.2/CoreText, Sharp 0.35.5, and Pillow 12.2.0.
The measured Sharp libraries are libvips 8.18.7 and librsvg 2.63.2.
The installed Sharp directory on the source workstation is `/Users/moon/Documents/umipos-redesign/node_modules/sharp`.
Set `UMI_BRAND_PYTHON` to select another Python executable with Pillow 12.2.0.
Pillow uses its standard ICO writer. Sharp uses its standard SVG renderer and Lanczos3 resize.
`--check` regenerates all derivatives in memory and compares their bytes with the versioned files.
Exact bytes depend on these tool versions. The versioned SVG fixes the font outlines across machines.

## Dimensions and safe areas

| Asset | Dimensions | Placement |
| --- | --- | --- |
| iOS and macOS icons | Existing `Contents.json`: point size × scale | Ink width is 66% of the square. Opaque RGB PNG. |
| Android legacy icons | 48, 72, 96, 144, 192px | Ink width is 66%. Opaque RGB PNG. |
| Android adaptive foreground | 108 × 108dp | Ink width is 58.32dp. Its full bounding rectangle fits inside the central 66dp circle. |
| Android adaptive background | Full resource | Opaque approved light surface. |
| Android launch vector | 288 × 288dp | Ink width is 168dp. Its full bounding rectangle fits inside the central 192dp circle. |
| iOS launch images | 288, 576, 864px | Transparent square at 1×/2×/3×. Visible ink width is 168pt. |
| Windows ICO | 16, 24, 32, 48, 64, 128, 256px | Same 66% composition, with all seven entries. |
| Web development icons | 192, 512px; favicon 32px | Same composition; the full ink rectangle also fits inside the maskable 80% circle. |

The source contains no border, icon mask, or shadow.
The adaptive ink rectangle has a diagonal of about 64.18dp, below the 66dp safe diameter.
The launch ink rectangle has a diagonal of about 184.88dp, below the 192dp safe diameter.
The same launch vector serves the legacy window background and the Android 12+ system splash.
Separate Android 12+ themes preserve the existing day/night theme parents.
The iOS launch storyboard uses only a centered image and native Auto Layout constraints.

## Native checks

`verify_umi_branding.py` checks dimensions, RGB/alpha modes, ICO entries, path identity, and conservative circular safe areas.
Android resources also require `aapt2 compile` and `aapt2 link` against an installed Android SDK.
Apple resources require `actool` and `ibtool` from Xcode.
Native launcher masks and cold starts require actual device checks.
These source checks do not prove the final platform appearance.

The official platform references and tradeoffs are in `.superpowers/sdd/2026-11-02-redesign-parity/task-3d-branding-references.md` at the repository root.
