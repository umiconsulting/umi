# Local verification playbook

Everything learned the expensive way about running and _verifying_ Umi on this workstation.
It exists because that knowledge kept living in chat threads and getting re-derived: how to
start each piece, how to drive the real clients, and which traps cost somebody an hour.

Read this before sweeping, before trusting a number, and before concluding that a check
"cannot be run here".

## 1. The local stack

| Piece                                   | Where                                                  | Start it with                                                |
| --------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| Dashboard (Vite)                        | http://127.0.0.1:4000                                  | `pnpm --filter @umi/dashboard dev`                           |
| API                                     | http://127.0.0.1:4001                                  | `cd apps/umi-api && pnpm dev` (that is `nest start --watch`) |
| Postgres                                | 127.0.0.1:4003, DB `umi_transition_rehearsal_20260901` | `docker compose -f deploy/local/compose.yml up -d`           |
| Redis                                   | 127.0.0.1:4004                                         | same compose file                                            |
| Native POS (the real client)            | an X window titled `UmiPOS`                            | `bash tools/ux-sweep/pos-native-launch.sh`                   |
| CDP browser for the dashboard harnesses | http://127.0.0.1:9222                                  | `./scripts/ux-browser.sh`                                    |

**Credentials for the rehearsal data.** Every seeded `@kalalacafe.mx` user shares one password
locally: `Umi2026!` (a shared-hash condition the security gate flags as a real defect — read
it as a local fixture, not as an example). Merchant **Kalala Café**
`1860305f-e864-d745-29e6-fb0830926cc6`; locations **Chapultepec**
`7cb0a615-45e2-7e8e-b756-f95b295ec356` and **Congreso**; the seeded POS operator PIN is `1234`.
Postgres as superuser: `docker exec umi-buildv3-local-postgres-1 psql -U postgres -d <db>`.

**The POS is a native app.** Its web build is a development convenience and is _never_
evidence about the product — see `docs/architecture/2026-09-16-pos-is-a-native-app.md`. Read
that before measuring anything on the POS.

## 2. The commands that prove things

| Question                                                          | Command                    |
| ----------------------------------------------------------------- | -------------------------- |
| Every control, its size, its accessible name, per dashboard route | `pnpm ux:inventory`        |
| Accessibility: zero serious or critical violations                | `pnpm ux:a11y`             |
| Tap and millisecond budgets for the dashboard flows               | `pnpm ux:flows`            |
| Real operator workflows on the **native** POS, with real clicks   | `pnpm ux:pos:native`       |
| Visual regression, pinned viewports                               | `pnpm ux:visual`           |
| Every applicable POS surface, its state and first paint per route | `pnpm ux:verify`           |
| Can a role reach a surface it should not?                         | `pnpm check:role-surfaces` |
| Lint, formatting, migrations, contract checksum, use cases        | `pnpm check:pr`            |

`pnpm ux:verify` and `pnpm ux:a11y` need the CDP browser; start it with
`./scripts/ux-browser.sh` and stop it with `./scripts/ux-browser.sh --stop`. **Do not leave it
running.** It costs ~700 MB RSS, and this box (7.7 GB, and it swaps) feels it — measured
available memory went 1.7 GB → 2.2 GB and swap in use 6.2 GB → 4.7 GB when it was stopped.

### The dashboard is verified in a real browser, with real clicks

**A dashboard front-end claim is proved in the real Chromium that Playwright drives over CDP,
by clicking the workflow — not by a component test, not by reading the JSX, and not by a curl.**
This is a standing instruction from the owner, and it is the same rule the POS already lives
under: the instrument must be the thing the operator runs.

- **The runtime of record** is the Chromium on the CDP port, started with `./scripts/ux-browser.sh`
  (port 9222). Playwright attaches to it (`UX_CDP`) rather than launching its own browser, which
  is why `tools/ux-sweep/playwright.config.mjs` pins `workers: 1` — one browser, one window, one
  signed-in session.
- **Real clicks, then read the result.** Use Playwright's own input (`page.click`, `page.hover`,
  pointer gestures, `page.mouse`) so the events are real; then assert on what the page now shows,
  and take a screenshot as evidence. A DOM assertion alone does not prove a control is reachable
  or that the click did anything.
- **Use the DevTools side of CDP for the performance claim.** A frame-budget or paint claim comes
  from the protocol (`Tracing`, `Performance.getMetrics`, screencast), not from a stopwatch around
  a click.
- **The dashboard needs its dev server too** — `:4000`, already running in a normal session. If it
  is not up, `pnpm --filter @umi/dashboard dev`. `UX_BASE` overrides the target.
- **The same trap as the POS applies**: a screen that looks right in a unit test can be dead in
  the browser. D43 in the plan of record is exactly this — an API read route, an intended console
  screen, and no client — and it was found by reading the screen, not by a test.

### Seeding the room the dashboard draws

**The floor-plan screen draws the LIVE room, and an empty room proves nothing about it.** Every
table draws the same when nobody is sitting down, so a reader that is broken looks exactly like
an idle café. `tools/ux-sweep/table-state-seed.mjs` fills one, so a person or a harness can see
the six contract states on the map.

It writes through the **real POS command routes** (`/api/v1/pos/…/table-state/*`), not with
INSERTs. Seat, clear and the service transitions then run the same transaction, the same command
journal and the same database triggers the till runs, so what the console reads is a room the
product could actually have produced. The one thing it does by hand is the operator session,
because a session is what a sign-in mints and no route mints one for a script.

```sh
node tools/ux-sweep/table-state-seed.mjs                        # T1 seated … T5 dirty, T6/T7 open
node tools/ux-sweep/table-state-seed.mjs --seat T6 --party 4    # one command, to watch a timer
node tools/ux-sweep/table-state-seed.mjs --ordered T6           # also served, awaiting-payment
node tools/ux-sweep/table-state-seed.mjs --merge T6,T7 --party 6
node tools/ux-sweep/table-state-seed.mjs --split T6
node tools/ux-sweep/table-state-seed.mjs --clear T5             # …and --open T5
node tools/ux-sweep/table-state-seed.mjs --reset                # empty the room again
```

- It reads `apps/umi-api/.env` for the database, the JWT secret and the port, so it needs no
  arguments here. `--location <uuid>` and `--base <url>` override the guess; by default it picks
  the location whose plan has the most tables.
- **Seating a party this way writes real rows in the shared rehearsal database.** That is
  intended, and the room you leave behind should be reported. `--reset` removes the rows again.
- **This is the only honest way to get state onto the console.** The console read is read-only
  by design — the till runs the room — so a client-side fixture would prove the screen can draw
  a room the product cannot produce.

### Working a kitchen ticket over HTTP, without the till

**A defect that was found live has to be answered live.** D33 (§8H step 3) was "the kitchen board
cannot be cleared, so it fills up", and it was found by making one real HTTP call and reading the
body. `tools/ux-sweep/kitchen-command-probe.mjs` makes that repeatable: it mints the operator
session a till would hold, picks the **oldest queued ticket the board is showing**, and then walks
the cook's path over the API — the board read, the iPad device route on the same ticket, then the
POS route's start → per-item bump → replay of the same identity → recall → ready → complete —
printing the journal, the item states and the events afterwards.

```sh
node tools/ux-sweep/kitchen-command-probe.mjs              # the API of record on :4001
node tools/ux-sweep/kitchen-command-probe.mjs --plan       # pick and print, write nothing
node tools/ux-sweep/kitchen-command-probe.mjs --base http://127.0.0.1:4013 --ticket <uuid>
```

- **It prints the contract version it is talking to**, because a green probe against a process
  running pre-change code proves nothing. `nest start --watch` has twice compiled the new
  `dist/` and not respawned the child, so `/health` is the first thing to read.
- It **leaves the ticket completed** — that is the point of D33 — and it reuses its own fixed
  furniture rows, so a second run repairs them instead of stacking devices.
- The one refusal it expects is `recall` without `kitchen.recall`
  (`KITCHEN_PERMISSION_REQUIRED`, naming the permission). Everything else must be a 2xx, or the
  tool exits non-zero and says the path is not the one it promises.

### Reading a console route the way a screen reads it

The console's routes authenticate a **browser session**, and no route mints one for a script —
signing in needs a password. What a script can do is everything else a session is: a durable
`runtime.session` row and a signed access token built with the product's own algorithm.
`tools/ux-sweep/inventory-costing-live.mjs` is the worked example, and it has four parts:

1. **A staff row that ALREADY EXISTS.** Do not create one: `staff_merchant_id_user_id_key` refuses
   a second employment for the same person, and the person you want is already on the café's
   staff — that is how you find them. What matters is the role, because the permission a route
   enforces is resolved from the employment:
   `select unnest(umi.resolve_staff_permissions('<staff-uuid>'))` is the whole answer, and a
   merchant's `admin` and `owner` roles are the ones that carry `merchant.manage`. Read that
   before blaming a gate for a 403.
2. **A durable session row** in `runtime.session` with a random `token_hash`. Nothing checks the
   hash on a bearer-token request; the row is what makes the session real.
3. **A token with NO `device_id`.** Same key, same claims as the till's, minus the device — and
   that one absence is what makes `AuthGuard` treat the request as a console session. With a
   `device_id` it becomes a till request, and the console's routes are not the till's.
4. **The real routes, in the real order.** Create the purchase order, send it, receive it — over
   HTTP, so the numbers a screen reads were produced the way a screen's numbers are.

Two details, each worth a 400 of its own: a console `POST` carries its resource id in the **body**
as well as the path (`send` and `receipts` want `purchaseOrderId`), and these routes are
unversioned — only the POS and device surfaces carry `/api/v1`.

What this buys over an integration test: the gate, the merchant scope, the RLS context, and the
serialisation of a `bigint` into JSON. A test that injects the service proves the arithmetic; this
proves the wire.

### Full screen, and one app per workspace

**Every app is worked on full screen.** A windowed app is a smaller viewport, and the viewport
is not a neutral setting: at 1350 x 837 the POS catalogue drew about two tiles and looked like a
defect about the product; full screen at 1920 x 1080 it draws the whole menu. The owner's
standing instruction is to work each app full screen so the instrument sees what an operator
sees.

**The desktop here is three workspaces**, and the apps live one to a workspace so nothing
overlaps and a screenshot is unambiguous:

| Workspace     | What lives there                           |
| ------------- | ------------------------------------------ |
| `wmctrl -s 0` | the Terminal, and the Dashboard's Chromium |
| `wmctrl -s 1` | the native POS (`UmiPOS`)                  |
| `wmctrl -s 2` | free                                       |

```sh
export DISPLAY=:0
wmctrl -l                 # which window is on which workspace
wmctrl -s 1               # show the POS
wmctrl -s 0               # show the Dashboard
wmctrl -i -r 0x02200007 -b add,fullscreen      # by window id, from `wmctrl -l`
xdotool getwindowgeometry 35651591             # verify: 1920x1080
```

`wmctrl` was not installed system-wide either; it went in the same way `xdotool` did, no root:

```sh
cd /tmp && apt-get download wmctrl libxmu6
mkdir -p ~/.local/opt/wmctrl && for d in *.deb; do dpkg -x "$d" ~/.local/opt/wmctrl; done
# then a one-line wrapper on PATH at ~/.local/bin/wmctrl
```

Two consequences worth knowing before you trust a screenshot:

- **A window on another workspace cannot be clicked.** X gives each workspace its own viewport,
  so a click aimed at the POS while workspace 0 is showing lands on whatever is there. Switch
  first, then drive.
- **`xdotool windowactivate` switches for you**, so a driver that activates its target before
  clicking is fine; a driver that assumes the window is already visible is not.
- **The one deliberate exception is a harness that pins a reference viewport.** The visual and
  gesture specs set `1024x768` (café tablet) and `1280x720` (counter terminal) on purpose,
  because the plan measures against that hardware; that resizes the full-screen window for the
  duration of the run. Interactive work is full screen; a pinned viewport is a measurement.

### The till shows no floating notifications, and money screens fit one screen

**Two owner directives, both about the same thing: the screen should not take the operator's
attention away from the customer.** Keep new POS work inside them.

- **No bottom notifications.** There is no `snackBarTheme` in `umi_theme.dart` and there should be
  no `showSnackBar` in `apps/umi-pos`. Nineteen of them were removed, because a bar that slides up
  from the bottom covers the destination bar, sits on top of whatever dialog is open, and steals the
  tap aimed at the button underneath — the sale-complete dialog's "Nuevo pedido" was measurably
  dismissed by the "listo para el siguiente cliente" bar sitting on it. A message belongs where the
  work is: `InlineNotice` in the surface that raised it, or the `AlertDialog` that surface already
  uses. **Deleting the bar is not permission to swallow the failure** — if the bar was the only
  notice of something, it moves, it does not vanish. If a confirmation is genuinely needed, the
  screen should already say it (a cleared search field, a list that changed, a route that moved).
- **A screen the operator works with a customer in front of them fits one screen.** The reference
  viewport is **1280 × 720 logical** (that is what the windowed till renders, and what fullscreen
  scales from), so "it fits" means it fits _there_, not on a 1920 monitor. Three screens failed
  this and were rebuilt side by side rather than stacked: Centro de caja, the blind count, and the
  cash-received tender screen, where the keypad and `Cobrar · MXN 55.00` were below the fold and
  the sweep scrolled three times to reach them. **The pattern is: read on the left, act on the
  right**, and the primary action pinned where it cannot move. Where a policy can add sections the
  operator does not need for the money (tip, discount, receipt, terminal), that side keeps a scroll
  view and the money side does not.

## 3. Driving the native POS

`tools/ux-sweep/pos-native-driver.mjs` is the instrument: it reads the Dart VM service's
semantics tree and clicks with real X input (`xdotool`), and
`tools/ux-sweep/pos-native-flows.mjs` is the workflow suite built on it. Two facts make it
work, and both cost time to learn:

1. **Flutter publishes each semantics node's rect relative to its PARENT.** The PIN key's "1"
   reports `Rect.fromLTRB(0, 0, 144, 84.7)` because it is the first child of its row. Absolute
   coordinates are the accumulated offsets down the tree.
2. **Logical pixels are not screen pixels.** The X window carries client-side decorations and
   its position moves between launches. Read the frame offset, the GTK extents and the header
   height live; a hard-coded origin silently misses.

Tooling needed, none of it installed system-wide: `xdotool` and `x11-utils` were extracted
without root into `~/.local/opt/xdotool` with a wrapper at `~/.local/bin/xdotool`
(`apt-get download xdotool libxdo3 x11-utils && dpkg -x <deb> <prefix>` is the whole recipe);
`ffmpeg` captures the screen (`ffmpeg -f x11grab -i :0 -frames:v 1 out.png`).

### Clicking by hand, without the driver

When you want to look at a screen rather than measure it, this loop is enough and needs no
Node process. It is the fastest way to answer "what does tapping this actually do".

```sh
export DISPLAY=:0
W=$(xdotool search --name "UmiPOS" | head -1)
xdotool windowactivate --sync "$W"
xdotool windowmove "$W" 0 0            # so image coordinates ARE screen coordinates
xdotool mousemove 676 758 click 1      # bottom nav "Mesas"
sleep 2
xwd -id "$W" -silent > /tmp/shot.xwd && ffmpeg -loglevel error -i /tmp/shot.xwd -y /tmp/shot.png
```

Three details make this work:

- **Capture the window, not the screen.** `xwd -id "$W"` records only the POS window, so a
  terminal sitting on top of the desktop cannot hide the evidence. `-f x11grab` grabs the
  whole screen and will hand you a screenshot of your own terminal.
- **Move the window to `0,0` first.** It launches at a negative origin (observed `-35,-3`),
  and a click at the coordinate you measured in the image then lands off-window.
- **Read the PNG before the next click.** The captured image carries a ~37 px left and ~65 px
  top client-side-decoration shadow, so measure the feature in the image and click that same
  number. Clicking blind is how a sweep produces findings about the wrong screen.

**A screen with a live clock breaks the driver's change detection.** `pos-native-driver.mjs`
decides whether a click landed by comparing the tree before and after: nothing changed means the
press was swallowed and is retried; something changed means the press worked and is never
repeated. The table map publishes a **one-second turn timer** (`T1, 4, seated 1 s` → `13 s`), so
the tree changes on its own every second and every click looks effective — including the ones that
did nothing. The symptom is a flow that fails at the click _after_ a step that worked, reporting
"the press had an effect" about a press that had none. **Fixed in the driver**: `fingerprintOf` now passes names and values through a `stableName`
that masks elapsed durations and refresh times, so the clock cannot read as an effect and
`waitSettled` can settle on a room with a party in it. If you see the old symptom again — a flow
failing at the click _after_ a step that worked, with "the press had an effect" — check that the
mask still covers the label the surface publishes; and check the database before believing the
product did anything wrong.

Two more things a 45-step hand sweep learned the hard way:

- **Click with a hover frame, then press and release.** An instantaneous
  `xdotool mousemove X Y click 1` was swallowed — the item was added with a separate
  `mousemove`, `sleep 0.4`, `mousedown 1`, `mouseup 1` and not without one. Whether the
  product has a real focus trap is open (defect D31 in the plan); the harness workaround is
  not optional.
- **Screenshot after every navigation before the next click.** Modals cover the navigation
  bar, full-screen surfaces have no bar at all, and a product panel or checkout sheet
  scrolls — so the control you are aiming at may not be on screen, and a tap aimed from a
  remembered coordinate lands on whatever took its place.

When reviewing many frames, keep the vision cost down: `ffmpeg -vf scale=900:-1` for a whole
window, and `crop` to zoom the one region in question. `convert` and `import` are not
installed on this workstation; `ffmpeg` is the image tool.

## 4. Traps that have already cost somebody an hour

**The API's dev watcher wedges.** `nest start --watch` recompiles `dist` and then does not
always respawn its child, so `:4001` keeps serving old code while your edit sits compiled on
disk. Symptom: a fix "does not work" no matter how many times you re-run it. **One command
answers it now** — `./scripts/api-freshness.sh` compares the running child's start time with the
newest file under `dist/` and prints `FRESH` or `STALE by Ns`, exiting non-zero when stale;
`./scripts/api-freshness.sh --restart` does the only thing that clears a wedged watch, which is
to kill it and start it again. (`UMI_API_DIST` overrides the build directory, which is how the
stale path is tested without touching a live build.) If you would rather check by hand:
`ps -o lstart= -p $(pgrep -f 'dist/main' | head -1)` against the dist mtime.
A failing compile (one was 117 bogus TS7016 errors while the contract package was being
rebuilt underneath it) wedges it hardest — and the count is rising: three separate sessions have
now lost ten minutes each to this, one of them serving pre-change code for ten minutes while the
suite talked to it.

**The API request log records 2xx and 5xx but not 4xx.** Two deliberate 401s produced zero log
lines. Never conclude "there was no auth failure" from the log's silence — that inference sent
one diagnosis down the wrong path for an hour. Ask the client, or the endpoint, directly.

**A fixture against an append-only ledger cannot be cleaned up, so it must own its own ids.**
`stock_ledger_entry` refuses UPDATE and DELETE and a receipt is immutable, so a suite that seeds
stock leaves it behind for good. The failure mode is the nastiest one there is: the FIRST run
passes, the second fails with numbers that are higher but entirely plausible — a napkin count of
600 where the fixture received 200, days of cover of 1243 where the arithmetic said 4 — because
the run measured its own leftovers. Two honest answers, and the choice depends on what is being
asserted. `procurement.integration.ts` uses **before/after DELTAS**, which is right when the
subject is a movement. A costing view's subject is an ABSOLUTE number ("this plate costs 840
centavos"), and a delta cannot express it, so `inventory-costing.integration.ts` derives **a
fresh merchant id per run** (`7e` + six hex characters of a random) and keeps its exact numbers.
Either way, a suite that runs green twice is the only suite whose numbers mean anything.

**`bigint` and `numeric` arrive from `pg` as STRINGS, and a division brings its own scale.**
`sum(...)` over a `bigint` column is a string in JavaScript, and `numeric / numeric` is
`12.0000000000000000` rather than `12`. Parsing either with `Number` silently rounds above 2^53,
which is a wrong cost on a screen. Cast in SQL when the value is integral
(`(a / b)::bigint::text`) and refuse anything that is not an integer in TypeScript — the domain's
`toBigInt` throws on `1.5` and on `12.0000000000000000`, which is how the first version of this
work found the bug rather than shipping it.

**A handful of scripted logins will lock you out.** `POST /api/auth/local/login` allows 20
attempts per 15 minutes per IP, against a process-local map, and every harness that signs in
spends from it. Budget your logins; a 429 on a refresh is what logs the dashboard out.

**The visual gate pins the theme _and_ the locale.** It did not always pin the locale, so an
operator whose preference was `es` failed four baselines that had been recorded in English.
When a screenshot check fails, check the pinned preferences before believing the diff.
The pin is written into the **shared browser profile** with `addInitScript`, so running the gate
also sets the owner's own language and theme to the harness's values and leaves them set.
`localStorage.removeItem('umi.dashboard.locale')` and `removeItem('umi-theme')` put the profile
back, and a harness run should say that it changed them.

**Semantics names are `label:` OR `tooltip:`, and a long label continues on the lines after
the colon.** Reading only same-line labels reported every table on the POS floor plan as
unnamed — a false accessibility defect about the product. When an instrument reports a
suspicious zero or a suspicious failure, read the raw dump before writing a finding.

**`xdotool mousemove --sync` stalls ~15 s when the pointer is already at the target.** Use
plain `mousemove`, read the position back, and verify the pointer before clicking. A card
inside a scroll view needs the wheel over the scrollable (`xdotool click 5`), not a drag.

**The rehearsal database is real, and its cash state can block every sale.** Before blaming a
harness for a `REGISTER_NOT_AVAILABLE` or `CASH_SHIFT_REQUIRED`, look at
`merchant.physical_register` (status, `version`, `current_shift_id`), `merchant.cash_shift`
(holding device, operator session) and `merchant.device.status`. Two defects were found this
way: a register held by a shift whose terminal was gone, and a till that lost its shift id
after an app restart. Sales you drive here write real rows — that is intended, and they should
be reported by id.

**The dashboard's floor-plan screen has a local named `document`, and it shadows the global.**
`const document = preview ? remote?.published : history.present;` in `floor-plan.jsx` is the
PLAN. A `document.addEventListener('visibilitychange', …)` written inside that component
attaches to null and throws on the first render, and the whole route dies with
`Cannot read properties of null (reading 'visibilityState')` and an empty body. Reach the page
from module scope. The shadowing was harmless until a second effect needed the real one, so
this is a trap, not a style point.

**A canvas cannot be masked, so a live number drawn on it makes a flaky baseline.** `maskVolatile`
walks DOM text; Konva draws into a `<canvas>`, so a turn timer — "11 min", then "12 min" — is
invisible to it. Two consequences. The `/floor-plan` baselines are only valid while the room is
quiet. And a real change to the canvas can stay under `maxDiffPixelRatio: 0.02`, in which case
`--update-snapshots` reports "passed" and writes nothing: seven small tables repainted did not
move those baselines at all. **Never read a green screenshot check as evidence that a canvas
change landed** — take a screenshot and look at it.

**This Chromium will not report a hidden tab, so drive the event instead.** `xdotool
windowminimize` reaches `WM_STATE: Iconic`, and a background tab made with `Target.createTarget`,
and both leave `document.visibilityState === 'visible'` — Chrome for Testing 151 on this X11
session does not surface either to the Page Visibility API. Override the getter in the page and
dispatch the real event, then say in the report that you did:

```js
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
document.dispatchEvent(new Event('visibilitychange'));
```

**An effect that arms its own timer must guard the SCHEDULER, not only the read.** A poll loop
whose cleanup sets `cancelled = true` still reschedules from the in-flight read's
`.finally(schedule)`, so every remount — and React StrictMode mounts twice in dev — leaves one
more loop polling for ever. The symptom is exactly double the expected request rate. Guard
inside `schedule()` as well as before the read.

**Stacked `window.fetch` wrappers double every count.** Instrumenting a live page by replacing
`fetch` twice — which is what a re-run against a page you did not reload does — pushes each
request into the same array twice, and the arithmetic then proves a bug that is not there. It
did here: 6 reads in 45 s looked like two poll loops and was one loop counted twice. Reload the
page before instrumenting, or guard the wrapper with a marker.

**A suite that wants a pristine build will lie on the rehearsal clone.** Two targets exist and
they answer different questions: `00_run.sh` builds a database from the DDL alone, while the
rehearsal clone carries production-shaped rows and extra schemas. `sql-preflight.integration.ts`
belongs to the first — pointed at the clone it reported a file this increment never touched as
newly unparseable, and the same run against a fresh build passed with identical coverage
(851 statements prepared verbatim, 6 legitimately uncovered). Before believing a failure,
check the database the suite was written for: `npm run test:integration:schema` says so in its
own header.

**A fresh database is a different test run, not a slower one.** The same integration file
passed on the rehearsal clone and failed three cases on a fresh build — because the clone
already had slack in `stock_balance.in_transit` from earlier runs, and only the empty database
showed that a receipt was being posted twice inside one command. Any suite that moves stock
must be run once against a database built from `docs/migration/build-v3/00_run.sh` before it is
believed. To do it: `createdb`, apply the chain, then
`docker exec -i umi-buildv3-local-postgres-1 psql -U postgres -d <db> -f - < apps/umi-api/test/integration/harness-roles.sql`
(the harness logins are cluster-global, but their GRANTS live inside each database).

**A rebuilt `@umi/contract/dist` can leave a stale ESLint cache.** Right after `pnpm --filter
@umi/contract generate`, `pnpm --filter @umi/api lint` reported 121 errors of the form
`'SaleSnapshot' is an 'error' type` in files nobody had touched; a second run reported none.
Re-run the linter before believing its first answer after a contract build.

**`pnpm ux:visual:update` cannot fix a baseline that still passes.** Playwright's default
`--update-snapshots` mode is `changed`: it rewrites a snapshot **only when the comparison fails**.
A baseline that recorded the wrong state but is close enough to today's render — a mostly-white
screen, a masked region, a 2 percent pixel budget — therefore passes, and the command reports
success while writing nothing. The `reportes` baseline was an _outage_ frame (`OFFLINE · RETRY`,
"The sales report could not be loaded.", empty body) and had been re-recorded that way more than
once, because the screen it was compared against looked similar enough. Use
`--update-snapshots=all` to force a rewrite, or delete the file and let the run write a new one —
and treat "the update reported passed and the file hash did not change" as the tell.

**A mask is only as good as its pattern.** The visual spec masks `[data-ux-volatile]`, which
nothing in the dashboard sets: the attribute is applied at run time by `maskVolatile`, which walks
the text nodes and marks the ones that look time-like (`12:34`, `hace`, `EN VIVO`). Anything
volatile that does not look like a clock — the masthead's connectivity chip reading `Online` or
`Offline · Retry`, a live count — is pinned into the baseline instead. That made `overview` fail on
a transient the screen does not own, and it would freeze "Offline" as the expected render for
anyone who re-recorded during an outage. When you add volatile copy to a pinned screen, check that
the pattern covers it, and remember the screenshot waits for **network idle** rather than for a
fixed number of seconds now: a screen slower than the old two-second sleep was being pinned mid-load.

**The schema-version environment variable is SHARED STATE, and moving it early takes the API
down for everyone.** `EXPECTED_SCHEMA_VERSION` lives in `apps/umi-api/.env` and in two example
files, and the API reports itself `Unready` whenever the database's stamp and that value disagree —
in either direction. On 2026-09-16 a migration landed in the working tree and the three files were
bumped to `build-v3-70` **before** the migration was applied to the shared rehearsal database, so
`/health` answered:

```json
{"status":"degraded","state":"Unready",
 "release":{"expectedSchemaVersion":"build-v3-70"},
 "schema":{"current":"build-v3-69","compatible":false}}
```

Every workstream reads and writes through that API, so one agent's half-finished migration stops
everybody. **Apply the migration to the shared database first, then bump the three files, then
check `/health` is `ok` with both values equal.** And notice how cheap that diagnosis was: the
health body names both versions and says `compatible: false`, so one `curl` answers "why is
everything failing" — read `/health` before you read a log.

**A migration that passes on a fresh database has not been tested.** The same migration failed on
the upgraded database and would have passed on an empty one: a new `CHECK` was violated by 102
pre-existing rows. Build the database from the chain by all means, but **also run the file against
the database that has data in it** — `docs/migration/build-v3/00_run.sh` applies each file with
plain `psql -U postgres -v ON_ERROR_STOP=1 -d <db> -f <file>`, so applying one file to the shared
database by hand is exactly what the chain would do:

```sh
docker exec -i umi-buildv3-local-postgres-1 \
  psql -U postgres -v ON_ERROR_STOP=1 -d umi_transition_rehearsal_20260901 -f - \
  < docs/migration/build-v3/70_tender.sql
```

(`docker exec` runs as root inside the container, so `psql` needs `-U postgres` explicitly or it
looks for a role called `root`.)

**And when a new constraint is violated by rows that are already there, backfill from the data —
do not weaken the constraint.** The same migration added `check (status <> 'succeeded' or
proof_source is not null)`, which is a good rule: no writer may record a success and leave the
question of proof unanswered. The shared database held 102 rows that all violated it, and the fix
was **not** to make the rule optional. Every row already answered the question truthfully in another
column — `method = 'cash'` means the drawer and the count are the proof, stored value means our own
ledger is — so the migration backfills from `method`, and for anything else it records
`operator_attested`, which is the honest description of a success a person read off a screen before
any provider adapter existed. Then the constraint applies to every row, old and new, and the
backfill's `where proof_source is null` makes a second run a no-op. Proven by applying it twice:
`UPDATE 102 / INSERT 0 1` then `UPDATE 0 / INSERT 0 0`, both committing, with `/health` returning to
`ok`.

**"Re-runnable" is not the same promise as "convergent", and both are cheap to measure.** A file can
run twice without error and change nothing — idempotence — while still being unable to repair a
database that has _drifted_ away from what the file believes. `70_tender.sql` keeps only the first
promise in some places and both in others, and the difference is a table drop away from being
testable. Clone the schema, never the data, and ask it directly:

```sh
docker exec -i umi-buildv3-local-postgres-1 pg_dump -U postgres -s -Fp \
  umi_transition_rehearsal_20260901 > /tmp/schema-only.sql
docker exec -i umi-buildv3-local-postgres-1 createdb -U postgres umi_idem_probe
docker exec -i umi-buildv3-local-postgres-1 psql -U postgres -q -v ON_ERROR_STOP=1 \
  -d umi_idem_probe -f - < /tmp/schema-only.sql
```

`-s` is the point: the clone carries every table, constraint, policy and grant and **no customer
rows**, so you can break things in it and re-run the file against it until you know what the file
does rather than what its header claims. Break something, re-run, look. Measured that way, the
answer for `70_tender.sql` is a matrix, not a yes:

| the drift you introduce                                     | repaired by a re-run? | why                                                                                                   |
| ----------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------- |
| a constraint added by a guarded `DO` block                  | **yes**               | the guard asks `pg_constraint` and adds it when absent                                                |
| an index from `create index if not exists`                  | **yes**               | same guard, same reason                                                                               |
| the whole table, dropped                                    | **yes**               | `create table if not exists` builds it complete                                                       |
| a constraint written INLINE in `create table if not exists` | **no**                | the guard is satisfied by the table existing, so the entire definition — checks included — is skipped |

So the rule for a file of this shape: **a change inside a `create table if not exists` block reaches
every fresh database and none of the existing ones.** Once a table exists anywhere that matters, a
new constraint on it has to arrive as its own guarded `alter`, in the `DO`-block style above, or it
will silently apply to nobody who is already running. `70_tender.sql` does this for the attempt
table it widens and does not do it for the table it creates — which was correct only because
`fiscal_document` was new in the same file. The next person to add a check to it inherits the gap.

The no-op claim itself, re-measured on the shared database rather than recalled: a 138-line
fingerprint of columns, constraints, indexes, policies, triggers, grants and RLS flags for both
tables came back byte-identical across a re-run, the attempts' own row fingerprint was unchanged,
and the run reported `UPDATE 0` and `INSERT 0 0` with `/health` still `ok` at `build-v3-70`. Take
the _fingerprint_, not the row count — the shared database is live, and its attempt count moved
from 102 to 103 while these commands ran because the POS suite charged something. A count that
changes is not evidence that your migration did anything, and a count that holds still is not
evidence either.

**And a migration to the shared database is a CODE change, so the process that satisfies it has to
be restarted in the same step.** This one caught me: I applied `70_tender.sql` to the shared
database while the API was serving a build that predated it. The schema and the running code then
disagreed in the one direction `/health` cannot see — the _new_ constraint `payment_attempt_success_provenance_ck`
(a success must name what proved it) refused the _old_ checkout's insert:

```
500 DatabaseError: new row for relation "pos_payment_attempt"
violates check constraint "payment_attempt_success_provenance_ck"
```

The till's charge screen answered _"No fue posible completar el cobro de forma segura."_ with a bare
`Reintentar`, and it stayed that way until the API was running code that populates `proof_source`.
`/health` was `ok` throughout, because both sides agreed on the version — the mismatch was behavioural,
not a version skew, and no gate would have caught it. I found it by running the native POS suite,
which is the argument for running the real client's workflows after a schema change and not only the
migration's own verify step. **Order: make the code compile, apply the migration, restart the process,
then drive the money path — and if the code is not ready, do not apply the migration yet.**

**A stable screen is not a loaded screen, and `waitReady` cannot tell them apart.** The driver's
waits are satisfied by two identical trees, and a loading spinner is the same spinner every frame,
so `waitReady` settles on it happily. Two flows did `waitReady` and then read once, and both
reported product defects that did not exist — _"the till did not recover its own shift"_ and _"the
cash center showed neither an open shift nor an opening-float form"_ — about screens that had not
answered yet. Both wrote a screenshot as evidence, and **both screenshots show the spinner**, which
is the tell: when a flow says a screen lacks something, look at the picture it saved before
believing it. The fix in each case is to poll for a state the screen can actually be in, not for the
pixels to stop moving.

**`windowfocus` does not change which workspace is showing; `windowactivate` does.** The till lives
on workspace 1 here and the terminal and the Dashboard's Chromium on workspace 0, so a driver that
focuses its window without bringing it forward aims every click at whatever the _visible_ workspace
has at those coordinates. The symptom is a flow failing on a screen the app never saw, and the
evidence is unambiguous once you look at it: the failure screenshot of the "cash center" was a
photograph of the **terminal**. `pos-native-driver.mjs` now calls `windowactivate`, then compares
`xdotool get_desktop_for_window` with `get_desktop` and refuses to click rather than clicking blind.

**Resolve a click's coordinates _after_ waiting for the screen, never before.** `clickNode` used to
measure the target, wait for the tree to stop changing, and then click the position it had measured
_before_ the wait. Anything that moves while it settles — a menu opening, a route sliding in — makes
that a position the driver cannot justify, and a wrong position here is not a miss the driver can
detect: `Admin → Bloquear operador` was measured mid-animation and clicked into the backdrop that
replaced it, so the menu closed, nothing happened, and the API log held **no lock request at all**.
When a click's expectation times out, check the server log for the request the click should have
made; "the screen changed, so I must not repeat this" is the driver protecting a money path, and it
is not the same as "the click worked".

**Driving the till by hand is the driver's CLI, not a fresh script.** `node
tools/ux-sweep/pos-native-driver.mjs <click|shot|wait|tree|ready> …` gives you real clicks with the
same settling, coordinate resolution and verification the sweep uses, plus `shot` that captures the
window with `ffmpeg` instead of the whole screen. Two things bite: the names must match what the
surface publishes — the frequent-product chips are `Americano  ·  MXN 55.00` with **two** spaces
around the dot, and a single-space search finds nothing — and `--appears NAME` is the expectation
that decides whether the click counts, so pass the node the click is supposed to produce, not the
one it clicks.

**When a contract row and the code disagree, the live gate decides which one is stale — not the
comment that explains either.** §14 of the plan listed workstream C as done while its own offline
proof had three failures: two rows recorded `refused` for roles the code had since been changed to
allow, and two dashboard modules were gated on a permission no surface measured. The instinct is to
believe the prose — both sides had a confident comment explaining why they were right — and the
thing that settled it was one measurement: `node scripts/umipos-role-surface-gate.mjs` reported
**200** for the roles the contract said were refused. Read the measured status first, then decide
which artefact to change. A stale expectation and a stale comment fail identically, and only one of
them is checked by anything.

**A permission that no surface measures is a permission that only exists in a comment.** The
`customers` and `triage` modules were gated on `customer.read` in the dashboard registry, and
nothing bound either to a route, so nothing tested whether the API agreed. `role-surface-contract`
fails on exactly that, by name, and the fix is to add the row rather than an exemption. When you add
a screen that a role cannot reach, add the surface; the gate then fails if either side drifts.

**A small conflict hunk does NOT mean a small difference — compare the whole file before picking a
side.** `pos-cash.repository.ts` conflicted on one line: `ORDER BY sequence`, which sorts the
cast-to-text output column, so `'10'` lands before `'2'`. Both sides had qualified the column, so
"take theirs" looked like accepting the remote's one-line fix. It is not a one-line operation:
`git checkout --theirs -- <file>` replaces the **entire file**. It silently discarded the ~500
lines the branch had added to that same file (`reclaimRegister`, the register `hold`) and
`pnpm --filter @umi/api typecheck` named them as six errors afterwards. For every conflicted file,
diff **base→ours** against **base→theirs** (`git diff :1:$f :2:$f --stat` vs `:3:`) and compare the
sizes before choosing: where ours is the superset, take ours and hand-apply the remote's real
change. Then prove the resolution — extract every line the remote added
(`git diff <base>:$f origin/build-v3:$f | grep '^+'`) and `grep -F` each one against the resolved
file. That check found a dropped feature no conflict marker named: the incoming
`ventas-report.jsx` imports `useSalesInsight` from `data.jsx`, and taking ours for `data.jsx` had
removed it. Lint and the unit suite did not notice; the Vite build would have.

**Run the schema instruments BEFORE the re-apply step, or you will measure a database that no build
produces.** The CI gate's step order looks arbitrary and the re-apply step is tempting to do first.
It is not interchangeable. `90_rls.sql` **revokes** insert/update/delete on `merchant.kitchen_order`
from `api`, and `47_checkout_kitchen_projection.sql` **grants** insert and update back; `47` sorts
after `90` in `00_run.sh`, so a fresh build ends with the grant in place. The re-apply step replays
`90_rls.sql` **alone**, without `47`, so it revokes again and nothing restores it. Running
`test:integration:schema` after that produced six `permission denied for table kitchen_order`
failures in `table-order.integration.ts` that do not exist against a pristine database. The real
order is: apply from scratch → seed RBAC → harness roles → role provisioning → **schema
instruments** → realtime → DDL freeze → re-apply → security gate. Reproduce it in that order in a
scratch database (`createdb umi_merge_gate2`; superuser as
`docker exec umi-buildv3-local-postgres-1 psql -U postgres`), and drop the scratch database when
you are done. `test:integration:schema` is also the only place a suite listed in
`package.json` runs, so a new integration suite that is not in that list runs nowhere.

**`gitleaks` is not installed here, and CI redacts what it finds.** The `lint` workflow's last step
scans **every ref** (`--log-opts="--all"`), so a clean working tree is not a clean scan, and the log
prints only `leaks found: 1` — the finding itself is redacted on purpose. Install the exact version
the workflow pins, verifying it against that workflow's `GITLEAKS_SHA256`, then reproduce:

```bash
curl -sSLo /tmp/gitleaks.tar.gz \
  https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz
echo "<GITLEAKS_SHA256 from the workflow>  /tmp/gitleaks.tar.gz" | sha256sum -c -
tar -xzf /tmp/gitleaks.tar.gz -C /tmp gitleaks && install -m 0755 /tmp/gitleaks ~/.local/bin/
gitleaks git --no-banner --report-format json --report-path /tmp/gl.json --log-opts="--all"
```

The JSON report gives `RuleID`, `File`, `Commit` and `Fingerprint` without printing the value. The
one finding here was `generic-api-key` on a harness `JWT_SECRET` in `point-refund.integration.ts`, a
fixed and deliberately fake literal. Allowlist a false positive **by exact value, not by path** —
that file's own rule: a path allowlist blinds the scanner to a real credential pasted into the same
file later.

**A hard-coded `webServer` port is not a reason to stop somebody else's server.** The dashboard's
`playwright.config.js` pins `4011` in both `command` and `url`, and this box usually has another
session's process sitting there — on the day of the merge, a day-old `node /tmp/probe/proxy.mjs`.
The config sets `reuseExistingServer: false`, so the run dies before a browser opens. Do not kill
the other session's process; copy the config to `playwright.merge.config.js` with a free port and a
different `outputDir`, run `npx playwright test --config playwright.merge.config.js`, then delete
the copy. That is how all five floor-plan e2e assertions were run against the merged dashboard with
real Chromium clicks and drags.

**An incoming test can encode the other implementation's details.** The floor-plan e2e that arrived
with the remote expected a table button named exactly `T1 · 4`. This branch's list button reads
`T1 · 4 · Libre`, because the board is a canvas and that list is the room in words for a screen
reader — the live state has to exist as text somewhere. Two of five tests failed on the difference
and neither failure said anything about a defect. When an incoming test fails against your
implementation, decide which artifact is stale before editing either: the label is the feature, so
the test changed to match the label-and-capacity prefix and left the state suffix to the tests that
assert on state.

## 5. How to treat a number

- **Quote the artifact, not just the number.** "290 MB" is meaningless; "the native POS debug
  bundle, `flutter run -d linux`, 24 minutes of uptime" is checkable.

- **Measure the client the operator runs.** A dashboard number comes from the browser; a POS
  number comes from the native app. A web-build POS number is not evidence.
  Three defects in this family are now recorded, all of them the instrument's rather than the
  product's: two semantics-parser bugs that manufactured an accessibility failure on the table
  map, a change-detection comparison that a ticking turn timer defeated, and a **control count
  that invented six defects on the kitchen board** — the scrollable list counted as an unnamed
  button, and five rows counted as under 44 px because the dump returned `288x8` for a row a
  screenshot plainly draws at ~50 px while the identical label measures `288x52` elsewhere in the
  same tree. `pos-semantics-inventory.mjs` now separates controls from viewports and reports such
  rects as `unreliableRects` rather than as failures. **When a native measurement reports a
  defect, screenshot the band it names before you believe it.**
- **A false defect is worse than a missing number.** Both "unnamed tables" and "the flow
  failed" have already turned out to be instrument bugs. When the instrument and the product
  disagree, suspect the instrument first — and _verify_, do not assume.
- **A flaky instrument produces false product findings.** If a check fails intermittently,
  root-cause it before reporting either the pass or the failure.
- **Say what the run cannot prove.** A three-minute memory sample is not a leak verdict; a
  single green run is not determinism; a dev-server paint time is not the production bar.

## 6. What the native POS costs in memory

Measured 2026-09-16 on the native Linux debug build, `flutter run -d linux`. This is the number
to quote when someone asks what the till needs, and the number to compare against after a
change.

| Part                                         | RSS                                        |
| -------------------------------------------- | ------------------------------------------ |
| `build/linux/x64/debug/bundle/umi_pos` (app) | **225 MB idle, 302 MB after a full sweep** |
| `dart development-service` (debug tooling)   | 90–100 MB                                  |
| Flutter tool `dartvm` + `dartaotruntime`     | 80 + 15 MB                                 |
| **Whole `flutter run` tree**                 | **310–395 MB**                             |

Two readings, both real, and the distance between them is the point: **225 MB** sitting idle on
the order screen at 24 minutes of uptime, and **302 MB** at 38 minutes after a hand sweep had
walked every destination in the app. Quote the state with the number.

Read it with the process, never from `free`:

```sh
ps -o pid,rss,pmem,etime -p $(pgrep -f 'debug/bundle/umi_pos' | head -1)
```

- The app alone is the only figure that describes a café. The other ~190 MB is the **debug
  instrument** — the VM service and the development service exist because a debug build is
  how the semantics tree is read, and a release build does not run them.
- **A debug reading is not a release reading, and it is not a leak verdict.** A 24-minute
  idle window says what the app costs to sit there; it says nothing about a four-hour
  service. Trend two samples an hour apart before calling anything a leak.
- The workstation this was measured on is small: 7.8 GB of RAM with ~1.8 GB available and
  ~5.6 GB of swap already in use. **Check `free -m` before starting another browser.** A
  headless Chromium attached to the CDP port measured ~700 MB across its process tree, which
  is why `scripts/ux-browser.sh` exists and why the browser is started on demand and stopped
  again instead of being left resident.

## 7. Recovering a document that has no git history

`docs/plans/` is **untracked**. A plan can therefore be lost by a stale editor buffer saving
over it, and there is no `git log` to fall back on. On 2026-09-16 exactly that happened to
`docs/plans/2026-09-15-ultimate-platform-plan.md`: a 142 KB document was replaced by a 27 KB
copy that had been sitting open in an editor.

**The history exists, in the agent transcripts.** Every edit an agent makes is recorded:

```sh
ls ~/.codex/sessions/2026/09/16/rollout-*.jsonl
```

Each line is one event. An `apply_patch` edit is
`select(.type=="response_item" and .payload.type=="custom_tool_call" and .payload.name=="apply_patch")`
and its text is `.payload.input`; a shell command is the same shape with
`.payload.name=="exec_command"` and `.payload.arguments | fromjson | .cmd`. Timestamps are
**UTC** while the session **filenames are local** (`rollout-2026-09-16T14-01-21…jsonl` holds
`21:01:21Z`), which is a seven-hour gap here and an easy way to misread the order of events.

**Replaying the patches alone does not work, and the reason is worth remembering.** A markdown
run was followed by `npx prettier --write` after almost every batch, and prettier re-pads every
table. The next patch's context lines were written against the _formatted_ file, so a replay
that skips the formatting steps fails on hunks whose content is a single space wide — half the
padded table row. 51 patches replayed alone: 10 failures. The same 48 patches with the 22
`prettier --write` runs interleaved in their recorded order: **2 failures, both benign** (one
whose intent a later patch had already reached, one malformed patch that had failed in the
original session too and was retried twelve seconds later). Replay every operation, not just
the interesting ones.

Two traps, both learned by setting them off:

- **`apply_patch` patches hold ABSOLUTE paths.** Rewriting them to a scratch directory does
  nothing if the file path inside the patch is absolute: the replay writes the real file. Copy
  the current file somewhere safe _before_ replaying anything, and check the target path
  inside the patch rather than the path you passed in.
- **Replay changes the mtime and the content of a file a human may have open.** Recovered
  content is not a licence to merge blindly: diff the reconstruction against what is on disk
  and read the difference both ways, because `diff` will show lines the reconstruction lost as
  happily as lines it restored.

The cheap rule that avoids all of it: **before touching an untracked document, copy it.**
`cp plan.md /tmp/plan-$(date +%H%M).md` costs nothing and turns every one of these incidents
into a file rename.
