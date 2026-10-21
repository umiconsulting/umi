# POS account entry, restart, and day close

Date: 2026-10-20

Devices: iMin D3-504 `192.168.0.10:37913`, Samsung A9 `192.168.0.102:33037`

Staging merchant: ONCA `c982abb4-cd89-4d05-a6fc-05b573afc23b`

## Result

A fresh operator entry no longer adopts an account that was already open. The
till enters with an empty **Comanda**, keeps those accounts in **Cuentas**, and
resumes one only after an explicit tap. The account count remains visible in the
navigation.

The previous-day accounts also exposed a separate day-close defect. ONCA had a
04:00 business-day boundary, but its active policy was `manual`. After enabling
`auto_void`, the sweep still ignored saved (`suspended`) accounts, so yesterday's
work stayed open. The sweep now closes those accounts when the business day has
rolled over, but never when any payment or uncertain tender result exists.

## What created the observed friction

1. **Entry and account identity were coupled.** The server intentionally
   recovers the same operator session after a PIN login. The POS then fetched
   the current sale for that session and painted it immediately. The operator
   had no visible decision before an old account replaced the clean till.
2. **Offline replay was on the critical startup path.** The catalog waited for
   journal inspection, replay-authority validation, reconciliation and conflict
   handling before account and catalogue reads. In the measured login at
   `21:24:51.745Z`, PIN authentication finished in 108 ms, but the first
   `sales/current` request did not begin until `21:25:07.789Z`.
3. **The account list preferred stale local cache.** A refresh returned the
   cached rows first and updated the store asynchronously. The screen therefore
   needed a second refresh before it showed accounts the server had just closed.
4. **A stale validation refusal rendered as a spinner.** With no cart and
   `CART_VALIDATION_FAILED`, the order panel fell through its legacy failure
   branch. Starting a new order from **Cuentas** did not clear that controller
   state, producing an endless spinner.
5. **The 04:00 boundary was configured, but automatic closing was not.** The
   database held `timezone=America/Mazatlan` and `business_day_start=04:00`, but
   `pos_day_close_policy=manual`. The implementation also excluded
   `suspended`, which is how “Guardar y salir” stores an account.

## Competitive pattern

| Stage | Square | Toast | Lightspeed |
| --- | --- | --- | --- |
| Find work | **HD:** open tickets are available under **Checkout > Tickets**, including from another logged-in device. | **HD:** **All Checks** exposes filters for **Open**, **Paid**, and **Closed**; select a check to open it. | **HD:** the **Orders List** gathers all orders in one place. |
| Resume | **HD:** select the open ticket from the list. No requirement that the newest ticket auto-opens. | **HD:** select the check from the filtered list. | **HD:** open a held order by selecting it from the orders tab. |
| Continue editing | **HD:** open tickets can be edited before later payment. | **HD:** Send, Stay and Hold keep explicit control over what fires and what remains editable. | **HD:** held and open orders remain explicit objects in the Orders area. |
| Login behavior | Public documentation does not claim that sign-in auto-opens the last ticket. | Public documentation starts discovery at **All Checks**. | Public documentation starts discovery at **Orders**. |

The consistent interaction model is therefore: **the account survives, but the
operator chooses it**. The Umi change follows that model rather than inventing a
new explanation banner for an already ambiguous state.

Sources:

- [Square — Create and edit open tickets](https://squareup.com/help/us/en/article/5337-use-open-tickets-with-square)
- [Toast — Find Checks](https://support.toasttab.com/en/article/Finding-Checks)
- [Toast — Send, Stay and Hold](https://support.toasttab.com/en/article/Differences-Between-the-Send-Stay-and-Hold-Buttons)
- [Toast — Manage Payments and the Payment Terminal](https://support.toasttab.com/en/article/New-POS-Managing-Payments)
- [Lightspeed — About the Orders List](https://resto-support.lightspeedhq.com/hc/en-us/articles/360005901634-About-the-Orders-List)
- [Lightspeed — Hold an order](https://o-series-support.lightspeedhq.com/hc/en-us/articles/31329465555739-How-to-hold-an-order-with-Lightspeed)

Public product images reviewed:

- [Competitor comparison sheet](evidence/2026-10-20-session-resume/competitor-contact-sheet.png)
- [Square check actions](evidence/2026-10-20-session-resume/square-check-actions.png)
- [Toast Payment Terminal with Open, Paid and Closed checks](evidence/2026-10-20-session-resume/toast-payment-terminal.png)
- [Lightspeed Orders](evidence/2026-10-20-session-resume/lightspeed-orders.png)

Independent-review limit: searches in English and Spanish did not return a
credible independent review that specifically attributed this failure to
automatic account restoration. That frequency is therefore **unverified**; the
recommendation rests on the provider flows and direct product evidence.

## Implemented behavior

- A fresh operator entry binds sale scope without reading the current sale.
- Existing accounts remain available in **Cuentas** and are opened explicitly.
- The **Cuentas** navigation shows an account count.
- Offline replay starts after the usable till and is no longer a startup gate.
- Account-list loads are server-first online and cached only as a fallback.
- A cartless validation refusal is shown as a recoverable state, never as an
  indefinite spinner.
- Starting a new order from **Cuentas** clears the obsolete refusal.
- `auto_void` now includes saved accounts.
- The close sweep excludes accounts with captured, unknown, pending, or
  unresolved tender state.
- Closing a table account releases its table only when no other open account
  still owns it, and emits the same KDS notification used by manual closure.

The staging merchant policy was changed from `manual` to `auto_void`; its
`America/Mazatlan` timezone and 04:00 boundary were preserved.

## Evidence on the iMin

- Cold process launch to the PIN screen: approximately **5.4–6.7 seconds**. This
  remains a separate startup-cost investigation.
- PIN confirmation to usable menu: approximately **2 seconds** in the captured
  screen recording, down from the earlier path where account restoration was
  still pending after 15 seconds.
- Fresh login rendered empty **Comanda** with **Iniciar pedido**; no old account
  was auto-opened.
- A takeaway order started from **Cuentas**, showed the type chooser, then showed
  a usable empty order. Adding a variant created **Cuenta 001** with the line and
  totals, without a spinner.
- Removing the only line closed the synthesized empty account; **Cuentas** then
  showed no open accounts.

Artifacts:

- [Login timing](evidence/2026-10-20-session-resume/imin-login-timeline.png)
- [Clean account entry](evidence/2026-10-20-session-resume/imin-clean-login.png)
- [Accounts before cleanup](evidence/2026-10-20-session-resume/imin-clean-account-list.png)
- [New takeaway order](evidence/2026-10-20-session-resume/imin-new-takeout.png)
- [Created account with a variant](evidence/2026-10-20-session-resume/imin-takeout-account.png)
- [Clean accounts after the test](evidence/2026-10-20-session-resume/imin-clean-account-list-after-test.png)

## Verification

- Flutter: **1,117 tests passed**.
- Flutter analyzer: no issues.
- API: **2,069 tests passed**, 29 skipped.
- API typecheck: passed.
- Staging API image:
  `ghcr.io/umiconsulting/umi-api:day-close-session-20261020`.
- Installed iMin build: **226**, package
  `co.umiconsulting.umi_pos.clean`.

## Acceptance scenarios

1. Sign in with an account already open: the menu appears clean and the account
   remains visible in **Cuentas**.
2. Select that account: it opens explicitly with its items, total and table.
3. Start a takeaway order: choose the type, add a variant, and see the account
   and totals without waiting on replay.
4. Begin after a stale validation failure: receive a visible recovery action,
   not an endless spinner.
5. Cross 04:00 with an unpaid saved account: it closes, its table is released,
   and KDS stops showing it.
6. Cross 04:00 with a partial payment or unknown tender: the account remains for
   reconciliation rather than being silently abandoned.

## Open measurement

The remaining 5–6 second cold launch to the PIN must be profiled separately from
post-login performance. Its delay occurs before the first network request and is
not explained by POS/API response time.

## Follow-up: CART_ACTOR_BUSY after re-enrollment

The iMin produced `CART_ACTOR_BUSY` when opening Cardón while an empty account
from the same operator was still active on the server. The table write was then
incorrectly journaled locally, so the till painted a provisional table account
that the server never accepted.

Two changes close that path:

- A table or new-order command now parks the operator's active server account
  before creating the next one. Empty accounts are closed; accounts with content
  become suspended and remain available in Cuentas. Unresolved payments still
  block the switch.
- The client treats `CART_ACTOR_BUSY` as a definite server refusal and never
  queues a local replacement.

The device had also been re-enrolled, leaving replay commands from the previous
device ID. The server correctly refused that mixed stream with
`REPLAY_SCOPE_INVALID`. Recovery now resets a stale non-financial replay scope;
foreign-device cash commands remain untouched for explicit reconciliation.

Final proof: Cuenta 002 was created for Cardón while the previous empty account
was closed. There is no error banner, no local pending queue, and no replay-scope
refusal.

## Follow-up: resuming an account while another one is hidden

The next cold entry exposed a second path to the same refusal. The server still
held Cuenta 003 as `building_cart`, but that empty counter account was not present
in the visible Cuentas list. Selecting Cuenta 002 therefore returned
`CART_ACTOR_BUSY` from `accounts/:cartId/resume`: the hidden cart belonged to the
same operator, so it did not conflict with the selected account's ownership, but
the actor-availability check treated it as a blocker.

`claimAccount` now performs the same safe switch used by new orders and table
creation before checking actor availability. An empty hidden cart is cancelled;
a cart with content is suspended and remains resumable; unresolved payments still
stop the switch. The selected account is only claimed after that write succeeds.

Final device proof:

- Selecting Cuenta 002 returned `201` and opened Cardón with no generic banner.
- The hidden empty Cuenta 003 was cancelled rather than orphaned.
- Account 002 was saved, reopened and saved again after the corrected staging
  container was recreated from image
  `ghcr.io/umiconsulting/umi-api:account-resume-d17c24fe`.
- Release identity reports commit
  `d17c24fe657b0c417d9db30817795fe2b596e9a4`.
- The app was left on a clean menu with the account visible in Cuentas.

Artifacts:

- [Account 002 resumed](evidence/2026-10-20-session-resume/imin-account002-resumed.png)
- [Final clean menu](evidence/2026-10-20-session-resume/imin-final-clean-menu.png)

## Follow-up: Temporary table and stale replay conflicts

“Temporary table” previously opened a tableless account but displayed a success
notice that said there was no table. The label and the object disagreed: the
operator expected a normal account identified as a temporary table, while the
screen described a generic empty account.

The POS now creates the account with `Mesa temporal` as its persisted account
name. The order header shows the normal folio plus `Mesa temporal`, Cuentas does
not repeat “Sin mesa”, and no success banner is necessary. The destination
remains the product menu because that is where the operator adds the first item.

The same flow exposed a separate synchronization failure. A re-enrolled device
retained eight `sequence_gap` conflicts from an earlier operator session. The
server refused the stale sequence; the replay then used the old session and
returned `401`; the POS kept a green local paint with a generic “item was not
added” warning.

The correction removes that cascade:

- Definitively refused, non-financial cart steps are resolved automatically and
  remain in history.
- Replay now executes cart operations with the currently open operator session
  while preserving the original writing session in the command record.
- A missing replay cursor is created while resolving a sequence gap, and the
  cursor advances through the explicitly discarded step.
- `fire` and `prepare` may be discarded only when the server marks them
  non-retryable; payment, checkout and unknown outcomes still require a person.
- Successful recovery is acknowledged automatically when the local journal and
  server cursor both have nothing pending.
- The recovery diagnostics query no longer fails its PostgreSQL `GROUP BY`.

Final iMin proof with build **237**:

- Cuentas opened **Cuenta 006** as, and displayed, `Mesa temporal`.
- Adding Americano limón mineral produced no error banner.
- `POST /cart/lines` returned `201`; the server cart has the same line.
- The header remained `local confirmed`, and no recovery item was left pending.

Artifacts:

- [Temporary table account](evidence/2026-10-20-session-resume/imin-temporary-table-account.png)
- [Item added to the temporary table](evidence/2026-10-20-session-resume/imin-temporary-table-item.png)

## Follow-up: New account after firing to the kitchen

Cuenta 007 was sent to the kitchen, but the top-bar **Start order** action did not
reach the API. The cart controller's in-memory command lane still contained
accepted commands, so `saveAccount()` regarded the till as busy and the UI rendered
the previous generic product-validation error over a healthy account.

Account switching no longer asks that racing save path to suspend the current
account. It first makes pending local commands durable and then opens the next
account; the server parks the previous account atomically when it receives the new
open. A fired account with no current pre-payment sale also no longer surfaces
`SALE_NOT_FOUND` as an error.

Final proof with build **239**:

- Cuenta 007 reopened with its fired item and no banner.
- The top-bar action opened the service-type selector normally.
- No extra `/cart` write was attempted before the operator selected the new type.

Artifact:

- [New account selector after a fired order](evidence/2026-10-20-session-resume/imin-new-account-after-fired-order.png)
