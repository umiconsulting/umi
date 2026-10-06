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

**Proves:** a style change that moves one of the five representative screens
fails the check, at both reference viewports (1024x768 and 1280x720). Baselines
live in `__screenshots__/`.

```sh
pnpm ux:visual           # compare against the checked-in baselines
pnpm ux:visual:update    # re-record them (only when the change is intended)
```

## accessibility-gate.mjs

**Proves:** axe-core finds no `serious` or `critical` violation on any Dashboard
route; prints the rule id, impact, route, and selector for every one it does
find. POS semantics are a separate harness (F2, not built yet).

```sh
node tools/ux-sweep/accessibility-gate.mjs --out /tmp/ux/a11y.json --md /tmp/ux/a11y.md
node tools/ux-sweep/accessibility-gate.mjs --no-fail   # report without failing
```

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
