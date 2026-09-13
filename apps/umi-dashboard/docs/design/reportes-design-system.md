# Reportes — Design-System Reference

What to build Reportes *with*, so screens match Umi instead of drifting to generic
defaults. Extracted from the live code 2026-09-13. Companion to
[`reportes-ia-plan.md`](./reportes-ia-plan.md),
[`reportes-moodboard.md`](./reportes-moodboard.md), and
[`reportes-patterns.md`](./reportes-patterns.md).

**Source of truth:** tokens are generated — `packages/tokens/tokens/{core,dashboard}.json`
→ `packages/tokens/dist/dashboard.css`, imported at `apps/umi-dashboard/src/styles.css:6`.
Components + theme logic live in that ~4,500-line `styles.css`; screens add inline
styles that reference `var(--token)` (never raw hex). **Do not invent a palette — use
these tokens.**

---

## 1. Tokens (real values, with source)

**Theming.** Base `:root` is light ("Umi") (`dashboard.css:3-68`). Two dark themes:
`[data-theme="dark"]` (Ocean) and `[data-theme="midnight"]` (all-black); OS dark via
`@media (prefers-color-scheme: dark) :root:not([data-theme])`. Dark themes re-tint
only the primary button and `.eyebrow`/`.as-text` → `--umi-blue`; everything else is
token-driven, so a correctly-tokenised screen themes for free.

- **Canvas / ink / line:** `--canvas:#EEF1F8`, `--canvas-2:#E4E9F3`, `--surface:#fff`,
  `--surface-warm:#FAF4EC`; ink `--ink-1:#131f44` … `--ink-4:#7D8AAE`; lines
  `--line:#DDE3F0`, `--line-soft:#E8ECF5`, `--line-strong:#C8D1E5`.
- **Accent:** `--umi-navy:#223979`, `--umi-navy-ink:#131f44`; `--umi-blue:#7692CB`
  (focus rings, sidebar-active, dark primary), `--umi-blue-soft:#a8bbde`.
- **Sidebar:** `--sidebar-bg:#1a2952`, `--sidebar-bg-deep:#131f44`, `--side-text-1/2/3`,
  `--side-line`. Rail width `--side-w` = 244 / 210 (mid) / 72 (collapsed).
- **Semantic:** `--success:#287C42`, `--danger:#AC312A`, `--warning:#8A5F18`,
  `--info:#1F6CB0`, each with a `-soft` fill. **Use these for deltas/anomalies.**
- **Radii:** `--r-pill:9999`, `--r-lg:12`, `--r-xl:16`, `--r-card:20`, `--r-shell:28`.
- **Shadows:** `--shadow-card`, `--shadow-pop`, `--shadow-inner`.
- **Type:** `--font-display:"Inter Tight"`, `--font-body:"Source Sans 3"`,
  `--font-mono:"JetBrains Mono"`. Scale: `.h-page` clamp(28,2.6vw,38)/600, `.h-section`
  19/600, body 14/1.45, `.eyebrow` 11/600/0.1em uppercase, `.kpi-num` 44. **Figures are
  always `tabular-nums lining-nums`; money is `--font-mono`.**
- **Motion:** `--ease`, `--ease-out`, `--dur-1:120ms / -2:220 / -3:320`.
- **Gap:** there is **no spacing-scale token** — reuse the observed rhythm (grid gap 18,
  section gap 20/24, card pad 12–16). Do not invent new values.

## 2. Components to reuse (don't re-declare)

| Need | Use | Where |
|---|---|---|
| Container | `.card` (surface, 1px `--line`, `--r-card`, pad 20) / `.card-warm` | `styles.css:945` |
| KPI tile | `.kpi` → `.kpi-head .label`, `.kpi-icon` (30², canvas-2), `.kpi-num` (44), `.delta` | `styles.css:976-1044` |
| Buttons | `.btn` + `.btn-primary/-secondary/-ghost/-sm/-icon` | `styles.css:540+` |
| Inputs/select | `.input`, `.select` (h44, focus → umi-blue + 3px ring); custom `Select` portal | `styles.css:1253`; `components/select.jsx` |
| Status/label | `.badge-*` semantic system (active/trial/susp/info/neutral) | `styles.css:721-766` |
| Segment chips | `.segment-badge.seg-*` | `styles.css:3257` |
| View toggle | `.seg` / `.seg button.on` | `styles.css:2021` |
| Hub tier tabs | `.hub-tabs` / `.hub-tab.active` | `styles.css:4115` |
| Drawer / modal | `.sheet` (right, 480px) + `.sheet-head/-body/-foot`; `.modal` | `styles.css:1688-1735` |
| Charts | `SeriesChart`, `PaymentMix`, `Pivot` trio | `ventas-report.jsx:70-443` |
| Rail | `.side` 3-zone (head / scrolling `.side-nav` / pinned `.side-foot`) | `styles.css:231+` |

Charts key colors off `--merchant-brand` (runtime-injected per tenant) + `--success` /
`--danger`. Money always `--font-mono` + `tabular-nums`.

## 3. Conventions

- **Class for shell/atoms; inline styles for screen composition**, always via
  `var(--token)`.
- `.fade-up` is a no-op; arrival animation is opacity-only on `.screen-body`
  (transform avoided so it can't break `position:fixed` sheets).
- **Breakpoints:** 1180 (rail→210), **1080** (rail→drawer, money-hub grids stack,
  tables scroll in `.card:has(>table)`, topbar sticky), 900, **720** (14px gutter),
  **640**.
- Rail scrollbar uses `--side-text-3`; panel scrollbars `--line-strong`.
- **Lingui**: Spanish source, English catalog; `Trans`/`useLingui`/`msg`. The
  `lingui/no-unlocalized-strings` lint is an **error gate** — every literal must be
  wrapped or CI fails.

## 4. Landmines — consolidate, don't propagate

1. **KPI is re-implemented 7×** and off-spec (local `Kpi`/`Metric`/`Stat` use mono 24 +
   radius 14, vs the CSS `.kpi` display-44/`--r-card`): `ventas-report.jsx:24`,
   `recibos.jsx:41`, `reembolsos.jsx:31`, `customers.jsx:251`, `registros.jsx:19`,
   `caja-turnos.jsx:56`. **Reportes should introduce ONE shared KPI component and
   migrate to it — do not add an 8th.**
2. **StatusPill duplicated 3×** (`caja-turnos.jsx:87`, `recibos.jsx:73`,
   `registros.jsx:50`). **Use `.badge-*`, not a new `color-mix` pill.**
3. **Undefined tokens in use:** `--surface-2` (→ transparent) and `--font-sans` at
   `ventas-report.jsx:383,394,415`. **Use `--surface`/`--canvas-2` and `--font-body`.**
4. **Brand-name drift:** token is `--tenant-brand`, screens use runtime
   `--merchant-brand`, and `cash-shifts.jsx:10` hardcodes `#0F5BFF`. **Standardize on
   `--merchant-brand`.**
5. **Ad-hoc radii** (literal 10/12/14) — prefer the radius tokens.
6. **Three segmented-control patterns** — for Reportes use `.seg` (view toggle) +
   `.hub-tabs` (hub tier) only; don't add a `btn-sm` group.
7. **Login re-defines the brand blue** (`#0071e3`/`#2997ff`, `styles.css:3574`) — a
   scoped exception; don't copy it.

**Net:** the earlier worry "no design system → I'll drift generic" was wrong. The fix
is **consolidation to the existing tokens/components**, and Reportes is a good place to
retire the duplicated KPI/pill patterns rather than add to them.
