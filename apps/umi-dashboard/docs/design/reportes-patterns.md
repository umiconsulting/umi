# Reportes — UI Patterns & States Reference

Mobile-first, buildable patterns for Reportes. Primary user: owner on a smartphone.
Secondary: shift-scoped manager. Breakpoints `≤640` (phone, 1 col) / `≤1080` (tablet) /
`>1080` (desktop). UI copy is Spanish, plain language / ETS; money `$#,###.00`, tabular.
Companion to [`reportes-design-system.md`](./reportes-design-system.md) (the tokens to
build these with) and [`reportes-moodboard.md`](./reportes-moodboard.md).

## 1. Answer-first layout (glance reports, e.g. Ventas)

One column on the phone, inverted pyramid — the answer, then the evidence:

1. Filter + compare bar (sticky)
2. **Hero metric** — one number (28–40px), period label, delta chip
3. **One-line AI narrative** (Spanish, ≤140 chars): _"Ayer vendiste $4,820, 12% más que el martes."_
4. KPI tile row (2×2, max 4)
5. Primary chart (trend)
6. Secondary breakdown (payment / **channel** mix)
7. Detail table → cards
8. Export

Hero + delta + narrative must answer "¿vendí más?" with no scroll. Maps to NN/g
Summary → Context → Details.

## 2. KPI / stat-tile anatomy

Label (11–13px, muted) → value (20–28px bold, tabular) → **delta chip** (arrow + sign +
% + comparison word: `▲ 12% vs. ayer`) → optional sparkline (24–32px, no axes).

- Encode delta by **arrow + sign AND color** (never color alone).
- No prior period → `—` / "sin comparativo", never a fake `0%`.
- **Max 4 tiles** above the chart; overflow behind "Ver más"; most important first.
- Tappable tile → hit area ≥44px.
- Build on the shared KPI component (see design-system §4 landmine #1 — retire the 7×
  duplicates, don't add one).

## 3. Chart selection

| Question                                              | Chart                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| Trend over time (ventas por día/hora)                 | Line; area only for one cumulative series                     |
| Composition (mix de pago, **canal**)                  | Stacked horizontal bar; donut only ≤4 slices, direct-labelled |
| Ranking (top productos, por barista)                  | Horizontal bar, sorted desc                                   |
| Day × hour intensity (horas pico)                     | Heatmap (lightness ramp)                                      |
| P&L build-up (bruto → descuentos → reembolsos → neto) | **Waterfall**                                                 |
| One value vs. target                                  | Bullet / progress, not a gauge                                |

Color: ≤5–6 categorical hues; colorblind-safe (blue+orange is safest); vary lightness
not only hue; **encode nothing by color alone** (add order/labels/sign). Sequential
ramp for heatmap, diverging scale for faltante/sobrante (always with `+/−`). Direct-label
instead of a phone legend. Chart marks ≥3:1 contrast. Reuse the `ventas-report.jsx`
chart trio; key colors off `--merchant-brand` + `--success`/`--danger`.

## 4. Table → card (≤640px)

Each row → a card: **title line** (producto / folio / turno + timestamp), then 2–4
`label: value` pairs, key value bold; row actions in an overflow menu; sort/filter as
one control above the list.

Keep a **horizontal-scroll table** only for many-row × many-column comparison (the
**Tabla dinámica** pivot) or a true matrix: wrap in `overflow-x:auto`, freeze the label
column, sticky header, show a scroll cue. Umi mapping: Ventas desglose, Reembolsos por
operador, Turnos, Registros → **cards**; Tabla dinámica → **scroll-table**.

## 5. Filter / date-range / compare bar

Sticky bar shows the selection as chips; tap opens a bottom sheet.

- **Presets first:** Hoy · Ayer · Esta semana · Este mes · Personalizado. Days start at
  the owner's **business-day rollover**, not midnight.
- **Custom range:** two-tap calendar in the sheet.
- **Sucursal:** single-select ("Todas" default); show only if >1 location.
- **Canal:** multi-select chips (POS · WhatsApp · Delivery) — the wedge surface.
- **Compare:** toggle "Comparar vs. período anterior"; default the natural prior (same
  weekday / previous month); state the basis in words.
- **Freshness:** one label — "Actualizado hace X min" / "en tiempo real".

## 6. State matrix (critical)

**Golden rule: distinguish a real zero (there genuinely were no sales) from missing
input (we cannot compute it).** Never render `taxTotal = 0` as "IVA: $0" — in the Kalala
data that is fiction (no IVA/COGS/tips/channel tags exist yet).

| State                          | Show                                                                                                                  | Spanish (ETS)                                                                                                                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Empty / real zero**          | metric + context, not a blank                                                                                         | "No hubo ventas en este periodo. Prueba con otro rango." · "No abriste ningún turno en estas fechas."                                                                                                            |
| **First-run / not configured** | one line + one primary action                                                                                         | "Aún no registras ventas. Cuando cobres en el POS, aquí verás tu resumen."                                                                                                                                       |
| **Needs data (input missing)** | the report frame + a labelled prompt, never a zero                                                                    | IVA: "Falta configurar el IVA de tus productos." → "Configurar IVA" · Margen: "Para ver tu margen, agrega el costo de tus productos." · Canal: "Estamos etiquetando el canal de tus pedidos; disponible pronto." |
| **Loading**                    | skeleton mirroring the final layout for >1s; reserve space (no layout shift); spinner only for small in-place refresh | —                                                                                                                                                                                                                |
| **Error**                      | keep the page frame; inline error card in the failed region only                                                      | "No pudimos cargar este reporte." → "Reintentar"                                                                                                                                                                 |
| **Partial**                    | render what loaded; mark each missing block inline; one failed aggregate never blanks the answer                      | "No pudimos cargar el mix de pagos. Reintentar"                                                                                                                                                                  |

The **AI narrative** is special: on failure, hide the card silently (fail-safe null —
the existing `describe()` pattern). Never show a broken or ungrounded sentence.

## 7. Accessibility + responsive

- **Contrast:** text ≥4.5:1 (≥3:1 large); chart marks / arrows / focus / borders ≥3:1
  (WCAG 1.4.11); never color alone (1.4.1). This is the fix for both north-stars'
  legibility failures.
- **Touch targets:** 44×44 for tiles, chips, card tap zones, presets; ≥8px apart.
- **Focus:** visible 2px ring (≥3:1); logical order; every chart also reachable as a
  data table (text equivalent).
- **es↔en swing (~15–30% longer in Spanish):** no fixed label widths; wrap or truncate
  with tooltip; test the longest string ("Comparar vs. período anterior"); never
  truncate the hero value. Lingui already externalizes strings.
- **Breakpoints:** `≤640` single column, 2×2 tiles, table→cards, filters in a bottom
  sheet, hero+bar sticky. `≤1080` 2-col tiles / chart beside tiles, tables may stay
  tabular. `>1080` full multi-column.

---

**Sources:** NN/g (data tables, mobile tables, empty states, skeleton screens,
response-time limits); Material data-viz; Apple HIG (44pt, charts); Shopify Polaris
(empty state, data table); WCAG 2.2 / WebAIM contrast; Datawrapper (palettes, colorblind
readers); Refactoring UI. Full URLs in the research-swarm transcript for this session.
