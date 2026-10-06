# ONCA's menu, translated into Umi's catalog

Status: `APPLIED AS A MIGRATION, AWAITING CONFIRMATION FROM THE CLIENT`.
Client: ONCA (a café — merchant not present in the platform before 2026-10-06).
Last updated: 2026-10-06.

Source: the till's own database, recovered on 2026-10-05 from the borrowed package
(`com.bryajam.panpilot.trial6`, "ONCA POS 14", table `products`, 64 rows) and exported to
`~/umi-parrot-backup/2026-10-05/onca-pos-db/` as `products.csv`, `catalog-import.csv`,
`catalog-import.json`, plus the operational tables (`orders`, `daily_closures`,
`cash_openings`, `cash_withdrawals`, `drawer_events`).

Where it landed: `docs/migration/build-v3/migrations/002_onca_onboarding.sql`. The physical
side of the same package is `UMIPOS_SITE_DEVICE_INVENTORY.md`; what the package does when the
Internet is down is `ONCA_OFFLINE_FIRST_DESIGN.md`.

## 1. The shape of the change

The legacy till carried **five categories** because a drink's temperature was a category of
its own, with its own price:

| Legacy category | Items | What it actually was                                  |
| --------------- | ----- | ----------------------------------------------------- |
| `Pan`           | 21    | A real category                                       |
| `Calientes`     | 13    | Hot **style** of 11 drinks, plus 2 hot-only drinks    |
| `Frío`          | 21    | Cold **style** of 11 drinks, plus 10 cold-only drinks |
| `Nube`          | 4     | "Cloud" style (blended/over-ice) of 3 drinks, plus 1  |
| `Pizza`         | 5     | A real category                                       |

64 rows, but only **51 distinct products**: 13 of those rows were the same drink sold under a
different style, at a different price. The legacy till knew this — its daily closures name a
line `Frío · Latte` and `Nube · Coldbrew`, i.e. _style · product_, not _category of its own_.

Umi has a real home for that: `merchant.product_variant`, a sellable form of one product with
its own `price_delta`, its own availability and its own display order. So the translation is

    5 categories × 64 rows     →     3 categories × 51 products × 24 variants

and the price that used to be a category's price is now a variant's delta over the product's
base price:

| Product   | `price` | Variant                | `price_delta`     | Sells at        |
| --------- | ------- | ---------------------- | ----------------- | --------------- |
| Americano | $50.00  | Caliente               | +$0.00            | $50.00          |
| Americano | $50.00  | Frío                   | +$10.00           | $60.00          |
| Matcha    | $70.00  | Caliente / Frío / Nube | +$0 / +$10 / +$20 | $70 / $80 / $90 |

### The variants, and why this is not an option group

Umi has two ways to model "Caliente or Frío": a **variant** (a different sellable form of the
product) and a **required option group** (`product_option_group` with `min_select = 1`). The
import's own JSON used an option group named `Estilo`.

Variants won, for three reasons:

1. **The barista picks it before the line exists.** A variant is chosen when the product is
   added; an option group is edited inside the cart line. "Americano, then Frío" is one tap
   shorter as a variant, and the till queue is where that matters.
2. **Availability is per form.** A café can be out of cold brew and still sell the hot one.
   `product_variant` carries availability; a modifier does not.
3. **Reporting.** The style ends up on `order_item.variant_name`, which is what a
   "how much cold vs hot" question reads. As a modifier it would only exist in the modifier
   rows.

The option group shape stays available if ONCA would rather have it — it is one migration
either way — but the default is the one that matches how they already sold.

## 2. The three categories

| Umi category | Products | Colour    | Legacy categories folded in |
| ------------ | -------- | --------- | --------------------------- |
| `Pan`        | 21       | `#f58231` | `Pan`                       |
| `Bebidas`    | 25       | `#4363d8` | `Calientes`, `Frío`, `Nube` |
| `Pizzas`     | 5        | `#e6194b` | `Pizza`                     |

The colours come from the palette the schema ships (`product_category.color`). They matter
because the POS paints the tint behind every photo-less product, and the column's default is
**random** — leaving it unset would give the barista a different colour on every install.

## 3. The full catalog

Prices in MXN, IVA included, as the legacy till charged them.

### Pan (21)

| Product           | Price | Prep |
| ----------------- | ----- | ---- |
| Croissant         | 45    | —    |
| Peppe             | 70    | —    |
| Dona de azucar    | 50    | —    |
| Chocolatin        | 60    | —    |
| Peinado           | 80    | —    |
| Danesa            | 50    | —    |
| Coyota            | 35    | —    |
| Trenza fresa      | 50    | —    |
| Trenza cajeta     | 50    | —    |
| Roll              | 50    | —    |
| Dona de chocolate | 60    | —    |
| Dona de cajeta    | 50    | —    |
| Burgir pack       | 65    | —    |
| Dona Limon        | 60    | —    |
| Coricos pack      | 30    | —    |
| Oreja             | 35    | —    |
| Barra MM          | 130   | —    |
| Hogaza MM         | 120   | —    |
| Chocorico         | 10    | —    |
| Concha            | 45    | —    |
| Pan de muerto     | 45    | —    |

### Bebidas (25)

| Product                 | Base | Variants                          | Prep |
| ----------------------- | ---- | --------------------------------- | ---- |
| Espresso                | 50   | —                                 | ✓    |
| Americano               | 50   | Caliente +0 · Frío +10            | ✓    |
| Capuccino               | 60   | —                                 | ✓    |
| V60                     | 80   | Caliente +0 · Frío +0             | ✓    |
| Aeropress               | 80   | Caliente +0 · Frío +0             | ✓    |
| Prensa                  | 80   | —                                 | ✓    |
| Origami                 | 80   | Caliente +0 · Frío +0             | ✓    |
| Moca                    | 70   | Caliente +0 · Frío +10 · Nube +20 | ✓    |
| Capuccino de olla       | 60   | —                                 | ✓    |
| Dirty chai              | 70   | Caliente +0 · Frío +20            | ✓    |
| Carajillo               | 130  | Caliente +0 · Frío +0             | ✓    |
| Chai                    | 60   | Caliente +0 · Frío +10            | ✓    |
| Matcha                  | 70   | Caliente +0 · Frío +10 · Nube +20 | ✓    |
| Latte                   | 80   | Frío +0 · Nube +10                | ✓    |
| Cold brew               | 80   | Frío +0 · Nube +10                | ✓    |
| Americano limón natural | 80   | —                                 | ✓    |
| Americano limón mineral | 90   | —                                 | ✓    |
| Amanecer                | 90   | —                                 | ✓    |
| Té con jazmín           | 50   | —                                 | ✓    |
| Kombucha kiwi           | 50   | —                                 | —    |
| Kombucha manzana        | 50   | —                                 | —    |
| Kombucha mango          | 50   | —                                 | —    |
| Kombucha lichi          | 50   | —                                 | —    |
| Kombu Fresa             | 50   | —                                 | —    |
| Kombu Mandarina         | 50   | —                                 | —    |

### Pizzas (5)

| Product                   | Price | Prep |
| ------------------------- | ----- | ---- |
| Margarita                 | 220   | ✓    |
| Pepperoni con champi      | 250   | ✓    |
| Pepperoni sin champi      | 250   | ✓    |
| Tocino con queso de cabra | 250   | ✓    |
| Mitad y mitad             | 250   | ✓    |

## 4. Two decisions inside the catalog

### `requires_preparation`: what reaches a screen

`requires_preparation` is what makes a line a kitchen line at all — `resolveKitchenRoutes`
returns nothing for a line whose product does not require preparation, unless a route names
that product or its category explicitly.

- **Pan is `false`.** It comes out of the case. A ticket for a croissant is noise on the bar
  screen.
- **Bottled kombucha is `false`.** Six items (`Kombucha kiwi/manzana/mango/lichi`,
  `Kombu Fresa`, `Kombu Mandarina`) are opened, not made.
- **Everything else at the bar and all five pizzas are `true`.** 24 products in total.

Routing is then two rows, in `002`:

| Route                             | Station            | Effect                                                        |
| --------------------------------- | ------------------ | ------------------------------------------------------------- |
| default (no product, no category) | `Barra`            | Every line that requires preparation and matches nothing else |
| category `Pizzas`                 | `Cocina de pizzas` | The five pizzas, by category precedence                       |

The reason the bar is a **default** route and not a `Bebidas` **category** route is the
kombucha. `kitchen_route_category_uidx` makes a category route reach _every_ product in the
category, so routing `Bebidas` by category would put a bottled kombucha on the bar screen
next to the espresso. Routing by default leaves it off, and a drink added later with
`requires_preparation = true` still reaches the bar with no extra configuration.

Preparation targets: 900 s for pizzas, 300 s for everything else.

### Name collisions were the whole reason for (category, name)

The legacy catalog has `Americano` twice, `Latte` twice, `Moca` three times. They are now one
product with variants — but the guard that makes `002` re-runnable keys on
**(category, name)**, not on name alone, and that is deliberate: `merchant.product` has no
unique index on the name and should not have one, because a café may sell a bottled
"Americano" beside the one from the bar. Keying the guard on the name would make the second
apply silently insert nothing.

## 5. Evidence that the translation is faithful

The recovered `daily_closures` record real sales on 2026-10-01 → 10-03 with the legacy till's
own naming (`Calientes · Americano`, `Frío · Matcha`, `Nube · Coldbrew`). Dividing each line's
total by its units recovers the price actually charged, and every one of them lands on the
base price plus the variant delta above:

| Legacy line             | Units | Total | Per unit | Umi                        |
| ----------------------- | ----- | ----- | -------- | -------------------------- |
| `Calientes · Americano` | 2     | 100   | 50       | Americano + Caliente (+0)  |
| `Frío · Moca`           | 3     | 240   | 80       | Moca + Frío (+10)          |
| `Frío · Chai`           | 2     | 140   | 70       | Chai + Frío (+10)          |
| `Frío · Dirty chai`     | 1     | 90    | 90       | Dirty chai + Frío (+20)    |
| `Frío · Matcha`         | 1     | 80    | 80       | Matcha + Frío (+10)        |
| `Nube · Matcha`         | 1     | 90    | 90       | Matcha + Nube (+20)        |
| `Frío · Latte`          | 2     | 160   | 80       | Latte + Frío (+0)          |
| `Nube · Latte`          | 1     | 90    | 90       | Latte + Nube (+10)         |
| `Nube · Coldbrew`       | 1     | 90    | 90       | Cold brew + Nube (+10)     |
| `Calientes · Espresso`  | 4     | 200   | 50       | Espresso (no variant)      |
| `Frío · Té con jazmín`  | 3     | 150   | 50       | Té con jazmín (no variant) |
| `Frío · Kombucha kiwi`  | 1     | 50    | 50       | Kombucha kiwi (no variant) |

## 6. What still needs a human answer

1. **The IVA.** The recovered import carries 16% and the source itself flags it as
   "`taxRateBasisPoints` a confirmar". Confirm the rate, and confirm that the menu price is
   the gross price (that is what the migration assumes, and what a Mexican menu usually
   means). This decides what an invoice prints, not what the till charges.
2. **`Barra MM` and `Hogaza MM`.** Both look like take-away formats of a "media" loaf;
   nobody has confirmed what `MM` stands for. They are carried verbatim.
3. **Pizza modifiers.** The recovered pizza rows carry no option groups, but a café that
   sells "Mitad y mitad" usually has add-ons (extra cheese, orégano). None were in the data.
4. **The tap list.** The 25 bar products are one screen. Grouping them (Espresso bar / Fría /
   Sin preparación) is a dashboard change, not a migration one, and it is the first thing a
   barista will ask for.
5. **Whether `Bebidas` should split.** "Bebidas" now holds espresso, tea and bottled
   kombucha. That is a real category for reporting and a mushy one for a menu screen.
6. **The legacy PIN and handheld key** recovered from the app's preferences stay in the
   backup folder. They are secrets, they are not needed after cutover, and nothing should
   commit them.

## 7. How to apply it, and how to check it

```bash
# Against a target, once.
psql -v ON_ERROR_STOP=1 -f docs/migration/build-v3/migrations/002_onca_onboarding.sql

# Twice, which is the rule (it must change nothing the second time).
psql -v ON_ERROR_STOP=1 -f docs/migration/build-v3/migrations/002_onca_onboarding.sql

# What it wrote.
psql -c "select c.name, count(*) from merchant.product p
           join merchant.product_category c on c.id = p.category_id
           join merchant.merchant m on m.id = p.merchant_id and m.handle = 'onca'
          group by c.name order by c.name"
```

Expected: `Bebidas 25`, `Pan 21`, `Pizzas 5`, 24 variants, 2 stations, 2 kitchen routes —
the same counts on a first and a second apply.
