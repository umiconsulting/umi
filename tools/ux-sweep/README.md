# ux-sweep

Harnesses that measure the Umi surface instead of describing it. Everything here
drives a real browser or a real app and writes a report; nothing here is a
substitute for a test that asserts product behaviour.

The Dashboard harnesses attach to a Chromium already running with
`--remote-debugging-port=9222` and already signed in, because the Dashboard needs
a session and the sweep must not log in as anyone. Defaults:

```sh
export UX_CDP=http://127.0.0.1:9222   # the running Chromium
export UX_BASE=http://127.0.0.1:4000  # the Dashboard dev server
```

Run everything with `pnpm ux:verify`: every click, every hit-target size, every
flow budget, a first paint number per screen, and the visual baselines. The
heavier DevTools instruments — throttled load, memory over a shift, a full trace,
a screencast, and Lighthouse — are separate scripts below, so the standing loop
stays bounded.

**Rate limit.** umi-api rejects an IP after 300 requests in a minute
(`RATE_LIMIT_IP_PER_MINUTE`). Each Dashboard route load costs several calls, so a
bare 22-route sweep can trip it and the app then renders a shell without a
sidebar. The harness retries that load and, if it still happens, marks the route
`[DEGRADED SHELL]` in the summary and `degradedShell: true` in the JSON rather
than reporting five controls as if that were the screen. `--delay <ms>` spaces
the routes out; the `pnpm ux:*` scripts use 2500 ms.

## click-inventory.mjs

**Proves:** what can be clicked on each screen, which controls have no accessible
name, and which hit targets are smaller than the 44 x 44 px bar. Read-only: it
never clicks.

```sh
node tools/ux-sweep/click-inventory.mjs --out /tmp/ux/inventory.json --md /tmp/ux/inventory.md
```

## click-audit.mjs

**Proves:** what each control is, and what happens when it is pressed — the URL,
the console errors, the page errors, the failed requests, and any dialog the
click raised. Every control is classified safe or destructive first; the pattern
list lives in `lib/collect.mjs` and says why each family is destructive.

Read-only by default. Clicking needs an explicit opt-in that names the thing it
is allowed to wreck:

```sh
# classification only — safe against any database
node tools/ux-sweep/click-audit.mjs --out /tmp/ux/click-audit.json --md /tmp/ux/click-audit.md

# click the safe controls on read-mostly screens; disposable database only
UX_CLICK_CONFIRM=disposable node tools/ux-sweep/click-audit.mjs \
  --routes /,/reportes --limit 5 --shots /tmp/ux/shots
```

Three things decide whether that report means anything.

- **The viewport is pinned to 1280x720 by default.** Without a pinned viewport the sidebar's nav
  items resolve, call themselves visible and stable, and sit outside the viewport Playwright may
  click in, so every sidebar click times out with `element is outside of the viewport`. The report
  then looks like 115 dead controls and contains no writes at all.
- **Prove the write pass wrote.** `grep -c '"method":"POST"'` on the API's log is the evidence; a
  "click" report with a clean `failedRequests` column proves nothing on its own.
- **The run paces itself, and says so.** The session is priced at 240 requests a minute and every
  click reloads its route, so a 24-route pass spends a few thousand; the audit waits when three
  quarters of the budget is gone and prints each wait. A run that is quiet for a minute is a run
  waiting, not a run hung.

## flow-budget.mjs

**Proves:** how many taps and how many milliseconds each core flow costs, against
the budgets in `config/ux-budgets.json`. Exits non-zero when a measured flow
misses its budget or a step does not take effect. Flows the harness cannot drive
yet are reported as `not-yet-instrumented` — never as passing.

```sh
node tools/ux-sweep/flow-budget.mjs --out /tmp/ux/flows.json --md /tmp/ux/flows.md
node tools/ux-sweep/flow-budget.mjs --only customers-search
```

The viewport is pinned to 1280x720 by default because below 1080 px the shell
moves its sidebar into a drawer, which adds a tap to every navigation flow.

## visual-regression.spec.mjs

**Proves:** a style change that moves one of the seven representative screens
fails the check, at both reference viewports (1024x768 and 1280x720). Baselines
live in `__screenshots__/`.

```sh
pnpm ux:visual           # compare against the checked-in baselines (~6 min, see below)
pnpm ux:visual:update    # re-record them (only when the change is intended)
```

Four rules the spec enforces on itself, because each one produced a baseline that
was wrong rather than a baseline that failed:

- **The test's name is the screen it pins.** `/` is the owner's first screen, and the
  shell lands a role on the screen that role needs (`src/lib/role-landing.js`). A
  platform administrator has no cited first screen and lands on the first entry of
  that file's fallback chain, so a screenshot named `overview` was pinning the
  Customers screen. The spec opens the module it names and fails if it cannot.
- **No credential is ever pinned.** The operator's Chromium autofills the saved
  Dashboard password into `/login`, so the spec empties every field and refuses to
  continue while a value survives.
- **The operator's own budget is not a finding.** The session is priced at 240
  requests per minute (`LIMITS.user`), and fourteen page loads spend more than
  that. The spec paces itself with three quarters of the budget spent and reloads
  once when a 429 lands anyway; that is why a full run takes about six minutes.
  Stop smoking the sweeps for a minute before blaming a screen for "could not be
  loaded".
- **The baselines belong to one session.** They were recorded from the local stack
  as the platform administrator at the café `DATABASE_URL_APP` names. A run
  against another café, or as another role, compares two different products'
  worth of data and will fail on the merchant name alone.

## floor-plan-map.spec.mjs

**Proves:** the floor-plan console survives 200 tables, one slow drag and one
rotate, with a CDP trace around the drag and the frame numbers reported against
16.7 ms. It writes a real draft plan for the SELECTED location and restores the
draft it replaced in `afterAll`, so the location is a fixture:

```sh
pnpm ux:floor-plan-map                                  # the brief's café (Congreso)
UX_EXPECT_LOCATION='^ONCA$' pnpm ux:floor-plan-map      # the local stack's café
```

It is not part of `ux:visual` or `ux:verify`: it is one of the heavy DevTools
instruments, and it takes minutes.

## dashboard-role-surfaces.mjs

**Proves:** what each ROLE actually sees, in a real browser, route by route. `pnpm
check:role-surfaces` proves the API half of plan §C — "the client hides, and the API still
decides" — by asking the API whether it refuses a role. It says nothing about the CLIENT half:
whether the dashboard hides what the API refuses, and whether it draws a screen whose data it may
not read. That is what this walks.

```sh
pnpm ux:roles:ui     # needs a dashboard serving a database whose four role logins work
```

On this workstation that database is the fixture `scripts/umipos-role-surface-fixture.sh` builds;
point the dashboard at an API over it (`--base`) and pass `--cdp` at a browser the harness may
borrow.

Three things it learned the hard way, all worth keeping:

- **Pin the merchant the contract names.** The platform account (the owner) sees thirty cafés in
  that database, most of them harness merchants with no subscription, and the shell had selected
  Nudge Café — so all seventeen of that role's routes refused with "is not active for this café"
  and the walk reported seventeen mismatches that were the fixture talking. The selection lives in
  `localStorage['umi-dashboard-selected-merchant']`, so it is pinned before the first load, like
  the locale and the palette.
- **The contract is about API surfaces, not about screens.** The first verdict rule called a
  module "allowed" when _any_ of its rows allowed the role, and then reported the cashier's
  `/settings` as a mismatch: the client refuses a screen that mixes `merchant.manage` data with
  reward-config data the cashier may read. Those are two different questions, and the report now
  separates them (`partial`, `landing`, `listed-only` are not findings).
- **Do not wait for `networkidle`.** The shell holds a realtime socket open, so the network never
  goes idle and every route would burn the full timeout. The screen is ready when it has drawn a
  heading or a refusal.

Measured on 2026-10-10: four roles × twenty-four routes, all four sign-ins working, one finding —
`manager` on `/diagnostics`. The client draws the screen, the **Audit** tab asks the API for
`/operations`, and the API refuses it (403 `PERMISSION_DENIED`: the contract's own
`operations.audit` row expects exactly that for a manager, whose grant is `hardware.diagnostics`
and not `audit.read`). The screen answers honestly — "You do not have the permission required for
this operation." with a Retry — but the tab cannot ever load for that role, and the Retry cannot
either. The server already publishes the domains a role may read (`state.data.domains`, which the
workspace reads and the tab list does not), so the fix is to drive the tabs from the server's list
instead of the hardcoded three.

## pos-native-click-pass.mjs

**Proves:** what the till's controls do when they are pressed. The dashboard has had this since
`click-audit.mjs`; the till had journeys and an inventory but nothing that presses the controls an
inventory merely measures. It walks the same eleven surface-and-mode screens as
`pos-native-surfaces.mjs` (the maps are imported, so the two cannot drift).

```sh
pnpm ux:pos:clicks        # the app must be running and signed in
```

Three decisions, all of them about not fooling yourself:

- **It never presses a committing control.** Every control is classified from its own words into
  money (`cobrar`, `efectivo`, `propina`, `reanudar venta`…), shift (`turno`, `cajón`, `contar`…)
  and destructive (`anular`, `vaciar`, `terminar`, `empezar`…). Those are listed in the report with
  the reason and never pressed: a pass that charges and closes a till measures a café, not a
  build, and the state it wrecks poisons the screens that follow. The money path belongs to
  `pos-native-flows.mjs`, on a disposable database.
- **The expectation is the weakest honest one.** A journey names what a tap should produce; an
  audit presses to find out. `expect: { screenChanges: true }` (added to the driver for this)
  asserts that the screen must not stay put, compared against the state it had before the press —
  which still catches a swallowed press.
- **Escape between presses.** A press that opens an overlay leaves it covering the rail. The first
  run of this pass lost nine of eleven screens to exactly that, each reported as "not reached"
  because the nav item it tried to click was behind an open menu. One `Escape` closes them —
  measured, not assumed.

Measured on 2026-10-10 on a disposable clone of the local café: **46 controls pressed across the
eleven screens, zero app exceptions, and nothing written** (every POS table's newest row is from
before the pass). Eleven presses reported no visible effect, and each has an explanation worth
knowing rather than a defect: three were a control whose name changed between measuring and
pressing (the harness re-resolves by name, and reported it), three were theme choices — the
accessibility tree has no colours, so a palette change is invisible to this expectation — one was
a refresh with nothing to refresh, two were controls already in their target state (the selected
tab, the selected room), and one was "Nueva venta" on an empty cart.

## pos-native-surfaces.mjs

**Proves:** plan §7 Step F2 — "one command lists every actionable node on every POS surface with
its size and label". It walks the **native** POS by pressing the navigation the operator presses,
reads the accessibility tree on each of the seven surfaces, and applies the same 44 px floor the
dashboard inventory applies.

```sh
pnpm ux:pos:surfaces      # the app must be running and signed in
```

Two rules decide whether a number in that report means anything, and both were learned on
2026-10-10:

- **The engine publishes a node's box intersected with its clip rect.** The kitchen board's last
  row — cut by the bottom edge of the window — reported its five "Empezar" buttons as 115x34 while
  the identical buttons one row up measured 115x48. The tool judges only nodes inside the window,
  and a node flush against the edge is treated as cut, not as small.
- **A control that is short in one place and tall in another is cut, not small.** The sales list's
  third "Reanudar venta" measured 135x8 at the bottom of the _inner_ list while the two above it
  measured 135x48, and the window's edge was 24 px further down, so the window rule could not see
  it. The natural size of a control is the tallest instance of that name on the same screen;
  anything shorter is reported as clipped. Both counts are in the report, so nothing is hidden.
- **The screenshot is the cross-check.** The first version of this walk produced five phantom
  undersized buttons; the picture the improved driver now captures showed them half-cut at the
  window's edge. Capture, look, then believe the number.

**It walks the modes, not just the bar.** A surface is not one screen: the kitchen board has
`Comandas` and `Preparación`, the sales list has `Todas las ventas` / `Ventas suspendidas` /
`Ventas canceladas`, and the room has a plan and a `Ver lista`. The first walk inventoried only
whichever was open. Eleven (surface, mode) combinations are walked now, each with its own
screenshot.

The first run, on 2026-10-10, found two things and both are fixed:

- **`Mesas` — the room chip "Salón, 5 mesas" measured 122x42.** The chip is 44 tall, but its tap
  region sat _inside_ the surface's 1 px border, so the node the engine publishes was 42. The tap
  region now wraps the surface (`floor_plan_surface.dart`): the chip looks identical and the target
  is the whole 44 px box.
- **The search areas on `Comanda` and `Ventas` were pressable and unnamed.** `PosField` opens the
  keyboard from a whole-box `GestureDetector` that carried no name; the field's own words now live
  on that node, with the gesture detector excluded from semantics (`pos_fields.dart`).

Re-measured after the fix: eleven surface-and-mode screens reached, **0 controls under the floor
and 0 pressable and unnamed**, with the POS flow suite (7/7) and the Flutter suite (673 tests)
green.

## accessibility-gate.mjs

**Proves:** axe-core finds no `serious` or `critical` violation on any Dashboard
route; prints the rule id, impact, route, and selector for every one it does
find. POS semantics are a separate harness (F2, not built yet).

```sh
node tools/ux-sweep/accessibility-gate.mjs --out /tmp/ux/a11y.json --md /tmp/ux/a11y.md
node tools/ux-sweep/accessibility-gate.mjs --no-fail   # report without failing
node tools/ux-sweep/accessibility-gate.mjs --locale es --theme midnight   # one mode of six
```

**Run it in more than one mode.** The gate ran for a year in whatever mode the
browser happened to be in — English, default light palette — and that mode was the
only one anybody checked. On 2026-10-10 the same 24 routes were audited in three
palettes and two languages. The two dark palettes failed hard, and only there:
`midnight` reported **7 serious** contrast violations and the deep-ocean `dark`
palette **22**, because the navy and the muted inks were chosen against light
surfaces and never re-read against dark ones. Both are fixed (`--navy-ink` per
theme in `apps/umi-dashboard/src/styles.css`, and the `dark`/`midnight` `ink-3` /
`ink-4` steps in `packages/tokens/tokens/dashboard.json`). Four modes measured
after the fix — `umi`/en, `umi`/es, `dark`/es, `midnight`/en — all report **0
serious**. A palette is a mode, and an unmeasured mode is an unverified one.

## devtools-probe.mjs

**Proves:** how each screen performs — paint timing, JS and CSS coverage, dead
code, DOM nodes, heap, console errors, failed requests, and the slowest
responses.

```sh
node tools/ux-sweep/devtools-probe.mjs --out /tmp/ux/perf.json
```

## pos-semantics-inventory.mjs

**Proves:** the native POS surface — every actionable node on a Flutter screen
with its label and its size, read from the Dart VM service semantics tree.

```sh
node tools/ux-sweep/pos-semantics-inventory.mjs --out /tmp/ux/pos.json
```

## table-state-seed.mjs

**Sets up:** the live room the floor-plan screen draws. The only entry here that
does not prove something — it is a fixture, and it exists because an empty room
proves nothing: a broken reader of table state looks exactly like an idle café.

It writes through the real POS command routes
(`/api/v1/pos/…/table-state/*`), not with INSERTs, so the seat, clear and the
three service transitions run the same transaction, command journal and
database triggers the till runs. Only the operator session is made by hand,
because a session is what a sign-in mints and no route mints one for a script.

```sh
node tools/ux-sweep/table-state-seed.mjs                      # one table per state
node tools/ux-sweep/table-state-seed.mjs --seat T6 --party 4   # one command at a time
node tools/ux-sweep/table-state-seed.mjs --merge T6,T7 --party 6
node tools/ux-sweep/table-state-seed.mjs --reset              # empty the room
```

It reads `apps/umi-api/.env` for the database, the JWT secret and the port, so
it needs no arguments on this workstation. It writes real rows in the shared
rehearsal database; `--reset` removes them.

## lib/collect.mjs

Shared core: the route list, the control selector, the page-side collector, the
destructive pattern list, and the diagnostics listeners. `click-inventory.mjs`
and `click-audit.mjs` both import it, so the two cannot disagree about what a
control is.

## memory-shift.mjs

**Proves:** how a tab's JS heap, DOM node count, and event-listener count move
across a navigation loop, and how much the tab _retains_ once the collector is
forced. This is Step F6's "memory growth over a shift".

```sh
pnpm ux:memory                                          # 3 minutes, four screens
node tools/ux-sweep/memory-shift.mjs --minutes 30       # a shift-shaped run
```

The first and last samples are taken after `HeapProfiler.collectGarbage`, so the
difference between them is retention rather than a lazy collector; the samples
in between are left alone, because that is what an operator's tab actually looks
like. The report names its own thresholds and prints what the run can and cannot
prove. A three-minute run can show that nothing grew in three minutes. It cannot
show that there is no leak, and it says so in the output.

## perf-throttle.mjs

**Proves:** what a screen costs under emulated CPU and network conditions — the
question behind section 4's "loads in less than 1 second on the reference
tablet", which a number from an idle dev box cannot answer.

```sh
pnpm ux:perf                                             # slow-4g + 4x CPU, every route (~6 min)
pnpm ux:first-paint                                      # no emulation, FCP per route (~90 s)
node tools/ux-sweep/perf-throttle.mjs --network slow-3g --routes /,/reportes
node tools/ux-sweep/perf-throttle.mjs --network none --cpu 4 --viewport 1024x768
```

Profiles are Lighthouse's own throttling constants (`mobileSlow4G`,
`mobileRegular3G`, `desktopDense4G`), converted to DevTools protocol arguments
with Lighthouse's two adjustment factors, so this throttles the way the standard
audit does. The report prints the profile it used and the file it came from.

| Profile             | RTT     | Down     | Up       | CPU |
| ------------------- | ------- | -------- | -------- | --- |
| `none`              | —       | —        | —        | 1x  |
| `slow-4g` (default) | 562 ms  | 1.6 Mbps | 750 kbps | 4x  |
| `slow-3g`           | 1125 ms | 700 kbps | 700 kbps | 4x  |
| `desktop-dense-4g`  | 40 ms   | uncapped | uncapped | 1x  |

A throttled run measures the **dev server**, which serves the Dashboard as ~100
unbundled modules; those numbers are a floor on the development setup, not the
production load time. Point it at `pnpm build && pnpm preview` to answer the
tablet question for real. `--quick` skips emulation entirely and keeps the same
report shape; that is what `ux:first-paint` runs. Both modes fail the run when a
screen could not render at all (a degraded shell or a 429), because a screen that
did not paint must not be averaged into a load time.

`ux:first-paint` passes `--delay 2500`, a touch tighter than this script's
3000 ms default, because it is the fourth sweep in one `ux:verify` run. The
script's own default stays at 3000 ms.

**Where that cadence comes from.** A Dashboard route load costs about 15 API
requests, so the delay between routes is what decides whether the sweep trips
the 300-requests-per-minute limit. Measured across all 22 routes, one at a time:

| Delay between routes | Requests in the busiest 60 s | 429 responses |
| -------------------- | ---------------------------- | ------------- |
| 1200 ms              | 314                          | 11            |
| 1800 ms              | 296                          | 0             |
| 2000 ms              | 284                          | 8             |
| 2500 ms              | 250                          | 0             |

The 2000 ms row is why the standing sweeps keep 3000 ms and why this one uses
2500 ms: the boundary is noisy, because every client behind the address shares
the bucket, so the loop stays clear of it rather than sitting on the edge.

## trace-flow.mjs

**Proves:** what the renderer did for every millisecond of a real flow, as a
Chrome trace you can open and scroll. Step F6's "a full flow trace".

```sh
pnpm ux:trace
node tools/ux-sweep/trace-flow.mjs --trace --trace-out /tmp/ux/trace-nav.json
```

The flow is `dashboard-nav`: land on the overview, open the Reports group, click
its Sales child, then Orders, then back to the overview. It clicks the real
sidebar, which means it also documents how the sidebar works: a parent group is a
disclosure toggle that never navigates (`shell.jsx`), so the flow expands it
first. The report prints the trace path, its size, its event count, and the top
event names and categories, and says how to open it (`chrome://tracing` →
Load, or `https://ui.perfetto.dev` → Open trace file). A minute-long trace is
tens of megabytes — that is what a DevTools-density trace of a dev server costs.

## trace-screencast.mjs

**Proves:** what a flow _looks_ like, frame by frame, for the changes that are
easier to watch than to tabulate. Step F6's "screen recording".

```sh
pnpm ux:screencast
node tools/ux-sweep/trace-screencast.mjs --screencast --dir /tmp/ux/screencast
```

`Page.startScreencast` yields one image per rendered frame, not a video
container; the frames land in `--dir` and `index.json` carries their timestamps,
byte sizes, and the flow step each belongs to. Frame count tracks repaints, so it
drops when a screen is idle — the report says how many frames it wrote, how long
the flow took, and the effective frames per second.

## perf-lighthouse.mjs

**Proves:** the four Lighthouse category scores for a Dashboard screen, taken
through the browser the sweep already uses, plus the top opportunities sorted by
their time saving. Step F6's "Lighthouse audit over CDP".

```sh
pnpm ux:lighthouse
node tools/ux-sweep/perf-lighthouse.mjs --preset mobile --url http://127.0.0.1:4000/reportes
```

Lighthouse is a real devDependency, not a stub. Given a port it connects to the
running browser instead of launching one, and its default storage reset does not
include cookies or localStorage, so the audit does not sign the browser out. The
report prints the tab count before and after as evidence that the browser
survived. `--preset desktop` is the default because the reference devices are a
tablet and a terminal, not a phone.
