# The iMin till, tested on the device

Date: 10 October 2026, 22:30–23:00 MST. Requested by the owner: walk everything on the physical
package — the iMin D3-504 counter till and the two tablets.

## What is reachable, and what is not

| Device                                            | Role (`UMIPOS_SITE_DEVICE_INVENTORY.md` §1) | Reachable now | How                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iMin D3-504 (`D3`, Android 11, SDK 30, 1920x1080) | Counter POS / till, holds the cash drawer   | **yes**       | `adb connect 192.168.1.10:5555`                                                                                                                                   |
| Galaxy Tab A9+ (`SM-X210`)                        | Kitchen display                             | **no**        | not on this LAN with debugging: `nmap -p 5555 192.168.1.0/24` and `192.168.3.0/24` find only the iMin, and `adb mdns` is not supported by this adb build (1.0.41) |
| Galaxy Tab A11 (`SM-X133`)                        | Mobile POS / handheld                       | **no**        | same                                                                                                                                                              |

Everything below is the iMin. The tablets need their addresses, or their wireless debugging turned
on while they are on this network.

## CORRECTION: the app was never misconfigured

An earlier version of this report concluded that the Estación build pointed at itself
(`api=http://127.0.0.1:4013`) and needed a rebuild. **That was wrong, and the correction matters
more than the original finding.** The demo environment is deliberately built that way and reached
through ADB, as `docs/reports/2026-10-09-imin-design-comparison.md` says in its own words:

```sh
adb -s 192.168.1.10:5555 reverse tcp:4013 tcp:4013
```

That tunnel forwards the device's own `localhost:4013` to this workstation's API on 4013
(`umi_pos_estacion_design_20261008`). It dies whenever the ADB connection is reset, and the app
then reports `phase=recoverableFailure category=apiUnavailable` **with no message on screen**: the
keypad fills, `Continuar` clears it, and a cashier would retry the PIN forever.

The mistake had two parts, and both are worth keeping:

1. **I read the wrong server's log.** The device calls the API on 4013; I checked the log of the
   API on 4001, found no `pin-login`, and concluded the request never left the device. The 4013 log
   (`/tmp/umi-api-estacion-N19-restored.log`) holds the `POST /api/v1/auth/pos/pin-login → 201`
   lines that disprove it.
2. **I had not read the demo environment's own note**, which names both the port and the PIN.

Measured, with and without the tunnel:

| State           | The app's own bootstrap line                                                 |
| --------------- | ---------------------------------------------------------------------------- |
| Tunnel missing  | `phase=recoverableFailure category=apiUnavailable api=http://127.0.0.1:4013` |
| Tunnel restored | `phase=readyForAuthentication api=http://127.0.0.1:4013`                     |

The device-side check is one line and belongs before any conclusion about the client:

```sh
adb -s 192.168.1.10:5555 shell "echo -n '' | toybox nc -w 3 127.0.0.1 4013"
```

## The iMin, measured

| Fact           | Value                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Apps installed | `co.umiconsulting.umi_pos.estacion` (new design) and `co.umiconsulting.umi_pos.anterior` (old design), both 0.1.0                      |
| Sign-in        | PIN `1111` — the demo operator's, not the local café's `4321`                                                                          |
| Palette        | **light** on this device; the POS follows the system theme                                                                             |
| Accessibility  | Flutter publishes its semantics to Android: `uiautomator dump` returns every label with its rectangle, and `input tap` drives the till |

The surface inventory, taken on the device itself (`pos-device-inventory.mjs`):

| Surface | Pressable | Under 44 px | Unnamed |
| ------- | --------- | ----------- | ------- |
| Comanda | 28        | 0           | 0       |
| Caja    | 13        | 0           | 0       |
| Ventas  | 14        | 0           | 0       |
| Mesas   | 17        | 0           | 0       |
| Cocina  | 10        | 0           | 0       |
| Pedidos | 9         | 0           | 0       |
| Ajustes | 20        | 0           | 0       |

Zero under the floor, zero without an accessible name, no Dart exception in `logcat`.

## A real flow, end to end, on the device

The owner asked for a sale path, so it was driven by real taps:

1. **Comanda → Latte · MXN 65.00.** The product panel opens with `Variantes` (Chico / Mediano /
   Grande), `Modificadores` (Jarabes) and — **below the fold** — `Tipo de leche · Requerido`
   (Leche de avena / deslactosada / entera).
2. Choosing a variant is **not enough**, and the panel says so: _"Completa las opciones obligatorias
   para continuar."_ The button stays disabled until the milk is chosen. That message is honest and
   the required group is reachable — by scrolling.
3. After `Mediano` + `Vainilla` + `Leche entera`, `Agregar a la comanda` enables and the cart reads
   `Latte, 1 Latte Mediano · Leche entera · Vainilla MXN 83.00`, `Subtotal MXN 83.00` (65 base +
   10 for the size + 8 for the syrup), taxes included 11.45.
4. **`Enviar`.** The line is marked `Enviada` and `POST …/orders/fire` answers **201**.

## The kitchen path: a fixture gap, then a working board

The first fire created `merchant.kitchen_order` `ec31b75e-…` with **`status = exception`**, and its
`route_snapshot` explains why:

```json
[{ "lineId": "659ca4fd-…", "routeId": null, "stationId": null }]
```

No route and no station, so the ticket cannot be shown on a kitchen board — and the Cocina surface
on the till answered **"Sin comandas en cocina."**

**The cause was a fixture gap, not a client defect.** The demo database
(`umi_pos_estacion_design_20261008`) had **no kitchen routes for its own merchant** — both rows in
`merchant.kitchen_route` belong to ONCA (`e6b14af1-…`) and its location, not to the demo merchant
`10000000-…-101` that the device's tickets use, even though that merchant has a station
(`Estación N26`, `62000000-…-026`). One catch-all route, the same shape ONCA carries, closes it —
and it needs that station to exist first:

```sql
insert into merchant.kitchen_route
  (merchant_id, location_id, product_id, category_id, station_id, requires_preparation, route_priority, active)
select '10000000-0000-4000-8000-000000000101', '20000000-0000-4000-8000-000000000101',
       null, null, s.id, true, 100, true
  from merchant.station s
 where s.merchant_id = '10000000-0000-4000-8000-000000000101' and s.name = 'Estación N26';
```

Neither the station nor the route comes from the repository's own tooling: `scripts/umi-pos-demo-seed.sh`
seeds that merchant's catalog, policies, registers, devices and staff, and writes **no station and
no route**, so both were added by hand while the Estación work ran. A rebuild of the demo database
loses them, and the kitchen path goes back to `exception` tickets. Whoever makes that fixture
reproducible should write both statements into the seed, the way `002_onca_onboarding.sql` writes
ONCA's two stations and its routes.

Re-tested on the device, with a **new sale** (`Nueva venta` → the app warns that two unbilled lines
would be abandoned, and asks — `evidence/…/25-where-am-i.png`): Latte → `Chico` → `Leche entera` →
`Agregar a la comanda` → `Total MXN 65.00` → **`Enviar` → "Enviada a cocina"**, and this time:

- `merchant.kitchen_order` `375862ce-…` has **`status = queued`**;
- the Cocina surface shows the ticket: **`Tiempo 1 · 1× Latte · Hoy: 1 · Chico · Leche entera`**
  with `Empezar` and `Marcar Latte como listo` (`evidence/…/27-cocina-ticket.png`).

The POS → KDS path works on the real till.

## The product finding that remains: a fire that routed nowhere still reads `Enviada`

With the route missing, `POST …/orders/fire` answered **200/201 with `ok: true`** — the same answer
as a good fire — and the till said `Enviada`. Nothing in the response or on any screen said that
the item had no station; the only trace was the `exception` row in the database, which no POS
screen shows. A cook and a cashier would disagree about whether the order was placed.

The fix has to start in the contract, and that is why it is written here rather than patched:
`FireOrderResult` (`apps/umi-api/src/modules/pos-cart/pos-cart.service.ts:283`) carries `cartId`,
`cartVersion`, `orderId`, `reference`, `lineCount` and `firedAt` — and nothing about routing. The
service knows at that moment which lines resolved to `routeId: null` (it writes exactly that into
`route_snapshot`). Returning the unrouted line ids, or the kitchen order's status, would let the
till say `Enviada · 1 sin estación` instead of `Enviada`.

## The money path, on the device

The same cart was then charged, with taps only:

| Step                          | What the till did                                                                                                                                              | Evidence                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `Cobrar`                      | the tender sheet: `Selección de pago · Dividir el pago · Efectivo · Terminal manual · Importe exacto · Propina · Sin propina · Cobrar · MXN 65.00`             | `…/28-tender-sheet.png` |
| `Efectivo` → `Importe exacto` | `Cambio` appears; the tendered amount filled                                                                                                                   | —                       |
| `Cobrar · MXN 65.00`          | **`Pagado` · `MXN 65.00` · `Recibiste: MXN 65.00 · Consumo: MXN 65.00`** with `Ver comprobante` / `Nuevo pedido`                                               | `…/29-after-charge.png` |
| `Ver comprobante`             | the receipt: `Sucursal Local · Fecha operativa: 2026-10-11 · Latte Chico Leche entera 1 × MXN 65.00 · Subtotal MXN 65.00 · Impuestos MXN 8.97 · Total`         | `…/30-receipt.png`      |
| `Nuevo pedido` → `Ventas`     | the sale as **`Latte MXN 65.00 · 23:10 · Completada · Cliente anónimo`**, and the abandoned comanda beside it as **`Latte +1 MXN 128.00 · 23:06 · Cancelada`** | `…/31-ventas-list.png`  |

The database agrees: `merchant.pos_committed_sale` `6d3c50b7-…` committed at
`2026-10-11 06:10:59Z` on shift `7bbbfd9b-…`.

**Two small things the device shows that the desktop cannot.** First, the soft keyboard stays open
on the `Pagado` screen after the charge, taking the lower half of a 1920x1080 till
(`…/29-after-charge.png`); it should close with the payment, and on the counter terminal it covers
the very area the next action sits in. Second, an abandoned comanda is not lost silently: the till
asks before starting a new sale (`¿Empezar una venta nueva? … Se abandona y empieza una venta
vacía`) and records the old one as `Cancelada` — both correct, and both only visible here.

Evidence: `evidence/2026-10-10-imin-device-test/17-cart-with-latte.png` (the cart),
`…/19-cocina-board.png` (the empty board before the route existed), `…/16-panel-scrolled.png` (the
required milk group below the fold), `…/26-new-sale-fired.png` and `…/27-cocina-ticket.png` (the
working path after it).

## The instrument this leaves behind

`tools/ux-sweep/pos-device-inventory.mjs` drives a device over ADB: per screen it records the
pressable nodes with their sizes, the ones under the 44 px floor, the ones with no accessible name,
a screenshot of the device's own pixels, and the app's exceptions from `logcat`. It clears the
keypad before typing a PIN and reports whether every digit landed, and it starts from wherever the
till is when it is already signed in.

## Still open on this package

1. The two tablets: addresses, or wireless debugging on this network.
2. **Make the route fixture permanent.** The catch-all route above was inserted by hand into the
   disposable demo database; a rebuild of that database loses it. The seed that builds it should
   write the route, the way `002_onca_onboarding.sql` writes ONCA's.
3. **Decide the contract change** in the finding above, so a fire that routed nowhere cannot read
   as a success on the till.
4. **Dismiss the soft keyboard when a payment commits**, so the result screen is not half covered
   on the till's own display.
5. The cash drawer, the printer and a real KDS on the A9+ — the site drill in §7 of
   `ONCA_OFFLINE_FIRST_DESIGN.md` remains the only thing that can prove those.
