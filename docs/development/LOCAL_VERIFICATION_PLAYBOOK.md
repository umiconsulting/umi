# Local verification playbook

Everything learned the expensive way about running and _verifying_ Umi on this workstation.
It exists because that knowledge kept living in chat threads and getting re-derived: how to
start each piece, how to drive the real clients, and which traps cost somebody an hour.

Read this before sweeping, before trusting a number, and before concluding that a check
"cannot be run here".

## 1. The local stack

| Piece                                   | Where                                                 | Start it with                                                |
| --------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| Dashboard (Vite)                        | http://127.0.0.1:4000                                 | `pnpm --filter @umi/dashboard dev`                           |
| API                                     | http://127.0.0.1:4001                                 | `cd apps/umi-api && pnpm dev` (that is `nest start --watch`) |
| Postgres                                | 127.0.0.1:4003, the database `DATABASE_URL_APP` names | `docker compose -f deploy/local/compose.yml up -d`           |
| Redis                                   | 127.0.0.1:4004                                        | same compose file                                            |
| Native POS (the real client)            | an X window titled `UmiPOS`                           | `bash tools/ux-sweep/pos-native-launch.sh`                   |
| CDP browser for the dashboard harnesses | http://127.0.0.1:9222                                 | `./scripts/ux-browser.sh`                                    |
| Mail sink (Mailpit)                     | http://127.0.0.1:8025                                 | `docker compose -f deploy/local/compose.yml up -d mailpit`   |

**Credentials for the rehearsal data.** Every seeded `@kalalacafe.mx` user shares one password
locally: `Umi2026!` (a shared-hash condition the security gate flags as a real defect — read
it as a local fixture, not as an example). Merchant **Kalala Café**
`1860305f-e864-d745-29e6-fb0830926cc6`; locations **Chapultepec**
`7cb0a615-45e2-7e8e-b756-f95b295ec356` and **Congreso**; the seeded POS operator PIN is `1234`.
Postgres as superuser: the container that publishes 4003 — `docker ps | awk '/:4003->/'` names
it, today `umi-bv3-pg` — then `docker exec <container> psql -U postgres -d <db>`. The database
names rot: two `db:reset` runs ago the field read `umi_transition_rehearsal_20260901`, and that
database no longer exists. Read the name from `apps/umi-api/.env`, not from this table.

**The mail sink holds every message the API sends.** The password-reset link and the MFA code
arrive at http://127.0.0.1:8025, not in a real inbox. `apps/umi-api/.env` points `SMTP_HOST` at
the sink on port 1025. Without that config the API drops the message and logs
`email_adapter_missing_config`.

**The local café the POS flows need.** `pnpm ux:pos:native` drives seven flows with real clicks.
Six facts must hold in the local database. Without them a flow stops for a reason that is not the
product.

- **A second person holds `cash.reconcile`.** The variance approval joins the acting session with
  `acting.user_id <> s.user_id`, so one operator alone can never close a short drawer. The local
  café holds a `Gerente` with PIN `9999` and a "Gerente" merchant role that copies the Cajero
  permissions (145 of them, `cash.reconcile` included).
- **A published floor plan with tables.** An empty room proves nothing. The tables flows report
  "no tables" without a plan.
- **The register matches the enrolled device.** The register list applies
  `assignment_policy = 'operator_selects' OR assigned_device_id = <this device>`. A register that
  still names an old device keeps "Abrir turno de caja" disabled.
- **One customer exists.** The "open a customer profile" flow needs a row to open.
- **A checkout policy row exists for the location.** The manual terminal and the split come from
  `merchant.pos_checkout_policy`, not from a provider. With no row, the till offers cash only.
  Set `manual_terminal_enabled` and `mixed_tender_enabled` for the tender flows.
- **The window is an X11 window.** The launcher sets `GDK_BACKEND=x11`. On Wayland the app maps no
  X window, and `xdotool` then finds nothing to click.

**The platform administrator.** One account holds the platform role, and that role is the
only way to see every café and switch between them. `pnpm db:reset` grants it to
`hola@umiconsulting.co`. To name a different account, or to repair a database that lacks the
grant, run `scripts/umi-local-platform-admin.sh`. A database with no platform grant shows one
café in the picker and gives no error — the cause is `umi.user_role`, not the account.

**The POS is a native app.** Its web build is a development convenience and is _never_
evidence about the product — see `docs/architecture/2026-09-16-pos-is-a-native-app.md`. Read
that before measuring anything on the POS.

### Secure storage, before the till will boot

The POS fails closed when the platform credential service is absent, and the symptom
names the wrong component. The storage fault is reported as `apiUnavailable`, so the till
stops on the "No pudimos terminar la preparación" card while the API is healthy — and
**not one HTTP request reaches `:4001`**. The app log holds the answer:
`libsecret_error: Failed to unlock the keyring`. **Read the app log before the API log.**

On Linux the credential service is the freedesktop Secret Service. Check the provider,
then round-trip a secret:

```sh
scripts/local-secure-storage.sh                     # the check above, in one command

busctl --user list | grep org.freedesktop.secrets   # must name an owner
printf 'probe\n' | secret-tool store --label=umi-probe app umi-probe
secret-tool lookup app umi-probe                    # must print probe
```

A stopped `ksecretd`, a locked KWallet, or `Enabled=false` in `~/.config/kwalletrc` fails
this check. GNOME Keyring is the supported provider; install and unlock it as
`docs/development/NEW_MACHINE_SETUP.md` says, or run
`scripts/local-secure-storage.sh --install`. The decision and its evidence are in
`docs/architecture/2026-09-28-linux-secret-service-provider.md`.

## 2. The commands that prove things

| Question                                                          | Command                     |
| ----------------------------------------------------------------- | --------------------------- |
| Every control, its size, its accessible name, per dashboard route | `pnpm ux:inventory`         |
| Accessibility: zero serious or critical violations                | `pnpm ux:a11y`              |
| Tap and millisecond budgets for the dashboard flows               | `pnpm ux:flows`             |
| Real operator workflows on the **native** POS, with real clicks   | `pnpm ux:pos:native`        |
| Every control and its size, on the **iMin device** over ADB       | `pnpm ux:pos:device`        |
| Every safe control pressed, on the **iMin device**                | `pnpm ux:pos:device:clicks` |
| The forgotten-password journey, in a real browser                 | `pnpm ux:forgot-password`   |
| Visual regression, pinned viewports                               | `pnpm ux:visual`            |
| Every applicable POS surface, its state and first paint per route | `pnpm ux:verify`            |
| Can a role reach a surface it should not?                         | `pnpm check:role-surfaces`  |
| Lint, formatting, migrations, contract checksum, use cases        | `pnpm check:pr`             |

`pnpm ux:verify` and `pnpm ux:a11y` need the CDP browser; start it with
`./scripts/ux-browser.sh` and stop it with `./scripts/ux-browser.sh --stop`. **Do not leave it
running.** It costs ~700 MB RSS, and this box (7.7 GB, and it swaps) feels it — measured
available memory went 1.7 GB → 2.2 GB and swap in use 6.2 GB → 4.7 GB when it was stopped.

**A palette is a mode, and an unmeasured mode is an unverified one.** Until 2026-10-10 the
accessibility gate only ever ran in English on the default light palette, because that is the
mode the shared browser happened to be in. Auditing the same 24 routes across the themes found
**7 serious contrast violations on `midnight` and 22 on `dark`** — navy ink and the muted greys
were chosen against white and never re-read against black. Both are fixed; four modes measure
0 serious now. Run the gate per mode:

```sh
node tools/ux-sweep/accessibility-gate.mjs --locale es --theme dark
node tools/ux-sweep/accessibility-gate.mjs --locale en --theme midnight
```

### The role-surface gate needs its own database, and one command builds it

`pnpm check:role-surfaces` signs in as the four roles that
`config/umipos-surface-permissions.json` names — cashier, manager, admin and owner at Kalala Café —
and asserts the **measured** status of 22 surfaces: 23 rows that must be refused, 65 that must be
allowed. It refuses to pass a row it could not test, so a database that cannot sign a role in
produces 45 mismatches that are all fixture and none product. The local stack's own database
cannot run it at all: it holds ONCA and the platform administrator, not this café.

Four facts, each of which cost a session:

- **The rehearsal copy is missing three rows, and each one fakes a verdict.**
  `umi_rehearsal_20261006` has the four accounts but not the manager login the contract names, no
  membership of this café for the owner, and **no `pos` entitlement for Kalala Café at all**.
  UmiPOS is sold, not bundled into a public plan (`002_onca_onboarding.sql` writes the override
  for ONCA and says so), so every `@RequireProduct('pos')` route answers 403 `product_not_active`
  for **every** role: a `refused` verdict passes there for the wrong reason, and an `allowed`
  verdict can never pass. The gate cannot tell an entitlement refusal from a permission refusal —
  only the fixture can.
- **Build the copy, then point the API at it.** `pnpm check:role-surfaces:fixture` copies the
  rehearsal data into `umi_role_surfaces_gate` and applies
  `scripts/umipos-role-surface-fixture.sql` (the entitlement, the manager login, the owner
  membership). Add `--yes` to copy the source again and `--serve` to start the API over the copy
  and print the one command that runs the gate. It refuses to touch a database whose name does not
  start with `umi_role_surfaces`.
- **BOTH connection strings must name the copy.** `DATABASE_URL_APP` alone is not enough: the
  login reads its row through `DATABASE_URL_WORKER`, and with only the first one overridden the
  API answers 401 `Credenciales incorrectas` for the three café accounts while the owner — the one
  account that exists in _both_ databases — signs in. Three failures and one success look exactly
  like a drifted fixture, and the cause is the environment. `--serve` sets both.
- **The measured result, 2026-10-10:** 4/4 sign-ins, 88 assertions, 0 failed. That closes the gap
  the 2026-10-09 bug hunt left open in §135, where the contract's verdicts were checked by
  deriving them from `umi.role_permission` rather than by asking the running API.

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

### The forgotten-password journey needs a second API

`tools/ux-sweep/dashboard-forgot-password.mjs` walks what a locked-out person walks: the sign-in
screen, the request view, the message, the link in it, and the new-password form — with real
clicks in the real browser. Two facts about the local stack shape how it runs.

**The account must have a LOCAL credential.** The endpoint answers `201` and sends nothing for an
address it does not know; that is deliberate, so it cannot be used to enumerate accounts. Of the
seeded users only the platform admin (`hola@umiconsulting.co`) can sign in — every `@onca.mx`
account is `invited` with no hash. A walk therefore borrows the admin's credential under its own
address, and deletes it afterwards (the delete cascades to its reset tokens):

```sql
insert into umi."user" (email, full_name, password_hash, password_salt, password_algorithm, status)
select 'prueba-reset@umiconsulting.co', 'Prueba Reset',
       password_hash, password_salt, password_algorithm, 'active'
  from umi."user" where email = 'hola@umiconsulting.co';
```

**The message has to be readable, and the live API sends real mail.** `apps/umi-api/.env` names the
real relay, so the tool must not be pointed at the running API to read the link. Bring up a second
instance on another port with the Mailpit sink as its SMTP host — the two share the database, so a
token minted by one is consumed by the other, and the dashboard keeps talking to the API it already
proxies to:

```sh
cd apps/umi-api && setsid env PORT=4021 SMTP_HOST=127.0.0.1 SMTP_PORT=1025 \
  SMTP_USER=mailpit SMTP_PASSWORD=mailpit node dist/main.js > /tmp/umi-api-4021.log 2>&1 &

pnpm ux:forgot-password -- --email prueba-reset@umiconsulting.co \
  --password 'ClaveNueva2026!' --mint-api http://127.0.0.1:4021
```

The address typed into the visible form is a different thing from the account under test, and the
tool keeps them apart on purpose: the form is driven with `nadie@ejemplo.invalid`, so the request
view is exercised without posting mail to a stranger.

Real delivery is a separate leg, and it is measured in the log rather than in the inbox: an
instance started **without** SMTP overrides uses the real relay, and a send that fails leaves
`reset_email_send_failed` (plus, in development, `reset_link_dev`) in its output. A run on
2026-10-11 walked 11 of 11 steps, and the reset invalidated the previous password (`401` on the old
one, `201` on the new one).

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

**The driver's own screenshots were black rectangles until 2026-10-10, and every report that
quoted one quoted nothing.** `pos-native-driver.mjs` wrote them with `ffmpeg -f x11grab` at the
window's coordinates — a _root window_ grab, and on this compositing session Hyprland does not
draw XWayland clients into the X root window. Every frame came out 9 KB of black while the run
printed `shot <path>`, which is the worst shape a piece of evidence can take. It now captures
with `magick import -window <id>` — the window's OWN pixels, read from the X server — and warns on
the console when a frame is too flat to be a screen. Verify a screenshot by looking at it: if it is
black, the run is wrong, not the till.

**A harness window lives on a workspace nobody is looking at, and the screen never moves.** House
rule, asked for by the owner on 2026-10-10 while a game was running. Three consequences, all
measured:

- **Place it before it maps.** A window mapped while somebody is using the machine lands on _their_
  workspace and takes focus. `pos-native-launch.sh` installs a Hyprland rule first
  (`hl.window_rule({match={class='[Cc]o[.]umiconsulting[.]umi_pos$'}, workspace=N,
no_initial_focus=true})`) and then moves it by pid as a second guarantee;
  `scripts/ux-browser.sh` moves its Chromium by pid with
  `tools/ux-sweep/window-empty-workspace.sh`. Both pick the first workspace with no windows on it.
- **Do not follow the window.** Hyprland's `movetoworkspace` follows what it moves; the first
  version of the browser fix left the operator staring at the harness workspace instead of their
  game. The move is silent (`follow = false`), which is the whole point of a background run.
- **A click at a window nobody is showing is LOSSY, and the flows inherit it.** Measured on
  2026-10-11: four presses aimed at the till's PIN keypad moved its counter by two, while the
  semantics tree answered normally and the app's isolate was healthy (the VM service replied in
  9 ms). The same sequence moves every digit when the workspace is showing. So a desktop flow that
  fails on "the click did not land" while the owner is using the machine has not measured the
  product — `pos-native-driver.mjs` now appends the workspace pair to that verdict, and the device
  pass (`pnpm ux:pos:device:clicks`) is the check that does not depend on who is looking at what.
- **Capture the window, never the screen.** This is why `grim` was wrong here: it reads the
  composited output, which is whatever workspace is _visible_. `magick import -window <id>` works
  for a window nobody is displaying. Verified with the till on workspace 5: the semantics tree
  read, the capture came out 1896x1016 of the real PIN screen, and the operator's workspace never
  changed.

**`no_focus` also means the harness cannot TYPE into the window.** Clicks are pointer events at
screen coordinates and they land on their target whether or not it is focused; keys do not.
`xdotool type` sends to the X input focus, and with the launcher's rule that is _somebody else's_
window — measured on 2026-10-10, when an enrollment code meant for the till went nowhere in the
till. `xdotool type --window <id>` is not the answer either: it delivers synthetic events, and
Flutter ignores them. A typed step (the device enrollment's eight-character code) needs the window
focused at the compositor level, which moves the operator's screen for the duration:

```sh
hyprctl eval 'if umi_pos_workspace_rule then umi_pos_workspace_rule:set_enabled(false) end'
hyprctl eval 'for _, w in ipairs(hl.get_windows()) do
  if (w.class or ""):lower():find("umi_pos") then hl.dispatch(hl.dsp.focus({window=w})) end end'
xdotool type --delay 60 'CODE1234'
hyprctl dispatch "hl.dsp.focus({workspace=\"$OPERATOR_WORKSPACE\"})"   # put it back
```

Do it in one go and restore the workspace immediately. A till that will not take its code by typing
may simply not have focus, not a broken keypad.

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

### The iMin till, over ADB

The counter till that ships is an iMin D3-504 on Android 11, and it is reachable from this
workstation — `adb connect 192.168.1.10:5555`. The screens the café touches are those, so the
device is a first-class verification target, not a port of the desktop walk. Two instruments
drive it: `pos-device-inventory.mjs` (every pressable control, its size and its accessible name,
per surface) and `pos-device-click-pass.mjs` (presses every safe control and reports which press
moved nothing). Both read the labels through `uiautomator dump` and tap with `input tap`.

```sh
adb connect 192.168.1.10:5555
adb -s 192.168.1.10:5555 reverse tcp:4013 tcp:4013      # the demo API the Estación build calls
node tools/ux-sweep/pos-device-inventory.mjs --serial 192.168.1.10:5555 --pin 1111 \
  --out /tmp/ux/imin/inventory.json --md /tmp/ux/imin/inventory.md --shots /tmp/ux/imin/shots
```

**Flutter publishes its accessibility tree only while the platform asks for it, and this device
stops asking.** A `uiautomator dump` then returns a valid root with no labelled children while
the screen renders correctly, and a pass that trusts it mislabels its own results — the first
click pass reported five presses as `gone` about controls that were on the screen. One call
proves the cause:

```sh
adb -s 192.168.1.10:5555 forward tcp:43919 tcp:43919   # the VM URI and its token are in logcat
curl -s "http://127.0.0.1:43919/<token>=/ext.flutter.debugDumpSemanticsTreeInTraversalOrder?isolateId=<id>"
# Semantics not generated … the framework only generates semantics when asked to do so by the platform
```

The APK is AOT, so `evaluate` cannot switch the tree on (`Debugger is disabled in AOT mode`).
**Restart the app and the tree comes back on the first read** — `am force-stop` then `monkey -p
<pkg> -c android.intent.category.LAUNCHER 1`. A pass that walks for more than a few minutes should
re-check that the tree is populated and restart the app when it is not, rather than reporting its
own blindness as a product defect.

Four more facts about this device, all measured:

- **A label can carry a live clock.** A table's accessible name is
  `Mesa 1, 2 lugares, Ocupada, 2 personas, Tiempo 29:42 h`, so a label recorded before a press and
  looked up after it does not match. Mask the timer, or match by position.
- **`selected="true"` is published.** A tab that is already active cannot change the screen; read
  its own state instead of calling the press dead.
- **The soft keyboard is a separate actor.** The tendered-amount field is a real
  `android.widget.EditText`, so tapping it raises Gboard over the lower half of the till.
  `dumpsys input_method | grep mInputShown` says whether it is up, and one `input keyevent 4`
  puts it away before the next tap.
- **The window is 1014 px tall, not 1080 — and its density is 1.375.** The navigation bar takes 66
  device pixels, and 220 dpi makes the app's LOGICAL canvas **1396 x 737**. That is the number a
  widget test has to model: rendering at 1920x1014 _logical_ is half again as tall as the till and
  will report a screen as fitting while the device clips it. That mistake cost this session a
  vacuous test on the sign-in screen at `Muy grande` — the test passed against the broken layout
  until `devicePixelRatio = 1.375` went in, and then it failed exactly as the device did.
- **The pointer floor has two numbers.** The plan's §5.2 says 44, the rubric says 48, and the
  product's own token is `UmiTouchTarget.minimum = 48.0`. Measure both where it matters:
  `node tools/ux-sweep/pos-device-inventory.mjs --control-min 48`. On the iMin both pass today
  (0 controls under 48 px on all seven surfaces).
- **The largest text size is its own layout case.** `Muy grande` is a text scale of 2
  (`PosTextSize.extraLarge` clamps to `minScaleFactor: 2`), and Android's scaler is non-linear, so
  the effective factor at 16 px is smaller than 2 — model it with the linear value the app computes
  rather than the platform's. `apps/umi-pos/test/device_pairing_test.dart` pins the entry screens
  at 100 %, 150 % and 200 %: the action must be inside the window AND tappable where it stands.
- **A press can move the ground the next press stands on.** Tapping an area tab on the room, or a
  filter on the sales list, takes those controls off the screen, and a pass that enumerated them
  first then reports them as `gone`. That is the pass losing its aim, not the till breaking: the
  room switch is the product working. Read `gone` as "re-enumerate", never as a defect.

`uiautomator` coordinates are device pixels and need no window offset, which is the one thing that
is simpler here than on the X11 desktop. Type with `input text` only into a focused `EditText`;
the Flutter keypads on screen are tapped like any other control.

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

**A Wayland launch makes the till invisible to the launcher and to the driver.** On this Hyprland
session a shell carries `WAYLAND_DISPLAY=wayland-1`, GTK3 picks the Wayland backend, and the till
never creates an X window. The till is running the whole time. Measured 2026-09-29 on the same
binary with the same launcher, one variable changed:

- With `WAYLAND_DISPLAY` inherited: `hyprctl clients` reports `class: co.umiconsulting.umi_pos`,
  `title: UmiPOS`, `size: 1920,1080`, while `xdotool search --name '^UmiPOS$'` prints nothing. The
  launcher never sees its window and never prints the success line (killed at a 240 s cap, exit 124;
  its own wait is 300 s).
- With `WAYLAND_DISPLAY= GDK_BACKEND=x11`: `xdotool search` prints `4194307`, and the launcher
  exits 0 with the VM service URL.

So **do not read a launcher non-zero exit as "the till did not start"** — check
`hyprctl clients` first. The X-based driver needs the X11 backend:

```sh
WAYLAND_DISPLAY= GDK_BACKEND=x11 tools/ux-sweep/pos-native-launch.sh
```

A rendering, first-paint or screenshot claim measured on that instance is a claim about X11.
Re-check it under Wayland before you publish it.

Match the **title** (`UmiPOS`) when you script either tool, never the class: the same binary reports
`co.umiconsulting.umi_pos` under Wayland and `Co.umiconsulting.umi_pos` under Xwayland.

**The workspace helper cannot place a window on Hyprland.** `window-workspace.sh` drives `wmctrl`,
and Hyprland does not implement the EWMH calls it uses. The launcher says so —
`window 4194307 exists but the window manager never took it` — and reports `workspace=?`. The till
lands wherever the compositor puts it, so §2's full-screen rule is an instruction to the operator,
not something the launcher enforces. That much comes from the helper's own output, not from the
geometry. **Read the live geometry before you trust a screenshot or a coordinate**, and expect the
box to be driven by hand at the same time as a run: `hyprctl clients` for the viewport,
`xdotool getwindowgeometry <id>` for the X frame.

**Typing into the till on Hyprland needs `ydotool`.** Hyprland publishes no EWMH focus, so
`xdotool` cannot read or set it (`xdo_get_focused_window_sane failed`,
`XGetWindowProperty[_NET_ACTIVE_WINDOW] failed`). Three routes fail the same silent way —
`xdotool type` (no target), `xdotool type --window` (GTK ignores the synthetic event) and `wtype`
(routes to the Wayland-focused surface, and the till is Xwayland). `pos-native-driver.mjs type`
reports `type "TOJIM47V" in 759ms` while the field stays empty. Pointer clicks are unaffected, so
the working combination is: focus with `hyprctl dispatch` in its Lua form, click the control, and
send keys with `ydotool`:

```sh
hyprctl dispatch 'hl.dsp.focus({ window = "address:0x..." })'   # classic `focuswindow pid:` fails on Lua configs
sudo ydotoold --socket-path=/tmp/.ydotoold.sock --socket-perm=0666 &
YDOTOOL_SOCKET=/tmp/.ydotoold.sock ydotool type 'TOJIM47V'
YDOTOOL_SOCKET=/tmp/.ydotoold.sock ydotool key 29:1 30:1 30:0 29:0   # Ctrl+A, to clear a field
```

**An enrollment request is bound to the platform chosen in the Dashboard.** The Add device panel
defaults to Web, and a Linux desktop till claims as `linux`. The claim then fails the repository's
`request.platform !== input.platform` check, and the till shows
`El código de registro no es válido o caducó` — the message for `ENROLLMENT_REJECTED`, which reads
like an expired code and is not one. Set the platform before creating the code, and note that a
rejected claim increments `runtime.device_enrollment_request.attempts` (five and the code is dead).
The claim route is not written to the API request log, so an absent log line proves nothing here.

**`scripts/umi-pos-local-access-seed.sh` replaces the merchant's subscription.** It points the
merchant at the `umipos-local` plan, which carries `pos` and nothing else — so a café that had
`growth` (cash, dashboard) loses the console, and the screen says
`Devices is not active for this café`. Restore the plan and add the product as an override instead:

```sql
update umi.subscription set plan_id = (select id from umi.plan where key = 'growth')
 where merchant_id = '<id>';
insert into umi.entitlement_override (subscription_id, feature_id, enabled, reason)
select s.id, f.id, true, 'local rehearsal' from umi.subscription s
  join umi.feature f on f.key = 'pos' where s.merchant_id = '<id>'
on conflict (subscription_id, feature_id) do update set enabled = true;
```

`tools/ux-sweep/pos-enrollment-probe.mjs` drives the Dashboard half of the enrollment with real
clicks: `inspect` dumps the screen, `register --name <n> [--platform linux]` creates the request and
prints `SETUP_CODE <code>`, `approve` accepts the pending request.

**A person added from the Dashboard has no email, and the till cannot sign them in.** The POS
`pin-login` handler refuses with `OPERATOR_LOGIN_UNAVAILABLE` when `umi.user.email` is empty
(`auth.service.ts`), because a till session needs a user identity. That code is not in the
contract's error union, so `all-exceptions.filter.ts` rewrites the 403 to `PERMISSION_DENIED`, the
till maps that to `operatorPinInvalid`, and the screen says **"El PIN no es válido para esta
sucursal"** for a PIN that is perfectly correct. Team and access collects a name, a phone and a
PIN; it never collects an email. Until the form does, a locally created operator needs one set by
hand:

```sql
update umi.user u set email = 'gerente@example.mx'
 from merchant.staff s where s.user_id = u.id and u.full_name = 'Gerente Local';
```

`tools/ux-sweep/pos-operator-probe.mjs create --name <n> --role Manager --pin 1234` drives the
Dashboard half of this, including the PIN.

**The click pass needs the viewport pinned, or it reports 115 broken controls and clicks
nothing.** `click-audit.mjs` in its `UX_CLICK_CONFIRM=disposable` mode clicks the safe control
on each route. Without `--viewport` the browser keeps its own window size, and the sidebar's nav
items then resolve, call themselves visible and stable, and sit **outside the viewport Playwright
may click in** — so every sidebar click times out with `element is outside of the viewport`,
which reads like a screen full of dead controls. The report is worse than the read: nothing at
all is written, and the API log holds one request for the whole run. `1280x720` is now the
default, because that is the reference viewport the other sweeps pin. Read the run's own
evidence before believing a clean report: **`grep -c '"method":"POST"' ` on the API log is the
proof that a "write pass" wrote something.**

**One session's budget is 240 requests a minute, and every sweep spends from the same purse.**
`operational.interceptor.ts` prices a principal at `LIMITS.user = 240/min`, and each Dashboard
route load costs ~40 of them. A 24-route read sweep is ~1,000 requests, so a second sweep started
inside the same minute is answered 429 — and a 429 renders the same **"could not be loaded"** text
as an outage, which is how a rate limit gets written down as a product failure. `click-audit.mjs`
and `visual-regression.spec.mjs` now pace themselves at three quarters of the budget and say so
in their output; the visual suite also reloads once when a 429 lands anyway, which is why a full
visual run takes about six minutes. Spacing (`--delay 2500`) is not enough on its own: it spaces
routes without bounding the minute.

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
