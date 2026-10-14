# The offline drill, run on the workstation

Date: 10 October 2026, 20:51–20:59 MST. `docs/pilot/ONCA_OFFLINE_FIRST_DESIGN.md` §7 asks for a
drill "before anyone serves on this package" and says to record the outcome even when it passes.
This is the software half of that drill, on this workstation. The physical half — the drawer, the
printer, the KDS, and the Archer's uplink — cannot be run here, and this report says so rather
than implying it.

## What was run, and how

The till talks to `UMIPOS_API_BASE_URL`. To cut the WAN without touching the local API (which the
POS flow suite and the owner's own session share), the till was pointed at a TCP proxy —
`node -e 'net.createServer(...)'` on `127.0.0.1:4018`, forwarding to the API on `4001` — and the
outage was produced by killing the proxy. The LAN stays up, which is exactly ONCA's failure mode:
the Archer keeps the local network and loses the uplink.

| Step    | Command or action                                                                       | Result                                                                   |
| ------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Launch  | `UMIPOS_API_BASE_URL=http://127.0.0.1:4018 tools/ux-sweep/pos-native-launch.sh --force` | app up, `readyForAuthentication`, `api=http://127.0.0.1:4018` in the log |
| Sign in | driver clicks, PIN of `Caja 1`                                                          | "Comanda" appears                                                        |
| Sale    | frequent chip `Americano · MXN 50.00`, variant `Caliente`, `Agregar a la comanda`       | the comanda reads `Subtotal \| MXN 50.00`                                |
| Outage  | `kill` the proxy (API 4001 keeps serving)                                               | `curl` to `:4018` returns `000` (connection refused)                     |

## The findings, in the drill's own steps

1. **Sell one item online.** Done above: the line is on the comanda for MXN 50.00.
2. **Unplug the uplink, leave the LAN up.** Simulated by killing the proxy. The till keeps
   working: the cart is untouched and the shell stays responsive.
3. **Confirm the till shows `offline`.** It does, and the timing matters: **the state follows the
   requests, not the interface.** A till sitting on the catalog still read `En línea` because no
   call had failed yet; the moment a server-backed screen was opened (`Mesas`), the header read
   **`Sin conexión`**. That is the documented model — `apiFailure()` counts requests, and
   `networkDown()` only fires when the OS says every interface is gone — and it is worth knowing
   before judging the chip on real hardware: make a request, then look.
4. **Sell one item by cash.** **Refused, and that is the correct answer for this café.** The
   payment sheet opened, `Importe exacto` filled the cash received, and pressing
   `Cobrar · MXN 50.00` answered
   **"No fue posible completar el cobro de forma segura."** with `Reintentar` and `Cerrar`. No
   provisional receipt was produced, because `002_onca_onboarding.sql` writes **no**
   `merchant.pos_offline_cash_policy` and the design doc's §6.1 decision is still open. The
   safety property held where it counts: **nothing was written.** `merchant.pos_committed_sale`
   gained zero rows across the whole drill (the newest sale is 17:54 local, from the POS flow
   run).
5. **Confirm the KDS shows nothing new.** Not exercised: the kitchen board is not part of this
   workstation's stack. §5 of the design note stands unverified.
6. **Plug the uplink back.** The proxy was restarted. The chip returned to **`En línea`** and the
   sale was **still there** (`Total | MXN 50.00`) — nothing was lost, and nothing replayed twice.
   The documented two-successes-before-online rule could not be counted from outside the app;
   what is observable is that it does not report online on the interface alone.
7. **The accumulated-amount ceiling.** Not applicable: with no offline cash policy there is no
   ceiling to reach.

## What this does not prove

- **The physical half of the drill.** The drawer pulse, a printed `OFFLINE PROVISIONAL RECEIPT`,
  and the KDS's silence during an outage need the real terminal, printer and drawer.
- **The OS-level path.** `networkDown()` fires in one signal when every interface is gone. This
  run kept the LAN up, so only the request-failure path (`degraded` → `offline`) was exercised.
- **Provisional sales.** With the policy off there is nothing to replay; step 6's "the
  provisional sale replays and maps to a real sale" needs ONCA's §6.1 decision first.

## One observation for the pilot

The refusal message says what happened and not what to do. A cashier reading
"No fue posible completar el cobro de forma segura." has a cart, a customer, and no next step;
the design note's §6.1 decides whether that next step is "take cash offline" or "wait". Worth
settling with the message in hand, rather than after it.

Evidence kept: `/tmp/umi-pos-offline.log` (the app's log, with the API base it booted against),
`/tmp/ux/proxy-4018*.log`, the semantics dumps quoted above, and the driver's shots in
`/tmp/ux/pos-native-shots/`. Screenshots from this window are **black** — the capture is the
frame at the window's coordinates and this compositor did not put the till on the visible
output — so the semantics tree, not a picture, is the evidence here.

## The same drill on the till, 11 October

Run on the iMin (Estación build from this tree) with the demo API. The outage was made by cutting
the device's own path to the API: the app reaches it through `adb reverse tcp:4013 tcp:4013`, so

1. `adb reverse --remove tcp:4013` is **not** enough — the app keeps talking through the sockets it
   already has, and the API kept receiving its polls. Measured: the log of the demo API showed the
   polls continuing after the rule was removed.
2. `adb kill-server` is what cuts it: adbd closes the forwarded connections, and the API's log shows
   the device's polls stopping (last poll 11:17:57, none after).

Findings, with the till signed in, an adopted shift open, and the catalog already on screen:

| Step                                                 | What the till did                                                                            |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| idle for **150 s** with the API unreachable          | the header still read **`En línea`** at every 30 s check                                     |
| three taps on a product, each failing                | still **`En línea`**, and the panel answered `El catálogo no está disponible temporalmente.` |
| tapping a product **without** options (`Cheesecake`) | the same refusal — so no line can be added offline, not just the ones with variants          |
| `adb reverse tcp:4013 tcp:4013`                      | the same tap added the line: `Total MXN 85.00` — the till was never broken, only cut off     |

**Why the label does not move.** `ConnectivityController` is fed by the _context load_
(`catalog_surface.dart`), the kitchen board and the replay engine. The catalog's **product detail**
and the **hardware polls** — the two things an idle till keeps doing — do not report through it, so
an unreachable API with an operator doing nothing but looking at the menu leaves the header reading
`En línea` indefinitely. The design's drill step 3 ("confirm the till shows `offline`") is therefore
only reachable through a screen whose _load_ fails, and on this till **step 4 is not reachable at
all**: the design expects "sell one item by cash" offline with a provisional receipt, and the till
cannot add a line to the comanda while the API is unreachable.

That is a gap between the design and the client, not a fixture problem: the list renders from the
cached catalog, and every tap on a product goes back to the server for its detail. It belongs with
§8.1 of `ONCA_OFFLINE_FIRST_DESIGN.md` (the offline bounds: catalog, pricing and tax freshness),
which is still open — an offline sale needs a price the server has never confirmed, and the design
already says so.
