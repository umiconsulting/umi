# POS menu option-groups — split & cleanup report (Kalala)

- Date: 2026-09-05
- Context: audit F1 asked to turn combined modifier chips into grouped single-select
  dimensions. The POS UI now honours option-group metadata (`required`,
  `minSelections`, `maxSelections`), so a well-structured menu renders as clean
  grouped selectors. See [barista POS UX audit](2026-09-05-barista-pos-ux-audit.md).
- Done: **Americano** was split as the reference — one combined "Opciones" group
  (12 compound options) became three required single-select groups **Tamaño /
  Temperatura / Tipo de leche** with additive prices. Verified live: 7 grouped
  chips, correct pricing (GDE·Frappe·1oz = $75.00), cart shows the three choices.
  Script: `scratchpad/split-americano-options.sql`.
- This report covers the **other 41 products**, which are **not** safe to
  auto-split yet — they need a data cleanup first.

## 1. Why the rest is not a one-click migration

Each product's "Opciones" group is a flattened cartesian product, but the tokens
are inconsistent and the prices are only near-additive. Three blockers:

1. **The dimensions are not uniform across products.** Part 2 of the comma name
   is a temperature for coffees (`Caliente/Frappe/Rocas`) but a flavour or foam
   for others (`Caramelo`, `Pumpkin`, `Choc Blanco`, `Foam Coco`, `Mineral`).
   A positional split would put unrelated values in one "Temperatura" group.
2. **The same value exists in several casings/spellings** (see §3). Splitting
   before merging these creates duplicate options (three "Avena" chips).
3. **Prices are near-additive, not exactly additive.** Decomposing into
   per-dimension deltas changes the price of the non-additive combos. Americano
   had one such combo (`GDE·CALIENTE·normal` was $11.00 vs the additive $10.00 —
   a likely typo). Every product needs its per-dimension prices confirmed.

The correct fix is a menu-editor task with the owner: normalise the tokens,
confirm what each dimension is, set per-dimension prices, then split. The POS is
already ready to render the result.

## 2. Product inventory (41 remaining)

**3-dimension products (32)** — option counts in parentheses. A clean grid is
`2 sizes × N temps × M milks`; counts far from that signal extra/irregular
dimensions.

Caramelo Kafe (30), Caramelo vainilla (30), Chai (30), Chocofresa (30),
Chocolate (30), Dirty Chai (30), DIRTY TARO (30), KIDS (15), Latte Regular (20),
Lavanda Latte (30), Limonada (24), Mascabado Latte (30), Matcha Blanco (30),
**Matcha Foam (40)**, Matcha Latte (30), Matcha Lavanda (30), Matcha Mascabado
(30), Matcha Pumpkin Spice Latte (30), Matcha Rosa (30), Matcha Salted Caramel
(30), Matcha Sugar Free (30), Matcha Vainilla (30), Moka (30), Moka Blanco (30),
Pumpkin Spice Latte (30), Rosa Latte (30), Salted Caramel (30), **SHAKEN
ESPRESSO (90)**, SMORE'S (30), Sugar Free Latte (30), TARO (30), Vainilla Latte
(30).

**2-dimension products (9):** Americano Limón (4), Capuccino (10), Chapata (4),
Cold Brew (6), Matcha Agua (6), SMOOTHIES DE PROTEINA (8), Te Lavanda Manzanilla
(4), Tisana (6), **VASO DOBLE REDONDO (99)**.

**Outliers to review by hand:** `VASO DOBLE REDONDO` (99 options, 2 parts),
`SHAKEN ESPRESSO` (90), `Matcha Foam` (40). Their grids are actually **complete**
(every combination is priced — see §6), but they carry many dimension values or
an irregular structure, so confirm the dimensions and prices before splitting.

## 3. Token normalisation map (do this first)

The same option value appears in multiple casings. Merge each cluster to one
canonical spelling before splitting, or the split produces duplicate chips. The
comma **position does not map to a fixed role** across products (position 1 is
`CH`/`GDE` size on lattes but a flavour or name — `CHAI`, `TARO`,
`MOZZARELLA Y PESTO` — on others; see the full vocabulary in §5), but these
case/spelling merges are valid regardless of the role.

**Milk / part 3** (uses):

| Canonical      | Raw variants found                         | Uses |
| -------------- | ------------------------------------------ | ---- |
| Almendra       | almendra · Almendra · ALMENDRA             | 186  |
| Avena          | avena · Avena · AVENA                       | 192  |
| Coco           | coco · Coco · COCO                          | 192  |
| Deslactosada   | deslactosada · Deslactosada · DESLACTOSADA | 180  |
| Lavanda        | Lavanda · LAVANDA                          | 7    |
| Soya           | soya · Soya · SOYA                          | 192  |

Also seen elsewhere: `deslctosada` (missing "a" — a genuine typo, fix to
`Deslactosada`).

**Temperature / part 2** (uses):

| Canonical | Raw variants found  | Uses |
| --------- | ------------------- | ---- |
| Caliente  | Caliente · CALIENTE | 281  |
| Frappe    | Frappe · FRAPPE     | 289  |
| Rocas     | Rocas · ROCAS       | 279  |
| Natural   | Natural · NATURAL   | 24   |
| Mineral   | Mineral · MINERAL   | 14   |

## 4. Recommended sequence

1. **Normalise tokens** (§3) across all combined options — one casing/spelling
   per value.
2. **Per product, confirm the dimensions** — which comma-position is size, temp,
   flavour, milk — and rename them (`Tamaño`, `Temperatura`, `Tipo de leche`, or
   a product-specific name). Groups render alphabetically by name, so name them
   so the order reads naturally (as done for Americano: Tamaño < Temperatura <
   Tipo de leche).
3. **Confirm per-dimension prices** — §6 gives each product's additive
   decomposition; **32 of 41 products are cleanly additive** and ready to split
   once tokens are normalised. The **9 with non-additive combos** (Rosa Latte,
   SHAKEN ESPRESSO, Matcha Blanco, Pumpkin Spice Latte, DIRTY TARO, Chocolate,
   Lavanda Latte, Moka Blanco, Tisana) need an owner decision on the off-pattern
   prices first — several look like data-entry errors (e.g. Chocolate's
   `CH·Rocas·Soya` at −$66.00, milks priced as a −$12.00 discount).
4. **Split**, per the Americano template (`scratchpad/split-americano-options.sql`):
   set each new group `min_select=1, max_select=1`; the POS renders required
   single-select automatically.
5. **Handle the large/irregular products by hand** (§2) — their grids are
   complete but carry many or mixed dimensions; confirm structure and prices.

Best done in a menu editor rather than raw SQL, because steps 2-3 are business
decisions, not mechanical transforms.

The full data behind these steps: **§5** is the complete normalised token
vocabulary per position; **§6** is every product's dimensions, additive
per-dimension deltas, and flagged non-additive combos.

## 5. Full token vocabulary (normalised)

The distinct option values at each comma position, across all 41 products, after
case/spelling normalisation. The position does **not** carry a fixed meaning — it
is size on lattes, a flavour or a product name on others — so treat these as the
raw vocabulary to clean, not three tidy dimensions.

**Position 1** (17 distinct): CH · GDE · CHAI · CHOCO FRESA · CHOCOLATE · COLD BREW · COLDBREW FOAM · HORCHATA KAFE · LATTE · LIMONADA · MATCHA · MATCHATA · TARO · HABITS · ISOPURE · MOZZARELLA Y PESTO · SALAMI Y CHIPOTLE

**Position 2** (40 distinct): Frappe · Caliente · Rocas · Natural · Mineral · MATCHA · FRIO · CHAI · CHOCO FRESA · CHOCOLATE · COLDBREW · COLDBREW FOAM · LATTE · LIMONADA · TARO · CARAMELO · CHOC BLANCO · Foam Coco · Foam otro · Foam sin Jarabe · Foam Vainilla · JARABE COCO · MASCABADO · OTRO · PUMPKIN · SIN JARABE · VAINILLA · almendra · avena · CACAO · CAFE · coco · deslactosada · GOLDEN MILK · no chipotle · NORMAL · PUMPKIN FOAM · si chipotle · soya · VAINILLA FOAM

**Position 3** (17 distinct): Avena · Coco · Soya · Almendra · Deslactosada · Lavanda · Alemendra · Deslactodasa · Cherry · Frambuesa · Matcha · Rosas · Simple · CARAMELO · CHOCOLATE BLANCO · ROSA · VAINILLA

Note the typos still present even after case-folding: `Alemendra` (→ Almendra)
and `Deslactodasa` (→ Deslactosada) in position 3.

## 6. Per-product structure & additive price decomposition

For each product: the normalised dimension values, whether the grid is complete
(all combinations priced), and the additive per-dimension deltas (reference = the
first value of each dimension = +$0.00). **Non-additive** combos are where the
real price differs from the additive prediction — those prices need an explicit
owner decision before splitting, and several are clearly data-entry errors (e.g.
Pumpkin Spice Latte's `GDE·Frappe·Almendra` at **+$1026.00**, DIRTY TARO's
`Deslactosada` combos at **+$100+**, Chocolate's `CH·Rocas·Soya` at **−$66.00**).

### 6.0 Summary

| Product | Dims | Options | Grid | Non-additive | Casing conflicts |
| --- | --- | --- | --- | --- | --- |
| Americano Limón  | 2 | 4 | complete | 0 | — |
| Capuccino | 2 | 10 | complete | 0 | — |
| Caramelo Kafe | 3 | 30 | complete | 0 | — |
| Caramelo vainilla | 3 | 30 | complete | 0 | — |
| Chai | 3 | 30 | complete | 0 | — |
| Chapata | 2 | 4 | complete | 0 | — |
| Chocofresa | 3 | 30 | complete | 0 | — |
| Chocolate | 3 | 30 | complete | 1 | — |
| Cold Brew | 2 | 6 | complete | 0 | — |
| DIRTY TARO | 3 | 30 | complete | 2 | — |
| Dirty Chai | 3 | 30 | complete | 0 | — |
| KIDS | 3 | 15 | complete | 0 | — |
| Latte Regular | 3 | 20 | complete | 0 | — |
| Lavanda Latte | 3 | 30 | complete | 1 | — |
| Limonada | 3 | 24 | complete | 0 | — |
| Mascabado Latte | 3 | 30 | complete | 0 | — |
| Matcha Agua | 2 | 6 | complete | 0 | — |
| Matcha Blanco | 3 | 30 | complete | 9 | — |
| Matcha Foam | 3 | 40 | complete | 0 | — |
| Matcha Latte | 3 | 30 | complete | 0 | — |
| Matcha Lavanda | 3 | 30 | complete | 0 | — |
| Matcha Mascabado | 3 | 30 | complete | 0 | — |
| Matcha Pumpkin Spice Latte | 3 | 30 | complete | 0 | — |
| Matcha Rosa | 3 | 30 | complete | 0 | — |
| Matcha Salted Caramel | 3 | 30 | complete | 0 | — |
| Matcha Sugar Free | 3 | 30 | complete | 0 | — |
| Matcha Vainilla | 3 | 30 | complete | 0 | — |
| Moka | 3 | 30 | complete | 0 | — |
| Moka Blanco | 3 | 30 | complete | 1 | — |
| Pumpkin Spice Latte | 3 | 30 | complete | 3 | — |
| Rosa Latte | 3 | 30 | complete | 11 | — |
| SHAKEN ESPRESSO | 3 | 90 | complete | 13 | — |
| SMOOTHIES DE PROTEINA | 2 | 8 | complete | 0 | — |
| SMORE'S | 3 | 30 | complete | 0 | — |
| Salted Caramel | 3 | 30 | complete | 0 | — |
| Sugar Free Latte | 3 | 30 | complete | 0 | — |
| TARO | 3 | 30 | complete | 0 | — |
| Te Lavanda Manzanilla | 2 | 4 | complete | 0 | — |
| Tisana | 2 | 6 | complete | 1 | — |
| VASO DOBLE REDONDO | 2 | 99 | complete | 0 | — |
| Vainilla Latte | 3 | 30 | complete | 0 | — |

### Americano Limón  — base $78.00, 2 dims, 4 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Mineral (+$0.00) · Natural (−$2.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Capuccino — base $63.00, 2 dims, 10 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: almendra (+$0.00) · avena (+$0.00) · coco (+$0.00) · deslactosada (−$12.00) · soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Caramelo Kafe — base $75.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$4.00) · Rocas (+$4.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Caramelo vainilla — base $87.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$4.00) · Rocas (+$4.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Chai — base $78.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$12.00) · Rocas (+$12.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Chapata — base $95.00, 2 dims, 4 options (complete)

- Dim 1: MOZZARELLA Y PESTO (+$0.00) · SALAMI Y CHIPOTLE (+$0.00)
- Dim 2: no chipotle (+$0.00) · si chipotle (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Chocofresa — base $78.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$12.00) · Rocas (+$12.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Chocolate — base $78.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$12.00) · Rocas (+$12.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ⚠ Non-additive combos (1): CH·Rocas·Soya: real −$66.00 vs additive $24.00

### Cold Brew — base $80.00, 2 dims, 6 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: NORMAL (+$0.00) · PUMPKIN FOAM (+$20.00) · VAINILLA FOAM (+$15.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### DIRTY TARO — base $95.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$12.00) · FRIO (+$12.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ⚠ Non-additive combos (2): CH·Frappe·Deslactosada: real $102.00 vs additive $12.00; GDE·Caliente·Deslactosada: real $100.00 vs additive $10.00

### Dirty Chai — base $95.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$12.00) · Rocas (+$12.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### KIDS — base $65.00, 3 dims, 15 options (complete)

- Dim 1: CH (+$0.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$5.00) · Rocas (+$5.00)
- Dim 3: CARAMELO (+$0.00) · CHOCOLATE BLANCO (+$0.00) · Lavanda (+$0.00) · ROSA (+$0.00) · VAINILLA (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Latte Regular — base $67.00, 3 dims, 20 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Frappe (+$0.00) · Rocas (+$0.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Lavanda Latte — base $75.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$4.00) · Rocas (+$4.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ⚠ Non-additive combos (1): GDE·Frappe·Deslactosada: real $26.00 vs additive $14.00

### Limonada — base $78.00, 3 dims, 24 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Mineral (+$0.00) · Natural (+$0.00)
- Dim 3: Cherry (+$0.00) · Frambuesa (+$0.00) · Lavanda (+$0.00) · Matcha (+$10.00) · Rosas (+$0.00) · Simple (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Mascabado Latte — base $75.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$4.00) · Rocas (+$4.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Matcha Agua — base $70.00, 2 dims, 6 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$5.00) · Rocas (+$5.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Matcha Blanco — base $104.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$10.00) · Rocas (+$10.00)
- Dim 3: Alemendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ⚠ Non-additive combos (9): GDE·Frappe·Alemendra: real $20.00 vs additive $32.00; GDE·Frappe·Avena: real $20.00 vs additive $32.00; GDE·Frappe·Coco: real $20.00 vs additive $32.00; GDE·Frappe·Deslactosada: real $8.00 vs additive $20.00; GDE·Frappe·Soya: real $20.00 vs additive $32.00; GDE·Rocas·Alemendra: real $20.00 vs additive $32.00 (+3 more)

### Matcha Foam — base $120.00, 3 dims, 40 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Foam Coco (+$0.00) · Foam otro (+$0.00) · Foam sin Jarabe (+$0.00) · Foam Vainilla (+$0.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Matcha Latte — base $80.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$10.00) · Rocas (+$10.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Matcha Lavanda — base $92.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$10.00) · Rocas (+$10.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Matcha Mascabado — base $92.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$10.00) · Rocas (+$10.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Matcha Pumpkin Spice Latte — base $107.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$10.00) · Rocas (+$10.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Matcha Rosa — base $92.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$10.00) · Rocas (+$10.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Matcha Salted Caramel — base $107.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$10.00) · Rocas (+$10.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactodasa (−$12.00) · Soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Matcha Sugar Free — base $92.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$10.00) · Rocas (+$10.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Matcha Vainilla — base $92.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$10.00) · Rocas (+$10.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Moka — base $95.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$12.00) · Rocas (+$12.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Moka Blanco — base $87.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$4.00) · Rocas (+$4.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ⚠ Non-additive combos (1): GDE·Rocas·Deslactosada: real $26.00 vs additive $14.00

### Pumpkin Spice Latte — base $91.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$4.00) · Rocas (+$4.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ⚠ Non-additive combos (3): GDE·Frappe·Almendra: real $1026.00 vs additive $26.00; GDE·Frappe·Avena: real $1026.00 vs additive $26.00; GDE·Frappe·Coco: real $1026.00 vs additive $26.00

### Rosa Latte — base $75.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (−$2.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$4.00) · Rocas (+$4.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ⚠ Non-additive combos (11): GDE·Caliente·Deslactosada: real $10.00 vs additive −$2.00; GDE·Frappe·Almendra: real $26.00 vs additive $14.00; GDE·Frappe·Avena: real $26.00 vs additive $14.00; GDE·Frappe·Coco: real $26.00 vs additive $14.00; GDE·Frappe·Deslactosada: real $14.00 vs additive $2.00; GDE·Frappe·Soya: real $26.00 vs additive $14.00 (+5 more)

### SHAKEN ESPRESSO — base $66.00, 3 dims, 90 options (complete)

- Dim 1: CH (+$0.00) · GDE (−$12.00)
- Dim 2: CARAMELO (+$0.00) · CHOC BLANCO (+$0.00) · JARABE COCO (+$0.00) · MASCABADO (+$0.00) · Natural (+$0.00) · OTRO (+$0.00) · PUMPKIN (+$0.00) · SIN JARABE (+$0.00) · VAINILLA (+$0.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ⚠ Non-additive combos (13): GDE·CARAMELO·Deslactosada: real $0.00 vs additive −$12.00; GDE·CHOC BLANCO·Deslactosada: real $0.00 vs additive −$12.00; GDE·JARABE COCO·Deslactosada: real $0.00 vs additive −$12.00; GDE·MASCABADO·Deslactosada: real $0.00 vs additive −$12.00; GDE·Natural·Deslactosada: real $0.00 vs additive −$12.00; GDE·OTRO·Deslactosada: real $0.00 vs additive −$12.00 (+7 more)

### SMOOTHIES DE PROTEINA — base $115.00, 2 dims, 8 options (complete)

- Dim 1: HABITS (+$0.00) · ISOPURE (−$10.00)
- Dim 2: CACAO (+$0.00) · CAFE (−$15.00) · GOLDEN MILK (−$10.00) · MATCHA (−$15.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### SMORE'S — base $76.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$10.00) · Rocas (+$10.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$10.00) · Soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Salted Caramel — base $91.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$4.00) · Rocas (+$4.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Sugar Free Latte — base $75.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$4.00) · Rocas (+$4.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### TARO — base $78.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$12.00) · Rocas (+$12.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Te Lavanda Manzanilla — base $62.00, 2 dims, 4 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · FRIO (+$8.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Tisana — base $66.00, 2 dims, 6 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$7.00) · Rocas (+$7.00)
- ⚠ Non-additive combos (1): GDE·Frappe: real $16.00 vs additive $17.00

### VASO DOBLE REDONDO — base $190.00, 2 dims, 99 options (complete)

- Dim 1: CHAI (+$0.00) · CHOCO FRESA (+$0.00) · CHOCOLATE (+$0.00) · COLD BREW (+$0.00) · COLDBREW FOAM (+$0.00) · HORCHATA KAFE (+$0.00) · LATTE (+$0.00) · LIMONADA (+$0.00) · MATCHA (+$0.00) · MATCHATA (+$0.00) · TARO (+$0.00)
- Dim 2: CHAI (+$0.00) · CHOCO FRESA (+$0.00) · CHOCOLATE (+$0.00) · COLDBREW (+$0.00) · COLDBREW FOAM (+$0.00) · LATTE (+$0.00) · LIMONADA (+$0.00) · MATCHA (+$0.00) · TARO (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.

### Vainilla Latte — base $75.00, 3 dims, 30 options (complete)

- Dim 1: CH (+$0.00) · GDE (+$10.00)
- Dim 2: Caliente (+$0.00) · Frappe (+$4.00) · Rocas (+$4.00)
- Dim 3: Almendra (+$0.00) · Avena (+$0.00) · Coco (+$0.00) · Deslactosada (−$12.00) · Soya (+$0.00)
- ✅ Cleanly additive — the deltas above reproduce every combo; ready to split.
