# Void / refund → kitchen propagation: how Toast, Square, Clover, and Lightspeed handle the KDS when an item is killed

- Date: 2026-09-06
- Question: When a POS item is **voided** or **refunded**, how do the leaders handle the
  **kitchen (KDS) side** — and specifically the split between an item that is **already made**
  versus **not yet started**? Umi is building the propagation logic and needs the leaders'
  documented rules, from **primary** docs (help centers, developer docs), not SEO blogs.
- Scope: six dimensions per vendor — (1) void vs refund terms (and comp/exchange),
  (2) does a void/cancel propagate to the KDS in real time so the cook stops, (3) already-made
  / waste handling (reason codes, waste vs restock), (4) item-level vs whole-ticket,
  (5) timing gates (when voiding is no longer allowed and you must refund), (6) the
  inventory / restock link. **Kiosk is out of scope** and is not covered.
- Method: primary sources only — vendor help centers and developer docs for **Toast**
  (`support.toasttab.com`, `doc.toasttab.com`), **Square / Square for Restaurants**
  (`squareup.com/help`), **Clover** (`docs.clover.com`), and **Lightspeed**
  (`k-series-support.lightspeedhq.com`). This is the **fourth** file in the 2026-09-06
  POS/KDS series and reuses its labels: **VENDOR-PRIMARY** (a first-party help/dev doc),
  **VENDOR-MARKETING** (a first-party product/blog page, lighter evidence), **SECONDARY** (a
  non-vendor site, kept only when no primary was found), **INFERENCE** (a conclusion derived
  here). Anything no primary source states is flagged **NOT VERIFIED** rather than guessed.
  Sibling files:
  [POS+KDS client architecture](2026-09-06-pos-kds-client-architecture-vendor-research.md),
  [kiosk & device-role boundaries](2026-09-06-pos-kiosk-and-device-role-boundaries-research.md),
  [POS/KDS feature inventory](2026-09-06-restaurant-pos-kds-feature-inventory-research.md).

## 1. Framing — why this maps onto Umi's build

Umi is adding **state-aware fulfillment propagation**. On the money side, Umi already treats a
refund as **append-only**: a sale exception (`pos_sale_exception`) records the reversal without
mutating the original committed sale, and the Orders view should read **net-of-refund** rather
than editing history. The open question is the **fulfillment side**: when a barista voids or
refunds a line, what should the KDS do — and that answer depends on **where the item is in its
prep lifecycle** (queued vs preparing vs ready/made). The leaders converge on one principle
worth stealing: **a void is a pre-fulfillment removal and a refund/comp is a post-fulfillment
money+waste event**, and the KDS must be told either way so the cook stops (or knows the food
already made is now waste). The most transferable single rule — stated in Square's own primary
docs — is that the **prep state decides the verb**: not-yet-made → **void**; already-made →
**comp/refund** (the food is gone, the money is returned, and inventory stays depleted). This
file pins down each vendor's documented behavior so Umi's propagation state machine is
evidence-led, not invented.

## 2. Comparison table

| Vendor                    | Void vs Refund terms (+comp)                                                                                                                                                                                                                                                                                                                  | KDS void propagation (real-time?)                                                                                                                                                                                                                                                                                                                                                                                                                                    | Already-made / waste handling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Item vs whole-ticket                                                                                                                                                                                                                                                                                                                                            | Timing / state gates                                                                                                                                                                                                                                                                                                                                                                      | Inventory / restock link                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Toast**                 | **Void** = kill a check/item/same-day payment "as if it never happened"; **Refund** = money back after capture; **Comp** referenced separately. "Voiding an item alone does not refund money… Voiding the payment… is what reverses the charge" ([void vs refund](https://support.toasttab.com/en/article/Understand-when-to-void-vs-refund)) | **YES, explicit.** "When a check is voided, '(VOIDED)' appears on corresponding KDS tickets **with lines through the voided items**" ([voiding checks](https://doc.toasttab.com/doc/platformguide/adminVoidingOrders.html)) — VENDOR-PRIMARY                                                                                                                                                                                                                         | Void **reason** prompted if configured ([voiding checks](https://doc.toasttab.com/doc/platformguide/adminVoidingOrders.html)); waste is a **separate** system — log "item, quantity, and reason," auto-deducted from inventory ([waste tracking](https://support.toasttab.com/en/article/Toast-Inventory-Tracking-and-Managing-Waste-Canada-Ireland-and-UK)). "Void food not made / comp food already made" widely attributed to Toast but **not** verbatim-verified on a primary page this pass — **NOT VERIFIED** | **Both.** Item-level workflow "when one item on an open check needs to be removed **after it has already been sent to the kitchen**"; whole-check workflow; multi-check void ([voiding items](https://support.toasttab.com/en/article/Voiding-Items-Payments-and-Checks), [voiding checks](https://doc.toasttab.com/doc/platformguide/adminVoidingOrders.html)) | "Until the check payment is captured, you can void… **After the payment is captured, you cannot void the check. You must refund**" ([voiding checks](https://doc.toasttab.com/doc/platformguide/adminVoidingOrders.html)). "Check items can only be voided if they have been sent to the kitchen" ([adjustments](https://doc.toasttab.com/doc/platformguide/platformPwfAdjustments.html)) | Void reverses the sale; **waste is logged separately** and depletes inventory ([waste tracking](https://support.toasttab.com/en/article/Toast-Inventory-Tracking-and-Managing-Waste-Canada-Ireland-and-UK)). Comp-keeps-inventory-depleted vs void-restores: principle holds via Square primary; Toast-primary exact wording **NOT VERIFIED** |
| **Square**                | **Void** = "close an open ticket without processing a payment, which removes all existing items"; **Comp** = "give goods or services… without asking for payment"; **Refund** = after the sale ([comp & void](https://squareup.com/help/us/en/article/5814-get-started-with-comp-and-void))                                                   | **YES.** After send, "**Items and Carts cannot be deleted, only voided.** This allows you to keep track of orders that change after already being sent to Square KDS" ([KDS+Retail](https://squareup.com/help/us/en/article/8199-get-started-with-square-kds-and-square-for-retail)); a **"Void tickets"** printer job routes voids to the kitchen ([printer profiles](https://squareup.com/help/us/en/article/8245-set-up-printer-profiles))                        | **Reason required** on every comp/void ([manage checks](https://squareup.com/help/us/en/article/8166-comp-void-and-reassign-checks-with-square-for-restaurants)). Prep-state rule is explicit (see cell 5). "A comped item will show in sales reports **as well as inventory reporting**" ([manage checks](https://squareup.com/help/us/en/article/8166-comp-void-and-reassign-checks-with-square-for-restaurants))                                                                                                 | **Both.** Comp/void a single item (tap item → ••• → Comp/Void) **or** whole check (Actions → Comp/Void check) ([manage checks](https://squareup.com/help/us/en/article/8166-comp-void-and-reassign-checks-with-square-for-restaurants))                                                                                                                         | **Prep state decides the verb**: "If an item was ordered **but not yet prepared**… **void** the item"; if already prepared, **comp** ([comp & void](https://squareup.com/help/us/en/article/5814-get-started-with-comp-and-void))                                                                                                                                                         | **Comp keeps inventory depleted** ("shows in… inventory reporting"); **void** carries **no** inventory-report entry ([manage checks](https://squareup.com/help/us/en/article/8166-comp-void-and-reassign-checks-with-square-for-restaurants)). Explicit restock decision on void — **NOT VERIFIED**                                           |
| **Clover**                | **Void** = "cancel a sale" before settlement; **Refund** = "partial or complete repayment… after the transaction is settled" ([voids & refunds](https://docs.clover.com/dev/docs/voids-and-refunds))                                                                                                                                          | **NOT VERIFIED** — dev docs treat void/refund as a **payment** operation; no KDS void-display behavior documented ([voids & refunds](https://docs.clover.com/dev/docs/voids-and-refunds))                                                                                                                                                                                                                                                                            | **NOT VERIFIED** on primary — no waste/restock rule in the void/refund dev docs                                                                                                                                                                                                                                                                                                                                                                                                                                     | Dev docs operate at the **payment/order** level; **line-item** void/refund not documented there — **NOT VERIFIED**                                                                                                                                                                                                                                              | **Hard 25-min gate.** "A void applies to cancel a sale for **25 minutes**… If a void is attempted after 25 minutes, Clover processes it **as a refund**" ([voids & refunds](https://docs.clover.com/dev/docs/voids-and-refunds))                                                                                                                                                          | **NOT VERIFIED** on primary void/refund docs                                                                                                                                                                                                                                                                                                  |
| **Lightspeed (K-Series)** | Terms not defined on the KDS pages; POS-side "cancel" surfaces on KDS (see next cell) — void/refund **term** definitions **NOT VERIFIED** here                                                                                                                                                                                                | **Modifications, yes; void specifically inferred.** "If an order sent to the KDS is **modified from a POS device**, its order ticket **will blink with the new information until a user taps on it to confirm**" ([using KDS 2.0](https://k-series-support.lightspeedhq.com/hc/en-us/articles/22708154090267-Using-the-Kitchen-Display-System-2-0)); KDS-side cancel: "A ticket can be **canceled at any time via KDS** by using a long-press… selecting _Canceled_" | **NOT VERIFIED** — no waste/reason-code rule on the KDS pages                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Ticket status is per-ticket; item-level cancel from POS **NOT VERIFIED**                                                                                                                                                                                                                                                                                        | **NOT VERIFIED** on primary                                                                                                                                                                                                                                                                                                                                                               | **NOT VERIFIED** on primary                                                                                                                                                                                                                                                                                                                   |

## 3. Per-vendor detail

### 3.1 Toast — the clearest KDS void propagation, plus a payment-settlement timing gate

- **Void vs refund vs comp.** Toast separates a **void** (kill the check/item/same-day payment)
  from a **refund** (money back after capture). The distinction is **payment settlement**, not
  only fulfillment:
  > "Use a void to reverse a payment before the daily batch closes (~9:30 p.m. ET on the same
  > business day)." … "Use a refund when the payment has already been captured and either: The
  > current business day's batch has already closed… or The payment was captured on a previous
  > business day."
  > ([Understand when to void vs refund](https://support.toasttab.com/en/article/Understand-when-to-void-vs-refund)) — VENDOR-PRIMARY.
  > Critically, **voiding the item and voiding the money are two acts**:
  > "Voiding an item alone does not refund money to the customer. Voiding the payment (in
  > addition to the items) is what reverses the charge." (same page) — VENDOR-PRIMARY.
  > This is the same append-only intuition Umi already has: a line void is a fulfillment event; a
  > refund is a separate money event.
- **KDS propagation is explicit and real-time — the single best quote in this file.**
  > "When a check is voided, '(VOIDED)' appears on corresponding KDS tickets with lines through
  > the voided items."
  > ([Voiding checks — platform guide](https://doc.toasttab.com/doc/platformguide/adminVoidingOrders.html)) — VENDOR-PRIMARY.
  > Note the design choice: the voided item is **struck through, not erased**. The cook sees that
  > the item is dead (stop making it / this is now waste), rather than the line silently
  > vanishing — which would be ambiguous and dangerous.
- **Item-level, after it's already been fired.** Toast documents a dedicated single-item
  workflow explicitly for the post-fire case:
  > "Use this workflow when one item on an open check needs to be removed after it has already
  > been sent to the kitchen."
  > and a separate whole-check workflow "when every item on an open check needs to be voided"
  > ([Void Items, Payments, and Checks](https://support.toasttab.com/en/article/Voiding-Items-Payments-and-Checks)) — VENDOR-PRIMARY.
  > You can also "Select multiple open checks to void at the same time" or "a single open, paid,
  > or closed check" ([voiding checks](https://doc.toasttab.com/doc/platformguide/adminVoidingOrders.html)).
- **Reasons.** Void reasons are configurable and prompted:
  > "If you have void reasons configured, then when a restaurant employee voids a check, they
  > are prompted to select a reason."
  > ([voiding checks](https://doc.toasttab.com/doc/platformguide/adminVoidingOrders.html)); and
  > "Void reasons must be configured in Toast Web before staff can select them on the POS"
  > ([Void Items, Payments, and Checks](https://support.toasttab.com/en/article/Voiding-Items-Payments-and-Checks)) — VENDOR-PRIMARY.
- **Timing / state gate.** Payment capture is the wall between void and refund:
  > "Until the check payment is captured, you can void the check to cancel the payment and the
  > menu item selections." … "After the payment is captured, you cannot void the check. You
  > must refund the check amount."
  > ([voiding checks](https://doc.toasttab.com/doc/platformguide/adminVoidingOrders.html)) — VENDOR-PRIMARY.
  > Reinforced in the refunds/voids guide: "You can void items in an order until a payment is
  > captured. After the payment is captured, you must refund the payment on the items." and a
  > strong ordering rule: "Do not attempt to void items before or after you issue a refund on a
  > check. Voiding items before or after you issue a refund can cause problems with Toast POS
  > behavior and Toast reporting information."
  > ([Refunds and voids](https://doc.toasttab.com/doc/platformguide/adminRefundsAndVoids.html)) — VENDOR-PRIMARY.
  > One nuance about the _fulfillment_ gate rather than the money gate: an item-level adjustment
  > page states, "Check items can only be voided if they have been sent to the kitchen"
  > ([Adjustments](https://doc.toasttab.com/doc/platformguide/platformPwfAdjustments.html)) —
  > VENDOR-PRIMARY — i.e., voiding is the tool for **fired** items, which is exactly the
  > propagation case Umi cares about.
- **Waste and inventory.** Toast handles **waste as its own system**, separate from the void
  action:
  > "When a prep item or ingredient is added to waste tracking, they are automatically deducted
  > from your restaurant's inventory count." … "Add the **item**, **quantity**, and **reason**
  > to keep inventory accurate." … choose "**Other**" if the reason isn't listed.
  > ([Toast Inventory: Tracking and Managing Waste](https://support.toasttab.com/en/article/Toast-Inventory-Tracking-and-Managing-Waste-Canada-Ireland-and-UK)) — VENDOR-PRIMARY (region-specific: AU/CA/IE/UK).
- **NOT VERIFIED (Toast):** the popular formulation "**void food that was not made; comp/discount
  food that was already made**, because a void restores inventory and a comp leaves it
  depleted" is widely attributed to Toast in secondary write-ups, but I could **not** pull it
  verbatim from a primary Toast page in this pass. The primary Toast pages establish the
  void↔refund payment gate, the KDS strike-through, and a **separate** waste-tracking system;
  the inventory-restore-vs-keep-depleted contrast is confirmed **on Square's primary docs**
  (below), not Toast's, so treat the Toast wording as SECONDARY.

### 3.2 Square — prep state literally decides the verb (void vs comp)

Square gives the cleanest primary statement of the exact rule Umi is designing:

- **Definitions.**
  > "Comp, short for complimentary, is when you give goods or services to a customer without
  > asking for payment." … "Void is when you close an open ticket without processing a payment,
  > which removes all existing items and closes out the ticket immediately."
  > ([Comp and void open tickets](https://squareup.com/help/us/en/article/5814-get-started-with-comp-and-void)) — VENDOR-PRIMARY.
- **Prep state decides which one — the load-bearing quote.**
  > "If an item was ordered but not yet prepared, team members can void the item to remove it
  > from the customer bill." … "Applying a comp to an item removes the cost of the item from
  > the customer bill. Items can be comped to fix a mistake, or as a goodwill gesture."
  > ([Comp and void open tickets](https://squareup.com/help/us/en/article/5814-get-started-with-comp-and-void)) — VENDOR-PRIMARY.
  > Square's worked scenario: a server adds the wrong item and catches it **after the kitchen
  > received the order** — **not yet started → void**, **already prepared → comp**. This is the
  > queued-vs-made fork stated in a vendor's own help center.
- **Reasons are mandatory** on both:
  > "The reasons you set up in your Square Dashboard show on your point of sale app when you
  > comp or void tickets."
  > ([Comp and void open tickets](https://squareup.com/help/us/en/article/5814-get-started-with-comp-and-void)); and per-action "Select a reason for comp" / "Select a reason for void"
  > ([Comp, void, and reassign checks](https://squareup.com/help/us/en/article/8166-comp-void-and-reassign-checks-with-square-for-restaurants)) — VENDOR-PRIMARY.
- **Item vs whole ticket — both, symmetric.**
  > Item: "Tap the item you'd like to comp/void. Tap the (•••) three dots icon > Comp / Void."
  > Check: "Tap Actions > Comp check" / "Tap Actions > Void check."
  > ([Comp, void, and reassign checks](https://squareup.com/help/us/en/article/8166-comp-void-and-reassign-checks-with-square-for-restaurants)) — VENDOR-PRIMARY.
- **KDS propagation.** After an order is sent, Square does **not** delete on the KDS — it
  **voids in place** so the change is visible:
  > "Items and Carts cannot be deleted, only voided. This allows you to keep track of orders
  > that change after already being sent to Square KDS."
  > ([Set up Square KDS and Square for Retail](https://squareup.com/help/us/en/article/8199-get-started-with-square-kds-and-square-for-retail)) — VENDOR-PRIMARY.
  > For printer-based kitchens, a dedicated **"Void tickets"** printer job type routes voids to
  > the station
  > ([Set up printer profiles](https://squareup.com/help/us/en/article/8245-set-up-printer-profiles)) — VENDOR-PRIMARY.
  > (A fuller "Auto print void ticket prints a kitchen void ticket when you delete items or void
  > a whole order" phrasing appears in Square-derived summaries; the **existence** of the void-ticket
  > job is primary, the exact trigger sentence is SECONDARY.)
- **Recall on the KDS** (the "I bumped it by mistake / re-open it" path):
  > "Tap **Recall** at the bottom of the ticket in the completed view. The ticket will now
  > appear in the open tab again."
  > ([Complete and recall orders](https://squareup.com/help/us/en/article/8171-complete-orders-with-square-kds)) — VENDOR-PRIMARY.
  > There's a 3-second undo on completion, too.
- **Inventory link.**
  > "A comped item will show in sales reports as well as inventory reporting."
  > ([Comp, void, and reassign checks](https://squareup.com/help/us/en/article/8166-comp-void-and-reassign-checks-with-square-for-restaurants)) — VENDOR-PRIMARY.
  > So a **comp keeps inventory depleted** (the food was consumed/wasted) and shows in reporting,
  > while a **void** carries no such inventory-report entry — matching Square's "void = never
  > prepared" definition. An explicit **restock-vs-waste toggle** on void is **NOT VERIFIED**.

### 3.3 Clover — a strict 25-minute void→refund clock (payment-level), KDS not documented

- **Void vs refund + a hard timing gate.** Clover's developer docs make the void/refund line a
  **settlement clock**:
  > "A void applies to cancel a sale for 25 minutes of the original transaction. The merchant
  > can only refund the customer when the time elapses because the transaction goes through the
  > funding process. If a void is attempted after 25 minutes, Clover processes it as a refund."
  > ([Handle voids and refunds](https://docs.clover.com/dev/docs/voids-and-refunds)) — VENDOR-PRIMARY.
  > "Voids undo two types of transactions. Sales [and] Pre-authorizations"; "A refund is a partial
  > or complete repayment given to a customer for a specific order." (same) — VENDOR-PRIMARY.
- **KDS / fulfillment / waste / line-item / inventory:** the void/refund dev docs are a
  **payment** concern and say nothing about the KDS, waste, per-line propagation, or inventory
  restock — all **NOT VERIFIED** from Clover primary sources in this pass. Clover does have a
  KDS product, but its void→kitchen behavior is not documented on the pages read.

### 3.4 Lightspeed (K-Series) — POS modifications blink on the KDS until acknowledged

- **Real-time modification propagation (the strongest transferable signal).**
  > "If an order sent to the KDS is modified from a POS device, its order ticket will blink with
  > the new information until a user taps on it to confirm the update."
  > ([Using the Kitchen Display System 2.0](https://k-series-support.lightspeedhq.com/hc/en-us/articles/22708154090267-Using-the-Kitchen-Display-System-2-0)) — VENDOR-PRIMARY.
  > This is an **acknowledge-the-change** pattern: a POS-side change forces an active alert the
  > cook must clear, rather than a silent update.
- **Cancel is a first-class ticket status (on the KDS side).**
  > "A ticket can be canceled at any time via KDS by using a long-press to bring up the Status
  > selection menu and selecting _Canceled_."
  > (same page) — VENDOR-PRIMARY.
- **INFERENCE:** a POS-initiated **void** is a species of "modification," so by Lightspeed's
  documented rule it would surface on the KDS as a blinking change requiring acknowledgment.
  Lightspeed does **not** explicitly document the void's on-screen treatment, waste handling,
  line-vs-ticket granularity, timing gates, or inventory link on the pages read — all **NOT
  VERIFIED**.

## 4. RULES FOR UMI (evidence-led synthesis)

The leaders agree on three things worth adopting verbatim as principles: (a) **the kitchen must
be told** — never let a voided/refunded line silently disappear from the KDS; (b) **prep state
picks the verb** — pre-fulfillment removal (void) vs post-fulfillment money+waste (comp/refund);
(c) **reasons are captured** at the moment of the action. Concrete rules:

- **Model prep state as the switch, not payment state.** Square's primary rule — "not yet
  prepared → void; already prepared → comp" — is the cleanest fit for Umi's KDS. Drive
  propagation off the line's **fulfillment state** (`queued` → `preparing` → `ready/made` /
  `completed`), which the KDS already owns, rather than off payment status. (Payment state is a
  _second, independent_ gate for the money leg — see the last bullet.) [Evidence: Square
  primary; Toast "items can only be voided if sent to the kitchen" primary.]
- **queued (fired, not started) → CANCEL/RECALL the line.** Remove it from the active make
  queue. Following Toast, prefer **strike-through, not erase**, so the cook sees a line died
  rather than wondering if it scrolled off: "'(VOIDED)' appears… with lines through the voided
  items." No waste; inventory may be restored (INFERENCE — see restock bullet). [Evidence:
  Toast primary KDS strike-through; Square "void = not yet prepared" primary.]
- **preparing (in progress) → FLAG + STOP, then treat as waste.** Push a real-time,
  acknowledge-required alert to the KDS (Lightspeed's "blink until a user taps to confirm"),
  strike the line, and record the partial as **waste** with a reason, not a clean restock. This
  is the case most likely to be mishandled; the cook has invested product. [Evidence:
  Lightspeed primary modification-blink; Toast waste system primary.]
- **ready / completed (already made) → cannot un-make; ANNOTATE + waste-or-restock decision.**
  The food exists. Do not pretend it was never fired. Record the removal, keep inventory
  **depleted by default** (the Square "comp shows in inventory reporting" behavior), and ask a
  **waste vs restock** question only for genuinely restockable goods (a sealed retail item, an
  untouched packaged drink). Made-to-order food is waste, full stop. [Evidence: Square primary
  comp/inventory; Toast waste primary.]
- **Always capture a reason at the void/refund moment.** Both Toast and Square prompt for a
  configurable reason on void/comp; Umi should require one and store it on the append-only
  `pos_sale_exception` so Orders/analytics can group by reason (mistake, 86'd, guest changed
  mind, quality, comp/goodwill). [Evidence: Toast + Square primary — reasons.]
- **Item-level partial void must not nuke the rest of the ticket.** Every leader supports
  voiding a single line on a multi-item order while the rest keeps cooking (Toast and Square
  both document per-item and whole-check paths). Umi's propagation must be **line-scoped**: the
  KDS strikes only the affected line and leaves the remaining lines active. [Evidence: Toast +
  Square primary.]
- **Single-item order case.** When the only line on a ticket is voided, the ticket has nothing
  left to make → the whole KDS ticket should clear/close (Toast: "Once all items on a ticket are
  … [gone], the ticket disappears"-style behavior; Square whole-check void "closes out the
  ticket immediately"). INFERENCE for Umi: a line void that empties a ticket cascades to a
  ticket cancel; but still leave an auditable record (do not vanish silently). [Evidence: Square
  primary void = "closes out the ticket immediately"; INFERENCE for the cascade.]
- **Keep money append-only and separate from fulfillment.** Toast is explicit that "voiding an
  item alone does not refund money… voiding the payment… is what reverses the charge." Umi
  should keep the **fulfillment propagation** (KDS strike/cancel) and the **money reversal**
  (append-only refund/exception) as two events, joined by the exception record — exactly the
  design Umi already has. [Evidence: Toast primary.]
- **Payment/settlement is a real second gate — decide Umi's threshold deliberately.** Toast:
  once payment is **captured**, "you cannot void… you must refund." Clover: a **hard 25-minute**
  window, after which a void auto-becomes a refund. Umi should define its own capture/settlement
  boundary (Umi controls its processor path), but the **pattern** to copy is: pre-settlement =
  cheap reversal (void); post-settlement = refund. This gate governs the _money_; the _KDS_
  propagation gate above is separate and governs the _food_. [Evidence: Toast + Clover primary.]
- **Orders view should show net-of-refund.** Square records comps in sales **and inventory**
  reporting while a void reads as if it never happened; Toast keeps void/refund reports
  distinct. For Umi's Orders view, present the **net-of-refund** figure to owners (what was
  actually kept) while retaining the append-only gross + exception trail for audit and for
  waste/cost analysis. This is INFERENCE for the UI layer, consistent with how the leaders split
  "clean removal (void)" from "money-returned-but-it-happened (comp/refund)". [Evidence:
  INFERENCE grounded in Square + Toast reporting primaries.]

## 5. Not verifiable from primary sources (flagged, not guessed)

- **Toast:** the exact "void food not made / comp food already made — because void restores
  inventory and comp keeps it depleted" wording on a **Toast** primary page (the principle is
  confirmed on **Square** primary; Toast primary confirms only the payment gate, KDS
  strike-through, and a separate waste system). Toast's per-item KDS void appearance for a
  _single line_ (vs a whole check) is inferred from the check-level quote.
- **Square:** an explicit **restock-vs-waste toggle** on void/comp; the exact "auto-print void
  ticket" trigger sentence (the void-ticket printer **job** is primary; the trigger phrasing is
  SECONDARY); real-time push-vs-poll mechanism for KDS void display.
- **Clover:** KDS void/cancel propagation, line-item (vs payment-level) void, waste handling,
  and inventory restock — none documented on the primary void/refund dev pages read.
- **Lightspeed:** void/refund term definitions, the void's specific on-KDS treatment (only
  generic "modification blinks until acknowledged" is primary), waste, reason codes, timing
  gates, and inventory link.

## 6. Primary sources

Toast:

- Understand when to void vs refund: https://support.toasttab.com/en/article/Understand-when-to-void-vs-refund
- Void Items, Payments, and Checks (item vs whole check; after sent to kitchen; reasons): https://support.toasttab.com/en/article/Voiding-Items-Payments-and-Checks
- Voiding checks — platform guide (KDS "(VOIDED)" strike-through; capture gate; reasons): https://doc.toasttab.com/doc/platformguide/adminVoidingOrders.html
- Refunds and voids — platform guide (capture gate; do-not-mix void+refund): https://doc.toasttab.com/doc/platformguide/adminRefundsAndVoids.html
- Adjustments — platform guide ("items can only be voided if sent to the kitchen"): https://doc.toasttab.com/doc/platformguide/platformPwfAdjustments.html
- Toast Inventory: Tracking and Managing Waste (item/quantity/reason; auto-deduct): https://support.toasttab.com/en/article/Toast-Inventory-Tracking-and-Managing-Waste-Canada-Ireland-and-UK

Square:

- Comp and void open tickets (definitions; prep-state rule; reasons): https://squareup.com/help/us/en/article/5814-get-started-with-comp-and-void
- Comp, void, and reassign checks (item vs check; reasons; comp in inventory reporting): https://squareup.com/help/us/en/article/8166-comp-void-and-reassign-checks-with-square-for-restaurants
- Set up Square KDS and Square for Retail ("cannot be deleted, only voided"): https://squareup.com/help/us/en/article/8199-get-started-with-square-kds-and-square-for-retail
- Set up printer profiles ("Void tickets" printer job): https://squareup.com/help/us/en/article/8245-set-up-printer-profiles
- Complete and recall orders with Square KDS (recall): https://squareup.com/help/us/en/article/8171-complete-orders-with-square-kds

Clover:

- Handle voids and refunds (25-minute void→refund gate): https://docs.clover.com/dev/docs/voids-and-refunds

Lightspeed (K-Series):

- Using the Kitchen Display System 2.0 (POS modification blinks until acknowledged; KDS cancel status): https://k-series-support.lightspeedhq.com/hc/en-us/articles/22708154090267-Using-the-Kitchen-Display-System-2-0
