# Cash-shift management — the owner/manager UX in enterprise POS

- **Date:** 2026-09-06
- **Question:** How do leading POS / back-office systems model a *cash shift* (drawer session) and its reconciliation, and how do they present that to the **owner/manager** in the back office (not the cashier's on-terminal flow)?
- **Scope:** Square, Toast, Lightspeed Restaurant (K-series), Clover, Shopify POS. Data model + owner-facing UX + the concrete actions an owner can take.
- **Method / source labels:** Each claim is tagged.
  - `PRIMARY` — vendor product/help documentation.
  - `PRIMARY-SPEC` — vendor developer/API reference (the data model as code).
  - `SECONDARY` — vendor blog or partner doc (used only where the help centre was an unreadable SPA shell; flagged in the appendix).
  - `INFERENCE` — my synthesis across sources, not a quoted claim.
- **Companion:** [Receipt vs sale in enterprise systems](2026-09-06-receipt-vs-sale-enterprise-systems.md). Umi domain truth lives in `docs/migration/build-v3/33_pos_cash.sql` and `packages/contract/src/pos-cash.ts`.

---

## Executive summary

- Everywhere, a **cash shift is a durable, time-bounded reconciliation record** for one drawer on one device at one location: `opening float → cash movements → expected cash`, counted against `counted cash` to produce a **variance (over / short)**. `INFERENCE`
- The **shift links to individual sales through an append-only event ledger** — each cash payment, refund, pay-in and pay-out is an event summed into the shift totals. Square makes this literal (`CASH_TENDER_PAYMENT`, `PAID_IN`, …); Shopify calls it "session activity"; Lightspeed calls it the "cash management journal". `PRIMARY-SPEC` `PRIMARY`
- **Variance is the hero metric.** Every back-office view is built to answer "did this drawer balance, and if not, by how much and who?" Shopify's report is even **sortable by discrepancy amount**. `PRIMARY`
- Systems **split "ended" from "closed/audited"**: Square has three states (`OPEN` → `ENDED` → `CLOSED`), separating the person who runs the drawer from the person who **counts** it — a separation-of-duties control. `PRIMARY-SPEC`
- Shopify tracks **two** discrepancies — one **at start** (last close vs this open) and one **at end** — catching overnight/opening tampering, not just closing error. `PRIMARY`
- Owner **write-power varies widely**: Square's API is **read-only reporting**; Lightspeed/Clover back-office is **read + export**; Shopify lets an owner **close a session remotely** and add notes; Toast lets a manager **reopen a closed shift, reallocate entries, and approve over/short beyond a threshold**. `PRIMARY-SPEC` `PRIMARY`
- **Immutability disagreement:** Shopify sessions **cannot be reopened or edited** after close; Toast **can** be reopened. Umi sits with Shopify (append-only) but adds a `recovered` escape hatch. `PRIMARY` `INFERENCE`

---

## Cross-system comparison

| Dimension | Square | Toast | Lightspeed K-series | Clover | Shopify POS |
|---|---|---|---|---|---|
| Shift a first-class object? | **Yes** — `CashDrawerShift` API entity | Yes — cash drawer + shift review | Yes — shift → user → drawer reports | **Log**, not a reconciled object | **Yes** — register session |
| States | `OPEN` / `ENDED` / `CLOSED` | Active / Open / Closed | Open / Closed (period) | (per-event log) | Open / Closed |
| Opening float | `opened_cash_money` | Start balance | Opening count | (n/a in log) | Starting float |
| Expected cash | `expected_cash_money` (can go negative) | expected balance | `Total` = lifts+drops+takings | — | expected = start + cash payments |
| Counted cash | `closed_cash_money` | counted at close | `Reported` (denominations on click) | — | final count |
| Variance | expected vs closed | Cash over / short / none | `Difference` = reported − total | — | discrepancy at **start & end** |
| Pay-in / pay-out | `PAID_IN` / `PAID_OUT` events | Pay In / Pay Out | Lifts / drops | Paid in / paid out events | cash added / removed |
| Separation of duties | opener / ender / **closer** = 3 roles | drawer locked to employee | user per drawer | employee per event | staff per session |
| Owner can act from back office | **Read-only** (API) | Reopen, approve, adjust, complete | Export / print / journal | Filter / export | **Close remotely**, note, export |
| Editable after close? | (audited once) | **Yes — reopen** | Report only | Log only | **No — immutable** |

---

## Per-system detail

### Square — Cash Drawer Shifts API (the cleanest data model)
- **First-class object `CashDrawerShift`** with `state` = `OPEN` / `ENDED` / `CLOSED`, `opened_at` / `ended_at` / `closed_at`. `PRIMARY-SPEC` — https://developer.squareup.com/reference/square/objects/CashDrawerShift
- Money fields, each **computed by summing its event type**: `opened_cash_money` (float), `cash_payment_money` (`CASH_TENDER_PAYMENT` + `CASH_TENDER_CANCELED_PAYMENT`), `cash_refunds_money` (`CASH_TENDER_REFUND`), `cash_paid_in_money` (`PAID_IN`), `cash_paid_out_money` (`PAID_OUT`), `expected_cash_money` (float + payments + paid-in − refunds − paid-out — **"can be negative if employees have not correctly recorded all the events"**), `closed_cash_money` ("found in the cash drawer at the end of the shift by an **auditing employee**"). `PRIMARY-SPEC`
- **Three distinct people** per shift: `opening_team_member_id`, `ending_team_member_id`, `closing_team_member_id`, plus `team_member_ids[]` (everyone logged in). Separation of duties baked into the schema. `PRIMARY-SPEC`
- **Reporting shape** (owner-facing): `ListCashDrawerShifts` (summaries by location + time range — "scan shift activity … identify which shifts require attention"), `RetrieveCashDrawerShift` (drill-down + variance), `ListCashDrawerShiftEvents` (paginated event ledger). `PRIMARY` — https://developer.squareup.com/docs/cashdrawershift-api/reporting
- `description` is a free-text field used for **discrepancy notes**. The API is **read-only** (list/retrieve) — no write endpoints. `PRIMARY-SPEC`

### Toast — Cash Management + Shift Review (the richest owner actions)
- Drawers are **Active / Open / Closed** and can be **locked to a specific employee**; the system separates "cash in hand" from "cash in drawer". `PRIMARY` — https://support.toasttab.com/en/article/Cash-Management-Overview
- Permission-gated actions: **Adjust Cash Drawer Start Balance**, **Pay Out**, **No Sale**. `PRIMARY`
- **Shift Review flow** (POS, guided, each step checkmarked): close checks → declare cash tips → **reconcile cash and tips** → **close cash drawers** (count) → clock out. System computes **"Cash over, Cash short, or No difference"**; differences over a **configured threshold require manager approval**; 45-char comment for variance. `PRIMARY` — https://support.toasttab.com/en/article/Shift-Review-Overview
- **Manager review** (back office, permission "Review employee shifts"): monitor **Active** vs **Closed** shifts with status icons; **adjust clock in/out**; **complete shifts for departed employees**; **reopen closed shifts to reallocate cash-drawer entries / recalculate tips**; **approve over/short beyond threshold**. `PRIMARY`
- Day-level: **Close Out Day / Z-report**. `PRIMARY` — https://support.toasttab.com/en/article/Close-Out-Day-Z-Report-Auto-Capture

### Lightspeed Restaurant K-series — back-office Cash drawer report (the cleanest drill-down hierarchy)
- Report hierarchy: **shift report → user report → drawer report** (you open the shift first, then its users and drawers). `PRIMARY` — https://k-series-support.lightspeedhq.com/hc/en-us/articles/360051089653-Shift-reports
- **Cash drawer report** columns: `User`, `Date`, `Period` (open/close hours), `Reported` (counted — **click to see the denomination breakdown**), `Lifts/drops` (net added/removed), `Takings` (all registered payments), `Total` (= lifts + drops + takings), `Difference` (= reported − total). `PRIMARY` — https://k-series-support.lightspeedhq.com/hc/en-us/articles/4403156150171-Cash-drawer-report
- Owner actions: **export CSV / print PDF**, **download a "Cash management journal"** of individual lifts and drops, **sort by user/date**, adjust timeframe, click a count to see denominations. `PRIMARY`

### Clover — Cash Log (the lightest model: a log, not a reconciled shift)
- **Cash Log** is a free app that "tracks all customer cash transactions and manager cash drawer activities". Accessed at **Dashboard → Sales activity → Cash log**. `PRIMARY` — https://www.clover.com/en-US/help/run-cash-log-report *(help page rendered as an empty SPA shell on fetch; fields below are from the vendor's own search description — see appendix)*
- Report columns: **Event** (transaction or adjustment — paid in / paid out / no-sale), **Amount**, **Reason** (what prompted the drawer opening/adjustment), **Employee**. Date ranges (Today / Yesterday / 7 / 30 / custom); **filter by employee, event, or device type**. `PRIMARY (vendor description)`
- Clover models **cash events**, not a first-class reconciled shift with expected/counted — the lightest of the five. `INFERENCE`

### Shopify POS — register sessions + admin cash-tracking reports (the closest analog to an owner dashboard)
- A **register session** records all cash activity for an interval: **starting float**, cash added/removed, **final count**. Expected = starting + cash payments received. `PRIMARY` — https://help.shopify.com/en/manual/sell-in-person/shopify-pos/cash-register-management/cash-tracking
- **Two discrepancies:** **Discrepancy at start** (prior session's end vs this session's counted start) and **Discrepancy at end** (expected vs counted at close). `PRIMARY`
- **Owner actions from Admin** (back office): view session list (filter by location + date); open a session's detail; **close a session remotely** when the device couldn't; **export CSV** (whole summary / all sessions / selected); **add notes** when closing; print/export. Per-session reports: **Session** (overview), **Net payments** (by payment type), **Session activity** (log of every cash movement incl. drawer openings). `PRIMARY` — https://help.shopify.com/en/manual/sell-in-person/shopify-pos/cash-register-management/register-sessions-in-shopify-admin
- **Sessions cannot be reopened or edited after closure** — a remote close just appends to the activity history. `PRIMARY`
- **Cash tracking reports by location:** discrepancy summary (opening + closing), cash-payments overview (gross / refunds / net), **session list sortable by discrepancy amount**, compare across locations. `PRIMARY` — https://help.shopify.com/en/manual/sell-in-person/shopify-pos/cash-register-management/cash-tracking-reports-by-location

---

## The common conceptual model (what everyone shares)

A cash shift is: **one drawer · one device · one location · one time window**, holding
`opening float` **+** `cash sales` **+** `pay-ins` **−** `cash refunds` **−** `pay-outs` **−** `safe drops` **= expected`,
counted as `counted`, yielding `variance = counted − expected` classed as **over / short / balanced** against a **tolerance**. Individual sales attach through an **append-only event ledger**. Reconciliation is the whole point; the owner's job is to spot and resolve variance. `INFERENCE`

## Owner-facing UX patterns that recur

1. **A shift/session list, triageable** — filter by location + date; **sort by variance** (Shopify) or user/date (Lightspeed). `PRIMARY`
2. **Variance surfaced as the primary signal** — over/short in money, flagged when beyond threshold. `PRIMARY`
3. **Active vs closed split** — in-progress drawers shown apart from finished ones (Toast, Square). `PRIMARY`
4. **Drill-down hierarchy** — list → one shift → its event ledger → (Lightspeed) → the denomination count. `PRIMARY`
5. **Traceability** — every shift total decomposes into the events that produced it. `PRIMARY-SPEC`
6. **Export & print everywhere** — CSV + PDF; Shopify offers three export scopes. `PRIMARY`
7. **Notes / reason codes** attached to movements and variances. `PRIMARY`

## Superset of distinct owner/manager actions (tagged by system)

1. List shifts by location + date range — *Square, Toast, Lightspeed, Clover, Shopify*
2. **Sort/triage by discrepancy amount** — *Shopify* (by user/date — *Lightspeed*)
3. Filter by employee / event type / device — *Clover*
4. See expected vs counted cash and the variance — *all*
5. Drill into the shift's event ledger (every movement in sequence) — *Square, Shopify, Lightspeed*
6. Trace a cash entry to its underlying payment/sale — *Square, Shopify*
7. See opening float / starting cash — *all*
8. See pay-ins and pay-outs (lifts/drops) — *all*
9. See cash **refunds** within the shift as a distinct total — *Square*
10. View the **denomination breakdown** of a count — *Lightspeed, Square*
11. See **who opened / who ended / who counted** (separation of duties) — *Square, Toast*
12. See the **reason / description** for a movement or a variance — *Clover, Toast, Square*
13. Compare cash **across locations** — *Shopify*
14. Monitor **active (in-progress)** vs closed shifts — *Toast, Square*
15. See **discrepancy at start** (opening) as well as at end — *Shopify*
16. **Approve** an over/short beyond a threshold — *Toast*
17. **Reopen** a closed shift to reallocate entries / recalc tips — *Toast* (Shopify forbids this)
18. **Close a shift remotely** from the back office — *Shopify*
19. **Complete/close a shift for a departed employee** — *Toast*
20. **Adjust a closed drawer's balance / start balance** — *Toast*
21. Add a **note/comment** to a shift or at close — *Shopify, Toast, Square*
22. **Export CSV** (whole / all / selected) — *Square, Shopify, Lightspeed, Clover*
23. **Print / PDF** a report — *Lightspeed, Shopify*
24. Generate an end-of-day **Z-report / close-out day** — *Toast, Lightspeed*
25. **Reconcile tips** (cash vs credit) per shift — *Toast*
26. Download a **cash-management journal** of lifts/drops — *Lightspeed*
27. Review **no-sale** drawer opens — *Clover, Toast*
28. Set **thresholds/permissions** that gate cash actions — *Toast*

## Where systems disagree

- **Object vs log:** reconciled shift object (Square/Shopify/Toast/Lightspeed) vs event log (Clover).
- **Editable after close:** Toast reopens; Shopify is immutable; Square audits once; Umi is append-only with a `recovered` path.
- **One discrepancy or two:** Shopify tracks opening *and* closing; the rest track closing only.
- **Owner write-power:** Square API is read-only; Clover/Lightspeed read+export; Shopify remote-close+note; Toast full reopen/approve/adjust.
- **State granularity:** Square 3 states; Umi 10 (`opening, open, suspended, handoff_pending, counting, reconciliation_required, closing, closed, blocked, recovered`).

## Implications for the Umi "Turnos de caja" redesign (gaps to close)

*(Umi already matches the core: expected/counted/variance, an append-only ledger, sale linkage, tolerance policy, active/closed split, export button.)*

- **Add an opening (start) discrepancy**, not only the closing one — Shopify's two-discrepancy model; catches overnight/float mismatch.
- **Show separation of duties** — who opened vs who counted vs who approved (Umi has `opening_operator_id`, `responsible_operator_id`, and the approver via `elevation_grant`; Square proves the pattern).
- **Make the count click through to denominations** — Umi stores `opening_denominations` and count denominations as jsonb; Lightspeed proves the interaction.
- **Offer sort-by-variance** on the list — Shopify.
- **Multi-location roll-up** in the pulse — Shopify's cross-location compare.
- **Surface cash refunds as a distinct term** in the cash math — Square `cash_refunds_money`.
- **Three export scopes** (this shift / day / selected) + CSV alongside PDF — Shopify.
- **Name the owner escape hatches in owner language** — `recovered` ≈ "close remotely / recover a stranded drawer" (Shopify/Toast), variance approval ≈ Toast's threshold approval.

---

## Appendix — reachability & unverified

- **Clover** help page (`clover.com/en-US/help/run-cash-log-report`) returned an **empty SPA shell** on fetch; its fields (Event/Amount/Reason/Employee, filters, date ranges) are taken from the **vendor's own search-result description of that page**, not a secondary blog. Treat the exact column names as `PRIMARY (vendor description)` pending a rendered read.
- **Square** states are documented as `OPEN`/`ENDED`/`CLOSED`; the precise semantic boundary between `ENDED` and `CLOSED` ("ended for business" vs "audited/counted") is inferred from the field descriptions (`closed_cash_money` counted "by an auditing employee").
- Not covered (out of scope / not reached): Oracle Simphony/Micros, Revel, NetSuite cash posting. The earlier background run captured "Lightspeed K-series and Oracle" before a session rate-limit terminated it; Oracle notes were not recovered and are omitted rather than sourced from memory.

### Sources
- Square: https://developer.squareup.com/reference/square/objects/CashDrawerShift · https://developer.squareup.com/docs/cashdrawershift-api/reporting · https://developer.squareup.com/reference/square/cash-drawers-api
- Toast: https://support.toasttab.com/en/article/Cash-Management-Overview · https://support.toasttab.com/en/article/Shift-Review-Overview · https://support.toasttab.com/en/article/Close-Out-Day-Z-Report-Auto-Capture
- Lightspeed K-series: https://k-series-support.lightspeedhq.com/hc/en-us/articles/4403156150171-Cash-drawer-report · https://k-series-support.lightspeedhq.com/hc/en-us/articles/360050436394-Managing-cash-drawer-operations · https://k-series-support.lightspeedhq.com/hc/en-us/articles/360051089653-Shift-reports
- Clover: https://www.clover.com/en-US/help/run-cash-log-report
- Shopify: https://help.shopify.com/en/manual/sell-in-person/shopify-pos/cash-register-management/cash-tracking · https://help.shopify.com/en/manual/sell-in-person/shopify-pos/cash-register-management/register-sessions-in-shopify-admin · https://help.shopify.com/en/manual/sell-in-person/shopify-pos/cash-register-management/cash-tracking-reports-by-location
