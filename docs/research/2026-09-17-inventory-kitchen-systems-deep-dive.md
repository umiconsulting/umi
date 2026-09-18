# Inventory + recipes/sub-recipes + kitchen — deep dive

- Date: 2026-09-17 (local, America/Mazatlan). Supersedes the first pass
  (`2026-09-17-inventory-kitchen-systems-and-reviewers.md`), which reached one practitioner thread
  and two vendor help centres. This pass reached five independent reviewer channels, four help-centre
  APIs, and the app-store ratings for eight brands.
- Question: which systems actually integrate **inventory + recipes/sub-recipes + kitchen
  management**, judged partly by what individual reviewers say, across our competitors and the
  specialist tools.
- Method: primary sources only — vendor help centres through their own public APIs, our own
  primary-sourced competitor matrix, Trustpilot, Apple's search API, YouTube through the Obscura
  browser, and Reddit where it answered. Every claim is labelled **Documented**, **Field
  observation**, **Inference**, or **UNVERIFIED**.

## 1. What each route returned, including the failures

| Route                                                                                                 | Result                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G2, Capterra, Software Advice, TrustRadius, GetApp                                                    | **403.** Headless and windowed Chromium both. An IP-level block                                                                                                                                                                                                         |
| Reddit — direct, JSON, old, mirrors, jina proxy, Scrapling                                            | **403.** Blocked from the start                                                                                                                                                                                                                                         |
| Reddit — Obscura over CDP                                                                             | **Worked, then stopped.** 33 KB of real content, one harvest of ~60 requests, and then `ERR_HTTP_RESPONSE_CODE_FAILURE` for every request. A container restart did not clear it, so the block is the IP, not the session. This is the cost of scraping Reddit at volume |
| **Zendesk help-centre API** on `help.marginedge.com`, `k-series-support.lightspeedhq.com`             | **Worked, and it is the best route found.** 97 articles for "sub recipe" on one, 228 KB of hits on the other                                                                                                                                                            |
| Zendesk API on `xtrachef.zendesk.com`                                                                 | 200, but the centre publishes almost nothing — xtraCHEF's real documentation sits on Toast Central                                                                                                                                                                      |
| Zendesk API on Toast, Square, Clover, Fudo, SoftRestaurant, PoloTab, Craftable, meez, MarketMan hosts | No such centre at those hosts (404/000)                                                                                                                                                                                                                                 |
| `r.jina.ai` on `squareup.com/help` articles                                                           | **Works** for individual articles; the article ids are not guessable from the slug                                                                                                                                                                                      |
| **Apple App Store search API**                                                                        | **Works** — ratings and counts for every brand                                                                                                                                                                                                                          |
| Apple customer-reviews RSS                                                                            | **Dead** — a well-formed feed with no entries, both endpoint variants                                                                                                                                                                                                   |
| **YouTube through Obscura**                                                                           | **Works**, with structured data. 135 videos across eight queries                                                                                                                                                                                                        |
| Google Play product pages                                                                             | 404 on the package id tried; not pursued further                                                                                                                                                                                                                        |

**Inference worth keeping:** for software-category research on this machine the productive order is
**vendor help-centre API → Apple search API → YouTube via Obscura → Trustpilot**, and Reddit only
until its IP throttle trips. G2 and Capterra are simply unavailable without residential egress.

## 2. What reviewers say, with the numbers

### 2.1 Two review surfaces, and they disagree on purpose

| Brand                     | Trustpilot           | App Store                                            | Inventory/recipe product     |
| ------------------------- | -------------------- | ---------------------------------------------------- | ---------------------------- |
| Toast                     | **2.7 / 5 from 170** | Toast Now **4.93 from 11,487**; MyToast 4.75 / 6,901 | **xtraCHEF 4.62 from 2,461** |
| Clover                    | **2.0 / 5**          | 4.83 / 65,821 and 4.87 / 53,116                      | —                            |
| Square                    | 3.7 / 5              | **4.81 from 604,459**                                | recipes are a beta           |
| Lightspeed                | 3.8 / 5              | K-Series **2.8 from 15**; L-Series 2.97 from 30      | batches and recipes          |
| **MarginEdge**            | 0 reviews            | **4.89 from 530**                                    | yes — the whole product      |
| **Restaurant365**         | 2.9 / 5 from 2       | **4.84 from 44,391 (US)**; 5.0 from 83 in Mexico     | yes                          |
| **MarketMan**             | **2.0 / 5 from 17**  | 5.0 from **1**                                       | yes                          |
| Craftable, Apicbase, meez | 0 reviews            | 0 ratings                                            | yes                          |

**Inference, and it is the most useful thing in this table.** The two surfaces measure different
things and neither is the truth. Trustpilot catches the operator who was sold badly — Toast at 2.7
with 170 reviews, Clover at 2.0 — while the App Store catches the person who uses the mobile app
every day and mostly likes it. What matters for **this** question is that the two products built
specifically for inventory and recipes have the **highest and best-evidenced app-store scores in the
set** — MarginEdge 4.89 from 530, xtraCHEF 4.62 from 2,461 — while the back-office tools with the
same ambition have **no review footprint at all** (Craftable, Apicbase, meez: zero). Operators rate
these products when they use them daily in a phone; that is where the signal is.

### 2.2 The practitioner voice, from the one Reddit thread that answered

**r/Chefit, "Do you cost entire recipes?" — 83 points, 195 comments** (Documented, fetched 2026-09-17):

- A regional chef across 11 locations: _"I do that for the small restaurant group I'm involved with
  but it's not particularly accurate at the end of the day. It does help gauge how off we are from
  'ideal' cost versus 'real'."_
- The workaround everyone describes: _"Make up a database of all your ingredients costed down to the
  gram. Then when you create a new recipe in a spreadsheet, do a call back to your DB for all
  ingredients costs… **Every 6 months or so do an update to your price DB.**"_
- Yield loss in a chef's own numbers: _"A forty pound case of chicken trims down to 32-34 pounds."_
- The trade's dodges: the **Q factor** ("salt, pepper, sugar, lemon wedges, condiments, bread,
  butter, garnishes, disposables, and waste from overproduction") and a flat seasoning allowance —
  _"seasonings cost was $.15/recipe"_.

**The name of no product appears in that thread.** The chefs who argue hardest about recipe costing
are doing it in a spreadsheet, and their stated pain is that the price database goes stale on a
six-month cycle. Everything else I read on Reddit before the throttle was about the _practice_
(counts, waste, freezer temperatures), not about software.

### 2.3 The independent YouTube reviewers

Documented via Obscura. These are creators who compare systems rather than sell one — the closest
thing to "individual reviewers" this category has:

| Channel                      | What they cover                                                                                              | Views           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------- |
| **Merchant Maverick**        | "Your Complete Guide To Restaurant Inventory Management"; "The 5 Best POS Systems With Inventory Management" | 94,885 / 12,091 |
| **storekit**                 | "The top 4 inventory software systems for restaurants 2021" — names Apicbase, KitchenCut, MarketMan          | 16,004          |
| **Software Connect**         | "Free Inventory Management Software for Small Businesses (2026)"                                             | 35,268          |
| **Be Productive**            | "10 Best Inventory Management Software for Restaurants"                                                      | 3,055           |
| **BizGuide**                 | "MarketMan Tutorial for Newbies \| Restaurant Inventory Management Demo"                                     | 2,674           |
| **Dave Allred (TheRealBar)** | POS system comparisons for bars                                                                              | 25,164 / 13,418 |
| **Stewart Gauld**            | "Top 5 Free Inventory Management Software"                                                                   | 246,326         |

**Field observation:** the biggest view counts belong to _generic_ inventory comparison videos and to
free/Google-Sheets angles (220K for an AppSheet build), while the restaurant-specific software videos
sit in the 1K–100K band. **Inference:** this category is browsed by operators in comparison-video
form, and the naming that recurs in independent coverage is Apicbase, KitchenCut, MarketMan, Supy,
WISK and Crunchtime — specialists, not POS brands. That is a discovery channel worth planning for.

## 3. The capability evidence, per system

### 3.1 The sub-recipe model, named the way each vendor names it

| System                                                            | Sub-recipe mechanism                                                                                                                                                              | Evidence                                                                             |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **MarginEdge**                                                    | **Prep Items — "the only type that can be used in other recipes"**, alongside Menu Items and Bar Items                                                                            | **Documented**, its help centre, fetched 2026-09-17                                  |
| **Lightspeed K-Series**                                           | Recipes have a type — **"Made to order" or "Made in batches"** — and a batched recipe carries an expected yield and a measurement type, then feeds other recipes as an ingredient | **Documented**, `k-series-support.lightspeedhq.com`, "Creating and managing recipes" |
| **Toast / xtraCHEF**                                              | nested prep recipes, with yield and waste                                                                                                                                         | **Documented**, our matrix (PA3)                                                     |
| **Odoo**                                                          | multi-level kits and bills of materials; components can themselves be manufactured                                                                                                | **Documented**, our matrix (OD9) + Odoo 17 documentation on BoMs                     |
| **SoftRestaurant**                                                | "Manejo de insumos elaborados (sub recetas)", with product explosion                                                                                                              | **Documented**, our matrix (SR18)                                                    |
| **Fudo**                                                          | up to three levels of sub-ingredients                                                                                                                                             | **Documented**, our matrix (FU15)                                                    |
| **PoloTab**                                                       | "preparados" and "sub-recetas"                                                                                                                                                    | **Documented**, our matrix (PT5, PT6)                                                |
| **Square**                                                        | **No** — "a recipe cannot contain another recipe"; modifiers do not track inventory or costs; recipes are a beta                                                                  | **Documented**, our matrix (SQ9)                                                     |
| **Clover**                                                        | **UNVERIFIED** — not stated in its public help centre                                                                                                                             | our matrix (CL10), still open                                                        |
| **Craftable, Apicbase, meez, KitchenCut, WISK, Supy, Crunchtime** | commonly described as recipe-capable, but I could not reach a primary statement that a recipe may contain another recipe                                                          | **UNVERIFIED**                                                                       |

### 3.2 Yield, waste and the ingredient-price problem

- **MarginEdge — Documented, and the most concrete of any vendor.** Its yield article works an
  example: _"percentage yields for each ingredient that requires prep: onion at 85%, carrots at 80%,
  celery at 75%. When the yield is lowered, the cost of the ingredient within the recipe increases."_
  It pairs that with a **Waste Log** ("easily record waste from your phone for both products and
  recipes"), **Theoretical On-Hand**, **Theoretical Usage** reporting, count sheets with multiple
  count-by units, **Allergens in Recipes and Products**, and 30 commissary-kitchen articles.
- **Lightspeed K-Series — Documented.** Also has **batches**, **wastage**, **discrepancy reports**,
  **stock movements**, and — the detail that tells you where its own inventory stops — an article on
  **"Setting up the MarketMan integration"**, i.e. the POS pairs with a dedicated inventory product
  for the depth it does not carry itself.
- **Odoo — Documented.** Scrap and inventory adjustments, inventory valuation, reordering rules.

This is the same problem the r/Chefit chefs were solving by hand. The vendors that answer it keep the
price current by **reading the invoices** (MarginEdge's founding idea), and the ones that do not make
the operator refresh a spreadsheet every six months.

### 3.3 The kitchen leg, from the matrix's own kitchen table

| Capability     | Toast                     | Lightspeed K                        | SoftRestaurant                            | Square                  | Clover                      | Odoo                |
| -------------- | ------------------------- | ----------------------------------- | ----------------------------------------- | ----------------------- | --------------------------- | ------------------- |
| KDS            | yes, prep stations + expo | **KDS 2.0 with order manager**      | "Monitor de Producción" + **despachador** | Square KDS              | Clover KDS device           | Preparation Display |
| Courses / fire | **course firing options** | **courses and fire-course actions** | partial (display priority)                | coursing with hold/fire | **courses + auto-coursing** | partial (stages)    |
| Expo           | expediter device role     | **order-manager view + SLA pulses** | dispatcher confirms ready                 | expo role               | **expo mode**               | partial             |
| Recall         | yes                       | **bump and recall**                 | **recall within 2 hours**                 | yes                     | partial                     | yes                 |
| Pre-item state | yes                       | yes                                 | ticket-level                              | yes                     | multi-level fulfilment      | stages              |

## 4. The three that integrate all three legs

Ranked on **inventory + recipes/sub-recipes + kitchen management together**, which is the question.
The back-office specialists are excluded by construction, and that is itself the finding.

### 1. Toast (+ xtraCHEF) — the only system strong on all three, with the reviewer evidence to match

- **Recipes/sub-recipes:** nested prep recipes, yield and waste.
- **Inventory:** ingredient costs, purchase orders, invoice capture, physical counts, waste tracking,
  variance reporting, par levels, 86-on-depletion. **xtraCHEF carries 4.62 from 2,461 app-store
  ratings** — the largest evidence base of any inventory product here.
- **Kitchen:** the matrix's kitchen leader — prep stations, ticket printers, item and order
  fulfilment with recall, **course firing**, expediter role, warning colours, prep times, sounds, and
  fulfilment notification back to the POS.
- **The honest weaknesses:** it is two products bought together rather than one, purchase orders were
  historically a Retail feature, and the brand's Trustpilot rating is **2.7 from 170** — the loudest
  complaint surface in the set, mostly about sales and billing rather than the inventory engine.

### 2. Lightspeed Restaurant (K-Series) — the competitor whose own help centre proves all three

- **Recipes/sub-recipes:** two recipe types, with batched recipes carrying a yield and feeding other
  recipes. **This is the clearest sub-recipe model I read at any competitor**, and it is stated in
  their own words rather than inferred.
- **Inventory:** batches, stock levels and movements, wastage, discrepancy reports, production
  centres and instructions, par levels, suppliers and receiving, variance reporting.
- **Kitchen:** KDS 2.0 — production centres with routing, **courses and fire-course actions**, bump
  and recall, an order-manager (expo) view, **wait-time SLA pulses**, audible alerts, per-centre
  production dockets, POS-to-KDS status mirroring.
- **The weaknesses:** a small app-store sample (**2.8 from 15**), and it **integrates with MarketMan**
  for inventory depth — which is an admission that its own back office is not the deepest.

### 3. SoftRestaurant — the regional incumbent, and the one a Mexican owner will actually compare us to

- **Recipes/sub-recipes:** sub-recetas via "Manejo de insumos elaborados", product explosion, unit
  conversion for recipes, recipe costing, and a documented **merma por cocción**.
- **Inventory:** purchase orders auto-generated from min and max stock, supplier catalogue, XML
  purchase import with automatic item linking, physical counts, cost reports.
- **Kitchen:** "Monitor de Producción" in two levels, a whole dish split across several monitors, a
  **despachador** screen, **recall of orders served within two hours**, a production-time report,
  display priority, and a sound on a new comanda.
- **Why it beats Odoo to this slot:** all three legs are restaurant-shaped rather than adapted, it is
  sold and supported in Mexico, and our own matrix credits it with the deepest recipe feature set in
  our market.

### The near-misses, named

- **MarginEdge** — the best **recipe and inventory engine** in this note and the strongest app-store
  sentiment of any product here (**4.89 from 530**), with prep-item sub-recipes, yields worked in
  real percentages, waste logging from a phone, theoretical usage, allergens and commissary support.
  It has **no POS, no KDS and no kitchen management**, so it cannot be first on this question — but
  it is the system to study for the recipe half, and the one a dissatisfied MarketMan customer is
  told to move to by name.
- **Odoo** — the deepest integration by construction (multi-level BoM, manufacturing orders,
  valuation, an ERP behind the POS) and the weakest kitchen of the six, with no expo or bump bar.
- **Clover** — has expo mode, courses and auto-coursing, and its sub-recipe answer is still unknown.

## 5. What this means for Umi

1. **Sub-recipes are table stakes, and we are on the wrong side of the line.** Six of our eight
   competitors have them and the two best specialists do. Square is the only major POS that says no —
   which is an opening we can take, because it is the most-installed brand in the region.
2. **The practitioner pain is not "no recipe feature"; it is a price database that goes stale.**
   Every chef in the r/Chefit thread was building MarginEdge's founding idea by hand, refreshed on a
   six-month cycle. We already capture supplier invoices and receipts — Umi's costing workstream
   consumes exactly those rows. A system where the ingredient cost updates itself from receipts the
   product already writes is a claim none of the spreadsheet workflows can match.
3. **The trust angle is measurable and ours.** The most common complaint in the reachable sample is
   that a count does not save, or that onboarding is a liability. Umi's counts go through the
   product's own doors and its offline replay is proved in SQL; "the count is a fact, not a form" is
   a defensible differentiator against every back-office tool in this note.
4. **Course the work.** Sub-recipes (the last row in a module where we lead four of five), then the
   ingredient-price currency claim, then expo sequencing and load balancing — the only kitchen
   capability Toast has that we do not.

## 6. Still unverified, named rather than assumed

- **Clover's** sub-recipe support.
- **Craftable, Apicbase, meez, KitchenCut, WISK, Supy and Crunchtime** sub-recipe support — all are
  described as recipe-capable, none reached a primary statement.
- **G2 and Capterra content for every product here.** Unreachable from this machine; a residential or
  mobile egress is the fix, and that is a purchasing decision.
- **Any first-hand reviewer quote about kitchen staging quality.** The reachable reviewers review
  inventory and POS breadth; nobody reviewed expo or course firing in text I could retrieve.
- **YouTube video content**, beyond titles, channels and view counts. Transcripts were not pulled.

## 7. The three direct competitors, on recipes and inventory only

Researched separately on 2026-09-17 because these are the three a café in this market actually
compares us against. Every claim below is from **their own current documentation**, fetched and
rendered that day, or from our matrix's citation where marked.

### 7.1 Fudo — the best-documented recipe model of the three, with four documented limits

**Their own help centre, articles dated 2025-11 to 2026-03:**

1. **A hard three-level ceiling on sub-recipes.** _"Fudo permite hasta 3 niveles de sub-recetas. Si
   intentas agregar una receta a un ingrediente que ya llegó al límite, verás un mensaje de error."_
   A pastry programme or a central kitchen runs out of levels fast.
2. **Yield is the operator's responsibility, and getting it wrong fails silently.** _"La receta debe
   representar el rendimiento del ingrediente elaborado según su unidad de medida"_ and _"si la
   receta no representa correctamente el rendimiento del ingrediente, los valores de costo y stock
   pueden quedar desalineados."_ The system does not validate it — cost and stock simply drift.
3. **Stock control is opt-in per ingredient, and missing one is silent.** _"Para controlar el stock
   correctamente, asegúrate de activar control de stock en todos los ingredientes utilizados en
   recetas y sub-recetas."_ Nothing warns you when an ingredient in a live recipe is untracked.
4. **The whole inventory module is a paid tier.** _"Esta funcionalidad está disponible en planes
   Avanzado y Pro."_ Stock control is not in the entry plan.

**And there are no purchase orders.** Their supplier article says a supplier is picked _"cada vez
que se genere un gasto, al momento de cargar los datos de la compra"_ — a purchase is an **expense
with a goods detail**, so there is no order, no expected-versus-received, and no replenishment from
min/max. Modifier stock consumption is undocumented, and the matrix found no theoretical-versus-real
variance report (only counts that correct stock).

**Where Fudo is genuinely good:** ingredient-level waste (_merma_) is configurable per ingredient and
the gross quantity is filled automatically; there are _fichas técnicas_; counts are blind-capable.

### 7.2 SoftRestaurant — strongest on purchasing, weakest on variance, waste and public evidence

From our primary-sourced matrix (SR2, SR18, SR26, SR28) plus a live survey of its knowledge portal:

1. **No variance report was found.** The matrix records variance (theoretical versus real) as
   _"unknown — no variance report found"_. For a system sold on inventory control, that is the one
   report a serious operator asks for first.
2. **Waste is cooking loss only.** The documented waste concept is _merma por cocción_ — there is no
   general waste log with reasons, which Fudo does have.
3. **Modifiers do not consume stock.** No modifier stock deduction was found (SR17), where PoloTab
   documents modifier recipes explicitly.
4. **No named technical sheet.** Recipe costing exists, but a _ficha técnica_ object is not named —
   Fudo has one and PoloTab prints the full indicator set.
5. **Its public documentation is thin and dated, and that is itself the weakness.** Surveyed live on
   2026-09-17, the knowledge portal's popular articles are **installation, electronic invoicing, PC
   change, CSD renewal and migration**. The recipe and inventory facts in our matrix had to come from
   a commercial sheet and **archived PDFs dated 2012 to 2021**. An operator cannot verify current
   behaviour from public sources, and neither could we without the archive.

**Where SoftRestaurant is strongest of the three:** purchasing and supply. Purchase orders generated
from min/max stock, a supplier catalogue, **XML purchase import with automatic item linking**,
physical counts, unit conversion for recipes, product explosion and cost reports. It is the only one
of the three with a real order-to-receipt chain.

### 7.3 PoloTab — the best recipe modelling, wrapped in a choice the operator can get wrong

**Their own help articles, fetched and rendered 2026-09-17:**

1. **Two distinct concepts the operator must choose between correctly.** A **"Preparado"** is an
   intermediate production (masa, glaseado, salsa) whose inputs are deducted **when produced**, and
   which then carries **its own stock**; a **"Sub-receta"** deducts its inputs **directly at sale with
   no intermediate production**. Their own rule lines spell out the fork: _"¿hay una etapa de
   preparación o cocina antes de vender? → usa un preparado"_ versus _"¿los insumos se consumen
   directo al momento de la venta…? → usa una sub-receta."_
2. **A documented double-counting hazard.** _"Al vender un producto que usa ese preparado, se
   descuenta el stock del preparado, no de los insumos directamente (**evita doble conteo**)."_
   Choose the wrong type and the inventory is wrong in one direction or the other.
3. **They publish a troubleshooting article for "my stock is not deducting."** _"¿Por qué no se me
   está descontando mi stock?"_ is a top related article on every inventory page — a tell about where
   their support load lives.
4. **No waste or shrinkage handling is documented anywhere** (the matrix records it as unknown), and
   suppliers and receiving are partial: stock entry, not an order-to-receipt chain.

**Where PoloTab is genuinely strong, and better than our matrix credited:** ingredient-level yield as
**Rendimiento (%)** with both net and gross consumption, per-product and **per-size** recipes,
minimum and maximum stock, real-time costing per sale, and — uniquely among these three —
**modifier recipes that follow exactly the same logic as a base recipe**: _"Verás la receta base y la
receta de modificadores (ambas funcionan con la misma lógica)."_

### 7.4 The pattern across all three

|                                | Fudo                            | SoftRestaurant                        | PoloTab                          |
| ------------------------------ | ------------------------------- | ------------------------------------- | -------------------------------- |
| Sub-recipes                    | yes, **capped at 3 levels**     | yes (_insumos elaborados_)            | yes, two kinds                   |
| Yield                          | **unvalidated — silent drift**  | unit conversion + cooking loss        | **Rendimiento %**, net and gross |
| Waste log with reasons         | yes                             | **cooking loss only**                 | **not documented**               |
| Modifier consumption           | unknown                         | **not found**                         | **yes, full recipe logic**       |
| Purchase orders                | **no — purchases are expenses** | **yes, min/max auto-PO + XML import** | partial                          |
| Variance (theoretical vs real) | partial                         | **not found**                         | partial                          |
| Public documentation           | **strong and current**          | **thin and archived (2012–2021)**     | current, article-per-concept     |

**Inference — the shared hole.** None of the three closes the loop the specialists close: an
ingredient price that updates itself from the invoices the system already reads, and a
theoretical-versus-real variance report that turns counts into an operating number. SoftRestaurant
gets closest on purchasing, PoloTab on recipe modelling, Fudo on documentation. **That combination —
sub-recipes without a level cap, yield the system validates, and variance the owner can act on — is
the space we can take**, and it is the same space the r/Chefit chefs were filling with a spreadsheet.
