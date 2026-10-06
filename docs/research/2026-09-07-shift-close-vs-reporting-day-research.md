# Shift-close vs the reporting day: does closing a drawer zero the dashboard, or does a business-day window govern? (Toast, Square, Clover, Lightspeed)

- Date: 2026-09-07
- Question: When a cashier/operator **closes a cash shift** (drawer session / Z-report) in the
  POS, does the back-office **dashboard's sales reporting reset to zero** and start fresh — or
  is dashboard reporting on a separate **calendar / business-day window** (00:00–23:59, or a
  configurable "day start" / close-of-day hour that can span midnight) that is **independent**
  of how many shifts open and close inside it? Determine exactly how Toast, Square, Clover, and
  Lightspeed relate the **cash-drawer shift** to the **reporting day**.
- Scope: six dimensions per vendor — (1) is the drawer/shift decoupled from the sales day (does
  closing a drawer reset the day's dashboard totals, or only reconcile cash while sales keep
  accumulating)? (2) what defines the reporting "day" — a calendar day in the location timezone,
  or a configurable **business day / day-start / close-out hour** that can roll past midnight?
  (3) can several drawer/shift open-closes happen within one reporting day, summed on the
  dashboard? (4) do cash-drawer reconciliation and sales analytics live in **separate reports**?
  (5) does a shift close **trigger** anything on the dashboard (a Z-report/settlement) vs the
  dashboard just showing the running business day? (6) timezone / midnight handling.
- Method: primary sources only — vendor help centers and developer docs for **Toast**
  (`support.toasttab.com`, `doc.toasttab.com`), **Square** (`squareup.com/help`,
  `developer.squareup.com`), **Clover** (`clover.com/help`, `docs.clover.com`), and
  **Lightspeed Restaurant K-Series** (`k-series-support.lightspeedhq.com`). This is a sibling of
  the 2026-09-06 POS/KDS series and reuses its labels: **VENDOR-PRIMARY** (a first-party
  help/dev doc), **VENDOR-MARKETING** (a first-party product/blog page, lighter evidence),
  **SECONDARY** (a non-vendor site, kept only when no primary was found), **INFERENCE** (a
  conclusion derived here). Anything no primary source states is flagged **NOT VERIFIED**.
  Several Clover `clover.com/help` pages and one Lightspeed page render as JavaScript SPA
  shells on fetch; where a fact comes from the vendor's own indexed page text rather than a
  clean rendered read, it is labelled **VENDOR-PRIMARY (indexed description)** and called out in
  the appendix. Companions:
  [Cash-shift management owner UX](2026-09-06-cash-shift-management-owner-ux.md),
  [Void/refund → kitchen propagation](2026-09-06-void-refund-kitchen-propagation-research.md),
  [POS+KDS client architecture](2026-09-06-pos-kds-client-architecture-vendor-research.md).

## 1. Framing — why this maps onto Umi's build

Umi already made the architectural choice this file is testing against the market, and made it
the strong way. **Umi stamps a `business_date` ("fecha operativa") on every sale, cart, receipt,
exception, gift-card entry, loyalty ledger row, and cash-up**, and it derives that date from a
**merchant-level configurable day-start**, not from any drawer:

> `business_day_start time not null default '00:00'` … "When the trading day rolls over. A café
> that serves until 01:00 counts that sale as belonging to the previous day, and its cash-up, its
> revenue report and its receipt must all agree about which day that is. Midnight is the safe
> default; a late-night merchant sets 04:00. **EVERY business_date in this schema is derived from
> this column plus `timezone` by merchant.tg_business_date**, so they cannot disagree with each
> other." ([`20_merchant.sql`](../migration/build-v3/20_merchant.sql))

The derivation trigger subtracts the day-start before casting to a date, exactly so a post-midnight
sale lands on the previous trading day:

> `new.business_date := ((v_at at time zone v_tz) - v_day_start::interval)::date;` … "Subtracting
> business_day_start before casting to date is what makes an 01:00 sale belong to the previous
> trading day." ([`60_triggers.sql`](../migration/build-v3/60_triggers.sql))

Crucially, the sale's `business_date` is **derived, never supplied by the till, and never a
function of a cash shift**: "WHICH TRADING DAY THIS SALE BELONGS TO. Derived by
merchant.tg_business_date from placed_at, the merchant timezone and merchant.business_day_start —
never supplied by a caller" ([`20_merchant.sql`](../migration/build-v3/20_merchant.sql)). Umi's
`merchant.cash_shift` also carries a `business_date` ([`33_pos_cash.sql`](../migration/build-v3/33_pos_cash.sql)),
but it is a **separate reconciliation object** (opening float → cash movements → counted →
variance), not the axis the dashboard sums sales on.

So the concrete question for Umi is a design confirmation: **should closing a cash shift zero the
dashboard's "today" totals (model a), or should the dashboard keep running on the `business_date`
window while shift-close only reconciles cash (model b)?** Umi's schema is already built for (b).
This file checks whether (b) is the industry norm or an outlier — and whether Umi's configurable
`business_day_start` (vs a pure 00:00 calendar day) matches how the leaders behave.

## 2. Comparison table

| Vendor                    | Drawer decoupled from sales day?                                                                                                                                                                                                                                                                                         | Reporting-day definition (calendar vs configurable close-hour)                                                                                                                                                                                                                                                                                                                                        | Multiple shifts/day summed on dashboard?                                                                                                                                                                                    | Separate cash vs sales reports?                                                                                                                                                                                | Midnight / timezone handling                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Toast**                 | **YES.** Cash-drawer closeout and Close Out Day are "separate features"; the Z report "data updates in real time as sales occur," and "Printing the Z Report does not turn the day over" ([Close Out Day/Z](https://support.toasttab.com/en/article/Close-Out-Day-Z-Report-Auto-Capture))                                | **Configurable business day / close-out hour.** Auto-closes "By default at 4:00 a.m." ([Close Out Day/Z](https://support.toasttab.com/en/article/Close-Out-Day-Z-Report-Auto-Capture)); the Z report is "a one-day sales summary for the **entire business day**" ([Close-out overview](https://doc.toasttab.com/doc/platformguide/platformCloseOutDayOverview.html)). Cut-off changed via Toast Care | **YES** — many drawer closes roll up into one business day; drawer reconciliation is per-drawer, the business day is the roll-up ([Cash Mgmt](https://support.toasttab.com/en/article/Cash-Management-Overview))            | **YES.** Cash Management / Shift Review (drawer, over/short) vs Sales Summary (orders & sales) are distinct reports ([Sales Summary](https://support.toasttab.com/en/article/Sales-Summary-Report))            | Auto-close **4:00 a.m. ET** for US, **4:00 a.m. local** for UK/IE/AU/CA ([Close Out Day/Z](https://support.toasttab.com/en/article/Close-Out-Day-Z-Report-Auto-Capture))                                      |
| **Square**                | **YES.** `CashDrawerShift` is its own object; "Cash drawers" is a report **distinct from** "Sales summary" ([Dashboard reports](https://squareup.com/help/us/en/article/5072-summaries-and-reports-from-the-online-dashboard)). Ending a drawer does not touch the sales day                                             | **Configurable reporting hours.** "The **start time will determine the calendar day that sales will be attributed to**"; set multiple custom ranges + timezone ([Reporting hours](https://squareup.com/help/us/en/article/7192-set-up-reporting-hours)). Default is the calendar day                                                                                                                  | **YES.** Multiple `CashDrawerShift`s per location/day, listed by time range; sales sum on the reporting day regardless ([CashDrawerShift API](https://developer.squareup.com/reference/square/objects/CashDrawerShift))     | **YES.** Cash Drawers report vs Sales summary are separate dashboard reports ([Dashboard reports](https://squareup.com/help/us/en/article/5072-summaries-and-reports-from-the-online-dashboard))               | Reporting timeframe carries its **own timezone**; a bar closing past midnight sets the day-start via reporting hours ([Reporting hours](https://squareup.com/help/us/en/article/7192-set-up-reporting-hours)) |
| **Clover**                | **YES.** Batch **closeout is card settlement**, not a sales reset; the **Cash Log** is its own report; dashboard sales run on date ranges ([Voids/refunds](https://docs.clover.com/dev/docs/voids-and-refunds), [Cash Log](https://www.clover.com/en-US/help/run-cash-log-report))                                       | **Calendar date ranges** (Today/Yesterday/Last 7/30/custom) on the dashboard ([Date-range reports](https://www.clover.com/en-US/help/run-historical-reports-with-date-range-filters)). A Toast/Square-style _sales_ day-start hour is **NOT VERIFIED**; batch time is configurable but is a settlement clock                                                                                          | **YES** — batches settle independently; dashboard sums the date range chosen, not per batch ([Closeout settings](https://www.clover.com/en-US/help/understand-closeout-settings))                                           | **YES.** Cash Log (drawer events) vs Sales reports are separate ([Cash Log](https://www.clover.com/en-US/help/run-cash-log-report))                                                                            | Auto-batch closeout time configurable via support (commonly ~default overnight); location-timezone dates. Exact defaults **NOT VERIFIED** (SPA)                                                               |
| **Lightspeed (K-Series)** | **MOSTLY.** Back-office sales run on a **business day**; but the **on-POS Shift report** _is_ a per-"sales period" reset window opened/closed by staff — a real shift-scoped report that coexists with the day ([Shift reports](https://k-series-support.lightspeedhq.com/hc/en-us/articles/360051089653-Shift-reports)) | **Configurable "Start of day."** "Most businesses have a default **Start of day at 5:30 am local time**"; "To adjust your Start of day, contact Support" ([Tempo](https://k-series-support.lightspeedhq.com/hc/en-us/articles/43687798096027-Understanding-Lightspeed-Tempo))                                                                                                                         | **YES.** Several sales periods/shifts in a day; the business day (Start-of-day → next Start-of-day) rolls them up ([Shift reports](https://k-series-support.lightspeedhq.com/hc/en-us/articles/360051089653-Shift-reports)) | **YES.** Cash drawer report (shift→user→drawer, over/short) vs Sales Summary are distinct ([Cash drawer report](https://k-series-support.lightspeedhq.com/hc/en-us/articles/4403156150171-Cash-drawer-report)) | Start-of-day is **local time**; business day spans midnight (e.g. 5:30 → 5:29) ([Tempo](https://k-series-support.lightspeedhq.com/hc/en-us/articles/43687798096027-Understanding-Lightspeed-Tempo))           |

## 3. Per-vendor detail

### 3.1 Toast — a configurable 4:00 a.m. business day; the drawer is a separate feature

Toast is the cleanest statement of model (b): a **business day** governs reporting, closing a
**drawer** does not reset it, and the Z report is a live read of the day, not a settlement that
turns anything over.

- **(1) Drawer decoupled from the sales day.** Toast keeps the two on separate rails. The
  close-out article distinguishes the day-level Close Out Day screen from per-drawer cash
  reconciliation:
  > "Close Out Day is the manager screen on the Toast POS that closes out the business day, paid
  > checks, orders, and clocked-in employees. Cash drawer closeout is the per-drawer cash
  > reconciliation done at end of shift. They are separate features."
  > ([Close Out Day, Z Report, and Auto-Capture](https://support.toasttab.com/en/article/Close-Out-Day-Z-Report-Auto-Capture)) — VENDOR-PRIMARY.
  > And the Z report is a **live** view, not a reset:
  > "Printing the Z Report does not turn the day over. The data updates in real time as sales
  > occur." (same) — VENDOR-PRIMARY.
- **(2) The reporting day is a configurable close-out hour.** Toast auto-rolls the business day
  on a clock, not on a drawer:
  > "By default at 4:00 a.m. each day, Toast will: Close out any unclosed checks that were in
  > Paid status at the time of close." (same) — VENDOR-PRIMARY.
  > The Z report is explicitly a **whole-business-day** summary:
  > "The Z report is a one-day sales summary for the entire business day."
  > ([Close-out overview, platform guide](https://doc.toasttab.com/doc/platformguide/platformCloseOutDayOverview.html)) — VENDOR-PRIMARY.
  > The cut-off hour is configurable (not self-service). Toast documents it as a **default** and
  > routes changes through Customer Care; per Toast support material the business-day cut-off may be
  > set to a time between 12:00 a.m. and 7:00 a.m. in the restaurant's timezone, defaulting to
  > 4:00 a.m. — the "12 a.m.–7 a.m. window" wording is **VENDOR-PRIMARY (indexed description)**; the
  > 4:00 a.m. default and "contact Care to change" are clean primary.
- **(3) Multiple shifts per day summed.** Cash Management runs **per drawer / per employee** with
  its own over/short, while the day rolls all of them up; a shift close reconciles one drawer and
  the business day continues ([Cash Management Overview](https://support.toasttab.com/en/article/Cash-Management-Overview),
  [Shift Review Overview](https://support.toasttab.com/en/article/Shift-Review-Overview)) — VENDOR-PRIMARY.
- **(4) Separate cash vs sales reports.** Sales live in the **Sales Summary** ("breaks down
  orders and sales by service period or by custom hours"; "It records a sale when a check is first
  opened, not when the payment is processed" — [Sales Summary Report](https://support.toasttab.com/en/article/Sales-Summary-Report));
  cash/over-short lives in **Cash Management / Shift Review**. Different reports, different axes. —
  VENDOR-PRIMARY.
- **(5) What a close _triggers_.** The **day** close (4 a.m. auto or manual Close Out Day) is
  what auto-captures card batches and clocks out staff; the **drawer** close only reconciles cash.
  The dashboard is otherwise a running view of the business day, and printing a Z report changes
  nothing ("does not turn the day over"). — VENDOR-PRIMARY.
- **(6) Timezone / midnight.** "4:00 a.m. ET for all US customers, 4:00 a.m. local time for UK,
  Ireland, Australia, and Canada customers" ([Close Out Day/Z](https://support.toasttab.com/en/article/Close-Out-Day-Z-Report-Auto-Capture)).
  Note the US-ET quirk: US business days pivot on **Eastern**, not the store's local time, unless
  changed. — VENDOR-PRIMARY.

### 3.2 Square — reporting hours attribute sales to a day; the cash drawer is a separate object

- **(1) Drawer decoupled.** Square models the drawer as its own first-class object,
  `CashDrawerShift`, with `OPEN` → `ENDED` → `CLOSED` states and its own cash math
  (`opened_cash_money`, `expected_cash_money`, `closed_cash_money`)
  ([CashDrawerShift API](https://developer.squareup.com/reference/square/objects/CashDrawerShift)) —
  VENDOR-PRIMARY (spec). On the dashboard, **"Cash drawers"** is a report listed separately from
  **"Sales summary"** ([Summaries and reports from the online Dashboard](https://squareup.com/help/us/en/article/5072-summaries-and-reports-from-the-online-dashboard)) —
  VENDOR-PRIMARY. Ending a drawer reconciles cash; it does not zero the sales day.
- **(2) The reporting day is configurable "reporting hours."** Square lets you attribute sales to
  a day by a configurable start time, not a fixed midnight:
  > "The **start time will determine the calendar day that sales will be attributed to**."
  > ([Set up reporting hours](https://squareup.com/help/us/en/article/7192-set-up-reporting-hours)) — VENDOR-PRIMARY.
  > You "set up multiple custom time ranges to best represent your business hours" and "choose a
  > timezone." Default behaviour is the plain calendar day; a late-closing venue moves the day-start
  > so post-midnight sales land on the prior day.
- **(3) Multiple shifts per day summed.** `ListCashDrawerShifts` returns all shifts for a
  location over a time range ("scan shift activity … identify which shifts require attention"),
  i.e. many shifts coexist under one day and sales sum across them
  ([CashDrawerShift reporting](https://developer.squareup.com/docs/cashdrawershift-api/reporting)) — VENDOR-PRIMARY.
- **(4) Separate cash vs sales reports.** Confirmed by the dashboard report list: "Sales summary
  … Item sales … Cash drawers …" are distinct entries
  ([Dashboard reports](https://squareup.com/help/us/en/article/5072-summaries-and-reports-from-the-online-dashboard)) — VENDOR-PRIMARY.
- **(5) What a close _triggers_.** Square's cash-drawer API is **read-only reporting**; a drawer
  close writes a reconciliation record (variance), it does not roll the sales day. The dashboard
  shows the running reporting-day totals independently. — VENDOR-PRIMARY (spec).
- **(6) Timezone / midnight.** The reporting timeframe carries its own timezone and start time;
  Square's own guidance to bars closing after midnight is to set reporting hours so the day-start
  is before service and the day runs past midnight
  ([Reporting hours](https://squareup.com/help/us/en/article/7192-set-up-reporting-hours)). — VENDOR-PRIMARY.

### 3.3 Clover — batch closeout is card settlement, not a sales-day reset

Clover is the vendor where the "close resets the day" intuition is most likely to be _wrong_,
because Clover's most prominent "close" is the **payment batch**, which is a settlement clock, not
a reporting boundary.

- **(1) Drawer / batch decoupled from sales.** Clover's "closeout" is a **card-settlement**
  operation: a void works "before the daily batch closes," after which it becomes a refund
  ([Handle voids and refunds](https://docs.clover.com/dev/docs/voids-and-refunds)) — VENDOR-PRIMARY.
  Drawer/cash activity lives in a separate **Cash Log** ("tracks all customer cash transactions
  and manager cash drawer activities," at Dashboard → Sales activity → Cash log)
  ([Run a cash log report](https://www.clover.com/en-US/help/run-cash-log-report)) —
  VENDOR-PRIMARY (indexed description). Neither closing the batch nor the cash log resets the sales
  reports.
- **(2) Reporting day = calendar date ranges.** Clover dashboard sales reports run on
  **Today / Yesterday / Last 7 / Last 30 / custom** date ranges
  ([Run historical reports with date-range filters](https://www.clover.com/en-US/help/run-historical-reports-with-date-range-filters)) —
  VENDOR-PRIMARY (indexed description). A **configurable sales day-start hour** (Toast/Square/
  Lightspeed style) was **NOT VERIFIED** on Clover primary pages; the configurable time Clover
  documents is the **auto-batch closeout / settlement time**, changed via merchant support
  ([Understand closeout methods and settings](https://www.clover.com/en-US/help/understand-closeout-settings),
  [Check details for an automatic batch closeout](https://www.clover.com/en-US/help/check-details-for-an-automatic-batch-closeout)) —
  which governs funding, not the reporting-day boundary.
- **(3) Multiple batches/day summed.** Batches settle independently and can run more than once;
  the dashboard sums whatever **date range** is selected, not per-batch. — INFERENCE grounded in
  the date-range reporting model.
- **(4) Separate cash vs sales reports.** Cash Log (Event / Amount / Reason / Employee; filter by
  employee/event/device) is distinct from Sales reports
  ([Cash Log](https://www.clover.com/en-US/help/run-cash-log-report)) — VENDOR-PRIMARY (indexed description).
- **(5) What a close _triggers_.** A batch closeout submits card transactions for clearing and
  emails a closeout report; it is a **settlement** event, not a sales-day turnover. — VENDOR-PRIMARY
  (voids/refunds dev doc) + indexed description.
- **(6) Timezone / midnight.** Dates follow the location; the auto-batch time is configurable via
  support. Exact default closeout hour and any sales day-start hour are **NOT VERIFIED** (help
  pages are SPA shells).

### 3.4 Lightspeed (K-Series) — a configurable "Start of day" business day, plus an on-POS shift report

Lightspeed is the important nuance: it has **both** a business-day window _and_ a genuine
shift-scoped on-POS report — so it partly supports the "shift resets a report" intuition, but only
for the **on-terminal Shift report**, not the back-office business day.

- **(1) Drawer decoupled — mostly.** The **cash drawer report** (hierarchy shift → user →
  drawer; columns Reported / Lifts-drops / Takings / Total / Difference) is a reconciliation report
  distinct from sales analytics ([Cash drawer report](https://k-series-support.lightspeedhq.com/hc/en-us/articles/4403156150171-Cash-drawer-report)) —
  VENDOR-PRIMARY. **But** the on-POS **Shift report** _is_ a per-shift window: "A sales period is
  the period between when an employee starts it and the same or another employee ends it," and it
  "shows the sales and business data for the current sales period, a sales period on the current
  day, or the previous day's sales period"
  ([Shift reports](https://k-series-support.lightspeedhq.com/hc/en-us/articles/360051089653-Shift-reports)) —
  VENDOR-PRIMARY. So a staff-opened sales period does scope _that_ report; the **Back Office** sales
  reports still run on the business day and date range.
- **(2) The reporting day is a configurable "Start of day."** Lightspeed derives its business day
  from a configurable start hour:
  > "Most businesses have a default **Start of day at 5:30 am local time**." … "To adjust your
  > **Start of day**, contact Support." … "Tempo updates its data once per day, depending on the
  > restaurant's Start of day."
  > ([Understanding Lightspeed Tempo](https://k-series-support.lightspeedhq.com/hc/en-us/articles/43687798096027-Understanding-Lightspeed-Tempo)) —
  > VENDOR-PRIMARY. The business day therefore spans midnight (e.g. 5:30 a.m. → 5:29 a.m. next day) —
  > the "5:30→5:29" framing is INFERENCE from the Start-of-day quote plus the business-settings model.
- **(3) Multiple shifts per day summed.** Several sales periods/shifts can open and close in one
  day; the business day (Start-of-day → next Start-of-day) is the roll-up the Back Office reports on
  ([Shift reports](https://k-series-support.lightspeedhq.com/hc/en-us/articles/360051089653-Shift-reports)). — VENDOR-PRIMARY.
- **(4) Separate cash vs sales reports.** Cash drawer report (over/short, denominations) vs Sales
  Summary are separate ([Cash drawer report](https://k-series-support.lightspeedhq.com/hc/en-us/articles/4403156150171-Cash-drawer-report),
  [About Reports](https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804657209-About-Reports)) — VENDOR-PRIMARY.
- **(5) What a close _triggers_.** Ending a **sales period/shift** finalizes that on-POS Shift
  report (the closest thing here to a "shift Z-report"); it does **not** reset the Back Office
  business-day sales. Closing the **cash drawer** reconciles cash only. — VENDOR-PRIMARY + INFERENCE.
- **(6) Timezone / midnight.** Start of day is **local time**, configurable via Support; the day
  spans midnight by design. — VENDOR-PRIMARY.

## 4. VERDICT + RULES FOR UMI

### 4.1 Verdict — it is a business-day window, not a shift reset

**The industry norm is model (b), decisively.** Across all four leaders, the back-office
**dashboard runs on a reporting/business-day window**, and closing a cash drawer/shift **only
reconciles cash** — it never zeros the day's sales totals. Sales accumulate on the day regardless
of how many drawers open and close inside it; **cash reconciliation and sales analytics are
separate reports on separate axes** at every vendor. Three of the four even reject the _pure_
calendar day in favour of a **configurable day-start / close-out hour that spans midnight**: Toast
(default 4:00 a.m., cut-off configurable via Care), Square (reporting-hours start time "determines
the calendar day that sales will be attributed to"), and Lightspeed (Start of day, default
5:30 a.m. local, configurable via Support). Clover is the exception on configurability — its
dashboard reports on plain **calendar date ranges**, and its most prominent "close" (batch
closeout) is a **card-settlement clock**, not a reporting-day boundary; a configurable _sales_
day-start hour was **NOT VERIFIED** for Clover. The only place a "shift" scopes a report is
Lightspeed's **on-POS Shift report** for one sales period — and even that coexists with the
business-day Back Office reports rather than replacing them. **A shift close never resets the
dashboard; the business-day window does the roll-over.**

### 4.2 Rules for Umi

1. **Keep model (b). Never let shift-close zero the dashboard.** Umi's design is already correct
   and already matches all four leaders: the dashboard sums on `business_date`, and
   `cash_shift`/`cash_ledger_entry` reconcile cash on a parallel track. A shift close writes a
   reconciliation (opening float → movements → counted → variance); it must **not** touch "ventas
   de hoy." Treat this file as confirmation to ship (b), not (a).
2. **Umi's configurable `business_day_start` is the right choice, and it beats a pure calendar
   day.** Three of four leaders use a configurable day-start hour precisely for cafés/bars that
   serve past midnight — exactly Umi's `business_day_start` default `'00:00'` with a late-night
   café setting `'04:00'`. Keep it; do **not** hardcode 00:00. Umi already derives _every_
   `business_date` (sale, cart, receipt, exception, gift card, loyalty, cash-up) from that one
   column via `tg_business_date`, which is the single-source-of-truth property Toast calls out
   ("its cash-up, its revenue report and its receipt must all agree about which day that is").
3. **Expose `business_day_start` in the dashboard as an owner setting ("Inicio del día
   operativo" / hora de corte).** Toast, Square, and Lightspeed all gate this behind support;
   Umi can make it **self-service**, which is a genuine differentiator. Guard it: a change should
   be forward-looking (do not silently re-bucket historical `business_date`s — the trigger
   re-derives on UPDATE, so re-stamping old rows must be a deliberate, audited operation, not a
   side effect).
4. **Keep cash reconciliation and sales analytics as two reports.** Match the universal split:
   "Turnos de caja" (variance, over/short, denominations, per-drawer/per-operator) vs a sales
   summary/overview keyed on `business_date`. Do not merge the drawer variance into the sales
   figure; Square/Toast/Lightspeed all keep them apart, and Umi's schema already does.
5. **Many shifts per business day must roll up, not reset.** A café that changes baristas three
   times has three `cash_shift`s inside one `business_date`; the dashboard sums all sales on that
   date and shows three drawer reconciliations beneath. This is the Toast/Square/Lightspeed
   behaviour verbatim.
6. **A drawer close should _trigger_ only cash-side finalization** (variance calc, custody
   release, optional receipt/Z-style drawer report) — **not** a sales-day turnover. If Umi ever
   wants a per-shift "Z report" surface, model it on Lightspeed's on-POS **Shift report** (a
   read scoped to one shift/sales-period) that lives _alongside_ the business-day dashboard, never
   replacing it.
7. **Be explicit about the timezone pivot.** Umi already derives `business_date` from the
   **merchant `timezone`** (`v_at at time zone v_tz`), which is better than Toast's US-ET quirk
   (US Toast days pivot on Eastern, not store-local). Keep local-timezone derivation; surface the
   effective day-start + timezone in the dashboard so owners can see why a 01:00 sale is on
   "yesterday."

## 5. Not verifiable from primary sources (flagged, not guessed)

- **Toast:** the exact "cut-off can be set between 12:00 a.m. and 7:00 a.m." window is from Toast
  support **indexed text**, not a cleanly rendered quote; the 4:00 a.m. default, US-ET vs local,
  "does not turn the day over," and the drawer-vs-day separation are clean VENDOR-PRIMARY.
- **Square:** whether ending a `CashDrawerShift` has _any_ effect on sales reporting is confirmed
  negative by the separate-report model but not stated as a sentence; the reporting-hours
  day-start quote is clean primary.
- **Clover:** the biggest gap. Whether Clover offers a **configurable sales day-start hour** (as
  opposed to the batch-settlement time) is **NOT VERIFIED** — the `clover.com/help` reporting and
  closeout pages render as SPA shells; date-range reporting and the Cash-Log/sales split are from
  the vendor's indexed page text. The exact default auto-batch closeout hour is **NOT VERIFIED**.
- **Lightspeed:** the "5:30 a.m. → 5:29 a.m." business-day span is INFERENCE from the Start-of-day
  quote; the Start-of-day default (5:30 a.m. local) and "contact Support to adjust" are clean
  primary. Whether the on-POS Shift report and the Back Office business day can ever disagree on a
  sale's day is not documented.

## 6. Primary sources

Toast:

- Close Out Day, Z Report, and Auto-Capture (4 a.m. default; "does not turn the day over"; drawer vs day are separate features; ET vs local): https://support.toasttab.com/en/article/Close-Out-Day-Z-Report-Auto-Capture
- Close-out day overview — platform guide ("Z report is a one-day sales summary for the entire business day"): https://doc.toasttab.com/doc/platformguide/platformCloseOutDayOverview.html
- Sales Summary Report (orders/sales by service period or custom hours; sale recorded at check open): https://support.toasttab.com/en/article/Sales-Summary-Report
- Cash Management Overview (per-drawer cash, separate from the day): https://support.toasttab.com/en/article/Cash-Management-Overview
- Shift Review Overview (per-shift over/short reconciliation): https://support.toasttab.com/en/article/Shift-Review-Overview

Square:

- Set up reporting hours ("start time will determine the calendar day that sales will be attributed to"; custom ranges; timezone): https://squareup.com/help/us/en/article/7192-set-up-reporting-hours
- Summaries and reports from the online Dashboard (Sales summary vs Cash drawers are separate reports): https://squareup.com/help/us/en/article/5072-summaries-and-reports-from-the-online-dashboard
- CashDrawerShift object (OPEN/ENDED/CLOSED; own cash math): https://developer.squareup.com/reference/square/objects/CashDrawerShift
- Cash Drawer Shift reporting (list shifts by location + time range): https://developer.squareup.com/docs/cashdrawershift-api/reporting

Clover:

- Handle voids and refunds ("before the daily batch closes" — batch = settlement clock): https://docs.clover.com/dev/docs/voids-and-refunds
- Run a cash log report (Cash Log is its own report; drawer events): https://www.clover.com/en-US/help/run-cash-log-report
- Run historical reports with date-range filters (Today/Yesterday/custom): https://www.clover.com/en-US/help/run-historical-reports-with-date-range-filters
- Understand closeout methods and settings / Check details for an automatic batch closeout (configurable batch time): https://www.clover.com/en-US/help/understand-closeout-settings · https://www.clover.com/en-US/help/check-details-for-an-automatic-batch-closeout

Lightspeed (K-Series):

- Understanding Lightspeed Tempo ("Start of day at 5:30 am local time"; "contact Support" to adjust): https://k-series-support.lightspeedhq.com/hc/en-us/articles/43687798096027-Understanding-Lightspeed-Tempo
- Shift reports ("A sales period is the period between when an employee starts it and … ends it"; current/previous day's sales period): https://k-series-support.lightspeedhq.com/hc/en-us/articles/360051089653-Shift-reports
- Cash drawer report (shift→user→drawer; Reported/Lifts-drops/Takings/Total/Difference): https://k-series-support.lightspeedhq.com/hc/en-us/articles/4403156150171-Cash-drawer-report
- About Reports (Back Office sales reports by date range): https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804657209-About-Reports

Umi (internal, for framing):

- `docs/migration/build-v3/20_merchant.sql` — `business_day_start`; sale `business_date` derived, never caller-supplied
- `docs/migration/build-v3/60_triggers.sql` — `merchant.tg_business_date()` (subtract day-start, cast to date)
- `docs/migration/build-v3/33_pos_cash.sql` — `merchant.cash_shift` / `cash_ledger_entry` carry their own `business_date`
