# Cash centre — vendor documentation, independent forums, and screen evidence

- Date: 2026-09-29
- Question: how do the reference POS systems document and show the operator
  cash centre, and what do independent users say about it?
- Companion: [Centro de caja — the till cash centre: behaviour, market, and
  architecture](../design/2026-09-29-centro-de-caja-till-deep-design.md).
- Consolidated into: [Centro de caja — superset v1](../design/2026-09-29-centro-de-caja-superset-v1.md)
  and its [rendered artifact](../design/artifacts/2026-09-29-centro-de-caja-superset.html).
- Method: vendor primary documentation, then independent user sources. About
  fourteen vendor help articles were read. More than twenty product images were
  downloaded, and the key cash screens were inspected.
- Labels:
  - **VENDOR-PRIMARY** — a first-party help or developer document.
  - **USER-PRIMARY** — a public post written by a product user.
  - **SCREENSHOT** — a product image inside a vendor help document, inspected in
    this session.
  - **REVIEWER** — an independent review site.
  - **INFERENCE** — a conclusion of this review.
- Tools: `curl` 8.x, Chromium via Playwright 1.63.0-alpha (from the workspace
  `node_modules`), and a small local HTML-to-text extractor.

## 0. What failed, and the workaround

The workspace rule says to record a blocked source. These sources blocked this
environment:

| Source                                   | Result                                                       | Workaround                 |
| ---------------------------------------- | ------------------------------------------------------------ | -------------------------- |
| G2 (`g2.com/products/toast-pos/reviews`) | CAPTCHA                                                      | None. Not used.            |
| Capterra                                 | Cloudflare challenge                                         | None. Not used.            |
| Trustpilot                               | 403                                                          | None. Not used.            |
| SiteJabber                               | 403                                                          | None. Not used.            |
| TrustRadius                              | 404 and an error page                                        | None. Not used.            |
| Reddit (web, old, `redlib`)              | Login wall and network policy                                | Not used.                  |
| Odoo 18 docs                             | Browser timeout; `curl` returned the page but no cash screen | Feature-level detail only. |
| Clover and Shopify help images           | The pages render, but the images were empty on fetch         | Text only for those two.   |

Independent sources that did load: **Square Community**, **GetApp**, and
**Merchant Maverick**.

## 1. Toast — the richest operator documentation

Source: Toast, "Cash drawers", Platform guide,
https://doc.toasttab.com/doc/platformguide/adminCashDrawers.html
(**VENDOR-PRIMARY**, read 2026-09-29). Notes in this section are from that page
unless stated.

### 1.1 The model

- Three states: **Open**, **Closed**, **Paused**. Open takes cash of every type.
  Closed takes nothing and the cash is counted. Paused takes nothing and the
  cash is **not** counted.
- The closeout hour closes drawers automatically: "At the 4 AM closeout hour,
  cash drawers are automatically closed."
- Cash drawers are only available on Toast Flex, not on handhelds.
- A location that is offline at the start of the day **cannot create a cash
  drawer** until it is online.
- A device with two connected drawers lists them as **Primary** and
  **Secondary**.

### 1.2 The permission split

Toast splits the two abilities:

- `Manager > 3.18 Cash Drawers (Full)` — the expected balance is visible.
- `Manager > 3.17 Cash Drawers (Blind)` — the expected balance of each drawer is
  **not** displayed.

This is a per-user setting, not a per-merchant setting (**INFERENCE**).
One user can count blind while another can see the expectation.

### 1.3 The screen

The `Cash Drawers` screen has two tabs, `Open` and `Closed`. The `Open` tab holds
two groups: `Active` and `Paused`. The activity pane shows:

- a count of open drawers,
- the expected balance **per drawer**,
- the expected total balance for all open drawers,
- the expected and actual totals for the closed drawers,
- the cash overage or shortage,
- the total starting balance.

Each row has a `Close` button. A paused row carries a `TO BE COUNTED` chip.

### 1.4 The actions

The drawer activity screen groups the actions into two categories:

**Change drawer balance**

- `Add Cash`
- `Cash collected from server`
- `Cash out`
- `Payout`
- `Tip out`
- `Cash drop` (moves money to a safe)

**No sale**

- A reason choice from a list (`Making Change - Drawer`,
  `Making Change - Customer`, `Count Drawer`). The action opens the drawer and
  does not change the balance.

Other controls: `Lock drawer to me`, `Edit starting balance`, `Close drawer`,
`Print report`, `Create deposit`, and `Adjust closing entries`.

### 1.5 What a paused drawer is

When a cashier chooses to count the drawer later, the drawer becomes **Paused**
and the system opens a **new active drawer**. The new drawer keeps the old name
plus a number, for example `Bar (2)`, with the same starting balance. The paused
drawer stays visible until somebody counts it.

This is the cleanest answer in the reference set to the "operator must leave
now, the count comes later" problem (**INFERENCE**).

### 1.6 The screenshots

| File                                       | Shows                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Design lesson                                                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cash-mgt-cash-drawers-screen.png`         | The full drawer list. `Open 4` and `Closed 0` tabs. `4 Active` group. Each row: name, expected balance, `Close`. Left rail: `OPEN DRAWERS (ACTIVE)` with a footer of `Expected total balance $219.44`, `Total starting balance $200.00`, `Expected total closeout cash $19.44`, `Actual total closeout cash $0.00`, `Cash overage/shortage $19.44`.                                                                                                                                 | The drawer list and the day totals live on one screen. The variance is a footer line, not a hidden report.                                                   |
| `cash-mgt-open-cash-drawers.png`           | Three active rows and one `0 Paused` group.                                                                                                                                                                                                                                                                                                                                                                                                                                         | Active and paused are separate groups on the same tab.                                                                                                       |
| `cash-mgt-open-cash-drawer-categories.png` | The drawer activity screen. Left rail: the journal (`$0.00 Cash Payments`, `$100.00 Cash In`, `No sale Making Change - Drawer`, `$450.00 Cash In`, `-$75.00`), a `LOCKED TO ME` banner, `Edit starting balance`, the totals (`Starting balance $0.00`, `Cash in $650.00`, `Cash out -$75.00`, `Expected balance $575.00`), and a full-width blue `Close drawer`. Right: `Change drawer balance` with a green `Add Cash` and a red `Remove Cash`; `No sale` with three reason chips. | The journal is on the operator screen, next to the actions. The two high-frequency actions are the two largest controls. Positive is green, negative is red. |
| `cash-mgt-paused-cash-drawers.png`         | `Open 4`, `3 Active`, `1 Paused`. The paused row has a `TO BE COUNTED` chip.                                                                                                                                                                                                                                                                                                                                                                                                        | A drawer that needs a count is never invisible.                                                                                                              |
| `cash-mgt-closed-cash-drawers.png`         | `Open 4`, `Closed 2`. Each closed row: a lock icon, the balance, `Create Deposit`.                                                                                                                                                                                                                                                                                                                                                                                                  | The deposit is the next step after the close.                                                                                                                |
| `cash-mgt-closed-cash-drawer-actions.png`  | The closed activity screen. A pink `CLOSED 2:01 PM` banner. The journal ends with `$0.00 Closeout Exact`. Buttons: `Print report`, `Adjust closing entries`. Totals: `Starting balance`, `Cash in`, `Cash out`, `Expected balance`, `Actual balance`, `Cash overage/shortage`. A `Create deposit` button.                                                                                                                                                                           | The close adds one journal line, and the screen keeps both the expected and the actual number.                                                               |

Source for the six images:
`https://doc.toasttab.com/doc/media/<file-name>.png`, embedded in the platform
guide page above.

## 2. Square

Sources (**VENDOR-PRIMARY**, read 2026-09-29):

- "Start and end a cash drawer session",
  https://squareup.com/help/us/en/article/8344-start-and-end-a-cash-drawer-session
- "View cash drawer reports",
  https://squareup.com/help/us/en/article/8358-view-cash-drawer-reports

### 2.1 The model

- The session starts on the POS, never on the dashboard: "You are not able to
  start a cash drawer session from the Square Dashboard."
- The flow is `More → Reports → Current Drawer → Starting Cash → Start Drawer →
Confirm Start Drawer`.
- Cash moves outside a sale use `Pay In/Out` with a description.
- Square separates the words on purpose: "Ending a cash drawer is different than
  closing a cash drawer. When closing a cash drawer, you are recording the
  actual amount when ending the drawer. Ending a cash drawer is simply clicking
  End Drawer."
- The owner may end the drawer from the dashboard. Then "you will not be able to
  Pay In/Out to make any adjustment."
- A drawer that is open for more than 30 days with 7 days of inactivity is ended
  automatically.
- The cash drawer report can be printed or emailed from the POS. It **cannot**
  be printed or exported from the dashboard.

### 2.2 Screenshots

The three Square help articles read here carry **no product screenshots**. The
only images are the Square logo and one decorative header image. Square
documents this flow in text only (**INFERENCE**).

## 3. Lightspeed Restaurant (K-Series)

Source: "Managing cash drawer operations",
https://k-series-support.lightspeedhq.com/hc/en-us/articles/360050436394-Managing-cash-drawer-operations
(**VENDOR-PRIMARY**, read 2026-09-29).

### 3.1 The model

- A cash drawer is a physical drawer, and a second "user bank" wallet exists for
  devices with no physical drawer.
- The drawer is opened after a **sales period** starts, or after a drawer close.
- Counting can be **optional, allowed, or mandatory**, per drawer and user-group
  settings.
- `Add cash` and `Remove cash` require an amount and a reason.
- `Open drawer` pops the physical drawer with no balance effect.
- The close prints a **Drawer report**, and the app prompts at close. Older
  reports print from the `More` menu.
- The screen groups the controls into **Quick actions** and **End of day
  actions**.

### 3.2 The screenshots

| File              | Shows                                                                                                                                                                                                                                                                                       | Design lesson                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `12-5b3055f2.png` | `Cash drawer count Cash`. Left: a `Coins` table (0.01, 0.05, 0.10, 0.25) and a `Notes` table (1, 5, 10, 20, 50, 100), each with `Quantity` (`x20`) and `Total`. Right: the prompt `Input the total amount of notes of 50.00`, a 3x4 keypad, and a full-width button `Confirm - US$ 100.00`. | The confirm button carries the running total. The counter never asks the operator to add the drawer in their head. |
| `11-5ca2e5a3.png` | `Confirm cash amount.` A green line `Shift started at 4/24/26, 11:01 AM`. A table `Payment Method: Cash`, `Total: US$ 100.00`. One button: `Confirm cash amount`.                                                                                                                           | The open step shows the shift start time and the counted total before it commits.                                  |
| `15-abe7d839.png` | The `Cash drawer` settings screen. `Quick actions`: `Add cash`, `Remove cash`, `Open drawer`. `End of day actions`: `Close drawer`.                                                                                                                                                         | Two groups by purpose. The destructive, rare `Close drawer` is separated from the frequent actions.                |
| `17-65d191b2.png` | The amount-and-reason prompt for a cash add.                                                                                                                                                                                                                                                | A cash movement always carries a reason.                                                                           |

The image files and their attachment ids, in the order of the table above:

| Local file        | Attachment       |
| ----------------- | ---------------- |
| `12-5b3055f2.png` | `52558021883291` |
| `11-5ca2e5a3.png` | `52558036366491` |
| `15-abe7d839.png` | `52558021884187` |
| `17-65d191b2.png` | `18050500829211` |

Source: `https://k-series-support.lightspeedhq.com/hc/article_attachments/<id>`.

## 4. Clover

Source: "Run a cash log report",
https://www.clover.com/en-US/help/run-cash-log-report
(**VENDOR-PRIMARY**, rendered with Chromium, read 2026-09-29).

- The Clover model is a **log**, not a reconciled shift.
- The dashboard path is `Sales activity > Cash log`.
- The filters are date range, device, employee, and order type.
- The on-device `Cash log` app shows "date, event, amount, reason, and employee".
- Print and export exist. The printer icon needs a Station, a Flex, or a
  supported Mini.

Clover documents no expected-versus-counted step and no variance
(**INFERENCE**).

## 5. Shopify POS

Source: the Shopify help articles in the companion research
[cash-shift management](../research/2026-09-06-cash-shift-management-owner-ux.md)
(**VENDOR-PRIMARY**, from the earlier Umi review). The help pages read for this
file loaded as text with no images.

- A register session records the starting float, the cash added and removed, and
  the final count.
- Shopify tracks **two** discrepancies: one at the start and one at the end.
- The owner can close a session remotely from admin.
- A closed session cannot be reopened or edited.

## 6. Fudo — the closest Latin American comparison

Fudo has the deepest cash documentation of the Spanish-language products read.
The help centre is an Intercom site at https://soporte.fu.do/es/
(**VENDOR-PRIMARY**, read 2026-09-29).

### 6.1 The model

Sources:

- "3. Arqueos de caja" —
  https://soporte.fu.do/es/articles/11730865-3-arqueos-de-caja
- "¿Cómo configurar un 'Arqueo de caja ciego'?" —
  https://soporte.fu.do/es/articles/11730856-como-configurar-un-arqueo-de-caja-ciego
- "2. Movimientos de caja" —
  https://soporte.fu.do/es/articles/11730862-2-movimientos-de-caja
- "¿Cómo le asigno una caja a un usuario?" —
  https://soporte.fu.do/es/articles/11730853-como-le-asigno-una-caja-a-un-usuario

The facts:

- A **caja** is a named object. The owner creates cajas and assigns a caja to a
  user. More than one arqueo can be open at the same time.
- The arqueo opens from `Ventas > Arqueos de Caja > + Nuevo Arqueo`, with a
  date, an hour, and a **Monto inicial**. A caja picker appears when several
  cajas exist.
- The close shows two columns: **Según sistema** (the expected amount) and
  **Según usuario** (the counted amount). The operator enters the counted amount
  **per payment method** (Efectivo, Tarj. Crédito, Tarj. Débito, Mercadopago),
  not per denomination.
- A difference is coloured: green for sobrante, red for faltante.
- `Finalizar Arqueo` closes the arqueo. **A closed arqueo cannot be reopened.**
- `Imprimir Arqueo` prints to the ticket printer. A Pro plan sends the close by
  e-mail.
- **Blind counting is a role permission.** The owner removes
  `Ver 'Según Sistema' en arqueo abierto` and
  `Ver 'Según Sistema' en arqueo cerrado` from the role. The user then sees only
  the `Según usuario` section.
- One payment method can be set to `Completar saldo manualmente = off`, so the
  system fills the amount and the cashier does not type it.

### 6.2 The screenshots

| File                          | Shows                                                                                                                                                                                                                                                                   | Design lesson                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `fudo-arqueo/13-c55c4b86.png` | The `Ventas` screen with the tab `Arqueos de Caja Cerrado` and a prominent orange `Abrir la caja` button.                                                                                                                                                               | The open action is reachable from the selling screen.                          |
| `fudo-arqueo/15-dda41d58.png` | `ARQUEOS DE CAJA` with a five-tile header: `Arqueo de Caja`, `Saldo actual`, `Total de ventas`, `Ingresos`, `Egresos`, each with a `?` tooltip. A `+ Nuevo arqueo de caja` button.                                                                                      | Five numbers answer "what is in this drawer" before any action.                |
| `fudo-arqueo/16-ea375493.png` | The empty state: "Crea tu primer arqueo de caja".                                                                                                                                                                                                                       | The first run teaches the purpose.                                             |
| `fudo-ciego/13-313e6638.png`  | A blind arqueo. Header: `Caja: Principal`, `Hora de apertura`, `Creado Por`, `Estado: Abierto`. Section `SEGÚN USUARIO` with one `$` field per payment method, a `Comentario` box, a `Total $11,00` footer, and `Finalizar Arqueo`. There is no `Según sistema` column. | The blind mode is the same screen with a column removed, not a different flow. |
| `fudo-ciego/12-b2e78d47.png`  | The role permission list with the two `Ver 'Según Sistema'` checkboxes.                                                                                                                                                                                                 | Blindness is configured once, per role, by the owner.                          |

## 7. Independent user evidence

### 7.1 The Square Community feature request (the strongest single source)

Source: **USER-PRIMARY**, Square Community, Feature Requests,
"Redesign the end-of-day cash closing flow (denomination counting, blind counts,
and clearer variance)", posted about one week before 2026-09-29, 6 kudos.
https://community.squareup.com/t5/Feature-Requests/Redesign-the-end-of-day-cash-closing-flow-denomination-counting/idi-p/849765

The user asks Square for eight things:

1. **A built-in denomination counter.** "Let staff enter counts by bill and coin
   (20 × $1, 6 × $5, etc.) and have Square total it automatically."
2. **A blind close option.** "Give owners a setting that hides the expected
   amount from the person counting until after they submit. This is standard
   practice in food service and makes counts more honest and accurate."
3. **A clear variance breakdown.** "Show the expected total broken into its
   parts: starting cash, cash sales, cash refunds, paid in/out, and cash tips.
   Flag the likely cause where possible."
4. **A guided closing checklist.** "count drawer, record cash tips, set aside
   the next day's starting float, record the deposit amount, confirm."
5. **Float and deposit tracking.** "keep $150 in the drawer, deposit $412", and
   track deposits against the bank.
6. **Accountability per person.** "Record who opened, who handled, and who closed
   each drawer, with timestamps, and require a PIN at close."
7. **Better reporting.** Variance trends over days and weeks, by employee and by
   location, exportable.
8. **A mobile-first design.** "Large tap targets, readable in low light."

Two replies follow:

- "We ultimately stopped having our staff count the drawer when we switched from
  toast to square because this was missing. We would love to have this
  functionality back!"
- "Square's 'End of Day' doesn't exist... if I had a penny for the counting
  mistakes we had, I'd be Elon Musk rich."

**Why this matters for Umi.** The request lists, in the words of a paying user,
the same five controls Umi already has: the denomination counter, the blind
count, the variance reason, the expected breakdown, and the per-person record.
Umi should treat this as market validation, not as a new requirement
(**INFERENCE**).

### 7.2 The two-drawer shift change

Source: **USER-PRIMARY**, Square Community,
"Managing Cash Drawer Reports at Shift Change", 2025-10-08, 2,563 views.
https://community.squareup.com/t5/Reports-Setup-Management/Managing-Cash-Drawer-Reports-at-Shift-Change/m-p/820236

The operator runs two physical drawers in rotation, one for the AM shift and one
for the PM shift, each with $200. The operator names the exact race:

> "While the AM employee is counting their drawer, any sales done during that
> period would count against the AM drawer because it's still technically active
> in the POS."

**Why this matters for Umi.** Umi blocks new sales the moment a count is
submitted, because the ledger trigger accepts only `status = 'open'`. The Square
thread shows that this block protects the count. Umi must keep the block. The
friction in finding 5.2 of the design review is real, but the fix is a guarded
exit, not an open drawer during the count (**INFERENCE**).

### 7.3 The denomination counting request

Source: **USER-PRIMARY**, Square Community,
"cash drawer counting feature request", 2020-01-19, 7 kudos, 17,661 views, 15
replies.
https://community.squareup.com/t5/Hardware-Setup-Troubleshooting/cash-drawer-counting-feature-request/m-p/147986

> "Entry of actual counted cash would be amazing! I currently use a customized
> spreadsheet for this activity... based on each cash denomination."

Two replies agree, and one names three retail stores. The request is more than
five years old.

### 7.4 Other Square Community threads

All **USER-PRIMARY**, found by the community search on 2026-09-29.

| Thread                                                                 | Point                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| "What is the difference between 'Closed' & 'Ended' in cash management" | A user cannot tell two of Square's three states apart.             |
| "Square Sales Report vs. manually counting"                            | A user cannot reconcile the sales report with the drawer count.    |
| "Cash Drawer Report Email missing data" (2025-11-12)                   | The emailed report lost the actual-in-drawer and difference lines. |
| "Cash Drawer Disconnected error" (2025-03-06)                          | Hardware state is part of the operator experience.                 |
| "Cash Drawer Management: How do I count bills and coins"               | Counting by hand is the pain.                                      |

### 7.5 Independent review sites

- **GetApp, Toast POS reviews** (**REVIEWER**, https://www.getapp.com/restaurant-software/a/toast-pos/reviews/).
  Cash management appears as a product capability. Reviewers rate reporting and
  analytics as valuable but "not intuitive", and "downloading reports can be
  cumbersome". Offline payment is valued, with "issues with network
  connectivity" named.
- **Merchant Maverick, Toast POS review** (**REVIEWER**,
  https://www.merchantmaverick.com/reviews/toast-pos-review/). The review lists
  the Toast contract and the cost of extra hardware as the main cons. It does
  not test the cash drawer flow in depth.
- **Merchant Maverick, Lightspeed review** (**REVIEWER**). Names the cash drawer
  as third-party hardware, so the drawer is not the differentiator.

## 8. What the evidence changes

1. **Keep the blind count, and make it a permission.** Toast and Fudo both gate
   the expectation per user, not per merchant. Umi withholds it always.
   **Action:** read `blindCountRequired` and add a `cash.count.blind`-class
   permission in the same pass.
2. **Show the drawer journal on the till.** Toast puts the journal on the
   operator screen, next to the actions. Umi shows only the total.
3. **Group the actions by purpose.** Lightspeed separates `Quick actions` from
   `End of day actions`. Toast separates `Change drawer balance` from
   `No sale`. Umi already separates movements from the shift lifecycle. Keep it,
   and name the groups in the operator's language.
4. **Let the confirm button carry the running total.** Lightspeed prints
   `Confirm - US$ 100.00`. This removes one mental sum at the most error-prone
   moment.
5. **Add float and deposit tracking.** The Square request asks for "keep $150,
   deposit $412". Toast has `Create deposit`. Umi has neither.
6. **Require a PIN at close.** The Square request asks for it. Umi already binds
   a close approval to a fingerprint, but only above a threshold.
7. **Add variance trends.** The Square request asks for variance over days and
   by employee. Umi shows one shift. The dashboard can answer this with the
   existing ledger.
8. **Consider a paused-drawer state.** Toast lets an operator defer a count and
   keep selling on a new drawer. This is the cleanest fix for a shift change at
   a busy counter.
9. **Print or email the close.** Fudo prints and mails the arqueo. Toast prints
   the report and creates a deposit. Umi prints nothing.
10. **Do not copy the per-payment-method count.** Fudo counts by payment method.
    Umi counts by denomination. Denomination counting is the stronger control,
    and the market asks for it by name.

## 9. Sources

Toast:

- "Cash drawers", Platform guide —
  https://doc.toasttab.com/doc/platformguide/adminCashDrawers.html
- "Cash Drawer States", support —
  https://support.toasttab.com/en/article/Cash-Drawer-States
- "Get Started With Cash Management" —
  https://support.toasttab.com/en/article/Cash-Management-Overview
- "Use Cash Drawers" —
  https://support.toasttab.com/en/article/Use-Cash-Drawers-New-Experience
- Screenshots: `https://doc.toasttab.com/doc/media/<file>.png`

Square:

- "Start and end a cash drawer session" —
  https://squareup.com/help/us/en/article/8344-start-and-end-a-cash-drawer-session
- "View cash drawer reports" —
  https://squareup.com/help/us/en/article/8358-view-cash-drawer-reports

Lightspeed:

- "Managing cash drawer operations" —
  https://k-series-support.lightspeedhq.com/hc/en-us/articles/360050436394-Managing-cash-drawer-operations

Clover:

- "Run a cash log report" —
  https://www.clover.com/en-US/help/run-cash-log-report

Fudo:

- "3. Arqueos de caja" —
  https://soporte.fu.do/es/articles/11730865-3-arqueos-de-caja
- "¿Cómo configurar un 'Arqueo de caja ciego'?" —
  https://soporte.fu.do/es/articles/11730856-como-configurar-un-arqueo-de-caja-ciego
- "2. Movimientos de caja" —
  https://soporte.fu.do/es/articles/11730862-2-movimientos-de-caja
- "¿Cómo le asigno una caja a un usuario?" —
  https://soporte.fu.do/es/articles/11730853-como-le-asigno-una-caja-a-un-usuario

Independent:

- Square Community feature request —
  https://community.squareup.com/t5/Feature-Requests/Redesign-the-end-of-day-cash-closing-flow-denomination-counting/idi-p/849765
- Square Community shift change —
  https://community.squareup.com/t5/Reports-Setup-Management/Managing-Cash-Drawer-Reports-at-Shift-Change/m-p/820236
- Square Community counting request —
  https://community.squareup.com/t5/Hardware-Setup-Troubleshooting/cash-drawer-counting-feature-request/m-p/147986
- GetApp Toast POS reviews —
  https://www.getapp.com/restaurant-software/a/toast-pos/reviews/
- Merchant Maverick Toast POS review —
  https://www.merchantmaverick.com/reviews/toast-pos-review/
