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
- [Lightspeed — About the Orders List](https://resto-support.lightspeedhq.com/hc/en-us/articles/360005901634-About-the-Orders-List)
- [Lightspeed — Hold an order](https://o-series-support.lightspeedhq.com/hc/en-us/articles/31329465555739-How-to-hold-an-order-with-Lightspeed)

Public product images reviewed:

- [Square check actions](evidence/2026-10-20-session-resume/square-check-actions.png)
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

- Cold process launch to the PIN screen: approximately **5.4–5.9 seconds**. This
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
- Installed iMin build: **225**, package
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
