# Umi platform sweep and build plan — 2026-09-15

## 1. What this document is

This document is the plan of record for the next stage of UmiPOS and the Umi Dashboard.
It answers three questions:

1. What does the product look like now? This part uses measured evidence, not opinion.
2. What must it look like to beat Square, Toast, Clover, Lightspeed, Odoo, Fudo,
   SoftRestaurant, and PoloTab?
3. In what order do we build it, and how do we prove each step is done?

Companion research files:

- `docs/research/2026-09-15-ux-patterns-and-design-north-star.md` — design law and interaction rules.
- `docs/research/2026-09-15-tooling-and-design-system-landscape.md` — tools, versions, and adoption cost.
- `docs/research/2026-09-15-competitor-feature-matrix-fudo-softrestaurant-clover.md` — the vendor matrix.
- `docs/research/2026-09-06-competitive-scan-and-gap-audit/` — the first scan: Lightspeed, Toast, Square, Odoo, PoloTab.
- `docs/research/2026-09-06-restaurant-pos-kds-feature-inventory-research.md` — the capability list per module.

## 2. Method

The sweep used five instruments.

1. **Runtime click inventory.** A new harness walks every Dashboard route in a real
   browser. It records every interactive element, its accessible name, its role, and
   its hit-target size. Files: `tools/ux-sweep/click-inventory.mjs`.
2. **Native POS inventory.** A second harness reads the live accessibility tree of the
   running Linux POS through the Dart VM service. File: `tools/ux-sweep/pos-semantics-inventory.mjs`.
3. **Code intelligence.** The CodeGraph index was refreshed and used for code structure.
4. **Independent research.** Three research agents worked in parallel: user experience,
   tooling, and competitors. Each cited primary sources.
5. **Chrome DevTools Protocol.** A probe attaches to the running Chromium and records
   first paint, JavaScript coverage, DOM size, heap, console errors, and slow responses per
   screen. File: `tools/ux-sweep/devtools-probe.mjs`.

Limits of this pass. The click inventory reads the DOM. It does not yet click through
flows. The POS inventory covers one screen at a time, because the tree follows the
visible surface. The DevTools probe measures the dev server, not a release build. All three
limits are removed in workstream F.

## 3. Measured baseline

### 3.1 Dashboard, 22 routes

| Metric                                       | Value            |
| -------------------------------------------- | ---------------- |
| Clickable elements                           | 586              |
| Elements with no accessible name             | 0                |
| Elements smaller than 44 px in one dimension | 237 (40 percent) |

The accessible-name result is good. The hit-target result is not. The offenders repeat on
every screen, so the defect lives in the shell, not in the screens:

| Control               | Size     | Screens |
| --------------------- | -------- | ------- |
| Show or hide the menu | 24 x 24  | 21      |
| Theme selector        | 32 x 32  | 21      |
| Language selector     | 84 x 32  | 21      |
| Account menu          | 123 x 32 | 21      |
| Business selector     | 215 x 34 | 20      |
| View detail           | 36 x 36  | 20      |

One shell fix lifts 124 of the 237 findings, because those six controls repeat on most
screens.

### 3.2 POS, operator PIN screen

| Metric                       | Value    |
| ---------------------------- | -------- |
| Semantics nodes              | 33       |
| Actionable nodes             | 12       |
| Actionable nodes below 44 px | 0        |
| Keypad key size              | 144 x 85 |

The POS respects touch targets. The Dashboard does not. The two clients disagree about a
basic rule, and that disagreement is the first thing to remove.

The same screen also shows the kitchen entry: the POS bottom navigation already carries a
**Cocina** tab. The unified kitchen board is mounted there, and `apps/umi-kds` is the
deprecated native client. Section H records the correction.

### 3.3 DevTools measurements

The Chrome DevTools Protocol probe (`tools/ux-sweep/devtools-probe.mjs`) attaches to the
running Chromium and records paint, coverage, and runtime counters per screen. Values are
the first load of each route on the Vite dev server at 1440 x 900.

| Route                | First contentful paint | DOM nodes | JS heap | JS used of total |
| -------------------- | ---------------------- | --------- | ------- | ---------------- |
| `/` Overview         | 1904 ms                | 125       | 7.7 MB  | 409 of 425 KB    |
| `/operations`        | 588 ms                 | 244       | 9.2 MB  | 409 of 425 KB    |
| `/reportes`          | 612 ms                 | 363       | 11.1 MB | 409 of 425 KB    |
| `/catalog-inventory` | 672 ms                 | 438       | 11.8 MB | 409 of 425 KB    |
| `/kitchen`           | not measured           | 540       | 11.8 MB | 538 of 554 KB    |

Two readings matter.

1. The Overview screen paints in 1.9 seconds on the first visit. The quality bar is one
   second. This is the slowest screen and it is the first screen an owner sees.
2. Every screen loads the same 425 KB of JavaScript. The bar for a dense dashboard is
   under 250 KB for the first route, with the rest split per screen.

The probe also reports console errors, failed requests, and the five slowest responses per
screen. That is the evidence source for the performance work.

### 3.4 Defects found during the sweep

**D1 — Reportes returns 500 on every existing database.**

`GET /reportes` fails with `column s.origin_channel does not exist`.

Commit `5eab37e` (channel attribution) added the column `origin_channel` to
`merchant.pos_cart` and `merchant.pos_committed_sale` by editing
`docs/migration/build-v3/20_merchant.sql`. No `ALTER TABLE` statement exists anywhere.

A database built from scratch has the column. A database that already existed does not.
Staging and production are in the second group. The owner sees a broken screen.

**D2 — The schema version and the API expectation can disagree silently.**

`/health` answered 503 for hours on this workstation because
`EXPECTED_SCHEMA_VERSION` said `build-v3-48` while the database said `build-v3-62`. The
check is correct. The failure mode is quiet: the interface looks connected while it
reports "unready".

**D3 — A migration that edits an early file cannot reach a live database.**

This is the general form of D1. The migration chain has no rule that forbids edits to an
applied file.

### 3.5 Corrected observation

The first sweep showed six `429` responses on `/diagnostics`. A single load of the same
screen is clean. The harness caused the limit: the API allows 300 requests per minute per
IP, and the crawl used that budget. This is not a product defect.

It is still a production risk. Every client behind one address shares the budget. The API
must read the forwarded address, and the limit must be per authenticated principal where
one exists.

## 4. The quality bar

A feature is done when all of the following are true. These are the benchmarks.

| Area                       | Bar                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| Every action               | Reachable by pointer and by keyboard. Named for a screen reader. Target at least 44 x 44 px.         |
| Every flow                 | Measured in taps. The money path holds at three taps or fewer after the cart.                        |
| Every screen               | Loads in less than 1 second on the reference tablet, with no layout shift after first paint.         |
| Every failure              | Shows a typed message with a recovery action. No raw technical code outside the diagnostics surface. |
| Every money action         | Idempotent, audited, and covered by a property test.                                                 |
| Every offline action       | Replays once, or reports a conflict the operator can resolve.                                        |
| Every role                 | Sees a first screen built for that role, not the owner screen with hidden buttons.                   |
| Every screen, both clients | Passes a visual regression test on Dashboard and POS.                                                |
| Every change               | Adds no new lint warning. Keeps the existing warning baseline.                                       |

Reference hardware for the bar: the café tablet at 1024 x 768 and the counter terminal at
1280 x 720. Both are already the shapes used by the POS design.

## 5. Design north star

The full rules live in the UX research file. The five that change the most decisions:

1. **The interface does not move.** Controls keep one place. The product grid never
   reflows during a shift. Spatial memory does the work that a label cannot.
2. **One sale is one object.** The kitchen ticket, the guest, the payment, and the cash
   shift open from the sale itself. No parallel menus.
3. **Quiet by default, dense on demand.** The operator sees the few controls the shift
   needs. Depth appears on the edge of the object the operator already holds.
4. **Money is large.** The amount due and the change due stay large and on screen. The
   change stays until the next sale starts.
5. **Motion confirms, never delays.** Fast easing for a commit. No motion on the money
   path. No decorative animation on a screen an operator uses 200 times a day.

### 5.1 What the market comparison changes

The competitor matrix found eight openings with sources. Each one changes a priority in
this plan.

1. **Roles are weak in the middle of the market.** Toast publishes 100 permissions. Odoo
   offers three levels. Put the named role set and the per-permission override in the first
   release, not the last. It feeds workstream C.
2. **Approval on action is a Latin American pattern with no English-market equal.** Fudo
   blocks a waiter from another waiter's table with a PIN. SoftRestaurant needs an
   authorized password or a fingerprint for a cancel, a discount, a comp, a re-open, and a
   reprint. Make a manager approval a first-class flow in the POS and the KDS. It feeds
   workstreams C and H.
3. **Offline is still open ground.** Fudo calls the internet indispensable. Square allows
   offline card payments only inside a window. Toast needs a local hub. Umi already holds a
   device identity and a durable journal. Offline-complete is the strongest claim Umi can
   make. It raises the priority of workstream K.
4. **Loyalty, gift cards, and WhatsApp are a regional gap.** Fudo and PoloTab have no
   loyalty points, no gift cards, and no stored value. Umi has all three. Ship tiers and a
   reward catalog to lead the region. It raises the priority of workstream J.
5. **Recipes are the deepest moat.** SoftRestaurant supports sub-recipes, unit conversion,
   and cooking loss. Square cannot nest recipes, cannot put a recipe on a modifier, and
   cannot attach a recipe to a multi-variation item. Nested recipes and modifier
   consumption take the top of this module. It sets the shape of workstream E.
6. **Table timers are cheap and rare.** Clover turns a table red after 90 minutes by
   default. Square turns it yellow and then red. Fudo has no turn-time metric. Add the
   timer and the turn-time report in workstream D.
7. **Kitchen staging is the clearest product gap.** Fudo has no course concept and no
   recall. SoftRestaurant recalls for two hours. Clover has expo mode. Per-item state,
   recall, and staging are the highest-value build in workstream H.
8. **Pricing transparency is a trust weapon.** Clover hides software prices. Fudo,
   SoftRestaurant, Square, Odoo, Lightspeed, and PoloTab publish them. Publish Umi's.

### 5.2 The numbers, embedded

These values come from the design research. They are requirements, not suggestions.

| Item                                     | Value                                                                                 | Source                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Minimum control                          | 44 x 44 pt                                                                            | Apple HIG                                       |
| Padding around a control with a bezel    | about 12 pt                                                                           | Apple HIG                                       |
| Padding around a control without a bezel | about 24 pt                                                                           | Apple HIG                                       |
| Text enlargement support                 | at least 200 percent                                                                  | Apple HIG                                       |
| Contrast                                 | 4.5 to 1 up to 17 pt, 3 to 1 at 18 pt and bold                                        | Apple HIG                                       |
| Tap floor for this product               | 48 x 48 px                                                                            | research inference, above the Apple 44 pt floor |
| Primary money action height              | 96 px                                                                                 | research inference                              |
| 1024 x 768 layout                        | top bar 56 px, cart panel 360 px, bottom action bar 80 px, margin 16 px, gutter 12 px | research inference                              |
| Physical check                           | one control measures 9 mm or larger on the real panel                                 | research inference                              |

The operator evidence: one-handed use is common (49 percent of grips), so the primary
control sits in the lower right. The arm and wrist injury threshold starts at more than 10
repetitions per minute, so no action may require a repeated precise tap. Room noise already
reaches 68 dB(A) at peak, so sound confirms only a money action.

Time budget per shift: a café bar makes 60 to 80 milk drinks per hour at peak. Every second
removed from one drink repeats 80 times.

Layout rule from Apple: show the important items near the top and the leading side. Keep
the top-bar action count small.

### 5.3 Who wins each module

The competitor matrix names one leader per module. Copy the leader. Beat the leader where
the row says so.

| Module                | Leader                | What to take                                                                        | Where Umi can beat it                                                   |
| --------------------- | --------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Ordering and sales    | Square                | Seat-level ordering tied to cart, tickets, allergens, and split by seat             | Umi already owns channel attribution per sale                           |
| Floor plan            | Clover                | Sections, shape, capacity, clone, drag, and a table timer                           | Reservations with a database constraint, and POS-side editing           |
| Kitchen               | Toast                 | Stations, load balancing, expo sequencing, partial fulfilment, all-day counts       | Umi runs the board inside the POS, so one device does both              |
| Menu and catalog      | Square                | One menu drives POS, online, kiosk, and delivery, with time windows                 | Fudo is the cheap version; Umi can hold channel visibility per category |
| Inventory and recipes | SoftRestaurant        | Sub-recipes, unit conversion, cooking loss, product explosion, min and max ordering | Not yet. This is the deepest gap and the plan treats it as a moat       |
| Roles and permissions | Toast                 | About 100 named permissions in nine groups, jobs as the unit                        | Umi can match this and keep the role names in Spanish                   |
| Customers and loyalty | Square                | Loyalty, marketing, gift cards, and directory as one loop                           | Umi already has WhatsApp identity, which Square does not                |
| Payments and hardware | Clover                | Owns hardware, software, and processing, and publishes prices                       | Umi can publish prices and keep the terminal replaceable                |
| Online ordering       | Fudo and Square       | One menu, one stock pool, WhatsApp, QR at the table                                 | Umi holds WhatsApp today; this is the shortest path to parity           |
| Reporting             | Toast                 | 40 or more reports in nine categories                                               | Umi can be faster and clearer rather than wider                         |
| Multi-location        | Square for Franchises | Named roles, menu concepts, location groups, royalties                              | Later                                                                   |
| Offline               | SoftRestaurant        | Desktop offline, queue and sync, and a local network                                | Umi holds a device identity and a durable journal already               |

## 6. The toolbox

This section is the answer to one complaint: work that good tools already do must not be
done by hand again. Every workstream below names its tools. This section holds the whole
set in one place.

### 6.1 Rule

For every task, name the tool before the work starts. If no tool exists, search first:
official documentation, GitHub, engineering blogs, forums, and social channels. Record the
tool, the version, and the source. A hand-rolled solution needs a written reason.

This rule is now a standing instruction for the workspace, not a section of this plan.
`AGENTS.md` carries it, `docs/agents/tool-and-research-doctrine.md` holds the detail, and
the `research` skill applies it to a research task. Every agent reads it on every task.

### 6.2 Chrome DevTools, first class

The product runs on Chromium. The Chrome DevTools Protocol is the strongest instrument we
have, and it was missing from the first draft of this plan. It is now part of the standard
loop.

| Need                       | DevTools capability                                                  | How                                 |
| -------------------------- | -------------------------------------------------------------------- | ----------------------------------- |
| Load and paint timing      | `Performance.getMetrics`, paint timing entries                       | `tools/ux-sweep/devtools-probe.mjs` |
| Dead code per screen       | `Profiler.startPreciseCoverage`                                      | the same probe                      |
| Unused CSS                 | `CSS.startRuleUsageTracking`                                         | the same probe                      |
| Console and network errors | Runtime and Network domains                                          | the same probe                      |
| Slow responses             | Network timing                                                       | the same probe                      |
| Memory growth over a shift | `HeapProfiler`, `Memory`                                             | planned in Step F6                  |
| Throttled device run       | `Emulation.setCPUThrottlingRate`, `Network.emulateNetworkConditions` | planned in Step F6                  |
| A full flow trace          | `Tracing` domain                                                     | planned in Step F6                  |
| Screen recording           | `Page.startScreencast`                                               | planned in Step F6                  |
| Lighthouse audit           | Lighthouse over CDP                                                  | planned in Step F6                  |

The probe already returns real numbers. Section 3.3 holds the first run.

The sibling capability is `chrome-devtools-mcp`, the official Google MCP server. It gives
an agent the same instruments as callable tools. Playwright MCP and Playwright over CDP
stay for driving the interface. The two are complementary, not competing.

### 6.3 Task to tool

| Task                              | Tool                                   | Exact use                                          |
| --------------------------------- | -------------------------------------- | -------------------------------------------------- |
| Read a failed Vercel build        | Vercel CLI over npx                    | `npx vercel@latest inspect <deployment> --logs`    |
| Read a failed Cloudflare build    | GitHub CLI                             | `gh run view <run> --log-failed`                   |
| Read a failed GitHub check        | GitHub CLI                             | `gh pr checks <n> --watch`                         |
| Search history for a lost feature | git                                    | `git log --all -S<string>`, `git log --all --grep` |
| Find a stash or a worktree        | git                                    | `git stash list`, `git worktree list`              |
| Read the code structure           | CodeGraph                              | `codegraph explore`, `codegraph node`              |
| Inventory every click             | Playwright over CDP                    | `tools/ux-sweep/click-inventory.mjs`               |
| Measure a screen                  | Chrome DevTools Protocol               | `tools/ux-sweep/devtools-probe.mjs`                |
| Read the native POS tree          | Dart VM service                        | `tools/ux-sweep/pos-semantics-inventory.mjs`       |
| Drive the native POS              | `xdotool` over X11, Dart VM service    | `tools/ux-sweep/pos-native-driver.mjs`             |
| Look at a POS screen by hand      | `xdotool` + `xwd` + `ffmpeg`           | the loop in the local verification playbook, §3    |
| Measure what the till costs       | `ps -o rss`, `free -m`                 | the playbook, §6                                   |
| Query the database                | psql, `explain analyze`                | `docker exec ... psql`                             |
| Watch the API                     | the API log, `/health`, `/diagnostics` | read the log fields                                |
| Inspect a container               | docker                                 | `docker compose -f deploy/local/compose.yml ps`    |
| Deploy the dashboard              | wrangler, Vercel CLI                   | workflow plus the CLI                              |
| Verify a deploy                   | curl, the health endpoint              | check the released commit                          |

The one hour that this section exists to prevent: a Vercel deploy failure was read from a
browser tab. One command reads it from the terminal, and it answers in one line.

```sh
npx vercel@latest inspect <deployment-id> --logs
```

### 6.4 How we research

Official documentation is the floor, not the ceiling. The research order is:

1. Vendor documentation and the official API reference.
2. The vendor changelog and status page.
3. GitHub: the repository, the issues, and the discussions.
4. Practitioner writing: engineering blogs, Substack, dev.to, Hacker News, and Lobsters.
5. Community channels: Reddit, Discord, and Slack communities.
6. Social: X, where access allows.

Channel access, rate limits, and fallbacks live in
`docs/research/2026-09-16-research-channels-playbook.md`. The rule for this plan is
persistence: when a source blocks, try another route before giving up, and record which
route failed.

### 6.5 Install and use these

The tooling research file `docs/research/2026-09-16-agent-toolbox-and-devtools.md` holds
the full list with versions and sources. The short list that changes daily work:

| Tool                                            | Why                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Chrome DevTools Protocol, `chrome-devtools-mcp` | performance, coverage, memory, traces                                                            |
| Playwright, Playwright MCP                      | every click, screenshots, visual regression                                                      |
| xdotool, xwd, ffmpeg                            | real clicks and window capture on the native POS                                                 |
| alchemist                                       | the Flutter POS surfaces                                                                         |
| axe-core                                        | accessibility gate                                                                               |
| Vercel CLI, wrangler                            | read and run the two front ends                                                                  |
| CodeGraph                                       | code structure without reading every file                                                        |
| knip, fast-check                                | dead code, and property tests for money code — **both installed 2026-09-16**; see the note below |

`patrol` is deliberately absent from that list. Its published manifest declares
`android, ios, macos, web` and **no linux**, so it cannot drive the one Flutter device this
workstation has. `xdotool` against the real window is the substitute, and it tests what the
operator runs rather than a sibling build.

**Two of those tools were named and not installed, and are now.** `fast-check` arrived as a
devDependency of `apps/umi-api` for §8E's costing arithmetic — 28 generated-input cases over the
weighted average, the plate cost, the margin and days of cover, which is what turns "the
arithmetic is integer-only, rounds once, and never leaves the range of its inputs" from a claim
into a check. And `explain analyze` is a habit rather than an install: every stock query in a new
read gets a plan recorded with `EXPLAIN (ANALYZE, BUFFERS)`, because a query that is fast on 100
rows and a sequential scan on a million is the same query until someone measures it. The costing
plans are at the end of this file; the script that produces them is a plain `.sql` fed to `psql`,
and it is worth writing down for the next read because a plan with no merchant id in it measures
nothing.

**`knip` is installed and now configured, because its first run was mostly noise.** Installed
2026-09-16 (6.36.0). Its first run reported 145 unused files and 192 unused exports — and it was
**wrong about at least 44 of them in the dashboard alone**, because the app resolves its imports
through Vite aliases (`@`, `@umi/contract`, `@umi/tokens`) that live in `vite.config.js`, which knip
cannot read. Every module reached only by an alias looked unused, including
`src/lib/format.js` — which the newest screen imports four times. A root `knip.json` now declares
those three aliases and the app's entry points, and the numbers became **101 files / 121 exports /
10 duplicate exports**; the dashboard's share went **45 → 1**, and the last one was real:
`src/lib/supabase.js` had no importer anywhere and imported `@supabase/supabase-js`, which is not a
declared dependency of the app. **Deleted**, with the suite green (134 tests) and knip now reporting
**0** unused files in that app.

What remains is the same treatment elsewhere, not a list to act on: the other apps' aliases are
still undeclared, `.agents/skills/design/baoyu-design/**` is vendored tooling with no entry point
knip can see, and the `apps/umi-api/src/jobs/*.processor.ts` tree is registered by queue name
rather than imported. Of the product entries, two were checked by hand and **are** real:
`apps/umi-api/src/modules/conversations/pending-clarification.ts` has no importer anywhere in the
API, and there are **two `lifecycle-copy.ts` files** — `modules/cash/lifecycle-copy.ts`, which
`cash-scan.service.ts` imports, and `modules/lifecycle/lifecycle-copy.ts`, which nothing
references. The lesson is the plan's own, one level up: a tool that reports 145 problems it did not
understand is not evidence, and **configuring it was the work, not running it.**

### 6.6 What the native client costs

The till's own footprint, measured on the debug build of record. The numbers live with their
method in `docs/development/LOCAL_VERIFICATION_PLAYBOOK.md` §6 so they can be repeated.

| Part                                     | RSS                                    |
| ---------------------------------------- | -------------------------------------- |
| `umi_pos` (debug bundle)                 | 225 MB idle, 302 MB after a full sweep |
| Flutter debug tooling (VM + dev service) | ~185 MB                                |
| Whole `flutter run -d linux` tree        | 310–395 MB                             |

Two readings, both real: **225 MB** idle on the order screen at 24 minutes of uptime, and
**302 MB** at 38 minutes after a hand sweep had walked every destination in the app. The state
travels with the number.

The app process is the only figure that describes a café; the rest is the instrument. The
workstation this was measured on has 7.8 GB and was already 5.6 GB into swap, which is why
the CDP browser is started on demand (`scripts/ux-browser.sh`) instead of left resident, and
why a measurement is never reported without the uptime that produced it.

### 6.7 Traps that already cost time

Recorded here because each one produced a confident wrong answer, and a wrong answer that
arrives with a green check is more expensive than a red one.

- **A composite-returning function in the select list may run once per column.**
  `SELECT (merchant.append_stock_ledger(...)).*` expands the returned row in the target list,
  and PostgreSQL is free to evaluate the function for each expanded column. For an entry whose
  guard tolerates a replay the second call is invisible — it inserts nothing, re-reads its own
  row and returns it. For a purchase receipt it is fatal: the first call takes the goods out of
  transit, the second finds `in_transit` short by exactly that quantity and refuses a legal
  delivery. The measured shape was three integration cases failing on a pristine build and
  passing on the rehearsal clone, which is the signature of state hiding a defect. Call it in
  `FROM` (`FROM merchant.append_stock_ledger(...)`), where it runs exactly once.
- **An integration suite must be pointed at the target it was written for.**
  `sql-preflight.integration.ts` builds a schema model and must run against a PRISTINE build.
  Pointed at the backfilled rehearsal clone it reports `modules/conversations/products.repository.ts`
  as newly unparseable — a file this increment never touched — and the same run against a fresh
  build passes with the same coverage numbers (851 statements prepared verbatim, 6 legitimately
  uncovered). A failure that appears only on the wrong database is not a regression; it is the
  instrument reading the wrong thing.
- **A rebuilt `@umi/contract/dist` can leave a stale ESLint cache behind.** Immediately after
  regenerating the contract, `pnpm --filter @umi/api lint` reported 121 phantom errors of the
  form `'SaleSnapshot' is an 'error' type`, in files nobody had edited. Running it again — or
  running it on one directory — reported zero. Re-run the linter before believing its first
  answer after a contract build.
- **A suite that seeds an append-only ledger must own its own merchant id.** The first run passes
  and the second fails with numbers that are higher but plausible — 600 napkins where the fixture
  received 200 — because the ledger refuses DELETE and the run measured its own leftovers. Deltas
  where the subject is a movement, a fresh id per run where the subject is an absolute number; the
  worked example is in the playbook §4, and `inventory-costing.integration.ts` is the second.
- **`bigint` and `numeric` come back from `pg` as strings**, and `numeric / numeric` carries a
  scale (`12.0000000000000000`). `Number()` rounds silently above 2^53, which is a wrong cost on a
  screen. Cast in SQL where the value is integral, refuse non-integers in TypeScript, and let the
  refusal be loud.
- **A suite that reads a window from the clock must own the clock.** `inventory-costing.integration.ts`
  seeded literal business dates — 2026-09-16 as "today" — while `lowStock` takes its window from the
  merchant's own `currentBusinessDate`. Written on the 16th it passed; on the 17th `forecast.to` came
  back `2026-09-17` and two assertions moved with it (`expected 2 to be 1`), which reads like a
  regression in the read and is really a fixture pinned to the day it was written. The fixture now
  reads the SAME expression the repository reads, immediately after it creates the merchant, and
  states every business date as an offset from it. Proven by running the suite with the merchant's
  timezone set to `Pacific/Kiritimati`, which puts its business date at 2026-09-18 — **20/20 green on
  a day the fixture was never written for**. The rule generalises: a test whose subject is a _window_
  (the last 28 days, this shift, today's takings) owns its clock the way an append-only ledger test
  owns its merchant id.
- **`vitest.integration.config.ts` includes only `src/**/*.integration.ts`.** A file named
  `*.integration.spec.ts` is therefore invisible to both `test:integration` and its three scoped
  families, and the default unit config picks it up and SKIPS it — `kds.repository.integration.spec.ts`
  reports "23 skipped" without `GATE4A_DATABASE_URL`, and nothing fails. It is covered, but only by
  `scripts/umi-pos-kds-concurrency-check.sh`, which builds its own database. A green `npm test` says
  nothing about it. When you audit which integration suites are covered, compare against every
  script that names a file, not only the ones whose name starts with `test:integration`.
- **A required field on a generated contract breaks every consumer's fixture, and only that
  consumer's own suite will say so.** Adding `courseNumber` and `fired` as required on
  `KitchenOrderItem`/`CartItem` made `apps/umi-pos/test/kitchen_board_test.dart` fail on `fromJson`
  in every one of its cases: **2 passing, 22 failing**, silently, because the API suite and the
  contract suite were both green and neither imports a Flutter fixture. A contract change is a
  change to both clients; run the OTHER client's suite before believing the change is contained.
- **A device-scoped table answers an unscoped reader with "nothing", and "nothing" looks like a
  pass.** The offline journal's tables (`offline_replay_command`, `offline_replay_conflict`,
  `device_replay_cursor`, `offline_provisional_mapping`) each carry a RESTRICTIVE `device_scoping`
  policy. An integration suite that writes as one device and then reads WITHOUT naming it gets an
  empty result — and the first version of `pos-offline.integration.ts` cheerfully reported "the
  journal is empty" and "nothing was committed" **while a sale was committed**. Every assertion that
  counts something has to run as the same identity that wrote it, with the device id in the scope,
  or the test asserts the absence it created. The tender suite records the same trap.
- **`created_at::text` on a `timestamptz` is not the contract's `Timestamp`.** Postgres renders it
  `2026-09-17 08:51:26.123+00`, which is not ISO-8601-with-offset, so a zod `.datetime({offset:true})`
  rejects the model the repository just published — and the failure lands in whichever client parses
  it, not in the query. Format in TypeScript (`toISOString()`) or cast to a shape the schema accepts;
  grep for `::text` on any timestamp column rather than trusting the ones you know about.

## 7. The verification engine

This workstream comes first, because every later workstream depends on it.

### Step F1 — Finish the click inventory

- Keep `tools/ux-sweep/click-inventory.mjs` and extend it with a `--click` mode.
- Classify each control as safe or destructive. Destructive controls carry a name
  pattern such as delete, void, refund, close, or cancel.
- Click the safe controls on a disposable database. Record the console errors, the
  failed requests, and the screens that result.
- Save one screenshot per screen and one per state change.

Acceptance: one command writes a report with every Dashboard control, its size, its
accessible name, and its result when clicked.

### Step F2 — Extend the POS harness

- Keep `tools/ux-sweep/pos-semantics-inventory.mjs`.
- Drive the app between screens with `patrol` so the harness can reach every surface.
- Record the same columns as the Dashboard report.

Acceptance: one command lists every actionable node on every POS surface with its size
and label.

### Step F3 — Visual regression

- Add Playwright screenshot assertions for the Dashboard routes.
- Add `alchemist` golden tests for the POS surfaces.
- Pin one viewport pair: 1024 x 768 and 1280 x 720.

Acceptance: a change to a shared style fails the check on the affected screens only.

### Step F4 — Accessibility gate

- Add `@axe-core/playwright` to the Dashboard checks.
- Fail the build on a serious or critical violation.
- Keep the POS semantics report as the Flutter side of the same gate.

Acceptance: both clients pass with zero serious violations.

### Step F5 — Flow budget test

- Count taps and seconds for the ten core flows.
- Store the numbers in a checked-in file.
- Fail the build when a flow exceeds its budget.

Acceptance: the money path stays at three taps or fewer.

## 8. Workstreams

Each workstream lists the goal, the evidence, the steps, and the acceptance test.

### A. Repair the migration chain

**Goal.** No live database can miss a column again.

**Evidence.** D1 and D3 above.

**Steps.**

1. Add `docs/migration/build-v3/63_channel_attribution.sql`. Use
   `alter table ... add column if not exists` for both tables, with the same check
   constraints as `20_merchant.sql`. Backfill `origin_channel` to `walk_in` for existing
   rows.
2. Register the file in `docs/migration/build-v3/00_run.sh`.
3. Revert the column definitions in `20_merchant.sql` to their state before `5eab37e`, so
   a fresh build and an upgraded build end in the same shape.
4. Set `EXPECTED_SCHEMA_VERSION=build-v3-63` in the local and pilot environments.
   (Deployment state has since moved to `build-v3-64` — see §13.)
5. Add a check to `scripts/check-pr.mjs`: a pull request that edits an applied migration
   file fails the check. Applied means any file already named in `runtime.schema_migration`.

**Tools.** `psql` against a scratch database, `docs/migration/build-v3/00_run.sh`, the CI
gate script, `gh run view <run> --log-failed` to read the gate, and a throwaway database
created for the test. The gate rule is the instrument: apply the chain twice, then compare
the RLS policy count.

**Acceptance.** A restored snapshot passes `/reportes`, and `pnpm check:pr` rejects an
edit to an applied migration.

### B. One shell, one design system

**Goal.** Both clients obey one set of measurements, and the shell stops failing the
touch bar.

**Evidence.** 237 undersized controls, all in the shell. The two clients disagree today.

**Steps.**

1. Write the tokens once in `packages/tokens`: spacing, radius, type scale, motion, and
   control heights. Add a 44 px minimum for any pointer target.
2. Replace the Dashboard chrome with primitives from Radix UI. Keep the visual language
   Umi's own. Do not adopt a default component theme.
3. Fix the shell controls: menu, theme, language, account, business selector, and the
   detail affordance.
4. Add `sonner` for toasts and `motion` for the small set of allowed transitions.
5. Offer a command palette for the Dashboard, and keep the POS without one.

**Tools.** `tools/ux-sweep/click-inventory.mjs` for every control and its size, the Chrome
DevTools coverage probe for every unused byte, `axe-core` for contrast and names, Radix UI
for primitives, and one token file in `packages/tokens`.

**Acceptance.** The click inventory reports zero undersized controls. A designer can read
the token file and rebuild any screen.

**Note on restraint.** A command palette helps an owner on a laptop. It must not appear in
the POS. Operators work with a fixed layout and a fixed vocabulary.

### C. Role-first experiences

**Goal.** Every role opens the screen that role needs, not the owner screen with fewer
buttons.

**Evidence.** The competitor matrix lists the roles each vendor names. The UX research
file gives the first screen for each role.

**Steps.**

1. Do not freeze the role list. Derive the roles from the work an operator does, then name
   the role after that work. Rename a role when the operation shows a better name. Keep one
   name per job, and keep the permission names stable underneath.
2. Proposed revision, checked against the competitor role matrix and the floor:

   | Role             | Name           | The work                                      |
   | ---------------- | -------------- | --------------------------------------------- |
   | Owner            | **Dueño**      | reads money and trend, not operations         |
   | Manager on shift | **Encargado**  | runs the shift, approves exceptions           |
   | Supervisor       | **Supervisor** | approves inside a limit, cannot change policy |
   | Cashier          | **Cajero**     | takes money, opens and closes the till        |
   | Waiter           | **Mesero**     | serves tables, owns a section                 |
   | Kitchen          | **Cocina**     | works the board                               |
   | Host             | **Anfitrión**  | seats guests, manages the wait                |
   | Read only        | **Consulta**   | reads, changes nothing                        |
   | Platform         | **Plataforma** | Umi staff, never a merchant role              |

3. Define one first screen per role, with the three numbers and the three actions that
   role must have in the first five seconds.
4. Enforce the split on the server. The client hides; the API decides.
5. Test each role against the permission matrix that already exists in
   `scripts/umipos-pilot-rbac.mjs`.

**Tools.** `scripts/umipos-pilot-rbac.mjs` for the grant matrix, CodeGraph to trace every
guard, Playwright fixtures that log in as each role, and the Flutter POS semantics harness
to prove what each role can reach on the device.

**Acceptance.** A cashier cannot reach a manager surface by URL, and a test proves it.

### D. Floor plan and table map

**Goal.** The fastest table map in the category.

**Evidence.** The floor plan editor alternatives research of 2026-09-13. The competitor
matrix shows table maps in every full-service vendor.

**Steps.**

1. Keep the existing Konva decision. Do not reopen it.
2. Add direct manipulation: drag a table, rotate it, resize it, and snap it to a grid.
3. Add table state on the map itself: open, seated, ordered, served, awaiting payment,
   and dirty. Colour alone must not carry the state. Add a shape or an icon.
4. Add merge and split of tables as one gesture, with a visible group boundary.
5. Add a turn timer on every seated table.
6. Add reservations. A booking holds a table for a time window, shows on the map, and warns
   on a conflict. Enforce the overlap in the database with an exclusion constraint, not
   with an application check.
7. Add a test suite that drives the map: 200 tables, a slow drag, a rotate, a merge, and
   a split, on both tablet shapes.

**Tools.** Konva for the editor, Playwright pointer gestures with CDP for the drag, rotate,
merge, and split tests, `patrol` and `integration_test` for the POS map, and `alchemist`
goldens for the drawn layout. Use a DevTools trace during a drag to prove the frame budget.

**Acceptance.** A server can move a party of eight from one table to another in fewer
than five seconds, a double booking is impossible at the database level, and the tests
prove both.

### E. Inventory and recipes

**Goal.** Owners trust the cost number, and cooks trust the stock number.

**Evidence.** Inventory is partial in Umi and strong in Lightspeed, Toast, and Fudo.

**Steps.**

1. Close the loop from recipe to sale. A modifier must consume stock.
2. Add yield and waste to a recipe, not only a quantity.
3. Add purchase orders, suppliers, and receiving.
4. Add a blind count that hides the expected number, then a variance step that needs a
   second person.
5. Add a costing view per plate and per day.
6. Add a low-stock forecast from the last 28 days of sales.

**Tools.** `fast-check` for the ledger and recipe arithmetic, `explain analyze` for every
stock query, the disposable database scripts for fixtures, and the DevTools probe on the
inventory screen.

**Status — step 3, built 2026-09-16 (build-v3-69).** Suppliers, purchase orders and
receiving exist, and the whole increment hangs off the stock model that was already here:
`stock_balance.in_transit` and `stock_ledger_entry.effect_in_transit` are what "on order"
means, so there is no second inventory. Sending an order posts `purchase_ordered`; receiving
posts `purchase_received` and moves the goods from transit to `on_hand`; cancelling posts
`purchase_order_cancelled` for the outstanding quantity and nothing else. The schema carries
the invariants — `purchase_order_line_not_over_received` refuses a delivery larger than the
order for every writer including raw SQL, and a receipt is immutable with no UPDATE or DELETE
grant at all — and `apps/umi-api/src/modules/procurement/procurement.integration.ts` proves
them against a real database: partial then complete receipt, over-receipt refused with nothing
moved, a replayed receive posting once, a cancel releasing exactly its transit, cross-tenant
refusal, and a raw `UPDATE` refused with SQLSTATE 23514. The console owns the surface
(`/api/merchants/:merchantId/suppliers`, `/purchase-orders`) because ordering stock is
back-of-house work; the till still reads and writes stock through its own versioned routes.
Evidence for the whole row is in §14. Steps 5 and 6 are still absent, and step 4's approval
step exists only as the command-level `approvalId` the inventory module already carried.

**Status — steps 5 and 6, built 2026-09-16 (contract 2.21.0, no migration).** The two reads that
make the numbers usable exist, as four console routes under
`/api/merchants/:merchantId/inventory-costing`: `cost-basis`, `plates`, `days` and `low-stock`.
They are gated by `merchant.manage` like purchasing, because reading what a plate costs and what
a day made is a manager's question about money, and an `inventory.*` key is carried only by POS
operator sessions, which would make the routes unreachable from the surface that needs them.

**The cost basis is the quantity-weighted average of the ACTUAL received unit costs**, taken from
`purchase_order_receipt_line` and never from `purchase_order_line`: an order is what the business
intended to pay, and a receipt is what it paid. **An item with no receipt has no basis and the
response says so** — `basis: "no_receipts"`, `unitCostMinor: null` — because a zero cost makes
every margin a hundred percent, which is the opposite of the goal this workstream was written for.
A plate whose component has no basis is reported `incomplete` and names the items, and a day whose
sales include a product nothing maps is reported `incomplete` too: a day that sold what no recipe
describes has an UNKNOWN cost of goods, and reporting zero there is the same lie one level up, in
the shape that looks like good news.

**The recipe expansion is the checkout's own expression**, copied deliberately into
`inventory-costing.repository.ts` with a comment saying why: a cost that disagrees with the
consumption it is costing is worse than no cost, so the conversion maths has to be the same maths.
Consumption itself is read from the ledger's `sale_committed` rows, so the two sides of a day come
from the same transactions, and a modifier's extra portion shows up as stock consumed without
entering the base recipe's cost.

All the money arithmetic lives in `inventory-costing-domain.ts` as pure `bigint` functions with
**one rounding step per answer**, and `fast-check` asserts its properties over generated inputs.
Evidence: 20 integration cases against the real schema (a plate costed to the centavo, the batch
divide, the half-up rounding case, the modifier, the untracked day, the window, the cross-tenant
reads) and 28 property-driven domain cases. The live read is
`tools/ux-sweep/inventory-costing-live.mjs`; the query plans, and the one index this will want at
volume, are recorded at the end of this file.

Step 4's approval step still exists only as the command-level `approvalId` the inventory module
already carried, and the dashboard screen that consumes these reads is the next piece.

**Acceptance.** A plate shows its cost, its margin, and the stock it consumed. A count
with a variance over the threshold requires an approval.

### F. Reporting and analytics

**Goal.** The operator sees the truth in one screen, and the owner sees the trend without
an export.

**Evidence.** The existing gap matrix marks sales analytics as absent. The channel feature
is broken today (D1).

**Steps.**

1. Fix D1 first. The channel row is already designed and already tested at the unit level.
2. Build a read model for sales: net sales, product mix, daypart, employee, channel, and
   location, with period-over-period comparison.
3. Render large series with `lightweight-charts`. Keep tables where a table is clearer.
4. Make every number open its own detail. A number that cannot open is a dead end.
5. Add a nightly rollup job. Do not compute a year of history on each page load.

**Tools.** `lightweight-charts` for large series, the DevTools probe for first paint and
coverage, a nightly rollup job for history, and `explain analyze` for the read model.

**Acceptance.** The Ventas screen loads in under one second with 24 months of history.

### G. Payments

**Goal.** One integrated tender path, with a typed outcome for every attempt.

**Evidence.** The gap matrix marks a payment gateway as absent. Every competitor
monetizes here. The provider choice is now made: **Conekta** is the payment provider, and
a **Mercado Libre terminal** handles physical card processing.

Primary-source research confirms the split, and adds one correction:

- **Conekta does not issue the CFDI.** The documentation index has no stamping endpoint, no
  UUID, no certificate upload, and no cancellation. The only use of the word is a merchant
  onboarding document. Source: the Conekta developer reference.
- **Conekta has no card terminal.** In-person card processing rests entirely on the
  **Mercado Pago Point** device. Conekta covers the online gateway and a QR flow.
- **Mercado Pago Point does not issue the CFDI either.** Mercado Pago states that invoice
  emission is not automatic.
- **Facturapi is the recommended stamping provider.** It covers stamping, cancellation with
  SAT motives 01 to 04, the payment complement, and the global invoice. Published price is
  $299 MXN per month plus $0.60 MXN per timbre.

The SAT gives 24 hours after the close of the chosen period to issue a document, and it
allows cancellation without receiver acceptance below $1,000 MXN.

**Steps.**

1. Write the ADR. Record both halves: Conekta for the gateway, Mercado Libre for the
   physical terminal. State which tenders each half owns.
2. Model the terminal as one adapter behind one interface. A second terminal brand must
   not change the checkout code.
3. Model three outcomes for every attempt: success, failure, and unknown. An unknown
   result must be queryable by the same command identity. Never record an operator
   assertion as provider proof.
4. Add capture, settlement, surcharge, and a payment-level refund.
5. Stamp the fiscal record on our side. Use Facturapi, and treat the stamp as its own state
   machine: pending, stamped, cancelled, with the 24 hour deadline visible to the owner.
   Store the UUID, the RFC, the payment form, and the payment method on the sale.
6. Keep the terminal replaceable. The Mercado Pago Point device is the only card-present
   path today, so one interface must hide it and a second brand must not touch checkout.
7. Add a property test for the tender arithmetic, and a stateful test for the
   success-failure-unknown sequence.

**Tools.** The Conekta sandbox and the Mercado Pago Point integration sandbox, webhook
replay to test a duplicate and a late event, `fast-check` for the stateful
success-failure-unknown sequence, and the fiscal provider sandbox for the stamp. Research
and the provider verdict live in `docs/research/2026-09-16-mexico-payments-and-fiscal.md`.

**Acceptance.** A retried payment never charges twice, a terminal timeout never marks a
sale paid, a cancelled sale cancels its fiscal document, and tests prove all three.

**Status — steps 2, 3, 6 and 7, built 2026-09-16 (build-v3-70, contract 2.21.0).** The
attempt model, the terminal port and the outcome arithmetic exist, with each invariant
held by the schema rather than by a service's good intentions.

**The attempt record is the one that already existed.** `merchant.pos_payment_attempt` has
carried an attempt, keyed by cart and tender, since `20_merchant.sql`, with `unknown` and
`timeout` as first-class outcomes; `70_tender.sql` adds the command identity, the provider,
the provider's own order and payment ids, the proof source, the tender draft id and the
capture claim to it. No parallel model was created — the procurement work's rule, applied
here — which is also why the till's existing cash path kept working while this landed.

**A retry cannot reach the provider twice, and that is three mechanisms, not one.** The
provider is asked only by the writer that wins `update … set provider_capture_at =
clock_timestamp() where provider_capture_at is null`, so "asked exactly once" is a fact in
the row rather than a promise in the service. `pos_payment_attempt_command_identity_uidx`
makes a second attempt for one command identity impossible, and `payment_attempt_tender_draft_uq`
does the same for a second attempt against one tender draft — which is what covers the case
the command identity cannot: a second tab, or an operator pressing again after the till lost
the first response. `tender.integration.ts` proves all three, including two captures RACING
for one draft, and asserts the count from the fake that did the talking
(`captureCalls.length === 1`) rather than from the code's own report.

**The unknown is a state with an obligation, not an error to retry.** `pos.tenderAttempt`
answers by the same command identity that started the attempt; a provider that never
answers, or answers with the terminal's own `action_required` (its documented "did not
answer within 40 seconds and the status does not change"), stores `unknown` and query-only,
never `paid`. The contract's existing refusal to store an unknown as a result is joined by
a schema rule: `payment_attempt_success_provenance_ck` requires every success to NAME what
proved it (`provider`, `cash`, `internal_ledger`, `operator_attested`), and
`payment_attempt_provider_proof_has_id_ck` requires proof that came from a provider to BE a
payment id. A `processed` that arrived without one is downgraded to unknown and the audit
says why — `tender-domain.ts` is incapable of producing an unproven capture, and
`fast-check` asserts that property over generated outcomes rather than over the ones
somebody thought of.

**An operator's word is recorded and not believed.** `pos.tenderAssert` exists because a
customer WILL say the payment went through while the terminal is silent, and an operator has
to be able to write it down. It writes an audit event and returns the attempt UNCHANGED with
`effect: "none"`; the integration suite asserts the row is byte-identical afterwards. The
only way a person's sentence reaches a sale is the commit's `operator_attested` path, which
declares itself in the row.

**The terminal is one adapter behind one interface** (`TenderProviderPort`), with cash and
the manual terminal as members of it rather than special cases above it, and a registry that
lists which providers this deployment can actually reach so the till offers a method only
when it will work. `pos.tenderProviders` reports `mercado_pago_point` as registered and
unavailable, naming the credentials it lacks: the live Point transport is deliberately not
written from an unverified reading of its API, and the scripted providers (behind
`TENDER_SCRIPTED_PROVIDERS`, off by default) are the second implementation that proves a
brand swap does not touch checkout.

**The checkout now refuses an unresolved capture.** A tender draft that was captured through
an adapter is linked by its own id: if that attempt is not `succeeded` the commit refuses
with `PAYMENT_UNKNOWN` and the attempt id, and if it is, the commit LINKS the attempt — the
same row gains its `tender_id` — instead of writing a second one, so the sale cannot come to
rest on a person's word. A tender with no captured attempt (everything the till does today)
takes the path it always did, now naming its proof: cash, `internal_ledger`, or
`operator_attested`.

**One upgrade lesson is written into the migration, because the fresh build hid it.**
`payment_attempt_success_provenance_ck` applied cleanly to an empty table and was
unsatisfiable on a database that had been trading: 102 recorded successes, every one a cash
sale, none with a proof source. The rule was NOT weakened and NOT scoped to provider-backed
rows; instead the backfill gives each existing row the provenance its own `method` column can
defend, and it is idempotent (`where proof_source is null`). Applied to the shared rehearsal
database: first run `UPDATE 102`, second run `UPDATE 0`.

Evidence: `apps/umi-api/src/modules/tender/tender.integration.ts` (18 cases against the real
schema, including a `fast-check` stateful sequence over arbitrary success/failure/unknown
histories) and `tender-domain.spec.ts` (13 property tests, 1,650 generated cases). The
constraints are also exercised from RAW SQL, because a rule the API enforces is a promise and
a CHECK is enforcement.

**Status — step 5, built 2026-09-16 (same schema, contract 2.21.0).** The fiscal record is its
own state machine in `merchant.fiscal_document`, and the module that drives it is
`apps/umi-api/src/modules/fiscal`: `stampSale` resolves a committed sale, writes the PENDING
row with its deadline before the PAC is asked, calls Facturapi through `FiscalPacPort`, and
ends `stamped` with the UUID, the RFC, the SAT payment form and method, or `error` with the
PAC's own sentence. Stamping the same sale twice calls the PAC once and returns the first
document. `documents` is the owner's deadline view — `withinDeadline`, `pastDeadline` and
whether a cancellation would need the receiver's acceptance, which for café-sized tickets it
would not. The clock is real arithmetic (`fiscalDeadline`, 24 hours from the operation or
from the period close) and it is property-tested rather than asserted once.

**The third acceptance sentence is wired where a committed sale is actually undone, and that is
not `sale.cancel`.** History matters here: `sale.cancel` refuses anything past
`draft`/`prepared`, and only a COMMITTED sale can have an invoice — so the obvious wiring
would have looked like the acceptance while never once running. The command that undoes a
committed sale is `pos.saleException` (`void`), and `FiscalService.cancelForSale` is called
there, on the SAME client inside the SAME transaction as the void. A PAC that refuses
propagates and rolls the whole command back, so an operator cannot end up with a voided sale
whose CFDI the SAT still considers live — nor with a cancelled CFDI for a sale that stands in
our books. A `full_refund` does NOT cancel the document: the SAT's instrument for giving money
back is a CFDI de Egreso (the credit note the Facturapi adapter already models as type `E`),
and cancelling the income CFDI would erase the record of a sale that happened. That instrument
is step 4's, and it is not started.

**Two schema corrections came out of building the module, and both are in `70_tender.sql` with a
guard so an already-migrated database is corrected rather than left behind:**
`fiscal_document_stamped_shape` was a biconditional on `status = 'stamped'`, which FORCED a
writer cancelling a stamped document to null its `uuid_folio` — erasing the one fact a
cancellation is about. It now says what is true: a stamped document has the folio and the
stamping time, the two travel together, and a cancelled document may keep them. The other is
the four-value `TenderProofSource` above.

**The till's tender surface now offers cash, the manual terminal and the card terminal, and a
divided check is an explicit decision** (2026-09-17). A second method tile REPLACES the first; a
second leg joins only after the operator arms `Dividir el pago`, the legs are named in the order the
money is taken — cash first, because the change is measured from it — and a split that does not
cover the bill says by how much and keeps the charge button inert rather than letting the server's
`REMAINING_BALANCE` be the first word on it. A location that takes one method per sale says so
instead of hiding the control. The reasoning is §2.6 of the tender-path ADR; the real-tap evidence
is the native flow `tender-split-is-a-decision`.

**What is still missing here.** Step 4's remainder — settlement, surcharge and a payment-level
refund, plus that credit note. Nothing in
`apps/umi-pos` calls `pos.tenderCapture` yet, so no live provider has ever been called, the
three outcomes have never occurred in real data (only in the scripted fakes), and the
manual-terminal settlement path — the one tender whose resolver is a person, and which the
commit's guard would refuse while its attempt is unresolved — has no route yet. The fiscal
module also cannot persist the PAC's XML and PDF URLs, because the table has no columns for
them; it stores the PAC's document id, from which both can be fetched, and the fiscal screen
is the increment that will say whether that is enough. And `fiscal_document.order_id` is NOT
NULL with `unique (merchant_id, order_id, kind)`, which is right for a per-ticket CFDI and
wrong for a factura global that aggregates a period — an open decision, recorded at the end
of this file rather than guessed at.

### H. Kitchen display

**Goal.** A real station board, driven by the API, in real time, inside the POS.

**Correction to the earlier draft of this plan.** The kitchen display is not absent, and
it is not a separate application. The decision is already made and already implemented.

- The written decision is
  `docs/architecture/2026-09-06-unificar-kds-en-pos-modos-por-rol-adr.md`: unify the KDS
  inside the Flutter `umi-pos` app as a device role mode.
- An independent primary-source check is
  `docs/research/2026-09-06-pos-kds-client-architecture-vendor-research.md`. It reports that
  only Toast documents the one-app pattern, and that Square and Lightspeed ship a separate
  client. The decision stands. The correction is that the market does not require a second
  app, and the shared backend is the part the evidence supports.
- `apps/umi-pos/lib/features/kitchen/kitchen_board_surface.dart` states it:
  _"Opens the unified KDS mode (PoloTab pattern): the same app, on a device that runs the
  kitchen, shows the order board full-screen."_
- `showKitchenBoard()` pushes the board as a full-screen route.
- The POS bottom navigation carries a **Cocina** tab, gated on the presence of the kitchen
  board controller. The check is at `catalog_surface.dart:650`.
- The board reloads on an 8 second timer (`kitchen_board_surface.dart:46`). The source
  comment says a realtime feed replaces that poll once device identity unifies.
- `apps/umi-kds` is the older native Swift client. It is deprecated. Only one competitor
  ships a separate kitchen app, so a second client is not a differentiator.

**Steps.**

1. Retire `apps/umi-kds`. Delete the directory, drop its entry from
   `pnpm-workspace.yaml` and from `scripts/lib/release-manifest.mjs`, and correct the
   pilot deployment documentation. Correct `docs/product/UMIPOS_CASOS_DE_USO_Y_ROLES.md:3089`
   too: it still says UmiPOS does not implement the kitchen client.
2. Gate the Cocina tab on a permission, not only on the controller. A cashier must not
   reach the board.
3. Add per-item state to the board. A cook marks one item done, not the whole ticket.
4. Add courses and staging, so a dessert does not leave with the starters.
5. Add recall, with a visible marker and a time window.
6. Add an all-day count per item, because a cook reads that number first.
7. Route a ticket by product, by category, and by location default. Refuse a rule that
   names a product and a category together.
8. Replace the 8 second poll with the realtime channel, and keep the poll as the floor.

**Tools.** The Dart VM semantics harness for the board contents, `patrol` for the flow,
the POS web build with the DevTools probe for performance, and Postgres `listen/notify` or
the realtime channel for the feed.

**Acceptance.** A cook works a full service from the POS board without a second device.
A ticket reaches the correct station in under one second. The board survives a network
drop without losing a ticket. The native client no longer builds or ships.

### I. Channels

**Goal.** An order arrives once, from any channel, and lands in the POS and the kitchen.

**Evidence.** The gap matrix marks online ordering, QR ordering, and delivery as absent.

**Steps.**

1. Build one order writer. Every channel writes through it.
2. Add QR order and pay for a seated table.
3. Add a web order page on the same catalog.
4. Add delivery aggregation for the Mexican market. Start with **Rappi**, then **DiDi**.
5. Link, do not merge. Keep the channel identity on the order, as the channel ADR states.

**Step 2 was deferred on a question it does not have to answer (resolved 2026-09-17).** The blocker
was "pay-on-page versus pay-at-counter", but the acceptance sentence says nothing about where the
money is taken — so the table channel ships as **order intake** with payment at the counter, and
pay-on-page becomes an additive step on the same order when Conekta lands. The reasoning is §9 of
`2026-09-13-pos-channel-attribution-adr.md`; the consequence is that the guest surface must SAY the
order is paid at the counter and must not offer a payment step.

**Tools.** The Rappi and DiDi partner sandboxes with webhook replay, a QR generator for the
table flow, and Playwright to drive the ordering page end to end.

**Acceptance.** A QR order appears in the POS cart and on the kitchen board with no
manual step.

### J. Loyalty and stored value

**Goal.** The owner runs a program without a marketing agency.

**Evidence.** Loyalty is partial in Umi and absent in PoloTab. Stored value is strong in
Umi already.

**Steps.**

1. Add tiers, a reward catalog, and an enable switch the owner controls.
2. Add birthday and expiry jobs.
3. Add a consent record on every marketing field.
4. Keep WhatsApp as the channel edge, because it is the strongest asset Umi holds.

**Tools.** `fast-check` for the points and stored-value arithmetic, `psql` for the ledger
checks, the scheduler for expiry, and the DevTools probe on the loyalty hub.

**Acceptance.** An owner configures a tier, issues a reward, and sees the ledger.

### K. Offline and realtime

**Goal.** The till keeps working when the network stops, and the client returns to a
correct state without a person rebuilding it.

**Evidence.** Offline is a Umi strength. The gap is automatic replay and a real
connectivity source.

**Steps.**

1. Add an operating-system connectivity source.
2. Replay automatically on reconnect, in order, once.
3. Query an unknown result before any reuse of a command identity.
4. Add a Redis adapter to the realtime gateway for multi-replica scale.
5. Keep the poll loop as the floor.

**Tools.** The existing offline journal tests, CDP `Network.emulateNetworkConditions` to
cut the link for real, the Redis adapter for multi-replica work, and the replay tests.

**Acceptance.** A cash sale made offline lands once after reconnection, and the shift
total matches the ledger.

### L. Agent and developer experience

**Goal.** A person or an agent can change this product and prove it works.

**Evidence.** This sweep needed two new harnesses and several manual steps. The tooling
research lists the gaps in the repository itself.

**Steps.**

1. Keep CodeGraph current. Add a sync step to the development loop.
2. Publish the click inventory, the POS inventory, the visual tests, and the accessibility
   gate as one command: `pnpm ux:verify`.
3. Add `knip` for dead code and phantom dependencies.
4. Keep the typed contract as the single source. Regenerate it in the same command.
5. Add `fast-check` for the money domain and the offline replay rules.
6. Add a documented local reset that reproduces the pilot database in one command, so an
   agent can test on real shape data.
7. Publish the toolbox from section 6 as the standard loop, so no session starts from an
   empty terminal.

**Tools.** CodeGraph for structure, `knip` for dead code, the two UX harnesses, Playwright
and `patrol` for flows, `gh` and the Vercel CLI for deploys, and one `pnpm ux:verify`
command that runs the whole set.

**Acceptance.** A new contributor runs three commands: install, start, verify.

## 9. Sequence

| Phase                    | Contents                                        | Exit criteria                                                                                        |
| ------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 0. Stop the bleeding     | Workstream A, plus the shell hit targets from B | Reportes loads. No undersized shell control.                                                         |
| 1. See everything        | Workstream F1 to F6                             | One command reports every click, every size, every flow budget, and a first paint number per screen. |
| 2. One language          | Workstream B, then C                            | One token file. Every role has a first screen.                                                       |
| 3. The hard surfaces     | Workstream D, then E                            | The floor plan and the inventory pass their test suites.                                             |
| 4. Money and the kitchen | Workstream G, then H                            | Conekta, the terminal, and the CFDI are live. The POS board is complete.                             |
| 5. Reach                 | Workstream I, then J                            | A QR order flows end to end. A tier program runs.                                                    |
| 6. Scale                 | Workstream K, then L                            | A multi-replica deployment passes the realtime and offline tests.                                    |

Phases 0 and 1 are the priority. They remove a visible defect and build the instrument
that proves every later claim. Phase 3 carries the reservations commitment. Phase 4 carries
the fiscal commitment.

**Where the sequence actually stands, 2026-09-16.** Written after the workstream table below
was audited row by row, because a sequence with no position on it is a diagram rather than a plan.

| Phase | State                                                                                                                                                                                                                                                                                                                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | **Met.** `/reportes` loads — and its pinned baseline had been an outage frame, so the gate is now comparing the real screen (see F).                                                                                                                                                                                                                                                              |
| 1     | **Met.** One command reports every click, every size, every flow budget and a first paint per screen, for the dashboard (F1–F6) and natively for the till, where the instruments themselves were repaired twice.                                                                                                                                                                                  |
| 2     | **Met.** One token file; every role has a first screen (`check:role-surfaces`, 96 assertions over 24 surfaces).                                                                                                                                                                                                                                                                                   |
| 3     | **Met on E, and one decision short on D.** The inventory passes its suites and both halves of its acceptance are verified (see E). D's acceptance is measured on the server (a party of eight moved in 63.1 ms) and driven by hand on the till, but no table in the seeded plan seats eight and a merged party cannot be relocated onto a smaller one — an owner decision, not a missing feature. |
| 4     | **In flight.** The tender ADR is written and the attempt model is being built; neither provider is live and no capture has ever been taken. On the kitchen side the board is now workable (per-item bump, ticket moves, recall) and steps 4, 6 and 7 — courses and staging, all-day counts, routing rules — are open.                                                                             |
| 5     | **Not started, except its receiving end.** A channel can land in the till (the writer, the binding and the incoming-orders surface all work); there is no QR order-and-pay, no web order page and no delivery aggregation feeding it, so the acceptance is unproven. J is partial.                                                                                                                |
| 6     | **Not started.** K is partial (device identity and a durable journal exist; the connectivity source, ordered replay and the Redis realtime adapter do not) and L is mostly done.                                                                                                                                                                                                                  |

## 10. What to remove

The plan also strips work. Each item below costs more than it returns.

1. **The Dashboard "operations" bridge.** Two navigation models confuse operators. Keep
   one.
2. **Polling in the POS and the KDS.** Replace it with a stream and one fallback poll.
3. **Any second component theme.** One token file, one primitive library.
4. **`apps/umi-kds`, the native kitchen client.** The decision is made: the POS owns the
   kitchen board. A separate client doubles the work for a capability that one competitor
   even ships. Delete it and keep the history.
5. **The external-terminal "success" simulation.** Keep the unknown outcome. A false
   success is worse than an honest unknown.

Three removals are done, one of them found by a tool have since been done, and one more was found by a tool:

- **`apps/umi-kds` is deleted** (item 4), with the workspace map, the handoff notes and the pilot
  docs corrected to say the kitchen board is the POS's Cocina destination.
- **`apps/umi-dashboard/src/lib/supabase.js` is deleted** — found by `knip` once its aliases were
  configured, then checked by hand: no importer anywhere in the app, and it imported
  `@supabase/supabase-js`, which the app does not declare. A module that cannot resolve is not a
  module.

## 11. Open decisions for the owner

Closed since the first draft:

- **Payments:** Conekta is the gateway. A **Mercado Libre** terminal handles physical cards.
- **Fiscal record:** it is ours. Confirmed by primary sources: neither Conekta nor Mercado
  Pago Point stamps a CFDI. **Facturapi** is the recommendation, at $299 MXN per month plus
  $0.60 MXN per timbre.
- **Kitchen display:** the POS owns it. `apps/umi-kds` is deprecated.
- **Delivery:** **Rappi** first, then **DiDi**.
- **Floor plan:** reservations are in the first release, with a database constraint.
- **Dashboard:** web only for now. A native tablet build is a later question.
- **Roles:** not a fixed list. The names follow the operation. Section 8C proposes a set.

Still open:

1. Approve Facturapi, or ask for a second quote from another PAC.
2. Does the waitlist live on a host screen, or inside the floor plan?
3. When does the Dashboard deserve a native tablet build, and what triggers that?
4. Which single metric decides that the shell rebuild succeeded?

## 12. Sources

Every claim in this plan traces to one of these files.

- Design law and interaction rules: `docs/research/2026-09-15-ux-patterns-and-design-north-star.md`
- Tools, versions, and adoption cost: `docs/research/2026-09-15-tooling-and-design-system-landscape.md`
- Mexico payments and fiscal: `docs/research/2026-09-16-mexico-payments-and-fiscal.md`
- Agent toolbox and Chrome DevTools: `docs/research/2026-09-16-agent-toolbox-and-devtools.md`
- Research channels and fallbacks: `docs/research/2026-09-16-research-channels-playbook.md`
- Competitor matrix: `docs/research/2026-09-15-competitor-feature-matrix-fudo-softrestaurant-clover.md`
- First competitor scan: `docs/research/2026-09-06-competitive-scan-and-gap-audit/README.md`
- Capability inventory: `docs/research/2026-09-06-restaurant-pos-kds-feature-inventory-research.md`
- Measured click data: `tools/ux-sweep/click-inventory.mjs` output
- Measured POS data: `tools/ux-sweep/pos-semantics-inventory.mjs` output
- Channel decision: `docs/architecture/2026-09-13-pos-channel-attribution-adr.md`

## 13. Progress

A ledger of verified work, so the next session starts from evidence rather than from
memory. Every row names the command that proves it. A row is only here after the
command was run and its output read. Updated 2026-09-16.

### Phase 0 — stop the bleeding — DONE

| Item                     | Evidence                                                                                                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 fixed                 | `docs/migration/build-v3/63_channel_attribution.sql`. `GET /api/merchants/<id>/operations/reports/sales?range=last_30_days` went from **500** to **200**: 10 orders, 78700 minor units, `channelMix: [{walk_in, 10 orders}]`. |
| 20_merchant.sql reverted | `git diff 5eab37e^ -- docs/migration/build-v3/20_merchant.sql` is empty, so a fresh build and an upgraded build end in the same shape.                                                                                        |
| D3 closed by the PR gate | `node scripts/check-pr.mjs` fails on an edit to `48_customer_value_worker_scope.sql` ("DDL FREEZE VIOLATED … applied as build-v3-48") and passes on a new numbered file.                                                      |
| Shell hit targets        | `pnpm ux:inventory` → **0** shell controls under 44px. Menu 44x44, Theme 44x44, Language 84x44, Account 133x44, Location 95x44, View detail 44x44, Edit 45x44. Undersized overall: 297 → **82**, all screen-level.            |
| Gate green               | `pnpm check:pr` exit 0 (contract, pilot RBAC, lint, warning baseline 66, prettier, the D3 gate, use cases).                                                                                                                   |

Two corrections the work forced, both recorded in the migration rather than in prose:
`merchant.pos_cart` carries a lifecycle guard that refuses an update to a committed cart,
so the backfill lifts it for one statement and puts it back; and `90_rls.sql` grants the
cart's UPDATE column by column _before_ this file runs, so the two new columns need their
own `grant update`.

### Phase 1 — see everything — DONE

| Step                                                            | Status                     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 click inventory + safe/destructive audit                     | done                       | `pnpm ux:inventory`; `pnpm ux:click-audit` (22 routes classified, 0 clicks by default).                                                                                                                                                                                                                                                                                                                                                                    |
| F2 POS harness driven by `patrol`                               | done, by substitute        | `patrol` 4.10.0 ships `android, ios, macos, web` and **no linux** (pub.dev manifest), and this workstation's only Flutter device is Linux desktop, so it cannot drive the POS §3.2 measured. `tools/ux-sweep/pos-surfaces.mjs` drives the web build the repo already runs (`scripts/umi-pos-firefox.sh`) over CDP. Final: 11 surfaces, 127 actionable, **0 unnamed, 0 under 44px**, exit **0** — and `--viewport 1280x720` measures the counter shape too. |
| F3 visual regression                                            | done                       | `pnpm ux:visual` — 10 baselines (5 routes x 2 pinned viewports), 10 passed. Volatile text (clock, `LIVE`) is masked from the harness.                                                                                                                                                                                                                                                                                                                      |
| F4 accessibility gate                                           | **done, GREEN**            | `pnpm ux:a11y` exit **0**, 0 critical and 0 serious on all 22 routes. The 7 blocking findings are gone: the six hand-rolled `role="tablist"` filter strips are one named `Segmented` component (`role="group"` of `aria-pressed` toggles), the `/loyalty-value` em dash got a real name in the DOM instead of a prohibited `aria-label`, and the two colour pairs were darkened to 3.1:1 and 4.5:1. `ux:verify` now runs it as a HARD gate.                |
| F5 flow budget test                                             | done except the money path | `pnpm ux:flows` — 9 flows within 1-2 taps; `money-path-pos-charge` reported `not-yet-instrumented` because it needs F2.                                                                                                                                                                                                                                                                                                                                    |
| F6 DevTools memory, throttling, tracing, screencast, Lighthouse | done                       | `memory-shift.mjs` (heap 27.12 → 10.97 MB/min across halves, "still climbing in this window — investigate", which is all a 3-minute run can say), `perf-throttle.mjs` (slow-4g: FCP 8.4–8.9 s on the unbundled dev server), `trace-flow.mjs` (156,348 events, 32.22 MB), `trace-screencast.mjs` (436 frames), `perf-lighthouse.mjs` (performance 50, accessibility 94).                                                                                    |
| `pnpm ux:verify`                                                | done                       | exit **0** end to end with the accessibility gate now a HARD gate: `inventory && click-audit && flows && a11y && first-paint && visual`. It reports every click, every size, every flow budget and a first paint number per route. Final reading: 22 routes, 693 controls, **0 undersized, 0 unnamed**, 0 critical/0 serious axe findings, 10 flows with 0 failures, median FCP 460 ms, 0 429s, 0 degraded shells.                                         |

### Defects the new instruments found

The sweep is supposed to pay for itself by finding things. It did. Every row below was found
by running the harnesses, not by reading code.

| ID  | Defect                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D4  | **The POS cart-recovery path 500'd.** `PosCartRepository.create()` sent `ON CONFLICT DO UPDATE SET business_date=…`, and `90_rls.sql` withholds UPDATE on that column from `api` on purpose. Postgres reports a missing column privilege as `permission denied for table pos_cart`. 318 occurrences in the API log, the first hours before build-v3-63 — pre-existing, and on the money path. The operator saw _"No fue posible completar la acción de venta de forma segura."_ | **Fixed** by `docs/migration/build-v3/64_pos_cart_recovery.sql`: a `SECURITY DEFINER` helper derives the date server-side and re-asserts merchant/location scope. The recovery branch went 500 → **201** through the real POS, and the toast is gone. `business_date` is still not updatable by `api`.                                                                                                                                                                                                        |
| D5  | The re-stamp D4 protects is **inert**: trigger `merchant.pos_cart_business_date` (`60_triggers`) re-derives `business_date` from `created_at` on every insert or update, so a cart recovered the next morning keeps yesterday's date — the exact stale-date failure the code comment says it is preventing. Measured, not inferred: a cart created 2026-09-03 and recovered 2026-09-16 still reads `2026-09-03`.                                                                | **Open.** Needs a new migration; the trigger lives in an applied file.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D6  | `POST /api/{merchantRef}/admin/staff` creates the operator's auth user as `invited`, but `findPosPinStaff` joins `umi.user … AND u.status='active'`. Every operator created that way can never sign in at the POS — the PIN is rejected as `PERMISSION_DENIED`.                                                                                                                                                                                                                 | **Fixed.** The till reads the EMPLOYMENT and the login's suspension, not its invitation: `POS_PIN_LOGIN_STATUSES = ['active','invited']` as an allow list (so a status added later fails closed). Verified live: 403 → **201** on the created operator, refused again when suspended or when the staff record is disabled, and the three refusal bodies are byte-identical.                                                                                                                                   |
| D7  | Device enrolment binds `platform`, and the POS claims as `web` on a web build while an enrolment opened as `linux` cannot be claimed. First-time pairing fails with `ENROLLMENT_REJECTED` unless the two agree.                                                                                                                                                                                                                                                                 | **Open.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D8  | The POS **Inventario** surface renders an error screen (_"No fue posible completar la operación de inventario"_) and **Centro de recuperación** reports offline recovery unavailable on web.                                                                                                                                                                                                                                                                                    | **Open, reported as `error`/`unavailable` states**, never counted as working surfaces.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D9  | The `nest start --watch` dev loop does not reliably recompile or restart. Its child was observed running a dist **13 minutes older** than the compiled change, so source edits silently did not reach `:4001`.                                                                                                                                                                                                                                                                  | **Open, now diagnosed.** It is not "never respawns": a **failing compile wedges it** — the watch logged `Found 117 errors` (an unresolvable `@umi/contract` declaration while the contract was being rebuilt) and then never respawned, and overlapping edits from several agents produced the same stall. Cost every agent this session at least one stale-code probe. Workaround used: compare `ps -o lstart= -p $(pgrep -f 'dist/main')` against the dist mtime, and restart the watch when dist is older. |

| ID  | Defect                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D10 | **A suspended login could still sign in.** `findCredentialByEmail` never filtered `umi.user.status`, so suspension — the standard response to a departing or compromised employee — revoked nothing on the password path. Reproduced live before the fix: a suspended account got **HTTP 201** and a full session.                                                                                                                                                       | **Fixed.** The read is now `findSignInCredentialByEmail` with `status = ANY(PASSWORD_SIGN_IN_STATUSES)` and the ungated name is deleted rather than left as a tempting sibling; every caller (dashboard login, forgot-password, Umi Cash login) inherits it, and `refresh()`/`posRefresh()` re-check on the round trip they already make. Live: 201 → **401**, and a suspended account can no longer start a password reset (token rows 0 → 0, against 0 → 1 for the same account while active). Residual: an already-issued access token stays valid for its own TTL (≤15 min). |
| D11 | `security_gate.sql` fails one assertion: **8 accounts share one password hash+salt** (`admin@elgranribera.mx` and siblings, newest 2026-05-16), so they share one password. The gate's own AB#116 rule allows at most four.                                                                                                                                                                                                                                              | **Open — data, not code.** Needs an owner decision about those accounts. The gate itself is right to fail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D12 | `findUserById` requires `password_hash IS NOT NULL`, so a **PIN-only invited operator** is refused there as a missing user: the till opens for them and then cannot renew one access TTL later.                                                                                                                                                                                                                                                                          | **Open.** Reported rather than patched, because the same read decides what `/me` and the dashboard refresh resolve; the gap is written into `posRefresh`'s comment. The fix is a till-specific read that does not demand a password.                                                                                                                                                                                                                                                                                                                                             |
| D13 | **A transient API failure destroyed the operator's session.** `refreshSession()` collapsed every failure into `false`, and every caller treated `false` as a dead session — so a **429** from the rate limiter, a 5xx or a dropped connection cleared `localStorage` and bounced the operator to `/login`. This corrupted several verification runs today, including a full `ux:verify` whose flow steps "failed" on selectors that resolve perfectly on a live session. | **Fixed.** Three named outcomes: `REFRESH_OK` / `REFRESH_TRANSIENT` / `REFRESH_DEAD`. Only 401/403 or an auth-shaped body is dead; 429/5xx/network keeps the session and arms one bounded retry (15s → 240s, one in flight, no stacking). Live proof with an intercepted 429: stayed on `/`, key present, retry fired; with a 401: `/login`, key cleared, no retry.                                                                                                                                                                                                              |
| D14 | The **copy-to-all button on `/hours` is ~73 % occluded** by the next card (card ends x=806, the 44px button sits at 812–856, right column starts 824). Measured, pre-existing. Attempting the obvious grid fix squeezed the time fields to 58 px and made `07:30 AM` illegible, so it was reverted: the correct fix is a layout decision, not a size fix.                                                                                                                | **Open.** Needs a layout decision; recorded so it is not lost.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### The 3.5 rate limit — fixed

The plan's one open production risk besides the workstreams: "every client behind one
address shares the budget". The forwarded-address half was already right — `main.ts` sets
Fastify's `trustProxy` from `TRUSTED_PROXY_CIDRS` and both `clientIp` helpers use `req.ip`
rather than the spoofable leftmost `X-Forwarded-For`. The missing half was the principal:
the global `IpRateLimitGuard` bucketed every caller on the address alone.

It now verifies the access credential itself (cookie or POS bearer, via the shared
`JwtService`; anything that does not verify falls back to the **stricter** ceiling) and
charges the address bucket at `RATE_LIMIT_IP_AUTHENTICATED_PER_MINUTE` (3000, ten times the
anonymous 300) once a principal is proved. Address and principal are now separate
concerns — this guard bounds the address, `OperationalInterceptor` bounds the principal
(`user` 240, `device` 240, `tenant` 1000, `branch` 600) — and a bucket is charged in exactly
one place. A duplicated charge that briefly halved the per-user allowance to 120/min was
found and removed in review.

Measured: one authenticated request costs **one** unit (`239, 238, …, 234` across six
requests in one window), anonymous still starts at 300.

### What the next session should pick up — first pass (items 1-3 are now DONE; see the second pass at the end of this file)

1. **Turn F4 green**: 7 blocking axe findings — 4 critical `aria-required-children`
   (/orders, /staff ×2, /customers, /conversations) and 3 serious (`color-contrast` on
   /profile and /, `aria-prohibited-attr` on /loyalty-value). Add `ux:a11y` to `ux:verify`
   the moment it passes. That is the last unmet Phase 1 acceptance line.
2. **Finish workstream B** in the same pass: the remaining 82 undersized dashboard controls
   are on exactly those screens (`/settings` 25, `/hours` 18, `/orders` 10, `/customers` 6,
   `/conversations` 6, `/loyalty-value` 6, `/catalog-inventory` 3, `/staff` 3,
   `/diagnostics` 3, `/login` 2), plus **14 on the POS** (`Comer aquí` 127×40, `Para llevar`
   127×40, `POSTRES` published as a button clipped to 8px, the two 48×37 denomination
   steppers, four 38px filter chips, two sub-30px list rows).
3. **The money-path tap budget (F5)** is the one flow still `not-yet-instrumented`. It needs
   an open cash shift before a cash charge can complete, so the harness must open one first.
   D4 was blocking it; that is gone.
4. **D5, D6, D7** — the inert cart re-date, the `invited` operator, and the enrolment
   platform mismatch. All three are small, all three are in the POS's first-run path.
5. **D9, the dev watcher.** Until it is fixed, "did my change reach the API?" is a question
   each session has to answer by comparing `dist` mtimes against the pid. That is workstream
   L's "a person or an agent can change this product and prove it works", failing.
6. Re-record the F3 baselines whenever the dashboard's own data changes; `/reportes`
   correctly failed the check once D1 was fixed, which is the instrument working.
7. Still open from §11, needing the owner: approve Facturapi, decide where the waitlist
   lives, and pick the single metric that says the shell rebuild succeeded.

### What the next session should pick up — second pass, 2026-09-16 (its "Phase 2 is next" call was taken up: see the third pass at the end of this file)

Both phases above are now done and every gate is green: `pnpm ux:verify` exit 0 (with the
accessibility gate as a hard gate), `pnpm ux:pos` exit 0, `pnpm check:pr` exit 0. The
dashboard half of workstream B is finished — **0 undersized controls and 0 unnamed controls
on all 22 routes, 0 critical and 0 serious axe findings** — and the POS half reaches
**0 under 44px** once the harness measures a control after scrolling it into view instead
of judging a clipped rect.

That makes **Phase 2 the next phase**: workstream C, role-first experiences. Read its own
acceptance line before starting ("A cashier cannot reach a manager surface by URL, and a
test proves it") — `scripts/umipos-pilot-rbac.mjs` already holds the grant matrix, and
`pnpm umi-pos:check-pilot-rbac` already runs in `check:pr`, so the substrate is there.

Still open, in the order I would take them:

1. **F5's money path.** The one flow still `not-yet-instrumented`: a cash charge needs an
   open cash shift first. D4 was in the way; that is gone, and D12 is now the next thing in
   the way — a PIN-only operator can open a till but cannot renew it.
2. **D12**, then **D5** (the cart re-date trigger makes the recovery re-stamp inert — the
   upsert writes the date and the trigger overwrites it from `created_at`), then **D7**
   (enrolment binds `platform`; a `linux` enrolment cannot be claimed by the web build).
3. **D8** — the POS `Inventario` surface is an error screen and `Centro de recuperación`
   reports offline recovery unavailable on web. Both are reported honestly as
   `error`/`unavailable`, never counted as working surfaces.
4. **D14** — the occluded `/hours` copy-to-all button. A layout decision, not a size fix.
5. **D11** — 8 accounts sharing one password hash. Data, and the security gate is right to
   fail on it; needs the owner.
6. **D9** — the watch loop wedges on a failing compile. Workaround documented above; the
   real fix belongs to workstream L.
7. Re-record the F3 baselines whenever the dashboard's data changes; and note that the
   visual gate's 2 % budget ignores anti-aliased pixels, so a baseline can sit at 90 % of
   its budget and still pass. One stale baseline was re-recorded this pass for that reason.

Two numbers worth carrying forward honestly: the money-path budget is still unproven rather
than passing, and the DevTools numbers in F6 are dev-server numbers — §4's one-second bar
cannot be judged until someone runs `pnpm build && pnpm preview`.

### Third pass, 2026-09-16 — Phase 2, workstream C

**Workstream C's acceptance line is met and enforced.** "A cashier cannot reach a manager
surface by URL, and a test proves it" — there are now two tests, and one of them runs inside
`pnpm test`.

| Item                                     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The gap, measured first                  | As the seeded cashier, `GET /api/{ref}/admin/settings` and `GET .../reward-config` answered **200** while the Dashboard hides those screens behind `merchant.manage`. `GET/PATCH .../admin/hours` refused only because the location resolver stopped, not because of a permission. The reward-config **write** answered **200** for a cashier too.                                                                                                                                                                                                                                                                                                                                                             |
| Server enforces what the client declares | `merchant.manage` on the settings read and write; `merchant.manage` on hours and on the reward-config write; **`loyalty.read`** on the reward-config read (the weaker gate is deliberate — umi-cash's till home and the Dashboard's loyalty hub read it, and an over-tight gate briefly broke that panel); `customer.read` on every customer and triage read, closing a latent hole where a future role without it could have read customer records.                                                                                                                                                                                                                                                           |
| The live test                            | `pnpm check:role-surfaces` — a contract (`config/umipos-surface-permissions.json`, 22 surfaces) plus a script that signs in as four roles and asserts the measured status. Final: **88 assertions, 0 failed**, with the cashier and manager refused on every manager surface, admin and owner allowed, and the routes a cashier legitimately keeps asserted too so the gate cannot be over-tightened.                                                                                                                                                                                                                                                                                                          |
| The test that cannot be skipped          | `apps/umi-api/src/modules/auth/role-surface-contract.spec.ts` (22 tests) source-parses every controller with the TypeScript compiler API and fails when a handler's guard drifts from the contract, when a measured refusal is not explained by the permission, and when a permission-gated Dashboard module has neither a contract row nor a checked exemption. Proved with three induced failures, each restored and hash-verified.                                                                                                                                                                                                                                                                          |
| One first screen per role                | `apps/umi-dashboard/src/lib/role-landing.js`, grounded in §3.2 of the UX research file: owner and admin to `/`; manager and supervisor to `/operations` (their research screens — shift board, floor and service board — do not exist yet and belong to workstream D); cashier to `/cash-shifts`; everything else to the first screen it may actually see, never `/`. Verified live per role: cashier landed on `/cash-shifts` reading "Cash and shifts", manager on `/operations` reading "Operations center", owner and admin on `/` reading the greeting — and the no-bounce rule was proved by clicking away and back. The cashier and manager also make **zero** requests to the gated settings endpoint. |

**Six more defects, four of them fixed in this pass.**

| ID  | Defect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | State                                                                                                                                                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D15 | `POST /api/auth/local/login` allows **20 attempts per 15 minutes per IP**, against an in-process Map. A venue behind one NAT, or any scripted verification, shares it; the role-surface gate spends four per run and an agent hit it mid-verification.                                                                                                                                                                                                                                                                                                          | **Open.** Needs the same treatment §3.5's limit got: an authenticated allowance, and a store that is not process-local. Restarting the API clears it, which is a workaround, not a fix.                                                                                                                                                                                   |
| D16 | **A second dashboard tab logged the whole browser out.** The refresh token rotates server-side; the single-flight guard was per page, so concurrent tabs raced, the losers got a 401, the client correctly classified that as a dead session, and every tab was signed out. Measured: three concurrent refreshes with one cookie gave `201 at +145ms, 401 at +148ms, 401 at +149ms`. This is what corrupted several verification runs today, including a full `ux:verify` whose flow steps then "failed" on selectors that resolve perfectly on a live session. | **Fixed.** One rotation per browser via Web Locks, with a stored-expiry adoption re-check inside the lock, a documented localStorage fallback (measured to be best-effort, not a mutex) and an evidence-gated 401 adoption. Live proof: three tabs, one rotation, 3/3 signed in, five of six runs. `pnpm ux:verify` now finishes **exit 0** with the session still alive. |
| D17 | **The API request log records 2xx and 5xx but not 4xx.** Two deliberate 401s produced zero log lines, which made a real logout look like it had "no auth failure at all" and sent the first diagnosis down the wrong path.                                                                                                                                                                                                                                                                                                                                      | **Open.** A refusal an operator experiences should be visible in the log.                                                                                                                                                                                                                                                                                                 |
| D18 | `applyMerchantLocale` is dead code: every café is `es-MX`, but neither `buildSettings` nor the capabilities payload carries a `locale`, so the café's language never applies.                                                                                                                                                                                                                                                                                                                                                                                   | **Open, small.** Deferred deliberately: fixing it changes the UI language for users who never chose one, which interacts with the visual baselines.                                                                                                                                                                                                                       |
| D19 | The visual gate was language-sensitive — nothing pinned the locale, so an operator with `umi.dashboard.locale=es` failed 4 of 10 baselines that had been recorded in English.                                                                                                                                                                                                                                                                                                                                                                                   | **Fixed.** The harness pins the locale beside the theme; all three starting states (`es`, `en`, absent) give 10 passed, with no baseline re-recorded.                                                                                                                                                                                                                     |
| D20 | `GET /api/{merchantRef}/admin/conversations` declares no permission and has **no caller anywhere in the repo** — the same shape as the hole fixed above.                                                                                                                                                                                                                                                                                                                                                                                                        | **Open.** Recorded, not patched, because nothing reads it.                                                                                                                                                                                                                                                                                                                |

One client-gate nuance was reviewed and left alone. The `devices` screen also reads
`/kds/devices`, which is gated on `kitchen.diagnostics` under `KdsLocationGuard`, so a
manager gets 200 there while the Dashboard hides Dispositivos from it. Till pairing and
kitchen-station configuration are arguably different surfaces with different owners, so it
is recorded rather than changed on a guess.

**What the next pass should take, in order:**

1. **D12, then the F5 money path** — the one flow still `not-yet-instrumented`. A PIN-only
   operator can open a till but cannot renew it, so a shift dies one access TTL in; that is
   the next thing between the harness and a measured tap budget.
2. **D5 and D7** — the cart re-date trigger that makes the recovery re-stamp inert, and the
   enrolment `platform` mismatch that makes first-time pairing fail.
3. **D15 and D17** — the login limiter and the unlogged 4xx. Both are small and both cost a
   session real time.
4. **D18, D8, D14** — the inert café locale, the POS Inventario error surface and the
   "unavailable on Web" recovery sheet, and the occluded `/hours` button.
5. Then workstream D, then E. Phase 3's floor plan is what gives the supervisor and the
   waiter their real research first screens, which is the part of C this pass could only
   point at.

### Fourth pass, 2026-09-16 — Phase 3, workstream D (the floor plan), first slice

**A whole implementation of workstream D already existed on another branch and nobody had
brought it over.** It is the case §6.3's tool table names — `git worktree list` found it:
`/home/jc/umi-table-map`, branch `feat/table-map`, 66 files, 7,878 insertions. It holds a
floor-plan editor (dashboard screen, model, CSS, a Playwright e2e), a POS table surface (638
lines + a 571-line test), an API module, contract models, and `62_floor_plan.sql`. This pass
brought the **foundation** over and assessed the rest.

**What landed.**

| Item                                                                                                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The chain gap, closed                                                                               | `62_floor_plan.sql` was missing from this branch while every real database had `merchant.floor_plan` and the stamp `build-v3-62` — a fresh build silently lacked a table production had. Ported byte-identical, registered, added to `freeze.sh`'s hash list, and asserted in `99_verify.sql` (the branch's own `99_verify` never checked it, which is why it went unnoticed).                                                                                                                                            |
| The placement, corrected against evidence                                                           | The branch's runner put 62 **before** `90_rls` while the file's own comment says "Apply after 90_rls.sql". Applying the chain both ways and diffing policies and grants against the live database settled it: before-`90_rls` gives **two extra policies** (two permissive policies are OR'd, so the table becomes more permissive) and hands `api` DELETE; after-`90_rls` is byte-identical to live (`sha256 c0b23dbc…` for both). This is the A-workstream instrument — apply twice, compare — used exactly as written. |
| Workstream D step 6's discriminating half: **a double booking is impossible at the database level** | `65_table_reservation.sql`: `merchant.table_reservation` with `exclude using gist (location_id with =, table_id with =, during with &&) where (status in ('booked','seated'))`, forced RLS, grants, and half-open `[)` range checks.                                                                                                                                                                                                                                                                                      |
| The proof, both directions                                                                          | A 12-case integration spec against the real schema: overlapping hold refused `23P01`, adjacent window accepted, same window on a different table accepted, same table in another location accepted, a cancelled hold frees its window, a `seated` hold still blocks. **12 passed on a fresh build and 12 on the live database.** With the constraint dropped, exactly the three overlap-dependent cases fail — so the suite has teeth rather than being green by construction.                                            |
| The contract half                                                                                   | `packages/contract/src/floor-plan.ts` and the four floor-plan routes, ported. All four generated artifacts are **byte-identical** to the source branch's, which is the strongest fidelity signal available. `pnpm --filter @umi/contract test` 69 pass (was 63).                                                                                                                                                                                                                                                          |
| Deployment state                                                                                    | Live database at `build-v3-65`; `EXPECTED_SCHEMA_VERSION` bumped in the three places it lives; `/health` Healthy, `build-v3-65` against `build-v3-65`.                                                                                                                                                                                                                                                                                                                                                                    |

Two things the migration needed that no plan text anticipated, both measured: `btree_gist`
must be **schema-qualified** (`extensions.gist_uuid_ops`) because a fresh build carries
`extensions` on the search path and the live database does not; and `60_triggers`' sweep
already ran, so `touch_updated_at` has to be attached explicitly.

**What did not land, and why.** The branch is the _foundation_, not the acceptance. Its floor
plan is a JSON document: no table state, no turn timer, no merge or split, and **no
reservations at all** — grep across its editor, POS surface and contract finds none. So D's
steps 2 through 5 and 7 are still open, and the acceptance line is **half landed**: a double
booking is impossible and provably so; "a server can move a party of eight from one table to
another in fewer than five seconds" has no route, no gesture and therefore no measurement.

**The merge surface, measured rather than guessed.** Nothing this session is committed, so the
comparison is branch-versus-working-tree: 66 branch files, 80 working-tree files, **11 in
common**. Fifty-five are clean additions. The eleven:

- **Two are a genuine design disagreement, and it is D5's.** The branch carries
  `fix(pos-cart): stop the resume upsert from editing the sealed business date` — it removes
  `business_date` from the resume upsert and calls the stamp _sealed_. `64_pos_cart_recovery.sql`
  takes the opposite position: the re-stamp is intended ("a cart picked up the next morning is
  today's cart"), so it moved the write server-side instead. Both cannot be right, D5 says the
  trigger defeats the re-stamp either way, and the branch's author reverted and re-applied the
  change once. **Do not merge this pair until the cash ledger's requirement is read properly** —
  the gate-3c spec is the place to start.
- Seven are UI and lockfile wiring to merge by hand: `app.jsx`, `data.jsx`, `shell.jsx`,
  `catalog_surface.dart`, `pubspec.lock`, `pnpm-lock.yaml`, `00_run.sh`.
- Two are the research documents that already exist here untracked.

**New findings to carry forward.**

| ID  | Finding                                                                                                                                                                                                                                                                                   | State                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| D21 | `merchant.floor_plan.updated_at` is **inert** — `62_floor_plan.sql` is verbatim and never attaches `touch_updated_at`, so the column never moves. Its sibling `table_reservation` does attach it.                                                                                         | **Open, one line**, but it needs a new migration because 62 is now an applied file the PR gate protects. |
| D22 | Four floor-plan routes are declared in the contract's route table with **no controller to serve them**; the drift test lists them as `PENDING` with a reason. Whoever lands `modules/floor-plan` must delete those four entries — the test fails the moment they resolve and stay listed. | **Recorded.** Deliberate and self-correcting, but easy to miss.                                          |

**What the next pass should take, in order:**

1. **Finish workstream D.** Port `apps/umi-api/src/modules/floor-plan/**` (it requires
   `merchant.manage` on the dashboard routes — consistent with the C contract, so it needs a
   row there and the four `PENDING` entries deleted), then the dashboard editor and the POS
   table surface, then D's steps 2–5 and 7: direct manipulation, table state with a shape or
   icon, merge and split as one gesture, a turn timer, and the 200-table test suite on both
   tablet shapes — and finally the measurement the acceptance actually asks for, eight guests
   moved in under five seconds.
2. **Settle D5's disagreement** before either side is merged; it is a ledger rule, and the
   two implementations currently contradict each other.
3. Then the carried-over list from the third pass: **D12**, the F5 money path, **D7**, **D15**,
   **D17**.

### D5 resolved — the date never moves, and the drawer decides

The fourth pass left a question open on purpose: two implementations disagreed about
`merchant.pos_cart.business_date` on resume, and D5 said the trigger made either one inert.
The evidence settles it, and the answer is the _opposite_ of what this plan's own earlier
reading implied.

- `60_triggers.sql` is explicit that the derivation is the policy, not an accident: "a
  trigger that only fires on insert leaves the column forgeable by a later UPDATE.
  Re-deriving is idempotent, so firing on update costs nothing and closes the hole." The
  cart's date is `(created_at at the merchant's timezone) - business_day_start`, and the
  cart trigger "must be derived by the SAME function" as the order it becomes, "or the cart
  and the order it becomes could disagree about the day".
- The reason the re-stamp was ever wanted is **already solved elsewhere, better**.
  `pos-checkout.repository.ts:1074` states it: the cart's date never moves, a cart resumed
  the next morning still carries yesterday, `tg_cash_ledger_open_shift` compared that against
  the open shift's, "so every cash sale on a cart that outlived midnight failed with a 500
  and no explanation" — and the fix was **the drawer decides**: "a sale paid out of a shift
  belongs to that shift's business day, whatever day the cart was born on. Without a shift
  there is nothing to disagree with and the cart's own date stands."
- `gate-3c-cash-migration.spec.ts` already asserts exactly that — _"dates a cash sale by the
  shift, never by the cart it came from"_.

So the correct behaviour is the branch's: **the resume path must not write the date at all**,
and the trigger's derivation is the invariant. Our `64_pos_cart_recovery.sql` restored a
server-side re-stamp that the trigger overwrites — dead code asserting intent the ledger no
longer needs. It needs a new migration to `create or replace` the helper without the date
write (64 is applied and the PR gate protects it), the two `gate-3c` assertions corrected to
the truth, and a live proof that a cart recovered across a day boundary keeps its creation
date while the sale still lands on the shift's day.

That also **unblocks the branch merge**: with this done, the branch's
`fix(pos-cart): stop the resume upsert from editing the sealed business date` and this
branch agree, and the only remaining overlap between them is UI wiring.

### Fifth pass, 2026-09-16 — Phase 3, workstream D (the API half) and D5 closed

**The four declared floor-plan routes are real now, and the drift test proves it with no
exemption at all.** `apps/umi-api/src/modules/floor-plan/**` is ported (five files,
`cmp`-identical to the branch), registered in `app.module.ts` in two lines, and the four
`PENDING` entries that had been holding the contract's route table open are **deleted** —
`packages/contract/test/route-table.test.mjs` is byte-identical to `HEAD` again, so
"every declared route resolves to a live controller handler" now means something. The café's
plan is real data, not an empty default: version 13, published 12, tables T1 to T4 and a
Barra counter, read back as `admin` with 200 and refused as `cashier` with 403.

**The role contract grew by one surface, measured rather than assumed**: `floor-plan.read`
is refused for the cashier and the manager (403) and allowed for admin and owner (200) —
`pnpm check:role-surfaces` is now **88 assertions across 22 surfaces, 0 failed**. The two
**write** verbs are deliberately _not_ live-probed, because the gate measures by mutating
and these replace the document every till draws its map from; they are pinned offline in
`role-surface-contract.spec.ts` instead, with a third test that **fails if either route ever
reappears as a contract row**, so the pin cannot be quietly converted into a mutating probe.
Three induced mutations (guard loosened, module misnamed, a write route promoted to a
contract row) each failed the expected tests.

**D5 is closed, and the resolution was to converge with the branch rather than keep a third
shape.** `PosCartRepository.create()` is now the branch's version byte for byte — the upsert
naming `business_date` nowhere — the `SECURITY DEFINER` helper `64` introduced is dropped by
`66_pos_cart_recovery_rollback.sql` (it existed only to write a column that must not move,
so it was a privileged surface with no purpose), and `gate-3c`'s assertion was corrected from
"re-dates a cart the moment it is resumed" to "keeps the cart creation date when it is
resumed". Verified live: a cart created 2026-09-03 and resumed today kept `2026-09-03` while
its `updated_at` and `operator_session_id` both moved, and a **new** cart still stamps today.
The 500 that `64` fixed stays fixed: `pnpm ux:pos` exit 0, and the `permission denied for
table pos_cart` count in the API log did not rise (318 before and after, last occurrence
hours earlier).

**The D3 gate stopped giving false assurance.** A worker showed that on a dirty checkout
`git merge-base origin/build-v3 HEAD` _is_ `HEAD`, so the committed range is empty and the
applied-migration check inspected nothing while printing a confident all-clear. It now scans
**both** sources — the committed range CI sees and the working tree the person running it
actually has — and says `EMPTY (the merge base equals HEAD, so no committed changes exist to
inspect)` instead of implying a clean result. Proved by inducing a modification and a
deletion of `48_customer_value_worker_scope.sql` (both caught, both restored byte-identically)
and by adding a legal new numbered file (allowed).

**One thing that looks like a defect and is not.** A chain-only scratch database fails
`security_gate.sql`'s "super_admin holds every permission key" — `loyalty.operate`,
`orders.operate` and `tenant.manage` are ungranted. That gate is designed to run on a
backfilled target, and CI applies `backfill/seed_rbac.sql` before it (`umi-api-ci.yml` line
177), which is where those three grants come from. Recorded so the next agent does not spend
a turn diagnosing it.

**Small carry-overs from this pass.** `scripts/umipos-role-surface-gate.mjs` expands only
`{ref}` and `{merchantId}`, so the new row spells its location out as a literal uuid in the
contract — wiring `{locationId}` into that script would remove the one environment-specific
value from a file that is supposed to be environment-free. And the offline spec carries a
conditional `CLIENT_MODULE_NOT_LANDED` rule for the floor-plan row, because the Dashboard's
module registry does not gain that module until the editor slice lands; that rule should be
deleted with the slice.

**Next: the Dashboard editor and the POS table surface** (the branch's 986-line
`floor-plan.jsx` with its model and CSS, the 638-line POS surface with its 571-line test),
then D's steps 2 to 5 and 7 — direct manipulation, table state with a shape or icon, merge
and split as one gesture, the turn timer, the 200-table suite on both tablet shapes — and
finally the eight-guest move measured.

### Sixth pass, 2026-09-16 — Phase 3, workstream D: both clients draw the plan

**The editor and the POS surface are landed, and both draw the café's real published plan.**
The Dashboard's Konva editor (`floor-plan.jsx` 986 lines with its model, CSS and specs) and
the POS's table surface (`floor_plan_surface.dart` 638 with a 571-line test) are ported; the
POS gained a **Mesas** destination in its bottom navigation, and the Dashboard gained a
`Plano de mesas` screen behind `merchant.manage`.

| Check                              | Result                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Dashboard tests                    | **104 pass in 15 files** (was 91 in 13)                                                               |
| POS tests                          | **259 pass** (was 250) — the +9 are the ported table-surface cases                                    |
| `pnpm ux:inventory`                | 23 routes; `/floor-plan` **46 controls, 0 unnamed, 0 undersized**; the other 22 unchanged             |
| `pnpm ux:a11y`                     | **0 critical, 0 serious** on all 23 routes; `/floor-plan` clean at every severity                     |
| `pnpm ux:visual`                   | **12 passed** — floor-plan added at both pinned viewports                                             |
| `pnpm ux:pos`                      | **13 surfaces, 149 actionable, 0 unnamed, 0 under 44px**, exit 0; the harness discovered Mesas itself |
| `pnpm ux:verify` / `pnpm check:pr` | exit 0 / exit 0                                                                                       |
| `pnpm check:role-surfaces`         | 88 assertions, 22 surfaces, 0 failed                                                                  |

Five accessibility and hit-target defects the new screen brought were fixed rather than
suppressed, and the sweep's "do not click" list gained a `publish` family **before** the
screen was added to it, so the audit classifies Publish as destructive and never fires it.

**The zod and Konva cost is measured, not assumed.** The editor needs the contract's
`FloorPlanDocument` to validate before offering Save, so zod enters the browser for the first
time. It is contained: the console's eager bundle contains **0** zod and **0** Konva markers,
while the lazy `floor-plan-*.js` chunk (366.66 kB, 111.24 kB gzip) carries both. §4's
sub-250 KB first-route bar therefore still holds **only while that route stays `lazy()`** —
worth stating because a future eager import would quietly blow it.

**A correction to the fifth pass's note.** "The café's plan is version 13, published 12,
T1–T4 and a Barra counter" is one location. The dashboard's selected café is a _different_
one: **Congreso is version 10 with T1–T7 plus the Barra counter**, while **Chapultepec is
version 13 with T1–T4 plus Barra**. Both are real; location scoping is real, not a default.

**What is implemented and what is not, stated exactly.** The dashboard editor has §8D
**step 2**: drag, rotate, resize, grid snapping, undo and redo, keyboard nudge, draft
autosave, a published-versus-draft view, and publication. The POS surface _draws_ the
published plan with an area selector and a list/map toggle, and a tap identifies a table —
it makes **no writes at all**. **Steps 3, 4, 5 and 7 exist nowhere**: no per-table state, no
shape or icon carrying that state, no merge or split gesture, no turn timer, no reservations
UI, and none of the 200-table drag/rotate/merge/split suite. An independent read of the whole
`apps/umi-pos` tree confirmed the absence rather than inferring it.

**Two design records travelled with the code**, because the code is the answer to problems
those documents describe: `docs/architecture/2026-09-13-floor-plan-foundation.md` (the
draft/published model, the permission split, and the rule that the _next_ increment **must
add occupied-table publication checks before it enables visits**) and
`docs/reports/2026-09-13-floor-plan-drag-synchronization.md` (Konva's non-strict
reconciliation let a dragged node disagree with the published document; the sync-ref
correction is load-bearing, and a reader who "simplifies" it back re-introduces the bug).

**Unproven, and worth knowing:** the save and publish **happy path was never exercised live**
— only the conflict branch, where a deliberately stale `expectedVersion` returns
`409 OPTIMISTIC_VERSION_CONFLICT` with the draft unchanged. The pre-existing ten visual
baselines did **not** shift when the navigation gained an item, because at the pinned
viewports the new entry sits below the fold; that is a coverage gap the floor-plan's own
baselines do not close. And two harness gaps are recorded rather than fixed: the POS sweep
logs `destination Mesas -> surface unknown` because its surface classifier has no name for
it, and the gate script still spells its location out as a literal uuid.

**Next for D:** steps 3 to 5 with the occupied-table guard the foundation document requires,
then step 7's suite and the eight-guest measurement. After that the plan's own sequence
moves to workstream E.

### Seventh pass, 2026-09-16 — the POS is a native app, and the instruments said otherwise

**A correction, and it is about the measurement rather than the code.** Every POS figure this
plan reported recently — surfaces, touch targets, screenshots, the Mesas map — was measured on
the Flutter **web** build, because a web page is easy to attach to. A café does not run a web
page. The plan's own §3.2 measured the native Linux app through the Dart VM service; the
harnesses that followed quietly redefined the product as the thing they could reach.
`docs/architecture/2026-09-16-pos-is-a-native-app.md` records the decision and the failure
mode: an instrument that is easier to point at the wrong artifact will be pointed at it. The
same note records that the KDS is a mode inside the POS and that `apps/umi-kds` is stale.

**What is true now, measured on the native app.**

| Item                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native build of record    | `flutter run -d linux --debug` from source; app process `build/linux/x64/debug/bundle/umi_pos`, Dart VM Service published, real X11 window titled UmiPOS on the display. A **release** bundle was rebuilt too (`✓ Built build/linux/x64/release/bundle/umi_pos`, 12:18) so the stale 2026-09-07 artifact is no longer sitting in the tree.                                                           |
| The web POS is retired    | The `flutter run -d web-server` process on `:4002` was stopped; nothing listens there.                                                                                                                                                                                                                                                                                                               |
| Real native input         | `xdotool` — installed without root by extracting `xdotool`/`libxdo3`/`x11-utils` into `~/.local/opt` with a wrapper on PATH — drove the real window: four keypad clicks filled the PIN (`value: "4 dígitos"`), the mouse wheel scrolled the card to reveal Continuar, a click submitted it, and a further click opened **Mesas**. Verified by three screenshots and the semantics tree at each step. |
| The table map, natively   | "Mesas", "Plano actualizado", area tab "Salón / 4 mesas", and the canvas drawing **T1, T2, T3, T4 and the Barra counter** with seat dots — the same plan the dashboard editor shows.                                                                                                                                                                                                                 |
| Native semantics baseline | The operator-PIN screen reports **keypad keys 144 x 85**, exactly the value §3.2 recorded, which is the strongest sign that the native path is the one this plan was written against.                                                                                                                                                                                                                |

**The native instrument had two bugs, and together they manufactured a defect that does not
exist.** The first native reading of the Mesas surface said _8 actionable, 8 unnamed_ — an
apparent accessibility failure on the tables themselves. Reading the raw tree showed both
causes were in `pos-semantics-inventory.mjs`, not in the app:

1. A Flutter `IconButton` names itself with its **`tooltip:`**, and the parser only read
   `label:` — so Atrás, Actualizar and Ver lista counted as unnamed.
2. The engine prints a long label on the lines **after** `label:`, not beside it, and the
   parser could not read the continued form — so `"T1, 4\nT1"` and the Salón tab counted as
   unnamed too.

Both are fixed (the new report separates `namedByTooltip` and reads continued values), and the
surface now reads **8 actionable, 0 unnamed, 0 under 44px**, with the tables at 55 x 55. Worth
recording plainly: for one step this plan held a false accessibility defect about the product,
and the only reason it did not reach the ledger as one is that the raw dump was read instead of
the summary.

**Carry-over, unflinching.** The web-based `tools/ux-sweep/pos-surfaces.mjs` remains useful as a
development aid, but its numbers are not evidence about the product and the `13 surfaces / 149
actionable / 0 undersized` reported in pass six must be re-measured natively. This pass did
that for one surface (Mesas) and the entry surfaces; the remaining surfaces need a native driver
that walks them, which is the next piece of work — `patrol` has no Linux platform, so it is
`integration_test` driving the Linux app, or this xdotool-plus-VM-service pairing.

### The branch merge, resolved and green — 2026-09-18

**PR #169 is `CLEAN`.** It sat `CONFLICTING`/`DIRTY` long enough that no `pull_request` workflow
had ever run on it — Actions were enabled, the branch simply never produced a run. It is now
merged, pushed and green: `lint`, `contract`, `build-and-test`, `gate`, `tokens` and `deploy` all
pass, and the security scan reports no leaks.

**Both branches built the floor plan, and the shipping one is this branch's.** The remote's
PR #168 landed a working map-plus-details cut; this branch landed the interactive one. Every
add/add file is almost entirely _deletions_ going the other way — **939 more lines** of POS
surface (merge, split, elapsed time, the group boundary) and **71 more lines** of contract tests —
so the resolution keeps this branch's implementation and folds in the remote's small additions
(seat rendering, the sales-insight hook the incoming `ventas-report.jsx` imports). That is what
pass six's "steps 3, 4, 5 and 7 exist nowhere" described: the state of the _remote's_ copy, not of
the branch. With this merge the ten `pos.tableState*` routes, the six-state room, the turn timer
and merge/split are the ones in `build-v3`.

**The migration ordering question had a real answer, and it was not the remote's.** The remote
moved `62_floor_plan` ahead of `90_rls` so the RLS sweep would see the new tables. This branch had
already solved it the other way: `90_rls` carries an explicit `post_90` exclusion list naming
`floor_plan` and the other seventeen tables that eleven later files create, because each of those
files owns its own `<table>_scope` policy and the sweep's uniform pair would make a re-applied
database differ from a fresh one. Both work; this one covers all eleven files instead of one.
Settled by measurement rather than argument: a pristine apply reaches `build-v3 verify: OK`, and the
re-apply rule holds at **319 → 319 policies**.

**Two defects were red before the merge and are fixed here**, neither of them caused by it:
`gate-5a-administrative-command-migration.spec.ts` still asserted the `case t = 'cash_shift'` shape
that `90_rls`'s guarded cash_shift policy replaced, and the incoming `e2e/floor-plan.pw.js`
expected a table button named exactly `T1 · 4` where this branch's list, being the room in words
for a screen reader, reads `T1 · 4 · Libre`. The techniques and the two traps that cost time here
are written up in `docs/development/LOCAL_VERIFICATION_PLAYBOOK.md` §4.

## 14. Where the plan stands

A per-workstream audit, written 2026-09-16. Each row names the workstream's own acceptance line
and what currently proves or fails it. "Not started" means no artifact exists, not that nobody
thought about it. This is the honest picture, not a progress claim.

| Workstream                           | Acceptance line, as written                                                                                                                                                                                  | Status                                                                                                                                 | Evidence or the gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** Repair the migration chain     | A restored snapshot passes `/reportes`, and `pnpm check:pr` rejects an edit to an applied migration                                                                                                          | **Done**                                                                                                                               | `/reportes` 500 → 200 with real figures; the gate rejects a modified _or_ deleted applied migration, and now also inspects the working tree, because a dirty checkout was previously given a confident all-clear                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **B** One shell, one design system   | The click inventory reports zero undersized controls; a designer can read the token file                                                                                                                     | **Done — and now measured on the client that ships**                                                                                   | 23 dashboard routes, 0 undersized, 0 unnamed; `packages/tokens` carries the floor. The POS half said "re-measured on the web build and must be re-measured natively" and **is now natively measured**: `pos-semantics-inventory.mjs` against the running till reports **74 actionable nodes, 73 controls, 0 unnamed, 0 under 44 px** on the kitchen board (the densest surface in the app). Its first native run reported `1 unnamed, 5 subtouch` — **all six were instrument artifacts**, and fixing the instrument is what closed this row: the "unnamed actionable" was the scrollable list itself (a viewport legitimately has no name), and the five "undersized" controls were rects the semantics dump returned as 288x8 for rows a screenshot shows drawn at ~50 px, with identical controls elsewhere in the same tree measuring 288x52. The instrument now separates controls from viewports and reports those rects as `unreliableRects: 5` instead of inventing defects.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **C** Role-first experiences         | A cashier cannot reach a manager surface by URL, and a test proves it                                                                                                                                        | **Done**                                                                                                                               | Two tests: `pnpm check:role-surfaces` (**88 assertions across 22 surfaces, 0 failed**, live) and `role-surface-contract.spec.ts` (**29/29**); plus one first screen per role, verified by landing each role in the browser. **This row claimed Done while that offline spec had three failures**, and the tenth pass fixed them rather than restating the claim: `reward-config.read` and its byRef twin were recorded `refused` for cashier and manager against a gate of `merchant.manage`, while the controllers had been deliberately changed to `loyalty.read` — the shared merchant model on every dashboard screen and umi-cash's till home both read it, so the old gate refused a cashier a value her own screens display. The live gate settled which side was stale: the route answers **200 to a cashier and a manager**, so the rows now carry `loyalty.read`, with the divergence recorded as deliberate. And the `customers` and `triage` modules were permission-gated with **no surface bound to them**, so their gates were permissions nothing measured; both are now bound to their real routes (`GET …/customers`, `GET …/insights/triage`), which the controllers' own comments already said they mirrored.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **D** Floor plan and table map       | A server can move a party of eight between tables in under five seconds, a double booking is impossible at the database level, and the tests prove both                                                      | **Nearly done — one data gap**                                                                                                         | Double booking: done — an exclusion constraint and a 12-case integration test. **The eight-guest move: measured.** The server path is `party of 8: 2 requests (seat + move), 63.1 ms` in `table-state.integration.ts`; the operator path is now real too, with every write the till made between 43 and 89 ms (seat 87, merge 89, move 77, clear 83/57, open 55/46/53/43) and the moved party's `seated_at` byte-identical before and after. The client half landed this day: the room, the six states drawn rather than only coloured, the turn timer from `seatedAt`, seat/move/merge/split/clear and mark-ready. What is left is not code but data and two routes: no table in the seeded plan seats eight, so an eight-party move is refused locally with a typed message and no request, and the three service transitions **landed and were driven by hand the same evening** — `ordered` → `served` → `awaiting_payment` on a real table, with `seated_at` byte-identical at every step. What is left is the eight-seat table above and step 7's 200-table map suite, whose console half is in flight.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **E** Inventory and recipes          | A plate shows its cost, its margin, and the stock it consumed; a count with a variance over the threshold requires an approval                                                                               | **Done — both halves of the acceptance are met and verified**                                                                          | **"A plate shows its cost, its margin, and the stock it consumed"** is on screen: `apps/umi-dashboard/src/screens/inventory-costing.jsx` reads the four costing routes and renders the day's numbers, the cost per dish with its components, the stock consumed and the low-stock forecast. Verified in the real browser over CDP by clicking the nav: the one fully-costed dish shows price MX$91.00, cost **MX$7.48**, margin **MX$83.52 (91.8 %)** built from `0.012 kg × MX$215.00/kg`— the arithmetic I recomputed by hand from the raw receipt lines (21500/kg, 2450/L, 165/unit are the quantity-weighted averages). The honesty rules hold: this café has 41 sale lines with no recipe, so the period's cost and margin read`No cost`/`No margin`**with the reason and the items named**, and no margin is ever rendered as a number the data cannot support. 134 dashboard tests, 20 costing integration tests and 28 fast-check properties pass. **"A count with a variance over the threshold requires an approval"** is enforced, not just displayed:`calculateInventoryVariance`sets`approvalRequired`above tolerance,`consumeApproval`refuses with`APPROVAL_REQUIRED` carrying the permission and fingerprint, and two service specs assert the boundary and the count-reconciliation refusal — re-run here, 14/14 green. Steps 1 (recipe→sale with per-modifier components), 2 (yield, waste), 3 (suppliers, purchase orders, receiving), 4 (blind count, variance, second-person approval), 5 (costing per plate and per day) and 6 (28-day forecast) are all built.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **F** The verification engine        | One command reports every click, every size, every flow budget, and a first paint per screen                                                                                                                 | **Done for the dashboard — after the gate itself was repaired**                                                                        | `pnpm ux:verify` exit 0 with the a11y gate as a hard gate, F1–F6 built. The POS is measured on the native client (see B): `pnpm ux:pos:native` passes five real workflows with every flow inside budget and `money-path-pos-charge` at **3 taps**, and the native control inventory reports 0 unnamed and 0 undersized. **The visual gate was passing on screens it had never seen**, and three faults were found and fixed in one pass: the spec captured **two seconds after `domcontentloaded`** — a fixed sleep cannot tell a rendered screen from a loading one — and now waits for network idle, failing loudly if it never quiets; **the `reportes` baseline was an outage frame** (`OFFLINE · RETRY`, "The sales report could not be loaded.", empty body, 28 KB) so the gate had been asserting that the screen still looked broken, and it is now the real screen (63 KB); and **the `[data-ux-volatile]` mask matched nothing by itself** — it worked only because `maskVolatile` auto-marks time-like text, leaving the connectivity chip pinned, which made `overview` fail on a transient the screen does not own. The spec now refuses to pin a body error state, masks the connectivity chip, and all 12 baselines were re-recorded from the real screens. **Two limits recorded rather than hidden**: the board read is a 15-second poll rather than a push (workstream K), and `patrol` has no Linux platform, so the native driver is `xdotool` over the Dart VM service.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **G** Payments                       | A retried payment never charges twice, a terminal timeout never marks a sale paid, a cancelled sale cancels its fiscal document, and tests prove all three                                                   | **All three acceptance sentences have test evidence; the till's tender screen and step 4's settlement/refund remain**                  | Step 1's ADR is `docs/architecture/2026-09-16-tender-path-adr.md`. Steps 2, 3, 6 and 7 are built on `merchant.pos_payment_attempt`, extended rather than duplicated, and every invariant is a CHECK the database enforces: one command identity per attempt with a unique index, a capture claim (`provider_capture_at`) so exactly one writer ever reaches the provider, an unknown that is query-only and answered by the SAME identity that started it, and a success that must NAME its proof (`provider`, `cash`, `internal_ledger`, `operator_attested`). `pos.tenderAssert` records an operator's "the customer says it paid" as evidence with `effect: "none"` and the attempt unchanged. The terminal is one adapter behind `TenderProviderPort`, with a registry the till reads to see which methods will actually work, and the checkout refuses to commit a tender whose captured attempt is unresolved. Step 5's fiscal record is `merchant.fiscal_document` plus `modules/fiscal` (stamp through `FiscalPacPort`, the PAC's id, the SAT codes, and the deadline the owner reads). Evidence: `tender.integration.ts` (18 cases incl. a `fast-check` stateful sequence) and `tender-domain.spec.ts` (13 property tests) prove sentences 1 and 2; `fiscal.integration.ts` (14 cases, incl. the transaction and its rollback) plus `pos-exception.void-fiscal.spec.ts` (6 cases proving the void hands the cancellation the same client) prove sentence 3 — the link lives on `pos.saleException`'s `void`, because `sale.cancel` cannot touch a committed sale and only a committed sale can be invoiced. Two schema corrections came out of building it: the success-provenance backfill for the 102 existing cash successes, and `fiscal_document_stamped_shape` no longer forcing a cancelled document to erase its SAT UUID. **Still missing**: step 4's settlement/surcharge/payment-level refund and the CFDI de Egreso a refund needs; and the till's tender screen — it still offers only `Efectivo`, so no live provider has been called and every outcome so far comes from a scripted fake. |
| **H** Kitchen display                | A cook works a full service from the POS board without a second device; a ticket reaches the right station in under a second; the board survives a network drop; the native client no longer builds or ships | **Steps 1 to 8 are all built (2026-09-17). The acceptance is met except the "under one second" claim, which still has no clock on it** | The POS owns the board and the **Cocina** destination is live — and, since the station-less POS command route landed, it can be **worked**: the per-item bump, the ticket moves and recall exist on both sides, and the route is proven by a live call on a 10-day-old ticket that finally left the board (36 → 35). **Step 1 is complete**: `apps/umi-kds` is gone, `pnpm-workspace.yaml` and `scripts/lib/release-manifest.mjs` no longer name it, and `docs/product/UMIPOS_CASOS_DE_USO_Y_ROLES.md` §18 records it as `RETIRADO — UmiPOS incluye el tablero de cocina. KDS retirado el 2026-09-16.` **Step 2 is complete** and a stale sentence about it is corrected here: the till's client has sent `posKitchenCommand` for some time, and the _board_ read it was also using was declared nowhere — it lived only as a string in `kitchen_board_controller.dart`. It is now `pos.kitchenBoard` in the route table, generated into `UmiRoutes.posKitchenBoard`, and the `Cocina` destination is gated on `kitchen.read`/`kitchen.prepare` rather than on the device happening to hold a board controller, so a cashier on a till that runs the board cannot walk into it. The last four steps followed: the all-day count sits on the rail, station routing is a real rule set with a dashboard screen, the realtime feed replaced the poll as the delivery path while keeping it as the floor, and courses and staging (step 4) landed 2026-09-17 — a course on the cart line, carried through `writeOrder` and the projector, grouped on the board, with held courses drawn as held and one action firing the next one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **I** Channels                       | A QR order appears in the POS cart and on the kitchen board with no manual step                                                                                                                              | **Started — the writer and the surface exist, the channel does not**                                                                   | The ledger said "no order writer, QR flow or delivery aggregation". The writer is real: the channel-attribution ADR (2026-09-13, Approach **B** — link, don't merge) is implemented, `pos_cart_bind_origin` binds an active cart to an incoming order so the committed sale freezes the channel, and the till has an incoming-orders surface — driven by hand it showed WhatsApp orders with amounts and an `Atender` action. So the receiving end of a channel works; **what does not exist is a channel to receive from**: no web order page on the same catalog, and no Rappi or DiDi aggregation yet. **Resolved 2026-09-17:** the deferral asked the wrong question of the wrong half — the acceptance sentence says nothing about where the money is taken — so the table channel now ships as ORDER INTAKE (channel ADR §9), with payment at the counter until the Conekta gateway lands, and the server half is landing under this row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **J** Loyalty and stored value       | An owner configures a tier, issues a reward, and sees the ledger                                                                                                                                             | **Partial**                                                                                                                            | The reward config and the loyalty hub exist and are role-gated; tiers, a reward catalog, the enable switch, birthday and expiry jobs and consent records are not verified as done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **K** Offline and realtime           | A cash sale made offline lands once after reconnection, and the shift total matches the ledger                                                                                                               | **Partial**                                                                                                                            | **The OS connectivity source is built** (2026-09-17): `connectivity_plus` 7.3.1, an interface watcher, and two deliberately ASYMMETRIC entry points into `ConnectivityController` — `networkDown()` goes offline in one signal, `networkUp()` gives `recovering` and never `online`, because an interface being up is not the API answering. The POS also holds a device identity and a durable journal with their own tests, automatic ordered replay and the unknown-result query before reuse are in the journal and replay engine, and the Redis realtime adapter is still unbuilt (it is the gate on running a second API replica). **And the acceptance sentence is PROVEN rather than intended** (2026-09-17): `pos-offline.integration.ts`, 7 tests, in the `test:integration:schema` family, drives a real offline cash sale through the replay contract and counts the sale, the inventory movement and the drawer in SQL — the re-delivered batch is answered as a duplicate with the SAME official sale and receipt ids, and the shift's expected cash equals the ledger sum computed by the caja dashboard's own expression                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **L** Agent and developer experience | A new contributor runs three commands: install, start, verify                                                                                                                                                | **Mostly done — the dead-code tool landed**                                                                                            | `pnpm ux:verify` is that verify command, and `check:pr`, `ux:pos` and `check:role-surfaces` extend it. **`knip` is now installed** (6.36.0) and its first run is a baseline that needs triage before it means anything — 145 files, 192 exports and 10 duplicate exports, overstated by a vendored skill and a queue-registered processor tree, with two real findings checked by hand (an unimported `pending-clarification.ts`, and a second dead `lifecycle-copy.ts` beside the one the cash scan imports); see §6.5. **`fast-check` is installed and in use** by the costing and tender arithmetic. What is still missing: the CodeGraph sync step and the one-command local reset.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

**The four things this audit said were most worth doing next — all four have since been done, and
the list below is what replaced them on 2026-09-17.** Kept because a plan that quietly deletes its
own predictions is a plan nobody can check: D's eight-guest move was measured (the party of eight
moves in 63.1 ms server-side, with the operator path at 43–89 ms per write); the POS was
re-measured natively and the driver is now the instrument of record, with the money path at three
taps; G is no longer unstarted — the attempt model, the terminal port, the three outcomes, the
fiscal state machine and the divided-check rule are built and tested; and H's board does per-item
state, courses and staging, and recall.

**What is actually next**, in the order the gaps are sharp, re-read from the code rather than from
this document:

1. **§8G step 4's remainder, and it is the only item with a legal clock on it.** Settlement,
   surcharge and a payment-level refund, plus the credit note (CFDI de Egreso) a refund needs — the
   SAT's 24-hour window is why this leads. Nothing in `apps/umi-pos` calls `pos.tenderCapture` yet, so
   the live provider has never answered and a manual-terminal attempt still has no settlement route.
2. **§8J's tiers.** The workstream's own acceptance line is "an owner configures a tier, issues a
   reward, and sees the ledger" — the reward catalog and the ledger exist, and the code has **no tier
   anywhere**: no column, no table, no route, no screen. Consent records are the other half of that
   row.
3. **§8I's channel order surface.** The one order writer, the channel-attribution identity and the
   POS's incoming-orders screen exist; a QR/web order that lands in the POS cart and on the board with
   no manual step does not, and the pay-on-page vs pay-at-counter decision that deferred it is still
   open.
4. **§8K's remaining steps and one unmeasured sentence.** The OS connectivity source is landing;
   the Redis adapter for a second API replica is not built (three gateways carry a comment saying it
   must fan out before a second replica runs), and §8H's "a ticket reaches the correct station in
   under one second" still has no clock on it anywhere.

### Eighth pass, 2026-09-16 — real workflows, real clicks, on the native POS

The owner's instruction — _"I want to work with real workflows and clicks"_ — is now the
standing standard, and this pass produced the instrument that meets it and then used it.

**One command drives the native app through real operator workflows and measures them.**
`pnpm ux:pos:native` attaches to `flutter run -d linux --debug`, resolves each semantics node's
**absolute** rect by accumulating the parent-relative offsets Flutter publishes, maps logical to
screen through the window's live geometry, and clicks with `xdotool`. Final run, `passed: true`:

| Flow                        | Taps  | Measured     | The plan's budget |
| --------------------------- | ----- | ------------ | ----------------- |
| `pos-sign-in`               | 5     | 5 136 ms     | 5 / 25 000        |
| `pos-tables-open`           | 4     | 6 318 ms     | 4 / 15 000        |
| **`money-path-pos-charge`** | **3** | **6 581 ms** | 3 / 8 000         |

The money path's three taps are `Cobrar` → `Importe exacto` → `Cobrar · MXN 55.00`, with the 21
prelude taps (opening the shift, adding items) recorded separately because §4 counts _after the
cart_. **F5's POS half is therefore no longer `not-yet-instrumented`: the money path holds at
three taps on the real client**, measured rather than asserted. This is also the first
end-to-end evidence for D's "an operator really can move through a table" half of the picture:
`pos-tables-open` opens Mesas, reads the drawn plan, and taps T2.

**A real sale, not a simulated one.** The run committed `merchant.pos_committed_sale`
`f31ea593…` against cash shift `d46e2b41…` (register `68b912e2…`, float 50 000), with
`merchant.cash_ledger_entry` carrying `opening_float 50 000` then `cash_sale 5 500` on business
date 2026-09-16, and an `Americano ×1 @ 5 500` cart line. Eight screenshots record each step
from `signed-in-catalog` to `sale-complete`.

**The instrument found three bugs in itself before it trusted a number** — depth inferred from a
gutter-stripped line, `right`/`bottom` summed from the parent's edges instead of shifted by its
origin, and an `isVisible` test that only checked the window (so a button 2px past a panel's
edge was "visible" and the click landed on the navigation bar underneath). It also stopped
using `mousemove --sync`, which stalls fifteen seconds when the pointer is already at the
target, and it now refuses to click off-screen. The worked example is in the report: the PIN
key's parent-relative `(0, 0, 144, 84.7)` becomes absolute `(416, 265, 560, 349.7)` and is
clicked at screen `(488, 383)`, after which the PIN reads `1 dígitos` in 590 ms.

#### A defect a real workflow found, and would not have been found otherwise

**D23 — a stale cash shift blocks every sale, and the till cannot reclaim its register.** Both
registers at Chapultepec were still held by shifts opened on 2026-09-03 and 2026-09-05 by
devices that no longer exist. Opening a shift answered `500 REGISTER_NOT_AVAILABLE`; charging
answered `500 CASH_SHIFT_REQUIRED`; and the **Caja screen still displayed "Turno abierto"**, so
the operator sees a free till and gets an unexplained 500. `POST …/registers/recover` exists in
the API but needs a manager approval artifact and **has no UI**, so from the till there is no
way out at all: the café cannot take cash on that register until someone with database access
clears it.

That is precisely the class of failure this plan's §4 bar forbids — _"every failure shows a
typed message with a recovery action"_ — and it is the strongest argument yet for the owner's
insistence on real workflows: a unit test, an API probe, or a web-build sweep would each have
looked fine. **Open, and high priority.** Unblocking the run required four hand edits to the
rehearsal database (closing two stale shifts and clearing a register's `current_shift_id`),
which are recorded in the worker's report and must not be how a café recovers a till.

Also recorded honestly: the workflow suite is **flaky on a cold-started app** — with a fresh
launch the tables flow failed twice because the plan canvas repaints after the first fetch and
swallows taps, and the cause is not yet known. Surfaces beyond Comanda, Mesas, Caja and the
kitchen board were not driven, nor the hardware paths.

### Workstream D's remaining UI, defined

So the next pass implements rather than re-decides. The server is landed (`67_table_state.sql`,
seven operations, the publish guard); the clients draw the plan. What is missing is the layer
between them.

**On the POS Mesas surface** (`apps/umi-pos/lib/features/tables/floor_plan_surface.dart`):

1. **State on the map.** Each table renders its state from `merchant.table_state`. §8D is
   explicit that **colour alone must not carry it** — so a state changes the drawing: a seated
   table gets a filled seat marker or an icon, an awaiting-payment table a distinct glyph, a
   dirty table a clearing mark. Read the six names from the API, never a local enum.
2. **The turn timer.** A seated table shows elapsed time from `seated_at`. It must not restart
   on a move — that is already enforced in SQL by the trigger, so the client only displays what
   the server holds. A timer that ticks locally between fetches is fine; a timer that disagrees
   with the server is not.
3. **Merge and split as one gesture.** Selection mode on the map: tap two or more **free**
   tables, then one action merges them into one party with a visible group boundary (the
   group's tables drawn as a single bounded region, and the server's `group_id` is what makes
   them one). Tapping a grouped table and choosing split dissolves it, with the survivor
   keeping the party and the others becoming dirty — the semantics the API already implements.
4. **Move.** The acceptance line's gesture: pick a seated party, tap a free table, and the
   party moves with its turn timer intact. The API's `move` already carries `seated_at` and
   `party_size` verbatim and refuses a target that cannot seat the party.
5. **Three new API transitions.** `ordered`, `served` and `awaiting_payment` are storable and
   validated but nothing sets them; the six states of §8D step 3 are only real when a till can
   reach all six. That is one small route each, and the surface then needs the same rendering
   for them.

**Then D's acceptance line, measured the only way it counts.** With the gesture in place the
native driver performs it: seat a party of eight, move it to another table, and time the
operator path with real clicks — `pnpm ux:pos:native` already measures taps and milliseconds on
the real client, so this is an extension of an instrument that exists, not new machinery. The
line is _"fewer than five seconds"_; the API's own half is already measured (two requests,
46–83 ms), and the operator half is what remains unproven.

**And step 7's suite**, split by where the gesture lives: the **dashboard editor** gets the
200-table drag and rotate (Playwright pointer gestures over CDP, on both pinned tablet shapes,
with a frame-budget trace from the DevTools probe), and the **POS** gets merge, split and move
through the native driver. The plan's §8D step 7 names both shapes for all four gestures; if
that proves to be the wrong split when implemented, say so rather than quietly shrinking it.

### D23 fixed, and D24 found in the same breath

**D23 — a stale shift blocked every sale — is fixed.** The refusal is no longer a 500:
`GET /cash` now reports a `hold` on every register
(`free | held_by_this_device | held_by_active_till | held_by_orphaned_till`, with the shift, its
`openedAt`, the device, its status and whether it is reclaimable), and
`POST …/cash/registers/:registerId/reclaim` frees a register whose holding terminal is gone.
Proven on the live orphan — a shift open since 2026-09-03 on a device last seen that day:
`409 REGISTER_NOT_AVAILABLE` with the facts → reclaim → the shift lands on its terminal
**`blocked`** state, the register returns to `available`, a new shift opens, and the **ledger is
byte-identical** (3 entries, 19 500, sequence 3, `closed_at` NULL) with an audit row naming the
actor and the reason. The two states the domain cares about are untouched: not `closed`
(reconciled by the responsible cashier) and not `recovered` (counted by somebody else) — because
nobody counted anything, and a new SQL constraint refuses a custody row that carries a count for
an `orphan_reclaim`.

Two things about the fix are worth keeping. The staleness proof is **evaluated by the
database**: a new `merchant.device_is_usable(uuid)` is called by the hold query, the RLS policy
_and_ the immutability trigger, so the till's answer and the write decision cannot drift, and the
trigger only permits `status` and `version` to change. And `center()`'s own-shift query had been
excluding only `closed`, which is why the Caja screen said **"Turno abierto"** for a shift it
could not use — the lie behind the 500.

**D24 — found while proving D23, and it is the more dangerous of the two: a till that restarts
mid-shift can never charge again.** Every restart creates a new operator session, and the open
shift keeps pointing at the old one. Measured on the live database: register `68b912e2` holds
shift `d46e2b41` whose `operator_session_id` is `9651df29` (**ended**), while the till's live
session is `3042ac86` on the same device. The client takes its shift id from `cash.activeShiftId`
(`catalog_surface.dart:2534`), which is null after a restart, so the charge posts a null shift id
and `pos-checkout.repository.ts:1069` throws `CASH_SHIFT_REQUIRED` — an untyped **500**, on screen
as _"No fue posible completar el cobro de forma segura."_ with a **"Reintentar"** that re-sends
the same broken payload and can therefore never succeed.

Observed live: `pnpm ux:pos:native`'s money-path flow failed after 44 s waiting for "Cambio a dar"
with exactly that toast. **The server already has the tools** — `shifts/:shiftId/resume` and
`shifts/:shiftId/adopt` exist and `cash.shift.resume` is in the cashier's permissions — so this
is a client that never asks and an API that answers an untyped 500 instead of saying which
register holds what. It is unstarted work at the time of writing; the fix is delegated.

**The lesson this pair teaches, and it is the same one as the native-client correction.** D23
needed a dead terminal and a stale shift — a state a unit test would have to invent. D24 needs
only an app restart, which is ordinary life. Neither was visible to the API tests, the unit
tests, or the web-build sweep, and both were found within an hour of driving the real client
with real clicks. That is the standing argument for the owner's instruction, and it is why the
native workflow suite is the instrument of record from here.

### D12 investigated — the till loses its operator at the refresh boundary

Recorded here the way D5 was, so the next pass implements a decided fix rather than
re-diagnosing it.

**The evidence.** `posRefresh` renews through `findUserById`, and that read demands
`password_hash IS NOT NULL` (`auth.repository.ts:622`). An operator the dashboard created
with an email and a till PIN has an **`invited` login and no password hash** — that is
deliberate, because `security_gate.sql` forbids `active` + email + NULL hash. So the till
opens for them (`findPosPinStaff` admits `invited`, fixed earlier this session) and then
**cannot renew one access TTL later** — 30 minutes by default, 15 in the example env. Measured
on the live database rather than inferred:

```
             email             | status  | has_hash | has_pin | survives_finduserbyid
-------------------------------+---------+----------+---------+-----------------------
                               | active  | f        | t       | f
 ux.d6.1789560035@example.test | invited | f        | t       | f
```

Two operators, and neither survives the read. One is the phone-only case (no email at all),
the other the email case. The second is what a shift actually looks like.

**The decision.** The till needs its own read, and only its own: a POS renewal lookup that
returns the id, email, display name and status **without** demanding a password credential,
used by `posRefresh` alone. `findUserById` keeps its predicate for the dashboard's refresh
and MFA paths, where a password credential is genuinely required — nobody signs into the
console with a till PIN. Do not relax `findUserById` in place: it is shared with `/me`, and
loosening it would change what the console resolves for every account.

**Why it matters beyond tidiness:** it is D's own acceptance's last dependency. The
money-path tap budget (F5) cannot be measured while a till operator can be signed out
mid-shift, and the branch's POS work is now in this tree, so the surface a person would use
to move a party of eight exists — it is the renewal that would drop them mid-service.

**Verification the next pass owes:** a unit test on the new read plus the SQL predicate proof
above, and — if a device proof can be produced — a live `posRefresh` for a PIN-only operator.
One earlier attempt could not drive the till end to end because the refresh needs a signed
device proof; if that still holds, say so rather than claiming a live renewal.

### Ninth pass, 2026-09-16 — the recovery, and a hand-driven sweep of every POS destination

**This document was lost and restored, and the method matters more than the incident.** A
stale editor buffer was saved over the file, replacing 142 KB with a 27 KB copy. `docs/plans/`
is untracked, so `git log` had nothing. The history survived in the agent transcripts under
`~/.codex/sessions/**/rollout-*.jsonl`, and replaying **every recorded operation in order** —
48 `apply_patch` edits interleaved with the 22 `npx prettier --write` runs that followed them
— rebuilt the document with **2 failures out of 50, both benign**. Replaying the patches
alone failed 10 times, because prettier re-pads every table after each batch and the next
patch was written against the padded text. The full recipe, the two landmines (patches carry
ABSOLUTE paths; a replay writes the real file), and the cheap rule that prevents the whole
class — copy an untracked document before touching it — are in
`docs/development/LOCAL_VERIFICATION_PLAYBOOK.md` §7.

**A hand-driven sweep of every POS destination found fifteen defects in one pass.** The
native app was driven entirely with `xdotool` against the live X11 window and read back with
`xwd` frames: 45 recorded steps, 74 screenshots, coordinates in
`docs/development/LOCAL_VERIFICATION_PLAYBOOK.md` §3. The two most consequential were also
fixed or diagnosed in this pass.

#### Two defects found by the sweep that no unit test could have found

**D25 — the cash ledger sorted as text, so the Caja screen died at the tenth entry.** `expectedCash`
projected `sequence::text`, and an output-column name shadows the table's own column, so
`ORDER BY sequence` sorted the **string**: `1, 10, 2, 3, …`. `calculateExpectedCash` requires a
strictly increasing sequence and threw `RangeError: Cash ledger order or amount is invalid.`,
which the API returned as a bare **500** (8 occurrences in the log). Proven on the rehearsal
database at exactly ten entries:

```
ORDER BY sequence                             -> 1 10 2 3 4 5 6 7 8 9
ORDER BY merchant.cash_ledger_entry.sequence  -> 1 2 3 4 5 6 7 8 9 10
```

**Fixed**: `ORDER BY merchant.cash_ledger_entry.sequence`, plus a source-guard test in
`pos-cash.repository.regression.spec.ts` (the file already guarded two sibling footguns of the
same shape). A till whose ledger reaches ten entries could not open its own cash screen, and
the number ten is a Tuesday's trading, not an edge case.

**Verified end to end afterwards, with real clicks on the fresh app.** The POS was restarted
through `tools/ux-sweep/pos-native-launch.sh`, the operator PIN was entered on the real keypad
(four dots, no doubled tap), and `Caja` was tapped: the screen now renders in full — "Turno
abierto · Caja Linux · 2026-09-16 · Abierto hace 2 h 41 min", the register-hold card
("Esta caja quedó retenida por una terminal que ya no existe" with `Liberar la caja · Caja
principal`), the four cash movements, `Suspender turno` / `Entregar turno`, and `Cierre de
turno`. The same screen was a permanent spinner before. The fix is confirmed at the surface an
operator touches, not only at the query.

**D26 — and the till shows a spinner forever instead of the error, which is why it looked like
a hang.** `CashController.load()` catches `AppException` only. Any other failure — including
the 500 above arriving as a non-`AppException` — escapes the handler, so `busy` is never
cleared and the surface spins indefinitely with **no message and no recovery action**. The
screen that was reported as "stuck loading" was in fact a failed load presented as a
permanent wait. It is the §4 bar's own sentence in the negative: _every failure shows a typed
message with a recovery action_.

**Fixed, and it was two faults rather than one.** Reading the surface as well as the controller
showed the second half: `cash_surface.dart` rendered `snapshot == null` as an unconditional
`CircularProgressIndicator`, so **even the handled failure** — the `AppException` branch that
sets an `errorCode` — left a spinner on screen, with only a transient SnackBar and a refresh
icon that is disabled while `busy` is true. So:

- the controller now has a catch-all beside the `AppException` branch, setting
  `CashController.unexpectedFailureCode` (`CASH_CENTER_UNAVAILABLE`). Deliberately not a
  contract code: nothing in the API describes this failure, and a borrowed code would make the
  operator's message lie;
- the surface draws `_CashUnavailable` — an error icon, the message, and a `Reintentar` button
  that calls `load()` — whenever there is no snapshot and no work in flight. It reuses the two
  strings that already existed (`cashOperationFailedMessage`, `retryAction`), so no new
  translation was owed.

`flutter analyze` clean, and two new tests in `test/cash_load_failure_test.dart` pass: a
non-`AppException` failure clears `busy` and names itself, and the retry is a real second
request rather than a dead button.

#### The sweep, in full

Each row is the click that found it. Severity is the author's, not the owner's.

| ID   | What a real operator hits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Severity  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| D27  | ~~**A table cannot be opened from anywhere in the POS.**~~ **FIXED the same day, verified with real clicks.** The sweep was right: every table gave an info-only sheet whose only action was `Cerrar`, so workstream D's whole gesture set had no entry point on the till. The client half now exists and the flow runs end to end on the native build — see "Workstream D's client half, landed and measured" below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **Fixed** |
| D28  | ~~**The cart drops a line but the total keeps counting it.**~~ **FALSIFIED — the line is not missing, it is scrolled.** The sweep saw "3 quesos 85.00" with Subtotal and Total at 180.00 and concluded a charge for an invisible item. A single wheel scroll inside the cart list reveals `Chapata · SALAMI Y CHIPOTLE, no chipotle · MXN 95.00`, with its own quantity, edit and delete controls, and the database holds both lines (`3 quesos` 8500 + `Chapata` 9500 = 18000). **What is real is the affordance**, now D28a.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Withdrawn |
| D28a | **The cart list is a scroll region with no cue that it scrolls.** At this window height exactly one line is visible: no scrollbar, no clipped next row, no count. An operator with two lines sees a total that does not match the single line on screen — which is precisely the misreading that produced D28 above, by a careful reader looking straight at it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | High      |
| D29  | **Barra is dead and inconsistent.** The bar element in the plan view does nothing when clicked and is absent from the list view.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | High      |
| D30  | A two-row required modifier group pushes `Agregar al carrito` fully below the fold, and the checkout's `Cobrar · MXN 180.00` likewise. Both scroll, so the action is invisible on first paint.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | High      |
| D31  | The first tap is swallowed when "Nota del operador" holds focus: an instantaneous move-and-click did nothing in three seconds, while hover-then-press-and-release added the item. Possibly a harness artifact; worth a retest as a real focus trap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | High      |
| D32  | `Ajustes` contains no settings — only "Bloquear operador" and "Cerrar sesión". Configuration has no home in the POS.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | High      |
| D33  | ~~**The kitchen board cannot be cleared, so it fills up.**~~ **FIXED, and closed with a real tap on the till.** The board was a read-only view (`kitchen_board_surface.dart` had no `onTap`, the controller only `load`), so every ticket that ever reached it stayed — ~10 `pos-cart:<uuid>` rows aged 132 minutes to over 10 days beside A-101..A-105. The server had the command vocabulary but **could not serve a POS device**: `ticketBelongsToDevice` requires a session `stationId` and every POS session has `station = null`, while `verifyDevice` read `metadata.location_id` against the till's `locationId`, so a live call answered `404 ticket_not_found` for a ticket the same board was displaying. **Fixed in three layers**: a POS-scoped `POST …/kitchen/command` that scopes by the location's stations and the operator session (proven live: board 200 → old route 404 → new route 201, replay 201 with no second journal row, `recall` refused with `KITCHEN_PERMISSION_REQUIRED` naming the permission and then 201 once granted, the ticket leaving the board on completion); a client whose lines are tap targets with per-item `mark_item_ready` and ticket-level moves; and the till switched from `/api/kds/command` to its own route. **Verified by hand**: tapping one line of A-103 sent `POST /api/v1/pos/…/kitchen/command` → **201 in 126 ms**, the item's `status` became `ready` in the database, the ticket advanced from `Parcial` to `Listo`, and the card redrew with both lines checked. The sweep's other half of that row is fixed too: the board rendered every age as raw minutes, so a ticket from ten days ago read `14747 min`. `formatTicketAge` now gives two units — `now`, `12 min`, `2 h 5 min`, `10 d 5 h` — with the second only once the first stops being a glance, six boundary tests, and the live board verified reading `10 d 6 h` where it used to read `14716 min`. | **Fixed** |
| D34  | ~~Checkout offers exactly one payment method, "Efectivo" — no card, transfer, split, or stored value.~~ **FIXED 2026-09-17, closed with real taps on the native till.** The tender surface offers Efectivo, Terminal manual and the card terminal, and a second method **replaces** the first: a divided check exists only after the operator arms `Dividir el pago`. The legs are named in the order the money is taken (cash first, because the change is measured from it), a split that does not cover the bill says by how much and keeps the charge button inert, and a location that takes one method per sale says so instead of hiding the control. Proven by `checkout_test.dart`, `checkout_point_tender_test.dart` and the native flow `tender-split-is-a-decision`. What remains of §8G is stored value and the live Point transport, not the split.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | High      |
| D35  | `Ventas`, `Pedidos` and `Ajustes` are modals that cover the navigation bar. The nav is unreachable while open, and the dismissing tap does not activate the item underneath, so changing place costs two taps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Medium    |
| D36  | `Nueva venta` does nothing with 180.00 in the cart: no confirmation, no reset, no new sale.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Medium    |
| D37  | The cart's `Comer aquí` chip does nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Medium    |
| D38  | Modifier labels truncate to `no chip…` / `si chipo…`, cutting off exactly the distinction that defines the option, and "Chapata" left the screen between taps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Medium    |
| D39  | One add landed within 1.2 s, another showed nothing at 2.5 s and had landed by the next frame — inconsistent, and it is what makes the tap suite flaky.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Medium    |
| D40  | The catalog grid renders two tiles with a large dead area at 1274 x 770.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Medium    |
| D41  | The Mesas surface has no bottom navigation, so an operator who taps `Mesas` must use the back chevron to leave.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Low       |

**What the sweep did not reach, stated plainly:** no payment was completed, so receipt output,
the drawer kick, sale completion and their downstream effects are still unverified. The
overflow destinations (`Suspender venta`, `Cancelar venta`, `Centro de clientes`, `Inventario`,
`Hardware`, `Centro de recuperación`, `Diagnóstico`) were listed but not opened. KDS ticket
lifecycle, `Atender`, `Asignar cliente` and `Para llevar` were not exercised.

**One of the fifteen did not survive verification, and that is the point of writing them
down.** D28 was reported as a critical money defect — a cart that drops a line while the total
counts it, "a charge for an invisible item" — and it was withdrawn after two minutes of
checking: one wheel scroll inside the cart list showed the second line with its own controls,
and the database held both rows at the right prices. The lesson is the playbook's own first
rule for a number, applied to a defect: **a false defect is worse than a missing one**, and the
cheapest cure is to try the second reading before writing it into the ledger. What the wrong
reading _did_ leave behind is worth keeping — D28a is the real defect underneath it, and it is
the one that misled a careful observer: the cart list scrolls with no cue that it scrolls.

#### D9 reproduced live, by hand

The `nest start --watch` loop was caught doing exactly what D9 describes. After a source edit
it logged `Found 125 errors. Watching for file changes.` and **never respawned**: the running
API process still carried its start time from 44 minutes earlier while `dist/` had already
been rewritten, so requests were served by stale code and a `curl /health` said 200 the whole
time. `npx tsc --noEmit` was clean seconds later — the 125 errors were the transient
`@umi/contract` rebuild that D9 already names. Touching `src/main.ts` did **not** wake it; the
only cure was to kill the watcher and start it again. This is now the strongest argument for
the workaround already written down: compare `ps -o lstart= -p $(pgrep -f 'dist/main')`
against the `dist` mtime before believing any local API result.

### Workstream D's client half, landed and measured, 2026-09-16

The plan had specified this surface in detail and the till had none of it. It now has all of
it, and every operation was driven by hand on the native build rather than asserted from a
test.

**What exists now.** `apps/umi-pos/lib/features/tables/table_state_repository.dart` reads and
writes through the generated contract types; `table_state_controller.dart` holds the room —
`stateOf()` returns `open` for a table with no entry, `serverNow` is anchored to the snapshot's
`serverTime` so a till with a wrong clock cannot lie about a turn, `elapsedOf()` is the timer
from `seatedAt`, and each command mints a fresh v4 idempotency key, applies the response's own
`changed` entries, then re-reads. `floor_plan_surface.dart` draws the state, hosts the
gestures, and carries a typed failure banner. 21 new tests (14 controller, 7 surface) plus 54
localized strings; `flutter analyze` clean and the full app suite at **285 passed**.

**§8D's five requirements, each observed rather than inferred.**

| Requirement                        | What was seen on the real window                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| State on the map, not colour alone | A free table draws four **hollow** seat markers on a grey ring; a seated one draws four **filled** markers inside a green ring. The state is in the drawing, so it survives a colour-blind operator and a screenshot.                                                                                                                            |
| The turn timer                     | `T1` showed `2 s` at the moment of seating and `1 min` / `2 min` as it ran, redrawn by a one-second ticker that only runs while a party is present.                                                                                                                                                                                              |
| Merge and split as one gesture     | Selection mode read `Selecciona dos o más mesas libres`, counted `2 seleccionadas`, offered `Combinar`, and defaulted the party to the tables' combined capacity — `2 mesas · 8 lugares`. The result draws as **one bounded region** around T2 and T3, and the database holds two rows sharing `group_id 1d4bbcd0-…` with identical `seated_at`. |
| Move                               | `Moviendo T1. Toca una mesa libre.` then a tap on the target: the party moved, and the origin table was left **`dirty`** — the party left, the table needs clearing.                                                                                                                                                                             |
| The timer survives the move        | The moved party's `seated_at` is `23:51:10.212`, **byte-identical to the seating before the move**. The clock did not restart. This is §8D's sentence "It must not restart on a move", proven at the database rather than in the client.                                                                                                         |

**The operator path, measured.** Every write the till made during the run, with the server's own
duration from the API log — three writes, three `201`s, no retries:

| Gesture                                | Request                    | Server | Then             |
| -------------------------------------- | -------------------------- | ------ | ---------------- |
| Seat a party of four                   | `POST …/table-state/seat`  | 87 ms  | fresh read 15 ms |
| Merge two tables into a party of eight | `POST …/table-state/merge` | 89 ms  | fresh read 15 ms |
| Move a party                           | `POST …/table-state/move`  | 77 ms  | fresh read 10 ms |

So a whole party change is **under 105 ms end to end**, against an acceptance line of five
seconds. The read the map polls on is 7–95 ms.

**The eight-guest move has one honest gap, and it is data rather than code.** The seeded
`Salón` is four tables of four seats. Merging T2 and T3 gives a real party of eight (confirmed
in the database), but a _move_ of that party needs one target table that seats eight, and this
plan has none — so the client refused it locally with a typed message, `Esa mesa no tiene lugar
para 8 personas.`, and made **no HTTP request at all**. That is the correct behaviour and it is
why the refusal appears rather than a failure: the server's own acceptance measurement (the
`table-state` integration suite, `party of 8: 2 requests (seat + move), 63.1 ms`) covers the
server half, and the operator half needs either an eight-seat table published in the plan or a
group-aware move route. Recorded as the remaining half of D's acceptance line.

**Reading `move` afterwards turned that gap into a real product question rather than a fixture
problem.** `TableMapRepository.move` takes one `fromTableId` and one `toTableId`, checks
`partySize > target.capacity`, and then releases _every other member of the group_ to `dirty`.
So a merged party is movable **only onto a single table that seats the whole party** — and on any
floor plan without a large table, a merged party of eight can never be relocated as a party at
all. The operator's only route is split, move each table's party, merge again: four or more
gestures, a discarded `group_id`, and a turn timer that survives only because the server refuses
to move `seated_at`. This is a design decision rather than a bug, and it is not this plan's to
make silently. Two shapes are open: **a group-aware move** (move a group onto a set of free
tables whose combined capacity covers the party — what "move a party of eight between tables"
literally asks for), or **a documented rule** that a merged party is dissolved in order to move.
Recorded for the owner with the evidence; neither is implemented on a guess.

**The three service transitions landed, and were driven by hand.** §8D step 5's remainder is
closed: `POST …/table-state/{ordered,served,awaiting-payment}` exist in the contract, the API and
the till, one route per operation so a refusal names the operation it refused. The design choices
are written into the contract — **no sequence is imposed** (any party-present state may reach any
of the three, because real service is not linear and the database already permits it), the
`UPDATE` touches only `state` and `updated_at`, a merged group advances as one row set, and the
operation is idempotent so a tap repeated does not become an error.

**Verified on the running native POS with real clicks, on the real database**, one transition at
a time, each read back from `merchant.table_state`:

| Gesture in the sheet | State after                   |
| -------------------- | ----------------------------- |
| `Pedido enviado`     | `seated` → `ordered`          |
| `Marcar servido`     | `ordered` → `served`          |
| `Pedir la cuenta`    | `served` → `awaiting_payment` |

`seated_at` was **`2026-09-17 00:29:20.37276+00` before, between and after all three** — the turn
timer survives a service transition as §8D step 5 requires, and the party size stayed 2. The map
and the accessibility tree both read the new states: the node for that table moved from
`T2, 4, ordered | T2 | 1 min` to `T2, 4, served` and on to awaiting payment, and a seated table
publishes `T1, 4, seated 9 s | T1 | 9 s`, so the state and the timer are available to a screen
reader and not only to an eye. Automated gates for the same change: contract `69/69`,
`generate:check` clean, API typecheck and lint clean, `table-state.integration.ts` **39 passed**
including a per-transition group test comparing `seated_at`/`party_size`/`group_id` before and
after, POS `flutter analyze` clean and **291 tests passed** (285 → 291).

Two notes for the next pass. The `served` action was renamed **`Marcar servido`** because the
sheet's state heading is `Servido` and two identical lines in one sheet is a tap waiting to hit
the wrong one. And the driver's own log caught the reason those clicks kept missing: on this
window manager **`xdotool windowactivate` fails, so a click only lands if the till's workspace is
shown first** — `wmctrl -s 1` before driving. That is written into the playbook, together with
`wmctrl` itself, which went in the same no-root way as `xdotool`.

Left in the rehearsal database, by id, as the plan's own rule requires: tables
`61c9e09f-779f-4e93-9d3b-85b9b026526c` and `ce1c140a-bfa9-489d-a8b8-f0c4ec8e7c17` at
Chapultepec, both `awaiting_payment` with a party of 2, left by this verification and cleared
with one `Liberar mesa` each. `table-state.integration.ts` also leaves rows for its own seeded
tables in the same merchant, which is why a merchant-wide count of states is not a clean read —
scope a query to a table id.

**D43 — the console's read of the room exists and nothing reads it.** §8D step 3 says table
state belongs "on the map itself", and the API agrees: `TableMapController` publishes
`GET /api/merchants/:merchantId/table-state` under `merchant.manage`, with a comment stating why
— _"a manager looking at a table that 'looks wrong' needs to see who is on it and for how long
without a till"_. **No client calls it.** `apps/umi-dashboard/src/screens/floor-plan.jsx` draws
the layout — kind, rotation, size, seat dots — and contains no reference to table state at all,
so the owner's floor-plan screen shows a room where every table looks identical whether a party
has been on it for two hours or it has not been touched since breakfast. The till half of step 3
is done and verified; the console half is dead route surface with a written intent behind it.

**Verified in the real browser, not by reading the JSX.** `tools/ux-sweep/floor-plan-state-probe.mjs`
attaches to the Chromium that Playwright drives over CDP — the browser the operator actually
runs, already signed in — opens `/floor-plan`, watches the wire from **before** the first
navigation, and then drags the canvas with real pointer events. Result: the route returns 200,
two canvases draw, the network log contains **zero** requests to `/table-state`, the visible text
contains **zero** state words, and the drag moves the layout while telling the operator nothing
about the room. The screen in front of me drew `Salón · 7 tables` for Congreso, with T1–T7 and the
bar counter in one flat style. The same probe is the shape the rest of the console verification
should take, and the standing rule is now written into the playbook: **a dashboard claim is proved
in the real browser with real clicks, and the browser is the real Chromium over CDP showing a
window on the desk — not a headless run and not a component test.**

**D43 is fixed and verified the same way.** The console now calls the route it always had: the
network log of a real page load contains `GET /api/merchants/1860305f-…/table-state`, and the map
draws the room. With a room seeded through the **real POS command routes**
(`tools/ux-sweep/table-state-seed.mjs` — seat and the three service transitions, not raw inserts,
so what the console reads is a room the product could actually have produced), the screen shows
T4 `awaiting_payment` in amber with its badge, T2 `ordered` in blue reading `30 min`, T3 `served`
in green, T5 `dirty`, and T1/T6/T7 differing in ring, seat markers, badge and timer — **not colour
alone**, which is §8D step 3's exact sentence. The screenshot is
`/tmp/ux/floor-plan-state/console-with-state.png`.

**D45 — on half the room the state was carried by colour after all.** The console's author noticed
in passing that the till draws its state badge at `Positioned(top: 1, right: 1)` inside a `Material`
shaped as a `CircleBorder` with `Clip.antiAlias`, and said it would be clipped on a round table. It
could not check: the till was being driven by hand. **Checked on the real till, and it is true.**
Seating a round table and a rectangular one in the same room and cropping both at 1:1 shows the
rectangular table drawing a whole, legible chair glyph, and the round table drawing a **fragment of
one, cut by the rim** — which means the round tables (half of this plan) carried their state by
colour and a clipped smudge, and §8D step 3 says in as many words that colour alone must not carry
it. **Fixed**: the badge is inset by the distance from the square corner to the rim at 45 degrees
(`min(width, height) * 0.15`) on a round table and stays at the corner on a rectangular one.
`flutter analyze` clean, the surface suite at 36 passed, and after a rebuild the round table draws
the whole glyph beside `T1 · 2 min`. Before: `/tmp/pos-d27/t1-zoom.png`. After:
`/tmp/pos-d27/t1-fixed.png`.

**§8D step 7's POS half is instrumented, and it passed once.** `pos-tables-merge-split` is in
`tools/ux-sweep/pos-native-flows.mjs` with a budget of 9 taps / 45 000 ms, declared in
`config/ux-budgets.json` beside the other native flows. It drives the real merge gesture on the
running till — the destination, a table, `Seleccionar`, the second table, `Combinar`, `Confirmar`
— proves the merge from the product's own words (`Grupo de 2 mesas` in the sheet), then splits
from that same sheet and proves the group is gone. **It passed: `ok — 9 taps, 12 960 ms`**, a
whole merge-then-split cycle inside the budget the assumption set.

**And it is flaky, for a reason worth writing down.** On later runs the merge still happened —
the database shows the pair `seated` with a shared `seated_at` — but the flow failed at the
click that re-opens the table to read `Grupo de 2 mesas`, with the driver reporting that the
press "had an effect". It had not: what changed was the surface's **one-second turn timer**
(`1 s` → `13 s` on both tables). The driver's safety rule — a click that changes nothing is
retried, a click that changes something is never repeated — reads the ticking clock as a
successful action, so a swallowed tap can no longer be distinguished from the timer, and the
retry it refuses is exactly the one that was needed. That was an instrument defect with a precise
cause, not a product defect, and it is **fixed**: `pos-native-driver.mjs` now masks the ticking
parts of a name — elapsed durations (`7 s`, `2 min`) and refresh times (`18:20`) — before it
fingerprints the tree, so the clock cannot masquerade as an effect, and `waitSettled` can finally
settle on a room that has a party in it (which it never could before: the label ticked every
second, so three equal fingerprints were unreachable). The flow also counts **operator taps, not
presses**, so the instrument's own recovery is not charged to the operator, and it **measures the
gesture alone**, excluding the setup that clears a table an earlier run left dirty — otherwise the
number would depend on the room's history rather than on the operator's path.

Three isolated re-runs after the fix: **passed, passed, passed**. Then the whole suite, which is
the check a change to shared tooling actually deserves, because every native flow fingerprints the
tree:

| Flow                     | Taps  | Measured  | Budget     |
| ------------------------ | ----- | --------- | ---------- |
| `pos-sign-in`            | 5     | 16 728 ms | 5 / 25 000 |
| `pos-tables-open`        | 4     | 7 744 ms  | 4 / 15 000 |
| `pos-tables-merge-split` | 6     | 21 428 ms | 9 / 45 000 |
| `money-path-pos-charge`  | **3** | 7 718 ms  | 3 / 12 000 |
| `pos-restart-recovery`   | 3     | 7 744 ms  | 3 / 12 000 |

`passed: true`, every flow inside its budget, and the money path still at the three taps the plan's
§4 fixes — which is the sentence that matters, because a driver change that silently loosened the
money path would have been worse than the flake it fixed.

Two smaller things the same exercise exposed, both fixed in the flow rather than in the product.
After a split the two tables are **asymmetric** — the survivor keeps the party and the other is
`dirty` — so a restore that assumes both are occupied fails; and `Mesa lista` **closes the sheet**,
so waiting for the sheet's own `Libre` after it is waiting for something that will never appear.
Both are in the flow's restore, which now runs in a `finally` so a failed gesture cannot leave the
floor in a state that makes the _next_ run fail on its precondition — which is how one flake turns
into a suite that only passes on a fresh database.

The lesson is worth keeping, because it is the second time this plan has paid for it: the route
existed, the contract existed, the intent was written in a comment on the controller, and the
screen showed nothing for it. **Only opening the screen found it.**

**Two corrections to the brief, from the implementer, both worth keeping.**

1. `clear` and `open` are different operations and the plan's §8D prose conflates them.
   `pos.tableStateClear` refuses a table with no party (`TABLE_NOT_OCCUPIED`) and turns an
   _occupied_ one `dirty`; the route that returns a table to service is
   `pos.tableStateOpen`. The surface therefore offers `Liberar mesa` on an occupied table and
   `Mesa lista` on a dirty one. Calling `clear` on a free table, as written, would only ever
   produce an error.
2. **Three of the six states had no route until this evening** — they do now; the account is at the end of this section. The original finding: `ordered`, `served` and `awaiting_payment`
   are drawn, coloured, named in semantics, and counted as a party for the timer and the
   capacity rules — but the API exposes only read, seat, move, merge, split, clear and open, so
   nothing can set those three. §8D's step 5 already calls for one small route each; this is
   the precise remainder, and until it lands the six-state model is four states a till can
   reach.

**A retry nuance to decide later.** A command that loses its response gets a
`TABLE_ALREADY_OCCUPIED` refusal on retry rather than the first attempt's own outcome, because
the idempotency key is minted fresh per attempt. The server's command journal already supports
replay-with-the-original-outcome; reaching it needs a durable pending-command journal on the
client — the `cash_recovery_store` pattern. Not built, and not needed for correctness of a
single attempt, but it is the difference between "safe" and "replayable".

**D42 — the operator was being told "la party" in Spanish.** Driving the clear path surfaced a
wording defect no test would catch: the Spanish strings said `Esa mesa ya tiene una party.`,
`La party es más grande de lo que cabe en la mesa.`, `No hay ninguna party en esa mesa.`, and
the confirmation dialog read `Ya se fue la party de T4?` — the English noun left untranslated
in the till's own language, on a Mexican café counter, and missing the opening `¿` that Spanish
questions require. **Fixed**: the four localized strings now say `un grupo` / `El grupo` /
`ningún grupo`, and the inline confirmation reads `¿Ya se fue el grupo de T4?`. `flutter gen-l10n`
regenerated cleanly, the generated Spanish file no longer contains the word, `flutter analyze`
is clean and the full app suite is **285 passed**. Worth naming as a class, because the surface
builds several strings with inline `es ? '…' : '…'` ternaries rather than the `l10n` file, so a
future string can miss translation entirely and no l10n check will notice.

**The existing instrument still passes, and it was worth checking rather than assuming.** The
Mesas surface was rewritten, so the flow suite that taps it had to be re-run: `pnpm ux:pos:native`
returns **`passed: true`** with every flow inside budget, which is the evidence that the new
table-state client did not disturb the money path it sits beside.

| Flow                    | Taps  | Measured | Budget     |
| ----------------------- | ----- | -------- | ---------- |
| `pos-sign-in`           | 5     | 9 435 ms | 5 / 25 000 |
| `pos-tables-open`       | 4     | 8 506 ms | 4 / 15 000 |
| `money-path-pos-charge` | **3** | 8 372 ms | 3 / 12 000 |
| `pos-restart-recovery`  | 3     | 9 356 ms | 3 / 12 000 |

The charge in that run committed a real sale and ended on `post-restart-sale-complete`, so the
three-tap money path is still three taps on the real client after the change.

**D43 — closed. The console reads the room, and it draws it the way the till draws it.** The
client half that was missing now exists, and the verification is a browser observation rather
than a reading of the JSX.

What moved. `apps/umi-dashboard/src/data.jsx` gains `fetchTableState` beside `fetchFloorPlan`,
through the same `_apiFetch`, so a room read behind an expired cookie refreshes and retries
exactly as a plan read does. `apps/umi-dashboard/src/screens/floor-plan-model.js` gains the room:
the read is parsed by the CONTRACT's `TableStateMap` (so a seventh state throws here rather than
reaching the canvas as a colour), a table the room never mentions reads as `open`, the turn is
measured against `serverTime` and not the workstation's clock, and the six visual states live in
one table. `apps/umi-dashboard/src/screens/floor-plan.jsx` draws it: accent and a 2px edge, a
badge glyph in the app's own Lucide language, seat markers that FILL with a party and stay hollow
without one, a hatched seat band for `dirty`, the turn timer stacked under the table's name, one
outline around a merged party, and a small muted line when the room read fails — which leaves the
editor working, because a manager who cannot read the room must still be able to edit the floor.

The six states are the contract's, spelled as the till spells them, and the words are the till's
own: `Libre`, `Ocupada`, `Pedido tomado`, `Servido`, `Por cobrar`, `Por limpiar` — the same six
`app_es.arb` already uses, so one room is named one way on both screens. The console does NOT
clip the badge. The till draws it as `Positioned(top: 1, right: 1)` inside a `Material` whose
`shape` is a `CircleBorder` with `clipBehavior: Clip.antiAlias`, so on a round table the mark is
clipped by the rim and effectively disappears; the console draws the same mark at the same
corner without clipping it, which is a deliberate divergence and the better of the two.

**Verified in the real browser, with real clicks, on a real room.** The room was put there by
`tools/ux-sweep/table-state-seed.mjs` — through the real POS command routes, never with INSERTs —
because an empty room proves nothing: a broken reader looks exactly like an idle café. Then:

- opening `/floor-plan` issues `GET /api/merchants/…/table-state?locationId=…`, where the earlier
  probe recorded **zero** such requests;
- the map draws `Ocupada`, `Pedido tomado`, `Servido`, `Por cobrar`, `Por limpiar` and `Libre` in
  one frame, each with its accent, its badge, and a seat band that is filled, hollow or hatched;
- the turn timers are live from the server's clock — `10 min` on four tables seated minutes ago
  and `29 s` on a table seated during the observation, which is the timer recomputing, not a
  stored number;
- **the read follows the top-bar location selector**: clicking it and choosing `Chapultepec`
  produced two reads carrying Chapultepec's id and Chapultepec's own room, and choosing
  `Congreso` again read Congreso's back;
- the poll is a 15 s beat — 2 reads in 32 s while the tab is visible, `0` in 50 s while it is
  hidden, and `1` within 5 s of the tab coming back. This Chromium will not report a hidden tab
  (minimising reaches `WM_STATE: Iconic` and a background tab is still `visible`), so the hidden
  state was supplied by overriding `document.visibilityState` and dispatching the real
  `visibilitychange` event; that is stated here rather than presented as a normal observation.

**D44 — the console's first poll loop leaked one loop per mount, and the browser found it.**
Introduced and fixed inside this increment, so it never shipped, but it is worth keeping as a
class: the effect's cleanup set `cancelled = true` and cleared its timer, and the read that was
already in flight then ran `.finally(schedule)` and armed a NEW timer, resurrecting the loop it
belonged to. React StrictMode mounts twice in development, so the visible symptom was exactly
double the intended request rate — 8 reads in 60 s where the beat is 15 s. Guarding the
scheduler, not only the read, is the fix. It was found by counting requests in the live page,
not by reading the code.

**Re-measured independently, because a fix reported by the same agent that wrote it is a claim
rather than evidence.** Attaching to the real Chromium, navigating to `/floor-plan` and counting
`/table-state` on the wire for 46 seconds: **3 requests, with gaps of 15.1 s and 15.1 s** — the
beat, one per beat, and the doubling is gone.

**D46 — the API could tell a client it spoke a contract it did not.** `/health` reported
`contractVersion 2.13.0` while the generated contract was `2.19.0`, because the release identity
reads a `CONTRACT_VERSION` **environment variable** that at least three places maintain by hand:
`apps/umi-api/Dockerfile`, `apps/umi-dashboard/Dockerfile` (into the dashboard's `release.json`),
and `apps/umi-pos/packaging/linux/build_appimage.sh`, which still defaults to `2.13.0`. A client
reads that field to decide whether it can talk to the service, so a field that can disagree with
the contract the process actually speaks is worse than no field. **Fixed for the API**: the release
identity now reports the generated constant (`CONTRACT_VERSION` from `@umi/contract`), which is
compiled into the same artifact and therefore cannot drift from it. Verified live: `/health`
`status: ok`, `contractVersion: 2.19.0`, `expectedSchemaVersion: build-v3-69` matching the
database. **Still open in the plumbing**: the three build scripts above set that variable by hand,
and the POS AppImage default is two minor versions stale; the same derivation belongs there.

**One correction to the expectation that the visual baseline would move.** It did not, and that
is the honest result: at the reference viewports the visual harness pins (`1024x768` and
`1280x720`), seven repainted tables occupy too few pixels to reach
`expect.toHaveScreenshot`'s `maxDiffPixelRatio: 0.02`, so `pnpm ux:visual:update` reported
"passed" and wrote nothing. Both `/floor-plan` baselines therefore still pass unchanged — and
they are only valid while the room is quiet, because the turn timers are canvas text that
`maskVolatile` cannot reach. `pnpm ux:visual` returns **12 passed** for the baselines; the whole
command exits non-zero only because `tools/ux-sweep/floor-plan-map.spec.mjs` (the §8D step 7
console suite, in flight under another agent) fails its untraced-drag assertion at both
viewports. That file is not part of this increment.

### Workstream E, steps 5 and 6 — the costing view and the low-stock forecast, 2026-09-16

Built: contract **2.21.0**, no migration, four console reads. This section is the evidence the
§14 row points at, and it is written so the numbers can be checked rather than believed.

**Files.** `packages/contract/src/inventory-costing.ts` (models, registered in `catalog.ts` and
exported from `index.ts`); `packages/contract/src/route-table.ts` (four entries, so the route
drift gate proves a controller serves each path);
`apps/umi-api/src/modules/inventory-costing/{inventory-costing.domain,repository,service,controller,module}.ts`
plus `inventory-costing-domain.spec.ts` and `inventory-costing.integration.ts`;
`tools/ux-sweep/inventory-costing-live.mjs`; `fast-check` added to `apps/umi-api`'s dev
dependencies (the plan named it in §6.5 and it was not installed).

**The basis, stated because a cost number with no stated basis is an opinion.** Quantity-weighted
average of `purchase_order_receipt_line.actual_unit_cost_minor` over the receipts that actually
arrived, merchant-wide on purpose (one item has one cost per business; a per-branch average would
make the same plate cost two numbers depending on who looked, and the response lists the branches
the receipts came from so the scope is visible). The item's own `quantity_scale` is the grid every
answer is expressed on, and a receipt written at a different scale is normalised to a common
denominator before the average — 12.5 received at scale 3 and 125 at scale 2 are the same
delivery, and a property in the domain spec asserts they produce the same cost.

**The exact numbers the integration suite asserts**, hand-computed from its own fixtures, because a
shape assertion cannot tell a correct cost from a wrong one:

| Claim                                                      | Fixture                              | Expected                                                                                                                                          |
| ---------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| quantity-weighted, not per invoice                         | 10 kg at $120.50 and 5 kg at $110.00 | **11700** minor/kg — the unweighted mean of the two invoices, 11525, is what a spreadsheet prints                                                 |
| half-up, once, at the end                                  | 1 package at 100 and 1 at 201        | **151** — 150.5 rounded up; half-to-even would have said 150                                                                                      |
| a plate costed to the centavo                              | 12 g beans + 200 ml milk, price 4500 | cost **840**, margin **3660**, **8133** bps (`round(840.4)`, one rounding for the two components)                                                 |
| a batch divides                                            | 600 g and 1.5 L per 10-plate yield   | **60** g and **150** ml per plate; cost **1227**, margin **2573**, **6771** bps                                                                   |
| a day reconciles                                           | two lattes, revenue 9000, tax 1440   | revenue **9000**, grand **10440**, 1 sale, 2 plates, cost **2861** (`round(280.8 + 2100 + 480)`), margin **6139**, **6821** bps                   |
| the modifier is not in the base recipe but IS in the stock | latte + vanilla syrup                | plate cost **840** (no syrup), milk planned 200 ml and **consumed 600 ml**, syrup reported as `modifier_component` with planned 0 and consumed 60 |
| no receipt means no basis                                  | sugar, opening balance only          | `no_receipts`, `unitCostMinor: null`, plate `incomplete`, `uncostedItems: [AZUCAR]`                                                               |
| an untracked day is not free                               | a sale of a product with no mapping  | revenue 9900, cost `null`, margin `null`, `state: incomplete`, `salesLinesWithoutMapping: 1`                                                      |
| the window is a window                                     | cups sold 2026-08-01 and 2026-09-16  | inside the 28-day window: **4** consumed, observed **1** day, cover **123**; the three from August are outside it                                 |
| the rate divides by days observed                          | beans sold on the 10th and the 15th  | 84 g over **7** observed days → **12**/day; a 28-day divisor would have called it 3 g a day                                                       |

**The live read, over HTTP, on the real rehearsal café** (`tools/ux-sweep/inventory-costing-live.mjs`,
which creates the ingredients and receives them through the console's own purchasing routes before
reading):

```
# Kalala Café (kalalacafe) · America/Mazatlan
# received CAFE-GRANO: PO PO-20260917-d85eea8c → send 201 → receive 201
## GET /api/merchants/1860305f-…/inventory-costing/cost-basis → 200
   Café en grano   weighted_average_of_receipts  21500 minor / kilogram  (1 receipt)
   Leche entera    weighted_average_of_receipts   2450 minor / liter     (1 receipt)
   Vaso 12 oz      weighted_average_of_receipts    165 minor / unit      (1 receipt)
## GET …/plates?productId=8258a61e-… → 200
   Pumpkin Spice Latte  price 9100  cost 748  margin 8352 (9178 bps) [complete]
      · Café en grano  12 @ 21500 = 258
      · Leche entera  200 @  2450 = 490
## GET …/days?from=2026-08-20&to=2026-09-16 → 200
   2026-09-02  revenue   11000  cost  —  margin  —   1 sales / 2 plates  [incomplete]
   2026-09-16  revenue  170500  cost  —  margin  —  28 sales / 31 plates [incomplete]
```

**D47 — the first honest read of a real café's day said "100 % margin", and the fix was in the
read, not in the data.** Kalala has 136 products and (until this increment) no recipes, so its 38
committed sales consumed nothing: cost 0, margin 100 percent, every day of its trading history.
That is the same lie §8E forbids one level down — a zero cost standing in for an unknown one — and
it is the worse shape of it, because it looks like good news. The day read now counts sale lines
whose product nothing maps, reports the day `incomplete` with the products named, and refuses to
publish a cost or a margin for it. **It also fixed a second, quieter defect the same read exposed:
`platesSold` was grouped by the CART's trading day while revenue came from the RECEIPT's**, which
put a phantom row in the report with revenue 0 and three plates — the two databases disagree on
five of this café's 38 sales, because a cart opened at 23:50 and paid at 00:05 is one sale on one
day and only the receipt says which. Both sides now come from the receipt, which is the frozen
fact, and the day row is therefore one day's transactions. Verified live: the phantom row is gone.

**The query plans.** `EXPLAIN (ANALYZE, BUFFERS)` on all ten statements the reads issue
(`/tmp/costing-explain.sql`, reproduced below), against a merchant with real rows:

| Query                      | Plan                                                                              | Execution |
| -------------------------- | --------------------------------------------------------------------------------- | --------- |
| cost basis buckets         | Seq Scan on `purchase_order_receipt_line` (93 rows) + GroupAggregate              | 0.27 ms   |
| receipt counts + locations | Seq Scan + GroupAggregate (distinct receipt)                                      | 0.10 ms   |
| plate mappings             | Index Scan `inventory_mapping_active_uidx` → Index Scan `product_merchant_id_uk`  | 0.12 ms   |
| recipe expansion           | CTE Index Scan on the same unique index + hash join to `inventory_item`           | 0.36 ms   |
| plate consumption          | Seq Scan `pos_cart_line` → Index Scan `stock_ledger_entry_merchant_id_…_key`      | 0.18 ms   |
| day revenue                | Seq Scan `pos_committed_sale` → Index Scan `receipt_snapshot_pkey`                | 0.12 ms   |
| day plates sold            | nested loops: `pos_committed_sale` × `pos_cart` × `pos_cart_line` (all seq, tiny) | 0.23 ms   |
| day consumption            | Index Scan on the ledger's merchant-prefixed unique index + GroupAggregate        | 0.13 ms   |
| low-stock on hand          | Seq Scan `stock_balance` + HashAggregate (54 rows)                                | 0.07 ms   |
| low-stock day statistics   | Index Scan on the ledger index + GroupAggregate (count distinct day)              | 0.10 ms   |

**One index this will want at volume, recorded rather than smuggled in.** Every ledger read filters
`merchant_id` + `entry_type = 'sale_committed'` + a `business_date` range, and the only index whose
leading column helps is the idempotency-key unique index — it seeks the merchant's rows and filters
the rest. `stock_ledger_history_idx` is `(merchant_id, location_id, inventory_item_id, occurred_at)`
and cannot serve a date range at all. On a café with a year of trade this is a scan of every ledger
row the merchant owns, per read, twice per request. The right index is
`(merchant_id, entry_type, business_date)` — and it belongs in a numbered migration with
`EXPECTED_SCHEMA_VERSION` bumped in all three build scripts at once, which is the D46 class of
change. Deliberately not done inside a read-only increment.

**What this increment did not do**, stated so the row is honest: no screen reads these routes yet
(the dashboard surface is the next piece and is deliberately out of scope here); step 4's approval
step is still only the command-level `approvalId`; and the cost is a CURRENT weighted average, so a
day six weeks ago is re-costed at today's basis — the platform stores no cost per receipt per sale,
which `costBasis.asOf` names and the contract documents as a real limitation rather than a rounding
detail.

### Tenth pass, 2026-09-16 — the till stops scrolling, and the sweep goes green

Two owner directives drove this pass, and both turned out to be about the same thing: a screen whose
work does not fit the screen makes the operator scroll _while the customer is waiting_.

**"The little notifications from below — they are distracting and don't follow the design. Just
delete them."** They are gone: **19 `showSnackBar` call sites across 7 files, zero left in
`apps/umi-pos`**, and the `snackBarTheme` that made them float up from the bottom is gone from
`umi_theme.dart` so the pattern cannot quietly come back. The confirmation bars went outright — the
"listo para el siguiente cliente" one the owner named, "ajuste registrado", "solicitud de apertura
registrada", the two hardware completions. Clearing the search and returning the cursor to it _is_
the till being ready for the next customer; a bar that slides up to say so only covered the bottom
of the screen, and it landed exactly where the sale-complete dialog puts **Nuevo pedido**, so a tap
aimed there dismissed the bar and did nothing else — the sweep had a `waitForNoSnackbar` workaround
for that, now deleted along with the bar.

The rest were not confirmations, they were the only notice of a failure, so they were moved rather
than dropped: a new `InlineNotice` (`shared/widgets/inline_notice.dart`, a `liveRegion` so a screen
reader still hears it) carries the barcode, sale-lifecycle, catalog-fetch, cash-operation,
refund-validation and hardware-attention messages in the surface that raised them; the kitchen
status failure and the two checkout refusals became the `AlertDialog` those flows already use,
including the lost-gift-card-code case, whose `Reintentar` action is now a button in a dialog rather
than a bar that disappears while the cashier reaches for it. **Silent failure was not the price of
this change.**

**"Centro de caja and the cash screen can fit in one screen with no scrolling — take it as a design
challenge."** Both do, at the reference 1280 × 720 viewport **and** at 1920 × 1080, verified by
driving the real client.

- **Centro de caja** was one centred 1040-wide column of stacked cards; the width was what it was
  wasting. It is now a full-width status strip with two panels under it — the drawer (`Movimientos
de caja`, `Turno`, and the expected-cash and variance cards) on the left, the numbered `Cierre de
turno` path on the right. The page-level `SingleChildScrollView` is gone. Below 1000 px logical it
  falls back to the single scrolling column on purpose: at 800 px the two panels are narrower than
  the controls they hold, and the cash tests caught exactly that (a `RenderFlex overflowed by 93
pixels` from `_MoneyCard`) before this shipped.
- **The blind count** was 11 denomination rows in one column inside a `SizedBox(width: 420)` with a
  scroll view: the small coins and the running total sat below the fold of a screen whose whole job
  is to be counted top to bottom. `DenominationCounter` now lays its rows out in two columns when
  there is room, the dialog is 660 wide, and the whole drawer plus `Total contado` is on one screen.
- **The cash-received screen** — the one that mattered, because it is where the customer stands
  handing over money — was one `ListView` with the keypad, the change banner and the charge button
  below the fold; the sweep literally scrolled three times to reach `Cobrar · MXN 55.00`. It is now
  the bill on the left and the money on the right: keypad, `Cambio`, and `Cobrar · MXN 55.00` all on
  screen at once, edges aligned. The money path now clicks `Cobrar` at y = 608 of 720 **with no
  scroll at all**, and the flow no longer contains a scroll step.

**The instrument was fixed three times, and every fix came from a failure its own evidence
explained.**

1. **Coordinates were resolved before the screen settled.** `clickNode` measured the target, _then_
   waited for the screen to stop moving, then clicked the position measured before the wait. A menu
   that is still opening moves its own items, so `Admin → Bloquear operador` was measured
   mid-animation and clicked into the backdrop that had taken its place: the menu closed, nothing
   happened, and **the API log held no lock request at all** — the only symptom was an expectation
   that timed out. The wait now comes first and the target is re-read after it.
2. **`windowfocus` does not switch workspaces.** The driver focused the till but did not bring it
   forward, so with the terminal and the Dashboard's Chromium on workspace 0 and the till on
   workspace 1, clicks were aimed at another app's window. The tell was in the evidence: a failure
   screenshot of the "cash center" showed the **terminal**. It now calls `windowactivate` and then
   checks `get_desktop_for_window` against `get_desktop`, refusing to click rather than clicking
   blind.
3. **A stable screen is not a loaded one.** Two flows waited with `waitReady` and then read once.
   The loading view is a stable spinner, so the wait settled on it and the read reported "the till
   did not recover its own shift" about a screen that had not answered — with its own screenshot
   showing the spinner. Both now poll for a state the screen can actually be in. This is the same
   trap the driver's own `waitReady` comment warns about, and it had been paid for twice.

**A defect in the product, found by real clicks.** The till published a **live PIN keypad before it
had decided whether to restore a session**, so on a cold start an operator could start typing and
have the screen taken away mid-PIN: digits `1` and `2` registered, `3` failed because the keypad was
gone, and the till landed in the previous operator's catalog with the digits discarded, no rejection
and no log line. The screen said only _"El PIN no es válido para esta sucursal"_, which was false.
Boot now decides first (a spinner in `EntryPhase.restoringSession`) and publishes the keypad only
when there is nothing left to decide; `restoreSession` still publishes it itself on failure. Guarded
by `a restart that will restore never publishes the keypad first`, which asserts the phase never
passes through `pinRequired` on a restoring boot.

**`pnpm ux:pos:native` is green for the first time, every flow inside budget:**

| Flow                     | Measured    | Budget    |
| ------------------------ | ----------- | --------- |
| `pos-sign-in`            | 5 / 9957 ms | 5 / 25000 |
| `pos-tables-open`        | 4 / 7775 ms | 4 / 15000 |
| `pos-tables-merge-split` | 7 / 9461 ms | 9 / 45000 |
| `money-path-pos-charge`  | 3 / 5906 ms | 3 / 12000 |
| `pos-restart-recovery`   | 3 / 5971 ms | 3 / 12000 |

`pos-sign-in` was the flow that had been failing at 26.5 s and 43.6 s; it is now 5 taps and 9.9 s,
with every digit landing once. The POS suite is **316/316** and `flutter analyze` is clean.

**What this pass did not do.** The blind count and the cash-received screens were verified at 1280 ×
**Workstream H, steps 1 and 2, and a route that was hiding in the client.** The audit said the
**Workstream C's proof had gone red, and the plan was still calling it Done.** The offline half of
the acceptance line — `role-surface-contract.spec.ts`, the one that "fails on guard drift" — had
**three failures**, and §14 was claiming the workstream complete. They were real, and each was found
by reading the failure rather than the claim. Two were drift in the other direction from the one you
would expect: `reward-config.read` and its reference-addressed twin were recorded in the surface
contract as refused for a cashier and a manager, on a gate of `merchant.manage`, while the
controllers had been deliberately changed to `loyalty.read` — the shared merchant model fetches that
value on _every_ dashboard screen for the loyalty hub, and umi-cash's till home draws a panel from
it, so the old gate refused a cashier a number her own screens display. The live gate is what
settled which side was stale: `GET …/cash/reward-config` answers **200 to a cashier and to a
manager**. The rows now carry `loyalty.read` and say why they are deliberately weaker than the
`settings` module around them. The third was a gate with nothing behind it: the `customers` and
`triage` modules are permission-gated and **no surface was bound to either**, so their permissions
were never measured — both are bound now to the routes their controllers already said they mirror.
`pnpm check:role-surfaces` is **88 assertions across 22 surfaces, 0 failed**, the offline spec is
**29/29**, and the API suite is **1493 passed, 0 failed** for the first time in this plan's
progress record.

**Workstream H, steps 1 and 2, and a route that was hiding in the client.** The audit said the
native client's retirement "is being executed" and that the till still sent its kitchen commands to
the iPad device route; the second half was stale, and the truth was worse in a different way. The
till has sent `posKitchenCommand` for a while, but **the board read it also uses existed only as a
string inside `kitchen_board_controller.dart`** — three routes in `KdsPosController` and two in the
contract, with the one a cook actually opens declared nowhere. It is now `pos.kitchenBoard` in the
route table under `kitchen.read`, generated into `UmiRoutes.posKitchenBoard`, and the client calls
it. The `Cocina` destination is no longer offered on the strength of the device holding a board
controller: it needs `kitchen.read` or `kitchen.prepare`, so a cashier on a till that runs the board
cannot walk into it, and `KdsService.boardForPos` now has tests pinning the refusal as a typed
`PERMISSION_DENIED` and the empty case as an empty board rather than a refusal. Verified on the
real client: the board renders and the read is `200` on the declared path, and `apps/umi-kds` is
confirmed gone from the workspace and the release manifest with §18 of the product doc corrected.

**What this pass did not do.** The blind count and the cash-received screens were verified at 1280 ×
720 and 1920 × 1080 on the reference workstation only — no 1024-wide counter tablet was tried, and
the cash center's fallback threshold (1000 px) is a judgement, not a measurement. The tip, discount
and terminal sections of the tender screen are policy-driven and still live in the left column,
which keeps a scroll view because of them; a policy that enables all three may still scroll that
side. And `pos-tables-merge-split` measures 7 taps against a budget of 9 that the plan itself marks
as needing owner confirmation against the reference hardware.

### Eleventh pass, 2026-09-16 — the payment method that could not be chosen

**§14's F row was checked rather than restated, and it holds.** `pnpm ux:verify` exits 0: 23 routes
with **0 unnamed and 0 undersized clickable controls**, 9/9 flow budgets inside their limits, 0
blocking accessibility findings, 12 screens visually pinned at both reference viewports, and a
median first contentful paint of 664 ms. One route still misses the 1000 ms FCP target on the Vite
dev server, which the gate itself names as a dev-server floor rather than a product number.

**Workstream G's step 2 was reachable in the API, the router, the engine and the contract, and
unreachable from the screen.** The audit row said the till "still offers only `Efectivo`", and the
cause was deeper than a missing configuration: **the tender screen drew its payment-method tiles
from a policy that the server only ever sent on the CHECKOUT response — the call that takes the
money** — and because the first press of `Cobrar` is a one-tap sale when the server reprices to the
same total, the tiles never appeared before the sale was already committed. `GET
/api/v1/pos/merchants/:merchantId/checkout/policy` (`pos.checkoutPolicy`, permission
`checkout.commit`) now answers that question first; the till reads it when the sheet opens, and the
card-terminal tile is on screen before anything is charged. Verified on the native client: the read
returns 200 and «Terminal manual» is offered beside «Efectivo».

**The policy itself had no writer anywhere in the platform.** `merchant.pos_checkout_policy` is
described in its own migration as _"server-issued … missing policy means default deny"_, and that is
literally true: `select` is granted to `api` and `worker`, nothing else, and no route, service,
migration or seed in the repository inserts or updates a row. So the café had none, every tender
except cash was refused as `INVALID_TENDER_AMOUNT`, and nothing about that is visible from the
Dashboard either. A row was provisioned by hand for the rehearsal location (`version
'rehearsal-1'`, `manual_terminal_enabled` only) so the path could be exercised at all — and the
absence of a writer is the finding, not the workaround.

**Three defects fixed while getting there, each found by driving the real client.**

1. **A failed checkout had no way out.** The failure surface published exactly one control,
   Retry — and a refusal the server marks `retryable: false` therefore trapped the operator on it
   for as long as they were willing to press the button. It trapped this sweep the same way: the
   only node the screen published was the retry. It now always offers **Cerrar**, and the cart
   survives the close so the sale can be fixed.
2. **An unproven connection was treated as an offline one.** `preview()` refused the charge locally
   whenever connectivity was not exactly `online`, so a till that had not yet seen the two
   successful calls that promote it from `unknown` could not take money — while the same code
   defaults to `online` when there is no connectivity controller at all. `unknown` and `recovering`
   now try; the states that mean something (proven-offline, degraded, replaying, review-required,
   blocked) still take the offline path.
3. **The policy was in the wrong place to survive a race.** Kept in `CheckoutState`, it was dropped
   by whichever concurrent load finished last — the sheet's open reads the policy and the
   recovered draft at the same moment, and the recovery read (50 ms behind) erased it, taking the
   terminal tile with it. It lives on the controller now, where the location's policy belongs, and
   survives a reset.

**The card path dead-ends, and the diagnosis is now complete.** Chasing the manual attempts to the
bottom produced a real money-path defect, in this order:

1. The cashier selects a card terminal and marks it **«Confirmar éxito»**, which the till records as
   a `manual_terminal` tender with `status: confirmed_success`. Nothing in `apps/umi-pos` calls
   `pos.tenderCapture`, so this is an operator ASSERTION that no provider has confirmed.
2. If the location forbids mixed tender — and `mixed_tender_enabled` is false by default — the
   confirm refuses the combination with `INVALID_TENDER_AMOUNT`. Correct refusal, **wrong moment**
   and wrong words: the server answers a prepare with "confirm the totals" whatever the tender
   allocation says, so the refusal only appears after the cashier commits, as `invalid_amount`,
   which the till had no message for and rendered as _"no fue posible completar el cobro de forma
   segura"_ with a Retry that re-sent the same refused payload.
3. The draft now carries a `confirmed_success` terminal tender, and the draft's own guards — which
   exist so a confirmed payment can never be dropped — refuse every later write that would remove
   or replace it. That refusal was **a bare 500** (`Checkout draft is immutable or belongs to
another context.`) for an ordinary operator action.
4. **And the operator cannot leave.** `Cerrar` calls the cancel route, which answers
   `PAYMENT_OUTCOME_UNKNOWN` because a confirmed terminal payment is unresolved, so the sheet does
   not close. The cart is unpayable and the screen is inescapable; the only exit is killing the app.

So the guards are right and the ORDER is wrong: the till lets a person assert a terminal payment
before anything can settle it, and there is no settlement or verification route for a manual
terminal to resolve it afterwards. **That is workstream G's step 4 remainder, and this is its live
reproduction.** Fixed in this pass: the 500 is now the typed `INVALID_TENDER_AMOUNT` refusal (both
call sites), the till enforces the single-method rule at the point of choice when the policy
forbids mixing (verified: choosing «Terminal manual» deselects «Efectivo»), the failure surface
always offers a way out, and `invalid_amount` and `totals_changed` have honest messages. Verified:
the 500 is gone from the log and the till now says _"Revisa la forma de pago: esta combinación no se
puede cobrar. Si la terminal ya confirmó un cobro, no se puede quitar de este pedido."_

**The rule is a database trigger, not only application code.** `pos_checkout_terminal_immutable`
refuses the write, so a poisoned draft cannot be cleaned up by hand either — a `delete` against the
two carts this pass left behind matched zero rows. **The reason is worth stating precisely, because
my first reading of it was wrong**: the trigger's immutability branch only guards a COMMITTED draft
(`old.state in ('completed','receipt_available')`), and these were `collecting_payment`, so it was
not that branch. The function ends `return new;`, which is correct for the `before update` it was
written for and silently cancels a `before delete` (NEW is NULL there) — so **no checkout draft can
ever be deleted at all**, by the product or by hand, and a row that matches every predicate still
deletes zero. A rule that swallows the write it is meant to refuse is worth fixing on its own terms;
it is not what blocks the cart. What blocks the cart is the claim itself: nothing here should be
loosened, the missing piece is the resolution route. **The operator's real escape is `Nueva venta`**, which abandons the
cart and gives the till a fresh one — verified, and it is how the poisoned state was cleared and the
sweep went green again (5/5, money path 3 taps / 6234 ms). Two abandoned carts stay blocked in the
rehearsal database because no route can resolve them; that is the debris this pass leaves, and the
reason (a) above is first on the list.

**The resolution route now exists — and it is not the whole gap.** `pos.tenderSettle`
(`POST /tenders/:commandIdentity/settlement`, permission `checkout.terminal.confirm`) turns an
operator's word into a FINAL state: `paid` becomes `succeeded` with `proofSource:
'operator_attested'`, `not_paid` becomes `declined`, and never a `provider` proof — a human voice
cannot manufacture a payment id, and the database says the same in
`payment_attempt_provider_proof_has_id_ck`. It is idempotent in the direction that matters: a second
settlement answers with what the first one decided instead of rewriting whether money moved. Four
cases in `tender.integration.ts` prove it (**22/22**, up from 18): the attempt moves and names its
proof while the provider's own verbatim status is left where the provider put it; the other
direction; no rewrite; and the gate, which refuses an operator without
`checkout.terminal.confirm` and leaves the attempt untouched.

**But there is no attempt to settle.** The till's terminal path never calls `pos.tenderCapture`:
every `pos_payment_attempt` this café owns is `method='cash'`, `proof_source='cash'`, with no
command identity. A manual terminal exists only as a tender DRAFT inside the checkout draft — which
is why the blocked cart could not be resolved by settling anything: there was nothing to settle.
So the order for the next pass is: **(i)** the till captures a terminal tender through
`pos.tenderCapture`, which creates the attempt with its command identity and answers with one of the
three outcomes; **(ii)** the operator's «Confirmar éxito» becomes the SETTLEMENT of that attempt
instead of a status on a draft; **(iii)** the checkout commits with the captured attempt linked,
which the commit already knows how to require. Until (i) lands, this route is proven but
unreachable from the till — which is the same sentence §14's G row has carried since the tender path
landed, now with the half that was missing on the server side.

**One harness fault fixed on the way.** `tender.integration.ts` seeds its operator session with
`ON CONFLICT (id) DO NOTHING` against a REUSED database, so adding a permission to its `PERMISSIONS`
list silently did nothing and the gate kept refusing — the test could not have proven anything about
permissions. It is an upsert now. The same trap is worth checking in any harness that seeds a row it
does not own from run to run.

**And the till captures now.** The wiring landed: before a checkout can record a terminal tender, the
till asks the provider for the money (`pos.tenderCapture`, with the tender's own cart-derived identity
as the command identity so a retry finds the attempt instead of asking twice), and then settles the
attempt with what the operator read off the screen. **First live terminal payment in this platform's
history**, read back from the database rather than from a return value:

```
method=external_terminal  provider=manual_terminal  status=succeeded  proof_source=operator_attested
command_identity=fd31cbbc-d12d-4a37-b1b8-a81cd530b322
```

The three calls appear in the API log in order — `tenders/capture`, then `tenders/<id>/settlement`,
then `checkout` — and the checkout then asked for a manager, because the policy this pass provisioned
had `manual_terminal_approval_threshold = 0`, and `>` that threshold means _every_ card payment needs
one. The till said so in words rather than a shrug — _"Un gerente debe aprobar este cobro."_ with a
**Solicitar aprobación** action — which is the approval path working, not failing. The threshold is
MX$5,000 now, a plausible café policy.

**The last link in the dead end: `Cerrar` could not close.** When the draft holds a terminal claim the
checkout refuses to cancel — correctly, that claim is a record of money possibly taken — and the sheet
then did _nothing at all_: it stayed open, `Cerrar` looked broken, and because there is no **Nueva
venta** on that screen the only way out of a refused card sale was to kill the app. `Cerrar` now falls
back to starting a new sale: the CART is abandoned, the claim is left exactly where it is for whoever
reconciles it, and the till is usable again. Verified on the native client — `Cerrar` returns to the
catalog in 2.2 s from the state that used to trap it.

**What is still true and still open.** A cart whose draft carries a terminal confirmation **from
before this wiring** stays stuck: that claim lives on the draft and not on an attempt, so
`pos.tenderSettle` has nothing to settle. The operator now reads exactly that — _"Si la terminal ya
confirmó un cobro, no se puede quitar de este pedido."_ — and can escape, but cannot resolve it. The
draft-level resolution (or migrating the draft's claim onto an attempt) is the remaining piece and the
last step of §8G step 4. A completed card sale was not driven to `Pagado` on that particular cart; the
capture, the settlement, the approval requirement and the escape were each observed on the real client,
and the unit tests cover the ordering.

**What remains, in the order it should be done.** (a) A way to RESOLVE a manual-terminal assertion —
the verification route a person needs when the terminal may or may not have taken the money, which
is what would let the cart above be closed honestly; (b) the prepare must report the allocation's
refusal instead of "confirm the totals", so the cashier hears it while composing the tender;
(c) `pos.tenderProviders`, the registry that says which methods will actually work, is still never
read by the till. Two smaller findings from the same screen: the split-tender «Cambio» line compares
the cash leg against the whole bill rather than the cash allocation, and a draft's stale error
survives into the next checkout, so a recovered draft opens with a red line about a refusal that is
no longer being made. `pnpm ux:pos:native` still passes 5/5 with the money path at 3 taps
throughout — the cash path is unaffected, which is what kept this from being caught earlier.

### Twelfth pass, 2026-09-17 — the keypad belongs to cash, and the terminal says whose word it is

**The tender surface now has two faces, and which one you get is the tender.** The owner is about to
link a Mercado Pago Point terminal, so the question "what should the money half of the checkout do
when the sale is a card?" stopped being hypothetical. The answer the surface now embodies: the
on-screen keypad exists to answer exactly one question — how much money did the customer put on the
counter — and a card sale has no answer to it. So the keypad leaves with the cash it belongs to, and
the same space states the card instruction instead: the amount to charge, the operator's own status
sentence, and the line the design law already required, _"La terminal es una declaración del
operador: el POS no lee su resultado."_ The swap is a 220 ms fade plus a 4 % slide (the design law's
surface transition, `UmiMotion.standard`), it becomes instant under the reduced-motion preference,
it animates opacity and transform only, and the charge button does not move because the `Spacer`
absorbs the difference between the two faces. Mixed tender keeps the CASH face: the split still
needs the keypad to say what went in the drawer.

**Evidence, and it is a real click on the real client.** `pnpm ux:pos:native --only
tender-keypad-follows-cash` (a new flow, `tools/ux-sweep/pos-native-flows.mjs`) builds a cart, opens
the tender, and counts the published digit keys instead of looking for the keypad by name, because
`"1"`..`"9"` are both the keys and the substrings of every amount on the bill: **10 on cash, 0 after
tapping «Terminal manual», 10 again after tapping «Efectivo»**, with «Cobro en terminal» and the
declaration on screen in between. 14 taps, 72.8 s, `passed: true`. The widget test
(`checkout_test.dart`, "the keypad belongs to cash…") holds the same contract at the unit level and
pins the duration to `UmiMotion.standard`; `flutter analyze` is clean and `checkout_test.dart` is
14/14. The channel test drives it with `mixedTenderEnabled: false`, because with mixed tender allowed
the terminal tile correctly keeps the cash leg — and therefore the keypad — which is not the swap
under test. **Naming the animation to the owner:** nothing here is decorative; it is the shortest
Material transition that shows which tender owns the space, which is what the design law's new
`Pagos` line now says.

**A reused cart re-poisons the next checkout, and this pass saw it happen.** The flow's first
attempts failed with the card ALREADY selected and the keypad still up, so the flow's first tap
_deselected_ the terminal and the surface never swapped — a harness failure that was really the
rehearsal database doing something the plan already knew about. A checkout draft is keyed by cart,
carts outlive sessions, and `pos_checkout_draft` for this café still held a `manual_terminal` claim
from the eleventh pass's live experiment (`45e77ed1`, `payment_accepted`, `confirmed_success`). A new
checkout on that cart recovers it: the till silently opens with the card selected and a split
|27.50/27.50 sized by `_balanceTenderFields`, on a location whose policy forbids mixed tender. This
is the "draft's stale error survives into the next checkout" finding from the last pass, one step
worse than a red line, and it is item (a) in the "what remains" list above, with a second symptom.
Not fixed here — the flow now names the condition instead of misreporting it.

**Two harness lessons, both about what a click can prove.** (i) **A press can be swallowed with no
trace and the driver will refuse its own safe retry.** The first press after the sheet's route
animation has been seen to do nothing at all, and `clickNode` then compares fingerprints taken
either side of a `focus()` call — activating the window moves the accessibility focus, which the
driver reads as "the press had an effect", so it refuses to retry a press that provably did not act.
The money-path flow already carried this lesson for «Nuevo pedido»; the new flow presses again and
licenses the repeat by the tender's own state (`«Importe aplicado»`, the terminal block's field, is
still absent) rather than by a guess. The driver's fingerprint is the better place to fix this, and
it is not fixed there. (ii) **A flow with no budget is not a flow that failed.** This flow asserts a
surface, not a cost; its milliseconds are dominated by the shared prelude (a cash shift, a cleared
cart, five taps to build one), so any ceiling would measure the prelude. `pos-native-flows.mjs` now
reports a budget-less flow as measured and skips the comparison it cannot make, and
`config/ux-budgets.json` says so in the flow's own `budgetSource` rather than inventing a number.

**Still open from this screen.** `pos.tenderCapture` is called for a manual terminal, but a
provider-backed Point transport is not written, so the terminal face still asks a person to read the
screen — which is what the declaration says. The card face therefore shows an operator's sentence
and not a device's. When Mercado Pago lands, the status row is where a real device state belongs and
the declaration becomes a fallback rather than the whole story.

**And the full native suite did NOT pass in this pass — say so rather than quoting the old 5/5.** Run
in full after the change: `pos-sign-in`, `pos-tables-open`, `pos-tables-merge-split`,
`money-path-pos-charge` and `pos-restart-recovery` all failed, while the new tender flow passed on its
own run minutes later. The failures are not one story. `pos-sign-in` and the money path failed on a
screen carrying `No fue posible completar la acción de venta de forma…` next to a cart panel that
already held four lines; `pos-tables-open` failed waiting for a table group while the map republished
itself (`Plano actualizado`); every flow ran 5-10x slower than the numbers quoted above (13 s to
acknowledge a single click), and the API was restarted by another session mid-run (the cash center
answered an error screen with a `Reintentar`, which loaded fine on retry). A shared rehearsal database
plus a stateful native client plus a second operator in the terminal is not a clean measurement
environment, and this pass measured in it anyway. **What is proven:** the tender surface, by real
clicks, in its own run. **What is not:** that today's checkout is green end to end on this database.
Re-run the suite when the rehearsal data is clean before quoting a pass rate from this date.

**The owner's next complaint was on the product screen, and it was a real disproportion.** On the
screen a cashier gets after tapping a product, the option tiles in one row did not line up: measured
from the running app's accessibility tree, an option without a surcharge was 176 x 38 and the option
beside it, which carries a price, was 176 x 54. Same width, 16 px of difference, and the 16 px was
exactly the second line. The cause was a `Wrap` giving every tile its own natural height. The fix is
`_optionRows`: the tiles keep one width (200, now a `static const` on `_OptionCard` so the packer and
the tile cannot disagree), they are packed into rows that fit, and each row is an `IntrinsicHeight`
with `CrossAxisAlignment.stretch`, so the tallest tile in the row sets the row and the rest grow to
it. Both call sites — variants and option groups — go through it.

**A pinned height was tried first and it was wrong, which is worth keeping.** `height: 54` on every
tile made the rows level and then painted `BOTTOM OVERFLOWED BY 4.0 PIXELS` across the selected tile
on the real client: a SELECTED tile draws a 2 px border where an unselected one draws 1 px, so the
number that fits one state does not fit the other, and a debug build shows it in stripes. Stretching
per row absorbs that difference structurally instead of guessing it. That is also why the regression
test asserts the sizes rather than the pixels: `catalog_test.dart` now gives the fixture one modifier
with a `priceDelta` and one without, and requires the two tiles to be the same size, then selects the
surcharged one and requires both to grow together - which is the assertion that would have caught the
pinned height.

**Then verified on screen, on the real client.** The API was unready for a stretch of this pass
(the shared database was mid-migration and `EXPECTED_SCHEMA_VERSION` did not match it), which is why
the first attempts only had tests behind them. With the API healthy again, the finished version was
driven by real clicks: tapping `Americano` gives **every option tile the same box**, measured from
the app's own tree — `CH` 200 x 57, `GDE | +MXN 10.00` 200 x 57, then `Caliente`/`Frappe`/`Rocas`
at 200 x 55 and `1oz leche`/`Normal` at 200 x 55 — each row level, and **with `CH` selected there is
no overflow stripe**, which is the thing the pinned height painted. `flutter analyze` clean; 41
tests green across `catalog`, `cart`, `navigation`, `checkout` and `sale_lifecycle`.

**A note on the shared environment, because it cost real time this pass.** `apps/umi-api/.env`
carried `EXPECTED_SCHEMA_VERSION=build-v3-71` while the rehearsal database reported
`build-v3-72`, so `/health` answered `503 Unready` and EVERY client — the POS, the dashboard —
refused to start, with a screen that says only "UmiPOS no puede iniciar de forma segura con esta
configuración". The version in that file is deployment state and has to move with the migration that
is actually applied; when a chain is mid-flight the value can be ahead of or behind the database for
minutes at a time. Restoring it to the version the database actually reported (`build-v3-71`) put
the API back to `Healthy` immediately.

**D's step 7, both halves, ran the same day with the API healthy.** The console half was measured
rather than assumed: `npx playwright test --config tools/ux-sweep/playwright.config.mjs
floor-plan-map.spec.mjs` → **2 passed**, one per reference viewport, each driving a **200-table map**
through a saved fixture, a hit-test, a slow drag, a drag back, and a rotate, and each recording a CDP
trace over the drag. The trace numbers are reported, not gated, and they are worth writing down
because they are trace-on numbers on a shared desktop: tablet-1024x768 measured 32.8 fps with a p95
frame cost of 98.45 ms and terminal-1280x720 measured 39.8 fps at 55.19 ms, against a 16.7 ms budget
with the spec's own caveat that the trace itself costs frames. The till half is `pos-tables-merge-split`
driven by real clicks: **ok — 7 taps, 9.7 s** (budget 9 taps / 45 s), merging two tables into one
party and splitting them again. So §14's D row, which said "step 7's 200-table map suite, whose
console half is in flight", is one migration out of date: both halves exist and both ran. What D
still lacks is unchanged and is an owner decision — no table in the seeded plan seats eight.

**The suite with a healthy API: four of six, and the two failures are not the same story.** Run
whole: `pos-sign-in` ok (5 taps, 8.7 s), `pos-tables-open` ok (4 taps, 8.1 s),
`pos-tables-merge-split` ok (7 taps, 9.7 s), `tender-keypad-follows-cash` ok (14 taps), and then
`money-path-pos-charge` FAILED (12 taps, 95.7 s) and `pos-restart-recovery` FAILED (2 taps, 310 s).
`pos-restart-recovery` is explained and is not the product's: it kills the till and relaunches it,
and the relaunch could not compile because **another session was mid-edit in
`lib/features/checkout/checkout_surface.dart`** — the log carries `Required named parameter 'scope'
must be provided` at `captureCardTender` and `Too few positional arguments` at `tenderAttempt`, both
theirs, both gone a minute later. `money-path-pos-charge` is the one that needs an answer, and its
screenshot has it: the tender screen opened with **both `Efectivo` and `Terminal manual` selected**
— a mixed tender this location's policy forbids — with `27.50` on the cash leg and `55.00` received,
and the `Cobrar · MXN 55.00` button, enabled and blue, **did nothing at all**: three presses, no
phase change, no error line, nothing in the semantics tree. That is the stale-draft poisoning from
this pass's earlier paragraph arriving in the money path, plus a second symptom worth its own
investigation: a charge press that neither charges nor refuses. The cash-leg half of the same
screenshot is this pass's fix working (`Cambio MXN 27.50` for a 27.50 leg against 55.00 received,
where the old code would have said `MXN 0.00`).

**Two things this pass found that are worth more than the pass itself, both observed live.**

**1. `Nueva venta` does NOT escape a poisoned cart, and the eleventh pass says it does.** That pass
recorded the escape as _"The operator's real escape is `Nueva venta`, which abandons the cart and
gives the till a fresh one."_ It does not. Driven by hand today: `Nueva venta`, then a new Americano
built with real clicks, then `Cobrar` — and the tender screen opened with **`Efectivo` AND
`Terminal manual` both selected**, on a location whose policy forbids mixed tender. The database
says why: after the abandon, `merchant.pos_cart` still holds the **same** id,
`ca7bea8a-0da2-4c8a-b1c1-328135e666f2`, still `status='draft'`, and its `pos_checkout_draft` still
carries the old `manual_terminal` claim (`fd31cbbc-d12d-4a37-b1b8-a81cd530b322`,
`status='confirmed_success'`). A draft is keyed by cart, so every checkout of that cart recovers the
claim and the till starts in a tender its own policy refuses. The cart is not replaced; only its
lines are. **So the debris this plan has been describing for three passes is not debris — it is a
live, self-renewing state**, and the escape has to be a real one: either `Nueva venta` mints a new
cart, or the till refuses to adopt a recovered tender the policy disallows, or both.

**2. A charge press that cannot be answered leaves the till spinning forever, with no exit.** With
the same mixed tender on screen, pressing `Cobrar · MXN 110.00` against an API that had gone
`503 Unready` (the shared database was mid-migration again) produced `Procesando pago` and then
**nothing else, permanently**: checked at +3 s, +15 s, +30 s and again after the API was restored to
`Healthy`, the semantics tree held exactly one node — the spinner. No error line, no `Cerrar`, no
retry, no way to abandon the sale except killing the app. The design law in
`docs/design/UMIPOS_DESIGN_LANGUAGE_V1.md` is explicit that a critical error is never a dead end, and
the eleventh pass fixed exactly this class of trap for the _cancel_ route; the charge route still has
it. The likely shape is in `checkout_controller.dart`: the phase is set to `repricing`/`processing`
before the request, and only an `AppException` is caught into a failure phase — anything else thrown
by the request escapes the button's callback, so no state is ever written and the spinner stays.
Not fixed here: another session was editing `checkout_surface.dart` and `checkout_controller.dart`
for the Mercado Pago Point work at that moment (its half-written state failed to compile twice, once
during `pos-restart-recovery`, which is what that flow's 310 s failure is). The finding is recorded
rather than raced.

**Both of those findings were then worked, and only one of them is closed.**

**Closed: the spinner that never ends.** `checkout_controller.dart` now catches what it has no type
for. Every money-path method caught `AppException` — the error the API client builds from a refusal
it understands — so anything else (a raw transport error, a body that does not parse, a bug in the
file) escaped the method with no state written, and the phase stayed at `repricing`/`processing`,
which the sheet paints as a spinner. `_unexpected` now lands those in the failure phase with the code
`UNEXPECTED_CHECKOUT_FAILURE`, which is the surface that names what happened and ALWAYS offers an
exit; it is wired into the online half of `preview`, into `_submit` (so `confirm` is covered), and
into `cancel`, because a close that cannot be completed must say so too rather than swallow the
press. Proven red-green: with both catch-alls removed, the new test _"a failure the protocol does not
describe reaches the failure surface"_ fails; with them it passes, and `checkout_test.dart` is
**16/16** with `flutter analyze` clean. The trigger is in the test's fake — a `StateError` out of
`checkout()` — which is the shape the live 503 produced.

**Open, and it is the one that needs a decision: a recovered tender the policy forbids.** Nothing
above touches the first finding. The till still opens a checkout on a poisoned cart with `Efectivo`
and `Terminal manual` both selected, and the charge it offers cannot succeed. Before the fix above,
that state's press also hung (the refusal arrives as an unexpected error while the API is unready);
now it lands on the failure surface, which is at least honest, but the operator still cannot pay the
sale or leave the cart cleanly. The two candidate answers were named earlier in this pass — the till
refuses to adopt a recovered tender its policy disallows, and/or `Nueva venta` mints a new cart — and
neither is safe to guess: refusing to adopt a `confirmed_success` claim is refusing to carry a record
of money that may have been taken, and abandoning a cart can strand that record. This is item (a) of
§14's "what remains" list, and it is now the oldest open item on the payments row.

**The verification engine, re-run the same day, is green.** `pnpm ux:verify` exits **0**. Click
inventory across the 21 dashboard routes: **0 unnamed and 0 undersized controls on every one**.
Flow budgets: **9 of 9 ok**, the slowest at 908 ms against a 3000 ms budget. Accessibility: **no
serious or critical violations on any route** (five routes carry one minor or moderate finding each).
First paint: `/login` 1908 ms, `/hours` 1656 ms, `/triage` 1016 ms and every other route between 476
and 836 ms — the three over a second are the Vite dev server's floor, which the gate names and does
not fail on. Visual: **12 of 12 baselines pass** at both reference viewports, and the map suite
inside the same run drives **200 tables** through a drag and a rotate twice. `pnpm check:role-surfaces`
also passes: **88 assertions across 22 surfaces, 0 failed** (23 must-refuse, 65 must-allow).
**`pnpm check:pr` does NOT pass today, and not because of this work**: its `format:check` step stops
on 19 files that belong to the Mercado Pago Point session's in-flight work (its two research
directories, `packages/contract/src/pos-checkout.ts`, `pos-checkout.service.ts`, the Point specs,
`config.schema.ts`, `pos-semantics-inventory.mjs`, `config/umipos-surface-permissions.json`) plus one
line of this document, which is fixed here. Re-run it when that session's tree is clean.

**D36 is fixed, and it was the escape the payments row was leaning on.** The defect table has
carried it since the ninth pass: _"`Nueva venta` does nothing with 180.00 in the cart: no
confirmation, no reset, no new sale."_ The cause was one guard in
`sale_lifecycle_controller.dart::newSale` — it returned unless the sale was already finished
(`_isTerminalOrMissing`), so with a cart on screen the press did NOTHING AT ALL, silently. That
silence is worse than it reads, because the eleventh pass named this button as the operator's escape
from a checkout whose draft holds a payment claim: that cart can be neither paid nor cancelled, so a
button that quietly does nothing leaves killing the app as the only exit. The button now asks first
— naming how many lines are unbilled and that nothing is charged for them — and only then abandons
the sale and starts a fresh one (`newSale(abandonCurrent: true)`, which cancels the old sale and
leaves its draft, claim and all, for whoever reconciles it). The confirmation belongs to the surface,
the abandonment to the controller, and a cancel that does not take refuses to start a second sale
beside the one that would not go. Evidence: `sale_lifecycle_test.dart` gains _"a new sale abandons a
cart in progress only when it is asked to"_ — proven red-green by making the controller ignore
`abandonCurrent`, which fails exactly that case — and the file is **16/16** with `flutter analyze`
clean; the five POS suites touched this turn (sale lifecycle, catalog, checkout, navigation, cart)
run **44/44**.

**The owner's standing rules for testing are now in the harness, and one of them found a crash.**
Two instructions: a window under test never shares a workspace, and it runs fullscreen. The first is
now `tools/ux-sweep/window-workspace.sh`, called by `pos-native-launch.sh` for the till and usable
for the dashboard's Chromium — it picks the first workspace with no visible window on it, creates a
new one if every workspace is taken, moves the window there and activates it. The second could not be
followed as asked, and the reason is a defect rather than a preference: **asking the till to be
fullscreen kills it.** EWMH fullscreen resizes the window to the full 1920x1080 display, the
compositor hands Flutter a 1920x1004 surface instead, and the GTK embedder gives up waiting —

```
** (co.umiconsulting.umi_pos:1871014): WARNING **: 03:21:40.087: Timed out waiting for OpenGL frame of size 1920x1080 (have 1920x1004)
Lost connection to device.
```

— and the app exits while `flutter run` reports a lost device. Maximised (1920x1051, the display
minus the top bar) survives, so that is what the helper asks for and what "fullscreen" means here
until the resize path is fixed. This is worth keeping because it is exactly the kind of thing the
owner's rule is for: a POS that dies when a window manager gives it the whole screen is not ready for
a counter terminal, and the crash is cheap to reproduce.

**And a note on the environment this pass ran in, for whoever reads the timings.** The owner was
implementing the Mercado Pago Point terminal in a second session at the same time as this work, so
`checkout_surface.dart` and `checkout_controller.dart` were being edited under this pass (that
session's half-written state failed to compile twice), the shared database moved between
`build-v3-71` and `build-v3-72` while the API was being restarted around it, and the single POS
window was contended between the two sessions — it exited under this pass's driving more than once,
twice with the OpenGL warning above and once with a plain `Application finished` while that session's
own launch was taking the window. None of that is a product finding; all of it is why some of this
pass's evidence is a widget test rather than a screenshot.

**The owner read the payment screen and called it confusing, and the two halves of that are now
separated in the UI.** Two instructions came with it: every click and every decision has to be said
out loud by the screen, with no contradictory sentences, and an impossible combination must not be
offered — cash and card together only when the check is being SPLIT, and a split has to name its legs
in the order they are charged. What the owner was looking at was two different situations wearing one
face:

1. **A recovered draft holding a split this location does NOT allow.** The tap handlers already
   enforced "one method per sale" (`_setCash`, `_setTerminal`, `_setCard` each turn the others off
   when the policy forbids mixing), so the contradiction could not come from a tap — it came from
   `_restoreDraft`, which adopted whatever the draft held, policy or no policy. That is why the sheet
   opened with `Efectivo` and `Terminal manual` both selected, both legs showing a number, a stale
   error underneath and a charge button that could not succeed. It now refuses to adopt that
   combination: the tender stays single, `recoveredTenderConflict` names the situation once
   (_"Este carrito no se puede cobrar así"_, with the record kept for review and the way out named),
   the charge button goes inert rather than offering a sale that cannot be taken, and the draft's own
   stale error is suppressed so the screen says one thing instead of two. The claim is NOT erased —
   it stays in the draft for whoever reconciles it, which is the same rule the rest of this path
   follows.
2. **A genuine split, which must say what it is.** When the location does allow two methods and the
   operator turns the second one on, the sheet now says `Cobro dividido` above the tiles and lists the
   legs with their amounts in the order they happen — card first, then the cash the customer hands
   over, which is the order the change is figured from. Before this, two selected tiles said nothing
   at all about why two were selected, which is the same picture as the refusal above.

Evidence: `checkout_test.dart` gains _"a recovered split the policy forbids is named, not adopted"_
(the notice is on screen, the terminal's own field is NOT, and the charge button's `onPressed` is
null) and _"a split says what it is and in which order the legs are charged"_ (no banner with one
method, then `1. Manual terminal: MXN 58.00   2. Cash: MXN 58.00`). The first is proven red-green by
disabling the guard in `_restoreDraft`, which fails exactly that case. `checkout_test.dart` is
**18/18**; the three suites touched this pass are **40/40** with `flutter analyze` clean. **Not yet
verified on screen**: the till window is the other session's while it works the terminal path, and
this pass killed that instance once by accident, so the visual check is owed — the two states to
shoot are the conflict banner and the split banner, and both are worth a disproportion review at the
same time.

**And the launcher no longer kills anything it did not start.** `pos-native-launch.sh` opened with
`pkill -f bundle/umi_pos`, which is correct when the instance is yours and destructive when it is
another session's: this pass killed a till that was being driven against a different API port mid-test.
It now REFUSES when a till is already running and says what to do instead (`--no-restart` to attach,
`--force` to replace), `pos-native-flows.mjs` forwards `--force` only when the operator asks for it,
and its mid-flow restart — whose whole subject is a restart — passes `force: true` on purpose.

**One more thing asked for and not yet proven: fullscreen that survives.** The owner's rule is that
the till runs fullscreen. Requesting it on a mapped window kills the client (the OpenGL frame-size
mismatch above), so the runner now honours `UMIPOS_FULLSCREEN=1` by going fullscreen BEFORE the
window is mapped, and the launcher exports it. That path has NOT been verified end to end yet: the
launch that would have proven it was the one that raced the other session's instance. It is the next
thing to check when the window is free, and if it fails the fallback is the maximised window the
helper already asks for.

**A full verification sweep, same day, because most of this document's numbers were older than the
schema it now runs on.** Every suite run here ran against the tree as it stands, with the Mercado Pago
Point work in it and the database at `build-v3-72`:

| Suite             | Command                                    | Result                                                                                                                                                           |
| ----------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API unit          | `pnpm --filter @umi/api test`              | **1539 passed, 22 skipped, 0 failed** (167 files)                                                                                                                |
| Contract          | `pnpm --filter @umi/contract test`         | **70 passed, 0 failed**                                                                                                                                          |
| POS (Dart)        | `cd apps/umi-pos && flutter test`          | **336 passed, 0 failed**                                                                                                                                         |
| Dashboard         | `pnpm --filter @umi/dashboard test`        | **134 passed, 0 failed** (16 files)                                                                                                                              |
| Dashboard gates   | `pnpm ux:verify`                           | **exit 0** — 21 routes, 0 unnamed, 0 undersized; 9/9 flow budgets; no serious or critical a11y violations; 12/12 visual baselines; the 200-table map suite twice |
| Role surfaces     | `pnpm check:role-surfaces`                 | **88 assertions across 22 surfaces, 0 failed**                                                                                                                   |
| Native till flows | `node tools/ux-sweep/pos-native-flows.mjs` | **4 of 6** — see the paragraphs above for the two failures and why neither is a regression                                                                       |

Two things this table changes. §14's G row records `pnpm --filter @umi/api test` as **1487 passed, 3
failed** (the `role-surface-contract` customers and triage rows); the three are gone and the suite is
green, so that row's "3 failed" is history rather than state. And the contract suite is **70**, not
the 70-with-drift the tenth pass was chasing: `generate:check` is clean at 2.21.0 in the same tree.
`pnpm check:pr` is the one gate that does not pass, and it stops at `format:check` on the other
session's 19 in-flight files, with every earlier step in that chain — `generate:check`,
`umi-pos:check-pilot-rbac`, `lint`, `check:lint-warnings` — passing on the way.

### Workstream L's missing command exists, and finding it cost two real defects

§14 says L's only gaps are the CodeGraph sync and "the one-command local reset". The reset now exists:
`scripts/local-reset.sh`, wired as **`pnpm db:reset`**. It reads the database from `DATABASE_URL_APP`
in `apps/umi-api/.env`, drops and rebuilds it, applies `docs/migration/build-v3/00_run.sh`, seeds the
demo merchant and catalogue, seeds the local operator roles and PINs, and regenerates the contract —
one command, the sequence nobody had written down. It is a **dry run by default** (it prints the
container, the database, the chain, the seed and what it would destroy, and exits), `--yes` does the
work, `--database NAME` rebuilds a scratch database instead, and it **refuses while an API is
listening on 4001 or 4014** because rebuilding a schema under a running server leaves a session that
half-works. `NEW_MACHINE_SETUP.md` had install, env files and gates and nothing about the database at
all; it has the section now.

**Verified by running it, not by reading it.** Against a scratch database (`--database
umi_local_reset_probe --yes`): the chain applied, `99_verify` reported **build-v3 verify: OK**, the
demo seed reported complete, the access seed reported complete, the contract regenerated at 2.21.0,
and the database answered `build-v3-72 (applied)`. The scratch database was dropped afterwards. The
shared rehearsal database was never the target of a `--yes` run.

**Two defects fell out of it, and both meant a fresh machine could not be seeded — which is why the
documented sequence had never been run from empty.**

1. **`35_pos_pilot_rbac.sql` could only ever run in one of its two positions.** It is generated from
   `config/umipos-pilot-role-grants.json`, and it inserted `(key, description)` only. At position 35
   that is correct — `umi.permission` has nothing else yet — but the local seeds RE-apply it after
   the chain, and by then `49_merchant_roles.sql` has made `product_key` and `group_key` NOT NULL, so
   the same file failed with `null value in column "product_key"`. `49_merchant_roles.sql` documents
   running into this and works around it for its own four permissions; the generated file itself did
   not. It now emits a guarded `do $$ … end $$;` that branches on whether the column exists, so one
   file serves both positions, and the derivation of product/group/status/risk is the same CASE
   expression 49 uses, in the branch that needs it.
2. **The demo seed pinned a grant count that had moved.** Its final assertions fail on purpose by
   dividing by zero, and one read
   `select 1 / case when count(*)=575 then 1 else 0 end` over the seven local roles' grants. The
   matrix has grown to **577** (the `location.switch` grants), so a clean database failed at the
   last line of the seed with a bare `division by zero`. The number is now 577 with a comment saying
   what moves it, and the general lesson is written where the number is.

**And an ordering fact the reset had to encode.** `pnpm umi-pos:seed-pilot-roles` runs the access
seed and then the demo seed. On an empty database that order cannot work: the access seed writes
roles, PINs and a subscription for the merchant, and the merchant is created by the demo seed. The
reset runs demo first, access second, and says why in a comment — the same class of trap as the two
above, and the reason a "known sequence" that is never executed from scratch rots quietly.

### The integration suites, run against a database built from nothing

The reset made a different kind of verification possible, and it is a stronger one than the suites
have had: every previous run of them, in this document's own history, was against the shared rehearsal
database — which has months of ad-hoc state in it. A database built from `00_run.sh` alone has none.
So a pristine database was built (`--database umi_verify_fresh --no-seed --yes`), the suites were
pointed at it through `DATABASE_URL_APP`/`DATABASE_URL_WORKER`, and it was dropped afterwards. The
shared database was never the target.

| Group                                                                                                                                                                                                                 | Files | Tests | Result                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----- | -------------------------------------- |
| Schema and gates — `sql-preflight`, `check-values`, `schema-parity`, wallet, loyalty, cash (seals, gift card, logout, login, register flip), auth, merchants, table reservation, table state, floor plan, procurement | 18    | 148   | **18/18 files, 148/148 tests**         |
| Payments — `tender.integration.ts` (25) and `fiscal.integration.ts` (14)                                                                                                                                              | 2     | 39    | **39/39**                              |
| Migration and realtime — `pooler-isolation` (5), `identity-normalization` (8), `pairing-realtime-handshake` (5), `pairing-nudge` (2)                                                                                  | 4     | 20    | **4/4 files**                          |
| Needs the pilot fixture — `rls.integration.ts` (6 of 10), `smoke.integration.ts` (2 skipped)                                                                                                                          | 2     | —     | **not runnable on a chain-only build** |

**One real find, and it was in the gate rather than in the code.** `sql-preflight` failed on the
fresh database with _"NEW uncovered file: modules/fiscal/fiscal.repository.ts (1)"_ — the instrument
that PREPAREs every backend statement against the real schema and reports what it could not measure
keeps an explicit list of accepted exceptions, and one statement in the fiscal repository was not on
it. It is `updateJoined`, whose SET and WHERE arrive as one composed fragment (`${setAndWhere}`) from
`markStamped` / `markError` / `cancelLocal`: the same class as the four entries already accepted
there, and about to be the same class as the Mercado Pago work. It is now named with that reason,
which is what the instrument's own rule asks for ("either make the gate able to rebuild it, or name
it with a reason"). Worth noting _why it surfaced today_: the statement arrived with the fiscal
module, the exception list was never updated, and the failure only appears on a database where the
gate's full sweep runs — which is to say, the same blind spot as the two seed defects above.

**Two suites cannot run on a chain-only build, and that is a fixture requirement rather than a
failure.** `rls.integration.ts` looks for the pilot merchant ("Kalala Café") and
`smoke.integration.ts` skips its reads, because both are written for the **backfill** database
(`umi_backfill_v3`, cloned from `umi_prod_snapshot`). Neither the template nor the clone exists on
this workstation — `docs/migration/build-v3/backfill/00_run_backfill.sh` defaults to a template that
is not in the container — so the backfill half of the migration story cannot be re-verified locally
right now. They were NOT pointed at the shared rehearsal database to make them pass: a live till is
driving that database from the other session, and a suite that reads fixtures is still a suite
running against someone else's test. What the plan has for those two rows is therefore still the
2026-09-16 run, not a fresh one — recorded here so the next reader does not mistake the table above
for a full sweep.

**And the reason is specific, so it can be acted on.** The prod dump is still on this workstation
(`/home/jc/umi-local-dumps/umi-production-20260901T052800Z.dump`, 13.6 MB, the one the 2026-08-31
rehearsal names), and `db/preview/` carries a schema-and-roles copy of the legacy prod shape. What is
missing is the **Postgres that can host it**: the snapshot's DDL runs nine `CREATE EXTENSION`
statements, and the local container (`pgvector/pgvector:0.8.5-pg17-bookworm`) offers
`pg_stat_statements`, `pg_trgm`, `pgcrypto`, `unaccent`, `uuid-ossp` and `vector` but **not
`pg_cron`, `pg_net` or `supabase_vault`**. The rehearsal used a dedicated
`umi-transition-postgres17` container on `127.0.0.1:5234`; that container no longer exists. So a local
backfill rehearsal needs either that container rebuilt from a Supabase-compatible image or the dump
restored somewhere that has those extensions — it is not a code problem, and `smoke` is the suite
that can run against the shared database safely (it writes nothing at all), which is why only `rls`
is still owed.

### The ten integration files no script named, and the one defect they were hiding

`vitest.integration.config.ts` has two documented scoped families plus `test:integration`; comparing
every `*.integration.ts`/`*.integration.spec.ts` against them leaves **ten files that no script
names**. They were run against `umi_int_probe`, the pristine build that `scripts/local-reset.sh
--database umi_int_probe --no-seed --yes` produces, with the two DSNs pointed at it and the shared
rehearsal database untouched.

| File                                                 | Tests | Result                                                |
| ---------------------------------------------------- | ----- | ----------------------------------------------------- |
| `auth/pos-device-proof.integration.ts`               | 6     | passed                                                |
| `auth/pos-pin-eligibility.integration.ts`            | 6     | passed                                                |
| `fiscal/fiscal.integration.ts`                       | 14    | passed                                                |
| `pos-cash/register-reclaim.integration.ts`           | 12    | passed                                                |
| `tender/tender.integration.ts`                       | 25    | passed                                                |
| `mercado-pago/point-credential.integration.ts`       | 12    | passed                                                |
| `mercado-pago/point-notification.integration.ts`     | 5     | passed                                                |
| `inventory-costing/inventory-costing.integration.ts` | 20    | **2 failed, then fixed — see below**                  |
| `kds/kds.repository.integration.spec.ts`             | 23    | not runnable here: `GATE4A_DATABASE_URL` is not set   |
| `tender/point-refund.integration.ts`                 | —     | **not run**: that file is mid-edit in another session |

**The costing suite was frozen to the day it was written, and it was the only real find.** Two of its
twenty assertions pinned `forecast.to` to `2026-09-16` and `cup.daysWithConsumption` to `1`; run on
the 17th they failed as `expected '2026-09-17' to be '2026-09-16'` and `expected 2 to be 1` — which
reads like a regression in the read and is really a fixture anchored to a literal date while the
read takes its window from the merchant's own `currentBusinessDate`. The fixture now reads the same
expression the repository reads and states every business date as an offset from it. **The fix is
proven day-independent, not merely green:** with the merchant's timezone set to `Pacific/Kiritimati`,
putting its business date at `2026-09-18`, all 20 pass. The trap is recorded in §6.7.

**Two files did not run, and neither is a code defect.** `kds.repository.integration.spec.ts` is
invisible to the integration config (whose include glob is `src/**/*.integration.ts`) and the default
unit config skips its 23 tests without `GATE4A_DATABASE_URL`, which
`scripts/umi-pos-kds-concurrency-check.sh` supplies along with its own database — so it is covered,
but by a script whose name says nothing about integration. And `tender/point-refund.integration.ts`
does not currently compile (`Cannot find name 'commandIdentity'` at line 604) because the session
that owns it is editing it right now; it was left alone deliberately, and it is the one row here
that still needs a run.

### The shared database was missing a setting every built database has

The pristine sweep above sent the same gate at the shared rehearsal database for comparison, and it
came back **RED in a way the fresh build was not**: `sql-preflight` reported `7 UNRESOLVED (measured,
broken)`, among them

```
modules/merchants/merchants.repository.ts:468 42883 function word_similarity(text, text) does not exist
```

`word_similarity` is `pg_trgm`, which `00_foundation.sql` installs **into the `extensions` schema** on
purpose. What makes it resolvable is the line directly below that install:

```sql
execute format('alter database %I set search_path = %s',
               current_database(), '"$user", public, extensions');
```

— set on the **database**, not on the roles, and the comment there explains why (a role-level setting
applies to the role you log in as and does not inherit, so it would miss `api_login`/`worker_login`
entirely). Every database built by the chain carries that setting: `pg_db_role_setting` lists it for
`umi_build_v3_mp`, `umi_proc2`…`umi_proc7`, `umi_mp_w3`, `umi_mp_refund_w3` and every probe built
today. **The shared rehearsal database was the only one that did not.** It was built by a path that
skipped that line, and nothing noticed, because the symptom is a _query_ that fails rather than a
schema that fails: `.repository.ts` calls `word_similarity(...)` unqualified, which is correct
against a correctly built database and an error against this one.

It is fixed where it belongs — `alter database umi_transition_rehearsal_20260901 set search_path =
"$user", public, extensions` — which is a database setting rather than a schema change, applies to
new connections, and leaves the running API's existing pooled connections untouched. Verified: the
statement now PREPAREs on that database, and the same gate run against it lost the `word_similarity`
failure entirely. Its remaining failures are **9 statements in `modules/tender/tender.repository.ts`
reading `column "refund_of_attempt_id" does not exist`** — the second session's in-flight refund work,
whose column has not reached the schema yet. Not ours to fix; recorded so the next reader does not
read those nine as a regression from this pass.

**Two lessons worth carrying.** First: a fresh build and a long-lived database can differ in ways no
schema comparison shows — `search_path` is not a table, a column or a constraint, and the parity
suites passed while it was missing. Second: the gate that caught it was run against two databases and
compared, which is the cheapest way to tell "the code is broken" from "this database is not the one
the code was written for".

### The smoke sweep was red, and one of its failures was a live 500

`src/smoke.integration.ts` is the gate that boots the API in-process, signs a real staff session and
a real customer bearer, enumerates **every GET route the app registers**, and requires each one to
answer (`< 400`) or to be a declared exception with a reason. It had not been run against this
database in this pass, and it was **red: 49 routes in the unexpected list**.

**One of those 49 was a real defect, in the endpoint that reads the audit trail.**
`GET /api/merchants/:id/audit` answered **500 for any merchant that had audit events** — which is
every merchant that has done anything. The cause is one word wide: the repository selected
`occurred_at::text`, and Postgres prints that as `2026-09-17 10:58:14.477621+00`, with a space where
the contract's `IsoTimestamp` — `z.string().datetime({ offset: true })` — requires a `T`.
`AuditEventView.parse` threw on the first row, so the whole response failed. Fixed in
`integrity.repository.ts` by converting to `new Date(...).toISOString()` in the mapping, which is what
the rest of the API does (122 call sites) and keeps the query readable. Verified: the route answers
**200** where it answered 500, the integrity module's 3 spec files are 9/9, eslint is clean on the
file, and `tsc --noEmit` is clean across the API.

**The other 48 were the sweep's own string substitution, and fixing that made the gate worth more
than the bug it found.** `fill()` — the helper that turns Fastify's `:param` routes into callable
URLs — named eleven parameters and left every other one literal, so `/purchase-orders/:purchaseOrderId`
was requested as a path containing the text `:purchaseOrderId`. The API correctly answered 400, and
the sweep reported that as an unexpected failure. It now substitutes **any** remaining `:param` with a
well-formed uuid, which lets each route answer for itself: a 404 that means "no such row" instead of a
400 that means "that is not a uuid".

**And two pins had moved, which is the half of the list that keeps it honest.** The location-scoped
reads (`floor-plan`, `table-state`, `fiscal/documents`, `purchase-orders`) demand `?locationId=` and
this sweep deliberately sends no query string; they are now declared with that reason, in the same
species as the existing `/kds/routes` entry. The POS entry is the interesting one: it expected **403**
because no rehearsal café held the `pos` product and the EntitlementGuard refused everything. The
café holds it now — `umi-pos-local-access-seed.sh` provisions exactly that entitlement — so the guard
passes and the routes refuse the missing query context instead. The pin is 400 with the story of why
it moved, and a pointer to where the POS surface _is_ exercised for real
(`tools/ux-sweep/pos-native-flows.mjs`, on the native till, where a device session exists).

**Result: `smoke.integration.ts` is green — 127 GET routes, 69 answered, 59 declared exceptions, 0
unexpected, 2/2 tests.** It was the last of the API-side gates that was red, and it is now a gate
that can fail again for the right reason: a new route that answers nothing, or a pin that has quietly
stopped matching.

### Workstream K: the queue now replays itself, and its audit row was two-thirds stale

§14's K row reads: _"the OS connectivity source, automatic ordered replay, the unknown-result query
before reuse and the Redis realtime adapter are not built."_ Two of those four claims are false, and
the third is now built.

**Already built, and the row did not know: the unknown-result query.** `OfflineRecoveryController`
has had `queryUnknownResults` — and a recovery path that walks every `unknown` journal entry through
`gateway.resultFor(...)` BEFORE replaying anything — since the offline work landed; the test
_"restart queries a lost response before replay and maps it once"_ is what proves it. Ordered replay
was built too: `OrderedReplayEngine.replay` sorts pending entries by `device.command.deviceSequence`,
batches them, applies each result and stops on a blocking failure.

**What was genuinely missing is the word AUTOMATIC, and it is the difference between a queue that
drains and a queue that waits.** Replay ran at sign-in (`_loadInitial` calls `_recover()` twice) and
when an operator opened the recovery centre and pressed the button. Nothing listened for the moment
the till came back online: `ConnectivityController.apiReachable` moves the state
`offline → recovering → online` on its own, and a cash sale taken in a dead spot therefore sat in the
journal until someone opened the recovery centre or restarted the app.

`OfflineRecoveryController` now subscribes to the connectivity controller. It remembers the last
`ReplayScope` it was handed (the scope names merchant, location, operator session and credential
version, and the surface is where the session lives, so the controller takes it from the first
`recover`), and on a transition into `online` or `recovering` it loads the journal and starts a
replay **if there is anything to replay** — the check exists so an idle transition does not ask the
server to begin a session, and `recover`'s own `_running` guard means an operator pressing the button
at that moment cannot double-submit. The listener is removed in `dispose`, which the composition root
already calls.

**Evidence.** A new test, _"the queue replays by itself when the connection comes back"_: a cash
command in the journal, the till offline, `recover(scope)` reaching `waitingForConnectivity` with
**zero submissions**, then two `apiReachable` calls — the two authoritative successes the
connectivity controller requires — and the queue submits **once**, the entry lands `accepted`, and the
phase is `completed`. Proven red-green by removing the listener registration, which fails exactly
that test. `flutter analyze` clean on `lib/features/offline/`, and the whole POS suite is
**337/337**.

**Still true in that row, recorded so the row shrinks honestly rather than all at once.** There is no
OS-level network source: `apiReachable`/`apiFailure` are called from four places, all of them request
outcomes, so the till learns it is offline when a call fails rather than when the interface drops —
which is the more honest signal about the API but means a drop during an idle minute is invisible
until the next sale. (`connectivity_plus` is not a dependency and was not added; a heartbeat against
`/health/live` would be the dependency-free version of the same idea.) The Redis realtime adapter is
still unbuilt, and it is API-side.

**Corrected 2026-09-17 — the first half of that is no longer true.** The OS-level source is built:
`connectivity_plus` is a dependency and an interface watcher feeds the till's connectivity state. See
the §8K step 1 section at the end of this file. The sentence above was accurate when it was written
and is left standing because that is what a log is; the Redis adapter is still unbuilt.

### §8H step 6: the all-day count, end to end

"Add an all-day count per item, because a cook reads that number first." `×5` now sits beside each
line on the till's kitchen board, and it means what it says: how many of that dish the kitchen has
been asked for on the trading day it is working.

**Its own route, not a field on the board.** `pos.kitchenAllDay` →
`GET /api/v1/pos/merchants/:merchantId/kitchen/all-day`. The board is polled every few seconds and
answers "what is on the rail NOW"; this is one aggregate per day that changes when an order arrives.
Folding it into the board would make every tick pay for it.

**The day comes back from the server, and that is the whole reason the response carries it.** A till
with a drifted clock — or a client computing midnight in the wrong timezone — cannot be trusted to
name the trading day, and `merchant.tg_business_date` already establishes that an 01:00 order belongs
to the previous day when the café's day starts at 06:00. So the read resolves the date in this order:
the day the caller named, else the newest day with orders at that location (the day the kitchen is
actually on), else the merchant's own clock applied the way the trigger applies it. The till sends no
date at all.

**Two counts, and one of them is a null rather than a zero.** `ordered` is the day's demand and
`outstanding` is what is not ready yet; a cancelled ORDER and a cancelled ITEM are both out of
`ordered`, because neither was cooked. When the count cannot be read — an older server, or a refusal
on this route — the board renders **nothing** beside the dish and keeps working: a `×0` would be a
claim that nobody ordered it today, which is a lie the till has no business telling, and the count
failing is not the operator's action failing, so it does not raise the board's error line either.

**Keyed on the name and the variant, because that is all a ticket line has.** The kitchen projector
stores what the order said — `product_name`, `variant_name` — with a nullable `product_id` that is not
what a cook reads. Two lines with the same name and variant are the same dish to the person cooking
them, and the count is answered in the same terms the rail is drawn in.

**Evidence, and one of these is the gate doing its job.** The contract's own drift check refused the
change until the handler existed — _"route table declares paths no controller serves:
pos.kitchenAllDay"_ — which is why the route, the controller and the service landed together; contract
tests are **70/70**. The aggregate was verified against real kitchen data before any UI existed:
`Americano` on the newest business date reads **5 ordered / 5 outstanding**, and the underlying rows
are five queued Americano lines of quantity 1. `kds` unit tests **110 passed**. The smoke sweep went
from 127 to **128 GET routes with 0 unexpected**, so the new route is enumerated and its refusal
(no `?locationId=`) is a declared pin. On the till side, `kitchen_board_test.dart` gains _"the all-day
count reaches the line it counts"_ and _"a refusing count route leaves the board working"_ —
**20/20** in that file and **339/339** for the whole POS suite. A delta-based case is added to the
gated `kds.repository.integration.spec.ts`
(it skips without `GATE4A_DATABASE_URL`, so it is CI coverage rather than evidence here).

### §14's H and J rows, re-checked against the code rather than against the last audit

Two rows of the per-workstream audit have been drifting for the same reason the K row had: the claim
was written before somebody built the thing, and nothing re-read it. Checked here, in the order the
steps are numbered.

**H step 7 — routing by product, category and location default — is BUILD. It is not open.** The
rules table is `merchant.kitchen_route`, and the refusal §8H asks for is a CHECK rather than a
convention:

```sql
constraint kitchen_route_target_ck check (num_nonnulls(product_id,category_id) <= 1)
```

— a rule that named both a product and a category is not storable. The projector reads the table
(`kitchen-projector.ts` selects active routes joined to active stations, ordered by
`route_priority`) and stamps each ticket line with `station_id` and the `route_reason` that produced
it; the API exposes `GET/POST/PATCH /kds/routes`; and the dashboard does not merely have the model,
it has the screen — `cocina.jsx` renders the kitchen domain, its "Configurar ruta" button opens
`KitchenRouteDialog`, and the command it sends (`kitchen.route.update`) is handled in
`administrative-command-execution.service.ts`, which routes it to `createRoute`/`updateRoute`. A
location default is a route with neither target set, which the CHECK also admits.

**H step 6 was open and is now built** — see the section above; the count is on the rail.

**H step 4 — courses and staging — is genuinely open, and this is what "open" looks like.** There is
no `course` in the kitchen tables, in the order line, in the contract or in the till: a dessert has
nothing to be staged by. It needs a course on the line, the till's order-taking able to set it, the
projector to carry it, and the board to group by it — four layers, none of them started.

**H step 8 — the realtime feed — is open, and its shape is now known.** The house already nudges over
Postgres `NOTIFY` with API listeners: `merchant.tg_notify_tender_attempt` (72_mp_point.sql) and the
conversation-message trigger it was modelled on, both `perform pg_notify(...)` with IDs only, the
client re-reading over RLS. A kitchen channel therefore means a trigger on kitchen order/item writes,
a listener plus an endpoint the till can subscribe to, and the till replacing the 8 s poll while
keeping it as the floor. It is a migration, an API surface and a client subscription — the next full
slice in this workstream.

**J — loyalty and stored value — is further along than "not verified", and its real gap is tiers.**
`merchant.loyalty_program` carries `stamps_per_reward`, `topup_enabled`, `multi_seal_enabled`,
`birthday_reward_enabled` with its reward name, `self_registration`, the card's style fields and a
promo window; `merchant.loyalty_reward` exists; the till has `pos.rewardAuthorize` and
`pos.rewardRelease` under `loyalty.reward.authorize`/`.release`; the dashboard has
`cash.rewardConfig` (and its by-reference twin), a `loyalty-value` screen and role gates; and two
schedulers cover the clock — `customer-value-expiry.scheduler.ts` and the birthday-grant path. What
is NOT there, checked by looking rather than by remembering: **tiers** (no column, no route, no
screen) and **consent records** (not found in the loyalty surface). So the row's five unknowns are
two, and both are features rather than verification debt.

### §8H step 8: the board's wake-up, and why it is not a trigger

H's acceptance says a ticket reaches the station in under a second. With the till polling every eight
seconds that sentence could not hold — a ticket could sit for eight seconds — so the poll had to stop
being the delivery path. It now is not: the till holds a request open and the server releases it the
moment a kitchen ticket moves.

**The nudge is raised by the writes, not by a trigger.** The tender nudge needs a database trigger
because the write that resolves an attempt happens in the WORKER process, which owns no HTTP
listener. Kitchen tickets are the opposite case: `projectKitchenOrder` runs in the web process and
every command goes through `executeKitchenCommand`, and `supabase/README.md` makes the API the only
business write boundary. So both paths call `pg_notify('umi_kitchen_board', …)` **inside their own
transaction**, which is also what makes it correct: Postgres delivers a transaction's notifications
at COMMIT, so a watcher can never be woken before the ticket it is about is visible, and a checkout
that fails after projection wakes nobody. A ticket written by hand in SQL would not nudge — the
poll is the floor for exactly that case.

The payload is **ids only** (merchant, location, order). The board re-reads over RLS REST and renders
what the database says, so a wake-up cannot show a cook a ticket that is not there.

**The channel is a HELD REQUEST, and the route says so.** `pos.kitchenBoardWatch` →
`GET /api/v1/pos/merchants/:merchantId/kitchen/board/watch` is authorised exactly as the board read
is (same `authorizePos` gate — a watch is a read with a longer life, not a different privilege) and
answers `{ ok, changed, waitedMs }`: `changed: true` the moment this location's kitchen moves,
`changed: false` when the hold expires. **Expiry is an ANSWER, not an error**, and that is what lets
one route be both the realtime channel and the fallback with no special case in the client. The hold
is **12 seconds**, bounded from above by a fact in the client: the till's `ApiClient.requestTimeout`
is 15 seconds, and a hold that outlived it would turn every idle watch into an error the till retries.

**The plumbing is the house's.** `KitchenBoardListener` holds the `LISTEN` on a dedicated connection
and reconnects itself, like `TenderAttemptListener` and `MessageNotifyListener` before it;
`KitchenBoardEvents` is the in-process bus (`waitForChange` filters by merchant AND location, so a
busy café's till is not woken by the neighbour's kitchen) and it carries the same single-process note
the dashboard bus carries — the Redis adapter is the gate before a second API replica. One line in
the dashboard gateway would give the dashboard the same stream if it ever wants a live board.

**And the till subscribes.** `KitchenBoardController.startWatching()` holds one watch at a time and
reloads the board when told to; the surface starts it when the board opens and stops it on dispose.
The eight-second timer stays exactly where it was, as the floor. A REFUSED watch is not a broken
board: the loop waits two seconds and tries again while the poll keeps the rail current — the
alternative, raising the board's error line, would tell a cook the kitchen is broken when the
kitchen is fine.

**Evidence.** `kitchen-board.events.spec.ts` covers the primitive in four cases: true on a matching
change, false on expiry, silence for the café next door, and both watchers released when two devices
watch one kitchen. `kitchen-projector.spec.ts` gains _"raises the board wake-up in the same
transaction as the ticket"_, which asserts the `pg_notify` goes out **on the caller's client** (not
an in-process emit) with ids only. `kitchen_board_test.dart` gains _"a wake-up reloads the board
without waiting for the poll"_. Gates: contract tests pass (the route's handler had to exist before
the drift check would let the route in), eslint clean, `kds`+`realtime` unit **136 passed**, smoke
sweep **129 GET routes with 0 unexpected**, and the POS suite **344/344**.

**What this does NOT yet prove, said plainly.** The end-to-end latency on the real till has not been
measured — the window belongs to the other session while it works the terminal path — and neither has
the "board survives a network drop without losing a ticket" half of H's acceptance, which is what the
poll-as-floor is for and what a drop test would show. The emission points are asserted at the query
level; that a live listener receives them is Postgres's contract rather than something a unit test
here can demonstrate.

### The other half of H's acceptance: a drop is SURVIVED, and now it is SAID

`kitchen_board_test.dart` now carries the acceptance sentence as a test: _"a dropped network is said
out loud, and the rail is kept."_ Writing it exposed that only half of that was true.

**The board already survived a drop** — the controller keeps the tickets it has when a read fails,
which is why the earlier note called the poll the floor. What it did NOT do was say anything: the
kitchen board's surface was constructed with `controller` and `entry` and nothing else, so a board
whose poll and wake-up were both failing showed the last tickets it had seen, with no mark on it at
all. **A stale board looks exactly like a quiet service**, and the difference matters more here than
anywhere else in the till: a cook who cannot tell them apart keeps plating from a rail that stopped
being true. That is the state the design language calls out — _"Mantén visible el estado offline sin
bloquear las acciones permitidas"_ — and the board was the one screen in the app not doing it.

**So the board shows it.** `showKitchenBoard` and `KitchenBoardSurface` now take the till's
`ConnectivityController`, the surface listens to it (and unsubscribes on dispose), and the app bar
carries a pill with the connection's own words when the state is anything but `online` — red for
offline, muted for degraded/recovering/blocked. It is absent when the till is online: a badge that
always reads "En línea" is noise on a rail a cook reads twenty times a minute, and the design law
asks for the OFFLINE state to be visible rather than for the online one to be announced.

**One source of truth for the eight words.** The label mapping lived in `catalog_surface.dart` as a
private `_connectivityLabel`, which was fine while the catalog was the only screen that showed it.
It is now `connectivityLabel` in `lib/shared/widgets/connectivity_label.dart`, next to
`showsConnectivityWarning`, and the catalog calls the shared one instead of keeping a copy — so the
till cannot end up describing the same network two ways on two screens.

**Evidence.** The new widget test drives the real controller through its whole vocabulary: three
consecutive `apiFailure`s reach offline, the rail keeps `Latte` while the read is failing, the pill
reads `Offline`, and two `apiReachable`s remove it with the ticket still on the board. Proven
red-green by disabling the pill, which fails exactly that test. `kitchen_board_test.dart` is
**22/22** and the POS suite **345/345**, with `flutter analyze` clean and `dart format` clean on
everything touched.

### The pill needed a wire under it: the board's own traffic now feeds the connectivity state

Adding the offline pill exposed a second gap behind it. The connectivity controller moves on
`apiReachable`/`apiFailure`, and those were called from exactly four places — all of them in the
catalog's own load path. **The kitchen board's traffic reached nobody.** A cook could sit in front of
a board whose every read and every held watch was failing while the connectivity state still said
`online`, because nothing had told it otherwise; the pill would have stayed dark precisely when it
mattered.

**The busiest client in the café is the one that should report.** A kitchen till is a read every
eight seconds, a held watch in between and a command per bump, so its traffic is the best evidence
the till has about whether the API is reachable. `KitchenBoardController` now takes the
`ConnectivityController` and reports from both loops: `load()` reports on success and on failure, and
the watch reports too — a held request that cannot connect is the earliest sign of a drop this till
gets, twelve seconds before the poll would have found out.

**The vocabulary is deliberately narrow, and that is the interesting part.** Reaching the API and
getting an ANSWER is `apiReachable`. A `transport` failure or a `timeout` is `apiFailure` — those are
the two categories that mean "no answer". Everything else is silence: a 403, a conflict or a 5xx says
something about the server's opinion, not about the wire, and treating those as failures would mark
the till offline for a permission problem. A state derived from guesses is worth less than the
requests it is derived from.

**Evidence.** Two cases join the controller's suite: _"the board's own traffic is what moves the
connectivity state"_ (a transport failure repeated three times reaches `offline` from the board's own
reads, and one answered read starts the way back — with no help from any other screen) and _"a typed
refusal is not treated as a broken wire"_ (three `PERMISSION_DENIED`s leave the till as it was).
Proven red-green by removing the failure report from `load()`, which fails exactly the first.
`kitchen_board_test.dart` is **24/24**, the POS suite **347/347**, `flutter analyze` and
`dart format` clean.

**What this does and does not close in §8K.** It does not build the OS-level network source the row
asks for — there is still no interface watcher, and `connectivity_plus` is still not a dependency.
What it does is remove the reason that gap was sharpest: connectivity is no longer inferred only when
somebody happens to make a call. On a kitchen till something is always making one.

**Corrected 2026-09-17: the OS-level source now exists** (`connectivity_plus` 7.3.1, an interface
watcher, and the two asymmetric entry points into `ConnectivityController`) — §8K step 1, at the end
of this file. What this section closed was the _reason the gap was sharpest_; what that one closes is
the gap itself.

### §8H step 4: courses and staging, and the gate that would have made it a 500

"Add courses and staging, so a dessert does not leave with the starters." The gap was total and the
plan said so in as many words: **there was no `course` in the kitchen tables, in the order line, in
the contract or in the till.** A ticket fired as one block, by construction, and no ticket could say
otherwise.

**The model is one column and one watermark, and the flag is derived.** `course_number` (1..20,
`NOT NULL DEFAULT 1`) is added to `pos_cart_line`, `order_item` and `kitchen_order_item`, and
`kitchen_order.fired_through_course` is the ticket's high-water mark. An item is **fired** when
`course_number <= fired_through_course` and **held** otherwise — computed in
`kds.station_order`, never stored, because a stored flag is a second place for the truth and the two
disagree the moment a course is fired and then corrected. The read returns **every** item with its
course and its flag; held items are marked, not filtered, so the decision about how a held dish looks
belongs to the client that knows its cook.

**Both writings are guarded against the two ways this goes wrong as a shared fact.** The cart's
`identity_key` deliberately excludes the course, and the `ON CONFLICT (cart_id, identity_key)` path
now sets `course_number = excluded.course_number` — so "move the flan to course 3" rewrites the line
instead of splitting it into a second one, which is what a course folded into the identity would have
done. And the watermark is monotone: the ticket update writes
`greatest(fired_through_course, $n)`, so a stale or twice-delivered `fire_course` cannot rewind a
ticket that has already fired past it. A requested course at or below the current watermark is a
**no-op that answers with the current state** — no version bump, no event, no board nudge — because
nothing was written and a late caller asking about work already done is not a conflict.

**The defect worth recording is not in the course column at all.** `merchant.kitchen_command.command_type`
is `CHECK`-constrained to the seven commands 42_pos_kitchen.sql knew. The course columns landed, the
API landed, the tests were written — and every single `fire_course` died on the journal insert with a
bare `23514`, which the client would have seen as a **500 on the one control this step exists to
add**. Nothing in the chain would have caught it: the column assertions verify the columns, and the
guard exists, it is just a guard that refuses the new value. `74_kitchen_courses.sql` now widens the
vocabulary as a **definition-aware correction** rather than an `if not exists` guard — the shape
70_tender uses for `fiscal_document_stamped_shape` — and `99_verify.sql` asserts `fire_course` by
name inside the constraint the server is enforcing. A fresh build prints the notice, because on a
fresh build 42 creates the old list and 74 corrects it.

**Evidence, and it is the chain rather than the file.** `bash docs/migration/build-v3/00_run.sh
umi_courses_verify` builds a virgin database through all four layers and ends `build-v3 verify: OK`;
the integration suite then runs **28/28** against _that_ database, not against a hand-patched one —
which is the point, because the constraint in question is created by an earlier file and only the
chain proves the correction runs. Re-running 74 against the same database is a no-op (columns skip,
the widen notice is silent), and the verify block was proven to have teeth by dropping `<= 20` from
`order_item_course_number_ck` and re-running it: it fails, naming the bound.

The five new integration tests are one per behaviour the step implies. A cart line's course survives
to `merchant.kitchen_order_item.course_number` — driven through real `pos_cart` + `pos_cart_line`
rows, then `writeOrder`, which projects the kitchen itself, so a cart-shaped mock cannot stand in for
the database. A held course reads `fired: false` and a fired one reads `fired: true`, through
`boardSnapshot`, both items still present. `fire_course` advances the ticket, replays to the same
result with no second event, and a lower course neither rewinds the watermark nor bumps the version.
And the guards refuse `course_number = 0` and `= 21` from **raw SQL** — the writer that never met
TypeScript — asserting the offending constraint by name, with 20 accepted so the rejection is a bound
and not a broken statement.

**All four places the step names are now true, and the till's half is what makes the sentence do any
work.** The operator sets a line's course from the product sheet with a stepper bounded to 1..20 —
chosen over a chip row or a number field because the sheet already steps quantity that way and a
typist cannot put a 40 into it — and the cart row names the course only when it is not 1, so an
ordinary single-course sale reads exactly as it did. One wire detail is worth recording because the
wiring could have introduced it: a quantity tap rewrites the whole line, so `quantity()` had to carry
the course through; without that, tapping `+` on a dessert would have dropped it silently back into
the starters, which is the exact failure the step exists to prevent.

**On the board, held is a state the cook can see rather than a state they must remember.** Courses
group lowest-first; a held course is drawn in its own framed, counted block (`Held · 3`, _Not cooking
yet_) and is **not bumpable however its status reads** — a held line cannot be started by a tap, and
the test that proves it also proves a fired line still bumps. One full-width action fires the next
held course, and it fires the **lowest** held course, never the highest, so a fire cannot jump a gap
and leave course 2 behind. Nothing moves until the server answers: the board only advances when the
returned snapshot carries the new watermark, which is the same rule the tender screen learned about a
terminal that has not answered yet.

**Evidence for the till half.** The POS suite is **371/371** with `flutter analyze` and `dart format`
clean; the course reaching the request, the in-place rewrite, the held block, the fire naming its
course and waiting for the server, and the stepper's bounds and 48 px targets each have a test that
fails when the behaviour is removed. One pre-existing breakage surfaced here: `kitchen_board_test.dart`
was **2 passing, 22 failing** before this step, because the regenerated contract made `courseNumber`
and `fired` required on models its fixtures parse — the server half had broken the client half's tests
and only running them said so (§6.7).

**What is still not closed.** Station routing of a held item: the watermark says what may be worked,
not which station may work it. And there is no click-through on the device. The shared till runs
against a database at `build-v3-72` while this chain now ends at 74, so an on-screen sweep would have
needed either migrating that database out from under a concurrent session or standing up a second
seeded one, and neither was worth the risk to someone else's work in flight. The widget and wire
evidence above is what exists for the till half; the server half is proven through the chain.

### §8K step 1: the operating-system connectivity source, and the leak it flushed out

"Add an operating-system connectivity source." The reason it was open was stated in this document in
as many words: _there is still no interface watcher, and `connectivity_plus` is still not a
dependency_ — the till learned it was offline only when a call failed, so a drop during an idle
minute was invisible until the next sale.

**The design is one asymmetry, and it is the whole point.** `networkDown()` goes to `offline` in ONE
signal instead of three, because the OS knows something the requests would only infer and a cashier
should not have to lose three sales to learn it. `networkUp()` **never** sets `online` — it moves
`offline`/`degraded` to `recovering` and leaves the existing rule (two authoritative API successes)
to finish the job. An interface being up is not the API answering, and a state derived from a guess
is worth less than the requests it is derived from. Neither entry point overrides `blocked`: a
revoked device stays revoked. Both clear the request counters, because an interface transition is a
discontinuity in the evidence those counters were built from — so coming back needs three _fresh_
failures, not the tail of an old streak.

**A broken watcher is not allowed to report a dead wire.** A plugin error on the stream is dropped
rather than mapped to `false`, an empty interface list is `unavailable` rather than "offline", and a
failing boot read is not a reason to go offline. The source can say the wire is gone; it can never
say the API is down.

**The leak is the find, and it was not in the new code.** The first wiring passed analysis and
leaked: an `async` cancel helper cleared its field _after_ an await, nulling out the subscription
that had replaced it. A test caught it (dispose cancels the watch; a later event cannot reach the
controller). Fixing it the same way in `entry_controller.dart` exposed the same bug there —
`_cancelPairingWatch` was clobbering the live pairing watch, so the realtime nudge listener was
**never released** and `dispose`/`cancelPairing` cancelled nothing. That one was proven red first
(`hasListener` still true after cancel) and green after. An async cancel that clears state after
awaiting is the shape to look for; there may be more.

**Evidence, and it is a running plugin rather than a compiling one.** `connectivity_plus` 7.3.1 is
Dart-only on Linux (`dartPluginClass`, NetworkManager over D-Bus), so it adds no native library —
`flutter build linux --debug` succeeds and the bundle gains nothing. A `flutter test` cannot tell a
registered plugin from an unregistered one (both look like `unavailable`), so the proof is an
`integration_test/` case run on the real device: the plugin answers `ready true`, the watch is a live
subscription, and `AppCompositionRoot.production()` carries the OS source while still refusing to
claim `online` from a boot read. 16 unit tests cover the rules, the mapping and the wiring; the POS
suite is green (**397 passing** at the time of this pass, up from 371 before it, with another
session's Point tests landing in the same window) and `flutter analyze` is clean.

**What this does not close in §8K.** The Redis adapter for a second API replica is still unbuilt (it
is the gate three gateways name in their own comments), and the acceptance sentence — a cash sale
made offline lands once after reconnection and the shift total matches the ledger — is still an
intention here rather than a measurement. One consequence to watch: because `networkUp()` yields
`recovering`, the recovery controller treats an interface flap as "go" and may attempt a replay
before any API call has succeeded. Its guards hold, but a flap now starts an attempt.

### §8K's acceptance sentence, proven — and the two defects it flushed out

> _A cash sale made offline lands once after reconnection, and the shift total matches the ledger._

That sentence had **no evidence anywhere in the repository**. Grep for it and you find only this
document: `pos-offline` had a service spec against mocks and nothing that ran the replay contract
against a database. So the sentence was an intention wearing an acceptance line's clothes, which is
the one thing this plan's own §6.7 says a green check must never be.

**It is true, and it is now counted in SQL.** `pos-offline.integration.ts` (7 tests, in the
`test:integration:schema` family so CI runs it rather than leaving it invisible) drives a real
offline cash sale through `issuePolicy` → `begin` → `batch`, then delivers the same batch again the
way a reconnection does. The assertions are not the API's answers: one `customer_order`, one
`pos_committed_sale`, one `sale_committed` `stock_ledger_entry`, one journal row, `on_hand` unmoved
across the retry, and on the second delivery a `duplicate` carrying the **same** official sale and
receipt ids. The drawer is proved the same way: the ledger summed in SQL with the caja dashboard's
own expression equals that shift's `expectedCash`. The ordering rules have their own cases — a
sequence gap is refused and stops the batch, a tampered fingerprint is refused, and a batch that
arrives out of order commits nothing twice.

**Two defects came out of writing it, both on the offline path, both fixed here.**

**A stale cart escaped as an unhandled 409 with nothing recorded.** A queued sale whose cart moved
on is a NORMAL offline outcome — the till was away and the cart advanced — and `checkout()` reports
it as a typed `ConflictException`. It left `batchLocked` at the preview as an unhandled conflict, so
**no `offline_replay_conflict` row was written** and the recovery centre, the one place an operator
is told what happened to a queued sale, showed nothing at all. Both the preview and the commit now
journal the refusal (`aggregate_version_conflict` for the version conflict, `server_validation_failed`
otherwise) and stop the batch; anything that is not a typed refusal still escapes, because a bug
here must not be recorded as the operator's problem.

**The batch cursor lied by exactly one.** The response's `cursor.lastAcceptedSequence` seeded its
reduce with `sorted[0].deviceSequence - 1`, so a batch whose FIRST command was refused reported the
sequence _below_ the one it had just refused — with an empty cursor and a refused sequence 3 it said
`2`, i.e. "commands 1 and 2 are accepted". A client that read the field as "accepted up to here"
would have dropped two commands it never sent. The till happens not to read it (`replay_engine.dart`
applies each `ReplayResult` and re-reads the cursor endpoint for the truth), which is why this was
latent rather than a live data-loss path — and why the test now asserts the field equals the cursor
table rather than asserting the bug.

**One finding is left open on purpose, because it is a product question rather than a defect.** The
policy and `OfflineCheckoutEligibility` contemplate a till holding many uncommitted offline sales
(`maxOfflineSaleCount`, up to 1000), but the platform issues **one live cart per operator per
location** (`pos_cart_active_operator_uidx`), so a cashier can queue exactly one. Either the offline
limit is described to merchants in those terms or the cart rule changes; that is not a line of code
to pick in passing, and it is recorded here so the next reader does not discover it by trying to
batch two sales.

### §8I step 2: the table-order channel's INTAKE half — and a trap in one word

§8I had a working receiving end and no channel to receive from. `writeOrder` already projects the
kitchen ticket for anything written through it, the POS already lists incoming channel orders and
binds one to a cart, and the channel identity already survives to the committed sale. What did not
exist was any way for an order to arrive from outside the building.

**The deferral was answered by asking which half it applied to.** The blocker on record was
pay-on-page versus pay-at-counter, but the acceptance sentence says nothing about where the money is
taken — and there is no Conekta client, so a "pay now" step would be a promise the API cannot keep.
The decision (channel ADR §9) is therefore: the table channel ships as **order intake**, payment
stays at the counter, and pay-on-page later becomes an additive step on the same order. The guest
surface is obliged to SAY the order is paid at the counter rather than offering a step that does not
exist — the same rule the tender screen learned about a terminal that has not answered.

**What landed is the server half.** `merchant.table_order_credential` (a hashed, revocable,
one-live-per-table token) and `merchant.table_order` (the per-order link, with a composite FK so a
link cannot point at another merchant's order). A guest surface calls two unauthenticated routes —
`GET /api/public/table-order/:token` for the menu and `POST …/orders` to place it — through
`TableOrderCredentialGuard` (which resolves the token and narrows merchant and location), then a rate
limiter that bounds the CREDENTIAL as well as the address. Pricing comes from the till's own
`price()` rather than a second copy, a retried submission creates exactly one order, and an unknown
token is indistinguishable from a revoked one.

**The trap is one word, and it was in this document's own instruction.** The instruction said the
order is "linked to that table's open state". `merchant.table_state.state` has a value literally
named `open` — and it means **the table is FREE**. `open` and `dirty` are the unoccupied states;
`table_state_party_presence` ties occupancy to `seated_at`. An implementation reading the sentence
literally would have refused every seated guest and admitted exactly the empty tables, and it would
have looked correct in review because the SQL would say `state = 'open'`. The intake test makes the
inversion executable — a table whose state is `open` is refused, a seated one orders — and the ADR
now says "a party is present" instead. The general rule this is another instance of: a name in a
schema is not the English word it resembles.

**Evidence.** `table-order.integration.ts`, 14 cases, green twice against the same database and once
against a database built from zero; where the ordering is proved from raw SQL, the ticket exists
because `kitchen_order` and `kitchen_order_item` rows are there and the POS's own `incomingOrders`
read returns it with channel `web` (and `bindOrigin` makes "in the POS cart" literal). The chain ends
at `75_table_order_credential`, `verify: OK`. The routes are exercised over HTTP with the real
guards, including the 13th attempt on one credential returning 429 — which only fires if the limiter
runs _after_ resolution.

**What this does NOT close, stated plainly.** The acceptance sentence has two halves and only one is
built: a QR order can now arrive and reach the POS and the board, but **there is no guest page and no
QR image** — a credential is issued through the owner's route and its token is returned once. Until
the page exists, the acceptance is met at the API and unproven end to end, and it is not claimed
here.

**Two findings on the way, neither of them mine to fix.** `created_at::text` on a `timestamptz` is
NOT the contract's `Timestamp`: Postgres renders `2026-09-17 08:51:26.123+00`, which is not
ISO-8601-with-offset, so any repository that stringifies a timestamp in SQL fails the schema it
publishes — worth grepping for rather than fixing here. And `PosIncomingOrder.itemCount` counts
LINES, not units (`count(*)` over live items), so a two-coffee order reads `itemCount: 1`; the till
owns that, and the new intake test asserts both numbers side by side in one place so the difference
is visible rather than latent.
