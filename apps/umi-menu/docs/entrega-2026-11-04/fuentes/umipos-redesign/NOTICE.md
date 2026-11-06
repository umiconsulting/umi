# Notices

Stageshow source is MIT licensed; see `LICENSE`.

Product and operating-system names, familiar device geometry, app icons, and
illustrated interfaces are used as examples. Those names and marks remain
with their owners; the Stageshow license does not grant trademark rights or
imply endorsement. Adapt examples to the product you are illustrating.

The Radix-inspired look uses publicly documented color and spacing values;
its source is identified in `examples/looks/radix.css`. The app icons in `assets/app-icons.ts` are artwork from their respective app
bundles, as identified in that file; they are not covered by the Stageshow MIT
license. They remain illustrative references to those products. The Wikipedia
study includes two local photographs dedicated under CC0 1.0 (also used
in the Finder, Telegram and annotation studies); their authors,
original source pages and modifications are recorded in
[`examples/wikipedia/PHOTOS.md`](examples/wikipedia/PHOTOS.md). Other scenes
use CSS and vector illustrations. No third-party fonts are bundled, and the
playground does not fetch fonts or photographs from external services at runtime.

The local brand registry in `kit/brands/` includes SVG artwork from SVGL (MIT), payment-icons (Apache 2.0), Cryptocurrency Icons (CC0 1.0), and official Linear, American Express and Circle assets. Per-file sources, hashes and license files are listed in [`kit/brands/SOURCES.md`](kit/brands/SOURCES.md). The original artwork and brand usage terms remain with their respective owners.

`Phone frame="photo"` is optional. Supply your own permitted bezel image via
`--ss-phone-photo-light: url(...)` and optionally `--ss-phone-photo-dark`.
Without it, the kit uses its CSS-drawn `pro` frame. No bezel photographs are
bundled.

## UMI study fonts

This local UMI study bundles IBM Plex Sans and Bricolage Grotesque. Their font licences are in public/fonts. The UMI and ONCA names remain with their owners.


## Unslop guidance

This design review applies Unslop by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Source: https://github.com/heydamir/unslop/tree/main/skills/unslop and https://heydamir.design/unslop.
The guidance was adapted to UMI POS typography, category filters and a schematic table floor plan.


## Illustrative product photographs

Sources, creators and licenses for the twelve illustrative photos are recorded in [public/products/SOURCES.txt](public/products/SOURCES.txt), also linked from the prototype viewer. They do not depict ONCA’s actual products.

## BoardUI controls

The free Button, Input, Select, Checkbox, Tabs, DirectionProvider and ScrollFade sources were installed from the official BoardUI registry with BoardUI CLI 0.5.9. The CLI package declares MIT licensing. Registry source: https://www.boardui.com/r/. Components are adapted to UMI typography, semantic colors and flat button treatments. No Pro components were fetched.

The local Stageshow Phone component adds iPad and Galaxy Tab screen profiles and orientation; Window adds Windows title-bar controls. These are schematic previews, not official hardware bezel artwork.

## Dashboard identity and sources

The dashboard preserves the UMI dashboard's `umidash` wordmark, navy navigation, visual hierarchy and original fish login asset. The fish image was copied unchanged from `apps/umi-dashboard/public/login-bg.jpg` in the user's UMI repository; ownership remains with its original rights holders.

Inter Tight and Source Sans 3 match the existing dashboard. Local files were retrieved from Google Fonts on 2026-11-02. SIL Open Font License texts are in `public/fonts/InterTight-OFL.txt` and `public/fonts/SourceSans3-OFL.txt`.

BoardUI Table, SidebarNavItem and their supporting free components were added with CLI 2026.11.1. Their source is adapted for React 18 and the same semantic UMI controls. No Pro components were fetched.
