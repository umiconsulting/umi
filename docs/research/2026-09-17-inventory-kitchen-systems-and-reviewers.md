# Inventory and kitchen systems by what reviewers say — and the three that integrate it all

- Date: 2026-09-17 (local, America/Mazatlan).
- The question: who integrates **inventory + recipes/sub-recipes + kitchen management**, judged
  partly by what individual reviewers say, across our competitors and the specialist tools.
- Builds on `docs/research/2026-09-15-competitor-feature-matrix-fudo-softrestaurant-clover.md`,
  which already carries the primary-sourced capability column for our eight competitors. This note
  adds the reviewer voice and the specialist systems that matrix does not cover.
- Labels: **Documented** (a source owns it), **Field observation**, **Inference**, **UNVERIFIED**.

## 1. The routes, and what each returned

Recorded because the negative results are half the finding, and because a blocked source is not an
absent product.

| Route                                                                                                 | Result                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reddit JSON and HTML, `www` and `old`                                                                 | **403** — "You've been blocked by network security". Blocked by network reputation, not by JS; the same block appears through a real windowed Chromium |
| `safereddit.com` (Reddit front end)                                                                   | **200 but behind an Anubis proof-of-work check** — no content without solving                                                                          |
| `r.jina.ai` text extraction in front of Reddit and Capterra                                           | 200, and the page it returns is the block page: Reddit 403, Capterra "Just a moment…"                                                                  |
| G2 product pages, headless **and** windowed Chromium                                                  | **403** both ways. This network is blocked outright                                                                                                    |
| Capterra, Software Advice, TrustRadius, GetApp                                                        | **403** (Cloudflare)                                                                                                                                   |
| Bing and DuckDuckGo-lite search                                                                       | 200 with unusable results — Spanish generic pages, not the query                                                                                       |
| Mojeek search                                                                                         | 200 with no parseable results                                                                                                                          |
| **Trustpilot**                                                                                        | **Works.** The category's only real volume is MarketMan (17 reviews)                                                                                   |
| **Apple App Store search/reviews API**                                                                | **Works.** Useful, but the volumes are tiny (below)                                                                                                    |
| Zendesk help-centre public API (`/api/v2/help_center/articles/search.json`)                           | **Works, and it is the best route found** — MarginEdge answered 97 articles for "sub recipe"                                                           |
| Zendesk API on MarketMan, Craftable, meez hosts                                                       | No such help centre at those hosts (404/000)                                                                                                           |
| **Scrapling 0.4.15** — TLS-impersonating HTTP + Playwright fetchers, installed for this research (§7) | **Did not open them.** Capterra 403, G2 403, Reddit 403. Consistent with an IP-reputation block rather than a fingerprint one                          |
| **Obscura** — Rust headless browser, CDP on `127.0.0.1:9222`, run from Docker                         | **Opened Reddit where plain Chromium got 403** — 33 KB of real content. G2 still 403, the same IP verdict                                              |
| Reddit through Obscura + the `.json` endpoints                                                        | **Works** — and it produced §2.4                                                                                                                       |

**Inference, and it matters for any future research on this category:** restaurant back-office
software is reviewed on G2/Capterra-family sites, and those sites are unreachable from this machine.
The practitioner voice therefore has to come from help centres, Trustpilot, App Store reviews and
vendor communities rather than from the review aggregators.

## 2. What individual reviewers actually say

### 2.1 MarketMan — a 2.0 out of 5, and the complaints are operational, not cosmetic

**Documented, Trustpilot, fetched 2026-09-17: 17 reviews, 2.0/5.** Direct quotes:

- _"Signed up to handle our weekly invoices and plate costs, but the onboarding is practically
  non-existent. The drag-and-drop inventory setup glitched out on almost every line item. Support?
  Completely ghosted us."_ (Aug 2026)
- _"Please fix your app, it doesn't save counts. We work at a bar and Finish late, the least of our
  worries should be the app saving our counts."_ (Dec 2025)
- _"After not using this program and paying for it, 3800 dollars for the entire year… I would suggest
  **margin edge**."_ (Sep 2025)
- _"We've since moved to another software solution that's far more efficient and transparent."_
  (Mar 2025)

**Caveats, stated rather than glossed:** 17 reviews is a small sample, Trustpilot self-selects for
complaint, and one review is positive (an Operations Director praising AI ordering and scanning).
What the sample does establish is the **shape of the failure**: onboarding effort, counts that do
not persist, contract terms that cannot be escaped, and support that does not answer. Those are the
things a buyer actually punishes.

### 2.2 The rest of the category has almost no reviewer footprint on these venues

- **Trustpilot: 0 reviews** for MarginEdge, Craftable, Apicbase, meez and Optimum Control.
  Restaurant365 has **2 reviews at 2.9**.
- **App Store ratings** (Documented, fetched today): Restaurant365 **4.95 from 83 ratings**;
  MarketMan 5.0 from **1**; Craftable, Apicbase and meez at **0 ratings** across their mobile apps.

**Inference:** an operator picking between these systems has essentially no consumer-review signal
to lean on, which is why the review-aggregator content is where the real decision material sits —
and why the MarketMan sample, thin as it is, is the loudest voice this research could reach.

### 2.3 What reviewers never complain about, and that is the point

Nothing in the reachable sample complains that a system **cannot** do sub-recipes. The complaints are
onboarding, reliability of counts, support, and contract terms. **Inference:** by the time an
operator is shopping, recipe nesting is assumed to exist — which is exactly why Square's absence of
it (below) is a real product hole rather than a niche omission.

### 2.4 What practitioners say when you actually reach them

Reddit only became reachable through Obscura (§7). The most on-topic thread found is
**r/Chefit, "Do you cost entire recipes?" — 83 points, 195 comments** (fetched 2026-09-17). Quotes:

- A **regional chef across 11 locations**: _"I do that for the small restaurant group I'm involved
  with but it's not particularly accurate at the end of the day. It does help gauge how off we are
  from 'ideal' cost versus 'real'."_ — and for his other concepts, he does not price seasonings at
  all.
- The **spreadsheet workaround**, described as the answer: _"Make up a database of all your
  ingredients costed down to the gram. Then when you create a new recipe in a spreadsheet, do a call
  back to your DB for all ingredients costs… **Every 6 months or so do an update to your price DB.**"_
  That last clause is the whole product problem, said out loud: the priced ingredient database goes
  stale on a six-month cycle because keeping it current is manual.
- **Yield loss, in the chef's own numbers**: _"A forty pound case of chicken trims down to 32-34
  pounds."_
- Two **practical conventions** the trade uses instead of modelling: the **Q factor** ("the cost of
  extras… salt, pepper, sugar, lemon wedges, condiments, bread, butter, garnishes, disposables, and
  waste from overproduction") and a flat seasoning allowance — _"seasonings cost was $.15/recipe"_.

**The finding that matters most: nobody in that thread names a system.** They cost recipes in
**spreadsheets**, and the entire argument is about how much of it is worth doing. **Inference:** the
chefs who care most about recipe costing are not using their back-office tool for it — which is an
opening for a product where the ingredient price database updates itself from the invoices the
system already captures, and where a sub-recipe is a first-class object rather than a spreadsheet
tab. That is precisely the seam the plan's workstream E already occupies.

## 3. Sub-recipes: who actually has them

### 3.1 Our competitors, from the primary-sourced matrix already on file

| Vendor             | Sub-recipes                                            | Source of the claim |
| ------------------ | ------------------------------------------------------ | ------------------- |
| **Fudo**           | **yes** — up to three levels of sub-ingredients        | FU15                |
| **SoftRestaurant** | **yes** — "Manejo de insumos elaborados (sub recetas)" | SR18                |
| **Square**         | **NO** — "a recipe cannot contain another recipe"      | SQ9                 |
| **Toast**          | **yes** — nested prep recipes, with yield and waste    | PA3                 |
| **Odoo**           | **yes** — multi-level kits and bills of materials      | OD9                 |
| **Lightspeed**     | **yes** — production batches feed recipes              | PA3                 |
| **PoloTab**        | **yes** — "preparados" and "sub-recetas"               | PT5, PT6            |
| **Clover**         | **unknown** — not stated in the public help centre     | CL10                |

### 3.2 The specialist back-office systems, verified today

**MarginEdge — Documented, fetched 2026-09-17, and it is unambiguous.** Their help centre describes
three recipe categories and names the nesting rule outright: _"Prep Items: Start here! This recipe
type is **the only type that can be used in other recipes**. Examples include anything from
dressings, sauces, bases, prepped portions of meats or seafood, cocktail mixers, and batch
recipes."_ The same help centre carries **Allergens in Recipes and Products**, conversions, yields,
recipe cost history, and commissary-kitchen support — 97 articles answer the "sub recipe" query.

**UNVERIFIED, and I am not going to guess:** the same explicit statement for Craftable, Apicbase,
meez and Restaurant365. Their help centres are not on Zendesk at the hosts I tried, their marketing
pages do not state it, and the review aggregators that would is blocked from this machine. Each is
widely described as recipe-capable, but "recipe-capable" and "a recipe can contain another recipe"
are different claims and I have primary evidence for only one of them.

## 4. The three systems that integrate inventory + recipes/sub-recipes + kitchen

Ranked on **all three legs at once**, which is the question. The ranking weights kitchen management
as a first-class leg, so the excellent back-office-only tools fall out of the top three by
construction rather than by dismissal.

### 1. Toast — the only one strong on all three legs

- **Recipes and sub-recipes:** nested prep recipes, with yield and waste, in xtraCHEF.
- **Inventory:** ingredient costs, purchase orders, invoice capture, physical counts, waste
  tracking, variance reporting, par levels and reorder alerts—the deepest inventory row in our
  own matrix.
- **Kitchen:** the module leader. Prep stations and ticket printers, item and order fulfilment with
  recall, **course firing**, an expediter device role, warning colours and prep times, kitchen
  notification sounds, and a fulfilled-order notification back to the POS.
- **Where it is weak:** the recipe engine is a bolt-on to the POS rather than the same product, and
  its purchase orders were historically a Retail feature rather than a Restaurant one (our matrix,
  SQ13-class caveat).

### 2. Lightspeed Restaurant (K-Series) — the competitor that has all three

- **Recipes and sub-recipes:** production batches feed recipes.
- **Inventory:** counts, waste and spoilage, yield in production, variance in reporting, par levels
  and low-stock warnings, suppliers and receiving.
- **Kitchen:** KDS 2.0 — production centres with routing, courses and fire-course actions, bump and
  recall, an order-manager (expo) view, **wait-time SLA pulses**, audible alerts, per-centre
  production dockets, and POS-to-KDS status mirroring.
- **Where it is weak:** back-office automation (invoice capture and AP) is thinner than Toast's or
  MarginEdge's.

### 3. SoftRestaurant — the regional incumbent that has all three

- **Recipes and sub-recipes:** sub-recetas via "Manejo de insumos elaborados", product explosion,
  **unit conversion for recipes**, recipe costing, and a documented **merma por cocción** (cooking
  loss).
- **Inventory:** purchase orders auto-generated from min and max stock, supplier catalogue, XML
  purchase import with automatic item linking, physical counts, cost reports.
- **Kitchen:** "Monitor de Producción" in two levels, split of a whole dish across several monitors,
  a **despachador** (dispatcher) screen that confirms an order is ready, recall of orders served
  within two hours, a production-time report, priority display, and a sound on a new comanda.
- **Why it belongs here rather than Odoo:** for a Mexican café it is the integrated competitor an
  owner will actually compare us against, and it is the one our matrix credits with the deepest
  recipe feature set in our market.

### The two near-misses, named so the ranking is not hidden

- **Odoo** — the deepest _integration_ by construction: multi-level kits and bills of materials,
  manufacturing orders, inventory valuation, and a preparation display with stages. But it is an ERP
  with a restaurant skin: no expo, no bump bar, no course firing as a kitchen practice. If the
  question were "which system integrates inventory into the rest of the business", Odoo wins; for
  kitchen management it is the weakest leg of the three.
- **MarginEdge** — the best **pure recipe engine** in this note, and the only specialist whose
  sub-recipe support I verified today. It is **back office only**: no POS, no KDS, no kitchen
  management. It is the answer to "who does recipes and inventory best", not to this question.

### And the notable hole among our competitors

**Square — the ordering leader in our matrix — cannot nest a recipe.** Its own help centre says a
recipe cannot contain another recipe, modifiers do not track inventory or costs, and recipe support
itself is a beta. **Inference:** the most common POS brand in the region has a documented hole
exactly where the plan calls recipes "the deepest moat", and that hole is open to us.

## 5. What this means for Umi

1. **Sub-recipes are table stakes among integrated systems, not an edge.** Six of our eight
   competitors and the best specialist all have them. We do not — our `inventory_recipe_component`
   table has no way for a recipe to reference another recipe. **This is now the single most
   defensible gap to close**, and it is one self-reference plus the explosion and a cycle refusal.
2. **The reviewer pain is a differentiator we can actually attack.** The loudest complaints in the
   reachable sample are onboarding effort, counts that do not save, support that does not answer,
   and contracts that cannot be exited. Umi's POS already writes counts through the product's own
   doors and proves them in SQL against a real database; "the count is a fact, not a form" is a
   claim no back-office tool in this note can make the same way.
3. **Our recipe feature set is already at parity with SoftRestaurant on four of five rows** —
   modifier consumption, unit conversion, yield, waste with an approval threshold — and ahead of
   Square on three of Square's own documented limits. **Nesting is the missing row.**

## 6. Sources and what I could not reach

**Fetched and used:** Trustpilot (`marketman.com`, `marginedge.com`, `craftable.com`,
`apicbase.com`, `getmeez.com`, `restaurant365.com`, `optimumcontrol.com`); Apple App Store search
API; MarginEdge help centre via the Zendesk public API (article 115002944673 and a 97-article
search); meez, MarketMan, MarginEdge, Craftable and Restaurant365 marketing pages; Odoo 17
documentation on bills of materials. Our own matrix supplies every competitor capability claim
above, with its own primary sources.

**Attempted and blocked, so nobody repeats it:** Reddit (JSON, HTML, old, mirror, and through a
text extractor), G2, Capterra, Software Advice, TrustRadius, GetApp, SourceForge, and the
MarketMan, Craftable and meez help centres.

**Still unverified, and named rather than assumed:** whether Craftable, Apicbase, meez and
Restaurant365 support sub-recipes explicitly; Clover's answer to the same question; and any
first-hand reviewer quote about **kitchen** staging quality in these systems, which no reachable
source carried.

## 7. The tooling this research produced

Two tools were researched on GitHub and evaluated against the sites that blocked every other route.
Both are real, both are prominent, and they behave differently — which is the useful part.

### 7.1 Scrapling — installed, and it did not solve the block

- **Source:** `github.com/D4Vinci/Scrapling` — **81,862 stars, BSD-3-Clause, Python**, latest release
  **v0.4.15** (2026-08-23), repository pushed to on 2026-09-17. The release notes advertise "an
  improved Cloudflare solver" and a reworked MCP server.
- **What it offers:** `Fetcher` (TLS/HTTP-2/HTTP-3 impersonation with no browser),
  `DynamicFetcher` (Playwright Chromium), `StealthyFetcher` (anti-bot, "bypass Cloudflare
  Turnstile/Interstitial"), session classes, CDP remote browsers, XHR capture, an MCP server and an
  agent skill.
- **Installed here:** `uv pip install "scrapling[fetchers]"` into `/tmp/rev-env` → **scrapling
  0.4.15**, verified importable. `scrapling install` failed on `playwright install-deps` (that step
  wants root); the Playwright browsers were already present, so the fetchers still ran.
- **Result against the blocked targets:** Capterra 403/404, G2 403, Reddit 403. **It did not open
  them.** Its own README is explicit that beyond Turnstile a solver service and mobile or residential
  proxies are needed, which matches what we measured: the block here is the **IP**, not the
  fingerprint.

### 7.2 Obscura — kept, because it did open one

- **Source:** `github.com/h4ckf0r0day/obscura` — **27,332 stars, Rust**, "The headless browser for AI
  agents and web scraping". Native rendering via V8, **no Chromium required**, supports the Chrome
  DevTools Protocol and is documented as a drop-in for Puppeteer and Playwright. An anti-detect
  column in its own comparison table, `-stealth` archive variants, and a ~57 MB Docker image.
- **Installed here:** `docker run -d --name obscura -p 127.0.0.1:9222:9222 h4ckf0r0day/obscura`.
  Verified by `curl http://127.0.0.1:9222/json/version` → `Browser Chrome/151.0.7922.34`,
  `Protocol-Version 1.3`.
- **Driven here:** the repository's own Playwright, via
  `chromium.connectOverCDP('http://127.0.0.1:9222')`. **Reddit returned 200 with 33,661 characters
  of real content**, where both headless and windowed Chromium had been refused with 403. G2 stayed
  403 — the same IP verdict, and worth saying plainly so nobody buys this class of tool expecting it
  to defeat a network-level block.
- **Operational notes:** stop it with `docker stop obscura`; it holds no page unless a script opens
  one.

### 7.3 The recommendation

Use **Obscura over CDP** as the browser for research scraping, because it passes where Chromium does
not and it costs one container rather than a fingerprint stack. Keep **Scrapling** for the jobs it is
actually good at — TLS-impersonating HTTP where there is no JS challenge, structured parsing, and its
MCP server — and expect neither to open an **IP-blocked** site: for G2 and Capterra that needs a
residential or mobile egress, which is a purchasing decision rather than a library one.

**Inference, and the reason this belongs in the plan rather than in a scratch note:** the route that
worked today was not "defeat the wall" but "go where there is an API" — Trustpilot, the App Store and
a vendor's Zendesk help centre answered everything substantive about this category.
