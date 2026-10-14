# The iMin till, tested again on the device

Date: 11 October 2026, 00:00–01:00 MST. Requested by the owner: test everything on the iMin
package, and report on the two tablets.

This run repeats the walk of `2026-10-10-imin-device-test.md` on the same counter till, adds a
click pass that presses every safe control on the device, and closes two of the defects that
report left open. It also records one measurement trap that cost this run an hour.

## What is reachable

| Device                                       | Role                                | Reachable | How                             |
| -------------------------------------------- | ----------------------------------- | --------- | ------------------------------- |
| iMin D3-504 (`D3`, Android 11, 1920x1080)    | Counter till, holds the cash drawer | **yes**   | `adb connect 192.168.1.10:5555` |
| Galaxy Tab A9+ (`SM-X210`) — the kitchen KDS | Kitchen display                     | **no**    | see below                       |
| Galaxy Tab A11 (`SM-X133`) — the handheld    | Mobile POS / order taker            | **no**    | see below                       |

**The two tablets are not on this network.** The workstation sits on `Megcable_2.4G_CE4F`
(`192.168.1.9/24`, gateway ZTE F680). Measured, twice, an hour apart:

| Check                                          | Result                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| `nmap -sn 192.168.1.0/24`                      | 8 hosts: `.1` gateway, `.2`, `.3`, `.6`, `.7`, `.9` us, `.10` iMin, `.120` |
| `nmap -p 5555 192.168.1.0/24`                  | only `.10` (the iMin)                                                      |
| `nmap -p 30000-49999` on every host that is up | only `.3`, ports 30960 and 49152                                           |
| `adb connect 192.168.1.3:30960`                | `offline` — the port serves UPnP, not `adbd`                               |
| `avahi-browse -artp` (`_adb-tls-connect._tcp`) | no Android device advertises on this LAN                                   |
| `nmcli dev wifi list`                          | a second network, **`Parrot POS`** (WPA2/WPA3, channel 2), is in range     |

`.3` identifies itself as `Portable SDK for UPnP devices 1.6.18 (Linux 3.0.8)`; a Galaxy Tab on
Android 16 runs kernel 6.12, so that host is a router or access point, not a tablet. The most
likely home of the tablets is the `Parrot POS` network, which this workstation is not on and whose
key nobody here holds. Both tablets need either their address on this network with wireless
debugging on, or the `Parrot POS` key.

## The instrument this run adds

`tools/ux-sweep/pos-device-click-pass.mjs` presses every safe control on every surface of the
device and records what happened. It is the device twin of `pos-native-click-pass.mjs`: it reads
the labels through `uiautomator` and sends real touches with `input tap`.

- It **never presses a committing control**. The same three families as the desktop pass are
  classified from the words on the control — money, shift, destructive — and listed in the report
  with the reason instead.
- Its assertion is the weakest honest one: **the screen must not stay put**. A swallowed press
  leaves both the semantics tree and the pixels identical, so both are compared. Zoom buttons move
  no label, and the pixel hash is the second witness.
- A control whose own state says it is already active (`selected="true"`, e.g. the tab you are
  standing on) is not counted as a dead press.

```sh
node tools/ux-sweep/pos-device-click-pass.mjs --serial 192.168.1.10:5555 --pin 1111 \
  --out /tmp/ux/imin/clicks.json --md /tmp/ux/imin/clicks.md --no-fail
```

## Results on the device

### Every surface, measured

`pos-device-inventory.mjs`, signed in with the demo PIN `1111`:

| Surface | Pressable | Under 44 px | Under **48 px** | Unnamed |
| ------- | --------- | ----------- | --------------- | ------- |
| Comanda | 28        | 0           | 0               | 0       |
| Caja    | 13        | 0           | 0               | 0       |
| Ventas  | 15        | 0           | 0               | 0       |
| Mesas   | 17        | 0           | 0               | 0       |
| Cocina  | 12        | 0           | 0               | 0       |
| Pedidos | 9         | 0           | 0               | 0       |
| Ajustes | 20        | 0           | 0               | 0       |

The last column matters because the plan's §5.2 names a 44 px floor, the rubric names 48, and the
product's own token is `UmiTouchTarget.minimum = 48.0`. `pos-device-inventory.mjs` documented a
`--control-min` flag that did not exist, so the walk could only ever report the 44 figure; the flag
is implemented and the whole walk was re-run at 48. **Both floors pass, and no control sits in the
44–48 band on these screens.**

### Every safe click, pressed

Eleven screens (seven surfaces and the four inner modes). 49 presses, **0 broke the app, 0
exceptions in `logcat`**, 4 that moved nothing:

| Screen                      | Pressed | Moved nothing | Left alone (committing) |
| --------------------------- | ------- | ------------- | ----------------------- |
| Comanda                     | 6       | 1             | 0                       |
| Caja                        | 2       | 0             | 4                       |
| Ventas                      | 6       | 0             | 0                       |
| Ventas → Ventas suspendidas | 4       | 0             | 1                       |
| Ventas → Ventas canceladas  | 4       | 0             | 0                       |
| Mesas                       | 6       | 1             | 1                       |
| Mesas → Ver lista           | 6       | 1             | 0                       |
| Cocina                      | 3       | 0             | 2                       |
| Cocina → Preparación        | 4       | 0             | 0                       |
| Pedidos                     | 2       | 1             | 0                       |
| Ajustes                     | 6       | 0             | 0                       |

The four that moved nothing are all the same shape, and none is a defect: `Actualizar` (a refresh
with no new data), `Nueva venta` on an empty cart, and a mode tab pressed while that mode is
already open. The report lists them so a reader can see the judgement.

Five presses were aimed at controls that had left the screen between the enumeration and the
press, and the reason is the pass's own doing, not the till's:

| Control that left the screen                             | Why                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `Referencia del recibo`, `Acciones de la venta` (Ventas) | an earlier press changed the sales filter; those controls belong to a completed sale card  |
| `Mesa 1`, `Mesa 2` (Mesas)                               | an earlier press switched the room from `Salón` to `Terraza`, which is the product working |
| `Español` (Ajustes)                                      | the language row needs a scroll, and the pass re-entered the page at the top               |

The instrument reports these as `gone`, not as defects, for that reason. A pass that presses more
than a few controls per screen can lose its aim this way; the count is the honest measure of it.

The table above is the run of 08:52 UTC, and two fixes landed in the instrument after it, both
measured on the device:

1. **A control is a label AT A POSITION.** Ajustes carries three controls called
   `Seguir al sistema`; deduplicating by label pressed the first of the three and never the others.
2. **The pass puts the terminal back.** Theme, text size, language and motion live on the device,
   so pressing them leaves the till dark and huge for the next person. The pass now records what
   was selected when it reached each screen and presses it again at the end — verified on Ajustes
   (`…/pos-device-click-pass-ajustes-restore.md`, "restored 2 preference(s)") and on Mesas
   (`…/pos-device-click-pass-mesas.md`).

Evidence: `evidence/2026-10-11-imin-device-retest/pos-device-click-pass.md` and
`…/pos-device-inventory.md`, with a screenshot of each surface in `…/surfaces/`.

### The money path, with real taps

Comanda → `Latte` → `Chico` → scroll → `Leche entera` → `Agregar a la comanda` → `Enviar`, then
`Cheesecake` added from the catalog → `Cobrar`:

| Step                      | What the till showed                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Cobrar`                  | `Cobrar pedido`, `TOTAL MXN 150.00`, `Efectivo recibido 150.00`, quick amounts                                                      |
| `Efectivo`                | the tendered field enables, `Cambio MXN 0.00`                                                                                       |
| `MXN 200.00`              | `Efectivo recibido 200.00`, **`Cambio MXN 50.00`**, total still `MXN 150.00`                                                        |
| `Cobrar`                  | `Pagado MXN 150.00`, `Cambio a dar MXN 50.00`, `Recibiste: 200.00 · Consumo: 150.00`                                                |
| `Ver comprobante`         | `Recibo · UmiPOS Local · Sucursal Local · POS-b8008e51-…`, Latte + Cheesecake, `Subtotal 150.00`, `Impuestos 20.69`, `Total 150.00` |
| `Nuevo pedido` → `Ventas` | `Latte +1 · MXN 150.00 · 00:39 · Completada · Cliente anónimo`                                                                      |

The database agrees: `merchant.pos_committed_sale` `08472883-68bf-4b42-9d49-79dbf2fa78eb`, cart
`7a52f5f2-0e4c-4fe8-a6fd-a5549f5f3398`, shift `7bbbfd9b-c19b-4c90-8502-4421f6a824d8`.

**The tender field no longer overwrites the total.** The owner's complaint about the old design —
typing the tendered amount replaced the original figure — does not reproduce here: `TOTAL` is a
read-only panel, the tendered amount has its own field (`Efectivo recibido`, an Android
`EditText`), and the change is derived from the two. A tendered amount that is not a valid number
is refused with `Escribe un monto válido, por ejemplo 1.500.00.` The taxes are arithmetic-correct
for 16% included: `65.00 → 8.97`, `150.00 → 20.69`.

### The kitchen path, end to end

`Enviar` answered `Enviada a cocina` and wrote `merchant.kitchen_order` `3bb6eddf-…` with
`status = queued` and a resolved route
(`routeId 0a2bad7a-…`, `stationId 62000000-…-026`). The Cocina board on the till showed the ticket
under `Comandas`; `Empezar` moved it to `En preparación`; `Marcar Latte como listo` set the row to
`ready`. The route fixture from the previous report still holds. Evidence:
`…/cocina-ticket.png`.

### Restart recovery

`am force-stop` mid-session, then relaunch. The app came back to
`phase=readyForAuthentication api=http://127.0.0.1:4013` and the keypad, then signed in. The
desktop defect from the previous report — a sale-error banner in place of `Ingresa tu PIN` — did
not reproduce on the device.

### Appearance and language

All three appearance settings, both languages, and the motion toggle were exercised. The switch to
English translates the whole shell, including the sign-in screen (`Enter your operator PIN`,
`Continue`). Evidence: `…/ajustes-english.png`, `…/pin-english.png`. The device was left as it was
found: Spanish, `Seguir al sistema`, normal text, sign-in screen.

## Defects this run found or confirmed

### 1. The soft keyboard stays open on `Pagado` — **fixed and verified on the till**

`dumpsys input_method` reported `mInputShown=true` on the result screen, and Gboard covered the
lower 40% of the till for as long as it stayed (screenshot `…/paid-keyboard.png`). The source fix
that was in this branch (unfocus the field when a payment commits) turned out not to work when it
was finally measured on the hardware: the field that raises that keyboard is the **catalog's search
field**, put back in focus by the "ready for the next customer" feedback as the sale commits, and
Android answers a focus change with an asynchronous `showSoftInput` — so a hide from the receipt
screen loses the race. The cause was named with a temporary instrument, the fix waits for that
answer, and the shipping build now measures `mInputShown=false` on `Pagado`. The whole trail is in
`2026-10-11-imin-keyboard-stays-open.md`.

### 2. The largest text size pushes `Continuar` off the sign-in screen — **fixed in source**

With **Ajustes → Tamaño del texto → `Muy grande`**, the sign-in screen collapses to a single
centred column, the last keypad row is clipped by the window edge, and `Continuar` leaves both the
screen and the semantics tree — the node is absent until the operator scrolls. Evidence:
`…/pin-muygrande.png` against `…/pin-restored.png` on the same device in the same minute. An
accessibility setting the product offers makes sign-in impossible for anyone who cannot scroll,
which is the person the setting exists for.

**Reproduced off the device, then closed.** The reproduction had to start by modelling the till
correctly: 1920x1080 device pixels at 220 dpi is a device pixel ratio of 1.375, so the app's
logical canvas is **1396 x 737** once the navigation bar takes its 66 pixels. A widget test that
renders at 1920x1014 _logical_ is half again as tall as the till and reports this screen as
fitting — which is exactly what the first version of the test did, and why it passed against the
broken code.

| Measured, logical pixels, window 737 tall | action bottom, before  | after |
| ----------------------------------------- | ---------------------- | ----- |
| 100 % text                                | 643.7                  | 643.7 |
| 150 % (`Grande`)                          | **746.0 — off screen** | 640.2 |
| 200 % (`Muy grande`)                      | **829.0 — off screen** | 705.0 |

The defect started at `Grande`, not only at `Muy grande`. The fix spends the entry screens' rhythm
and not their content: the outer margin, the gaps between blocks and the space between keypad rows
shrink, and the keys go from 68 to 60 px at the largest size — still well above the 48 px floor the
product's own `UmiTouchTarget.minimum` names. The station signature stays, because a test pins it
at 200 % and an operator on a shared counter has to know which terminal they are on.

`apps/umi-pos/test/device_pairing_test.dart` now asserts, for the sign-in screen and the enrolment
screen, at 100 %, 150 % and 200 %, that the action is inside the window **and** tappable where it
stands. Verified both ways: the test fails against the previous layout and passes against this one.
The same question was asked of the money path at the same geometry — `Enviar`, `Vaciar` and
`Cobrar` at 200 % text on 1396 x 737 — and there the layout holds in both locales
(`test/cart_layout_test.dart`, "cart actions stay on the till screen at 200 %"). The POS suite is at
**682 tests**.

**Confirmed on the hardware on 11 October**: with the rebuilt APK installed, the sign-in screen keeps
`Continuar` on screen at 200 % and a full sign-in at that size works (see
`2026-10-11-imin-keyboard-stays-open.md` for the build recipe).

### 3. The kitchen card names the cart, not the order

The board titles each ticket `pos-cart:7a52f5f2-0e4c-4fe8-a6fd-a5549f5f3398`. A cook cannot read
that, and it is the same string the customer's receipt shows as `POS-b8008e51-…`. A short ticket
reference, or the table and the first line, is what the surface needs.

### 4. Fixed since the last report

- The route fixture holds: a fire resolves a route and a station, and the board shows the ticket.
- The tender sheet separates the total from the tendered amount, and computes the change.
- The money path commits, and `Ventas` reads `Completada`.

## The measurement trap, so it does not cost the next hour

**Flutter builds its accessibility tree only while the platform asks for it, and on this device it
stops asking.** After the till had been running for a while, `uiautomator dump` returned a valid
root with no labelled children — an empty tree for a screen that was rendering correctly. The
Dart VM service says so in one call:

```sh
curl -s "http://127.0.0.1:43919/<token>=/ext.flutter.debugDumpSemanticsTreeInTraversalOrder?isolateId=<id>"
# Semantics not generated for Instance of '_ReusableRenderView'. … the framework only generates
# semantics when asked to do so by the platform.
```

Two consequences:

1. **A pass that reads an empty tree mislabels its own results.** The first click pass reported
   five presses as `gone` — a defect in the instrument, not in the till. The harness now waits for
   a readable tree; restarting the app restores one immediately (the restart-recovery step above
   did it).
2. **`evaluate` cannot force it.** The APK is AOT (`Debugger is disabled in AOT mode`), so the
   semantics tree cannot be switched on from the VM service. The reliable sequence is: restart the
   app, then walk.

The device also exposes the Dart VM service (`adb forward tcp:43919 tcp:43919`, and the token is in
`logcat`), which is a better read path than `uiautomator` for a development build.

## Still open

1. **The two tablets**: their address on this network with wireless debugging on, or the
   `Parrot POS` key. Without one of those, the KDS tablet and the handheld cannot be tested here.
2. ~~Rebuild and install the APK~~ — **done** on 11 October. The Estación APK was rebuilt from this
   tree, installed with `adb install -r` (same signing key, so the device kept its registration and
   its data), and both the keyboard (defect 1) and the large-text layout (defect 2) were verified on
   the hardware. The build recipe is in `2026-10-11-imin-keyboard-stays-open.md`.
3. **The printer and the cash drawer.** The Epson TM-T20III is not on the network, so the receipt
   print and the drawer pulse remain unproven. Section 7 of `ONCA_OFFLINE_FIRST_DESIGN.md` is the
   drill.
4. **The `pos-cart:` identifier on the kitchen board** (defect 3) needs a product decision.
5. The desktop till flows (`pos-tables-merge-split`, `pos-restart-recovery`) were **not** re-run
   this session. The desktop harness clicks at screen coordinates, and the owner was playing: a
   click aimed at a window on a hidden workspace lands on the visible one. The device evidence
   above covers the same journeys on the hardware that ships.
