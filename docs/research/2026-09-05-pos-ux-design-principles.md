# POS cashier and barista touch UI/UX design principles and heuristics

- Date: 2026-09-05
- Question: Which UI/UX design principles and heuristics govern a cashier and barista touch interface in a café or restaurant? This informs Umi, a coffee-shop/QSR POS + Kitchen Display System.
- Scope: touch targets, tap-count, confirmation and error prevention, cognitive load, muscle memory, order entry, payment, cash handling, shift open/close, and exception flows (void, refund, discount, no-sale). The focus is how the UI must translate each cashier action, not how many actions occur (see the sibling action-volume report).
- Method: primary and high-trust sources only. The report uses standards bodies (W3C WCAG, ISO), platform design guides (Apple, Material/Android), original HCI research (Fitts, Hick, Card/Moran/Newell, Miller), usability research (Nielsen Norman Group), and first-party POS vendor docs (Square, Toast, Lightspeed, Clover). Each claim carries a link to the owning source and a label: STANDARD (normative), GUIDELINE (platform), LAW (validated HCI model), HEURISTIC (usability research), VENDOR (first-party doc), or INFERENCE (a rule derived here for Umi).

Note on the companion report: the sibling file [2026-09-05-pos-cashier-kitchen-action-volume-research.md](2026-09-05-pos-cashier-kitchen-action-volume-research.md) measures action volume and throughput. This file does not repeat that. This file states the design principle that governs each action.

## 1. Summary

The design goal for a cashier and barista interface is speed with accuracy under time pressure. The worker taps at arm's length, with wet or gloved hands, while the worker also talks to the customer and makes the drink. The primary sources agree on a small set of rules that serve this goal.

Best-sourced principles:

1. **Make touch targets large and well spaced.** The normative floor is 44 × 44 CSS px (WCAG AAA), 44 × 44 pt (Apple), and 48 × 48 dp (Material/Android ≈ 9 mm), with ≥ 8 dp spacing. A POS used at speed must sit at or above these floors ([WCAG 2.5.5](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html), [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/accessibility), [Android a11y](https://support.google.com/accessibility/android/answer/7101858?hl=en), [NN/g](https://www.nngroup.com/articles/touch-target-size/)).
2. **Fitts's law says bigger and closer targets are faster and less error-prone.** Target time grows with distance and shrinks with size. On a finger touchscreen the effect is stronger, so small, tight tiles are disproportionately slow and error-prone ([Fitts 1954](https://psycnet.apa.org/record/1955-02059-001), [FFitts, Bi et al. 2013](https://www3.cs.stonybrook.edu/~xiaojun/pdf/FFitts.pdf)).
3. **Every tap and every decision has a fixed time cost.** The Keystroke-Level Model puts a button press at ~0.20 s (~200 ms) and a mental-preparation step at ~1.35 s. So each removed tap and each removed decision saves real time on every transaction ([Kieras KLM](https://www.cs.umd.edu/~golbeck/INST631/KSM.pdf), [Card, Moran & Newell 1980](https://dl.acm.org/doi/10.1145/358886.358895)).
4. **A confirmation must earn its place.** Reserve a confirmation for a destructive, irreversible, or costly action. Do not confirm a routine action, or the worker stops reading it. Prefer an undo window over a hard dialog ([NN/g confirmation](https://www.nngroup.com/articles/confirmation-dialog/)).
5. **Design for recognition, not recall, and for glanceability.** Show the options; do not make the worker remember them (Nielsen heuristic #6). Choice time grows with the log of the number of options (Hick's law), and short-term memory holds only ~7 chunks (Miller), so chunk the grid and keep it scannable ([NN/g recognition](https://www.nngroup.com/articles/recognition-and-recall/), [Hick 1952](https://www.tandfonline.com/doi/abs/10.1080/17470215208416600), [Miller 1956](https://psycnet.apa.org/doi/10.1037/h0043158)).
6. **Keep buttons in fixed positions to build muscle memory.** The Power Law of Practice says repeated actions get faster with practice, but only if the target stays in the same place. Consistency is Nielsen heuristic #4; layout shift breaks the learned motion ([Power Law of Practice](https://en.wikipedia.org/wiki/Power_law_of_practice), [NN/g heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)).

Two rules balance each other. Rule 3 says cut taps. Rule 4 says keep the one confirmation that prevents a wrong or costly order. The measured drive-thru penalty for an inaccurate order (+71 s, see the sibling report) shows that error prevention can be worth more than the tap it costs. Trim redundant confirmations; keep the single order-verification step.

## 2. Concrete numbers table

| Rule owner                              | Metric                              | Value                                                                  | Label     | Link                                                                                                            |
| --------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| W3C WCAG 2.5.5 (AAA)                    | Minimum touch target                | 44 × 44 CSS px                                                         | STANDARD  | [w3.org](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html)                                          |
| W3C WCAG 2.5.8 (AA)                     | Minimum touch target                | 24 × 24 CSS px (or spacing)                                            | STANDARD  | [w3.org](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)                                  |
| Apple HIG                               | Minimum tappable area               | 44 × 44 pt                                                             | GUIDELINE | [apple.com](https://developer.apple.com/design/human-interface-guidelines/accessibility)                        |
| Material / Android                      | Minimum touch target; spacing       | 48 × 48 dp (~9 mm; range 7-10 mm); ≥ 8 dp                              | GUIDELINE | [support.google.com](https://support.google.com/accessibility/android/answer/7101858?hl=en)                     |
| NN/g                                    | Rendered target; spacing; fingertip | 1 cm × 1 cm; ~2 mm; fingertip 1.6-2 cm, thumb 2.5 cm                   | HEURISTIC | [nngroup.com](https://www.nngroup.com/articles/touch-target-size/)                                              |
| Fitts 1954                              | Movement time                       | MT = a + b·log2(2D/W)                                                  | LAW       | [psycnet](https://psycnet.apa.org/record/1955-02059-001)                                                        |
| Card, Moran & Newell 1980 / Kieras 1997 | Button press K; mental step M       | K 0.20 s (200 ms); M 1.35 s                                            | LAW       | [Kieras](https://www.cs.umd.edu/~golbeck/INST631/KSM.pdf), [CACM](https://dl.acm.org/doi/10.1145/358886.358895) |
| NN/g                                    | Response-time limits                | 0.1 s instant; 1 s flow; 10 s attention                                | HEURISTIC | [nngroup.com](https://www.nngroup.com/articles/response-times-3-important-limits/)                              |
| Hick 1952                               | Choice reaction time                | RT = a + b·log2(n + 1)                                                 | LAW       | [QJEP](https://www.tandfonline.com/doi/abs/10.1080/17470215208416600)                                           |
| Miller 1956                             | Span of immediate memory            | ~7 ± 2 chunks                                                          | LAW       | [Psych. Review](https://psycnet.apa.org/doi/10.1037/h0043158)                                                   |
| W3C WCAG 1.4.3 (AA)                     | Text contrast                       | 4.5:1 normal; 3:1 large                                                | STANDARD  | [w3.org](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html)                                     |
| W3C WCAG 1.4.11 (AA)                    | Non-text (UI) contrast              | 3:1                                                                    | STANDARD  | [w3.org](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html)                                    |
| ISO 9241-110:2020                       | Interaction principles              | 7 principles (see §5, §6)                                              | STANDARD  | [iso.org](https://www.iso.org/standard/75258.html)                                                              |
| ISO 9241-11:2018                        | Usability definition                | effectiveness, efficiency, satisfaction, in a context of use           | STANDARD  | [iso.org](https://www.iso.org/standard/63500.html)                                                              |
| Square (help)                           | Refund path                         | Transactions → payment → Issue refund → items/amount → reason → Refund | VENDOR    | [squareup.com](https://squareup.com/help/us/en/article/5060-process-refunds-with-square)                        |
| Toast (platform guide)                  | Void path                           | manager code if no permission; void reason optional/configurable       | VENDOR    | [toasttab.com](https://doc.toasttab.com/doc/platformguide/adminVoidingOrders.html)                              |
| Toast (support)                         | Cash over/short                     | Over/Short = Expected − Actual closeout cash                           | VENDOR    | [toasttab.com](https://support.toasttab.com/en/article/Cash-Drawer-Reports-Overview)                            |
| Square (help)                           | Cash session                        | Starting Cash → Start Drawer; End Drawer → count → variance            | VENDOR    | [squareup.com](https://squareup.com/help/us/en/article/8344-start-and-end-a-cash-drawer-session)                |
| Clover (dev docs)                       | Tender flow                         | include a Cancel button; customer-facing flow full-screen              | VENDOR    | [clover.com](https://docs.clover.com/dev/docs/custom-tenders)                                                   |

## 3. Touch targets and Fitts's law

**Principle: make the target big and put it where the finger already is.** A bigger, closer target is both faster to hit and less likely to cause a mis-tap. The two goals do not conflict.

- **The size floor is a standard, not a preference.** WCAG 2.5.5 (Level AAA) requires a target of at least 44 × 44 CSS px ([W3C](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html)). WCAG 2.5.8 (Level AA) sets a lower floor of 24 × 24 CSS px, but only with enough spacing that a 24 px circle on each target does not touch a neighbour ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)). Apple recommends a minimum tappable area of 44 × 44 pt ([Apple HIG](https://developer.apple.com/design/human-interface-guidelines/accessibility)). Material and Android recommend 48 × 48 dp, which is about 9 mm, inside a recommended 7-10 mm range, with ≥ 8 dp of spacing ([Android a11y](https://support.google.com/accessibility/android/answer/7101858?hl=en)).
- **The research explains the floor.** NN/g recommends a rendered target of at least 1 cm × 1 cm and ~2 mm of spacing, because the average fingertip is 1.6-2 cm wide and the thumb contact area is ~2.5 cm ([NN/g](https://www.nngroup.com/articles/touch-target-size/), citing the MIT Touch Lab and Parhi, Karlson & Bederson 2006). A target smaller than the finger causes "fat-finger" errors.
- **Fitts's law gives the time cost.** Movement time to a target follows MT = a + b·log2(2D/W): time grows with distance D and shrinks with width W ([Fitts 1954, J. Exp. Psychol. 47(6):381-391](https://psycnet.apa.org/record/1955-02059-001)). For a finger on glass, the FFitts model adds a finger-tremor term, so small, tight targets are worse than the classic law predicts ([Bi, Li & Zhai, CHI 2013](https://www3.cs.stonybrook.edu/~xiaojun/pdf/FFitts.pdf)).
- **Consequence for Umi.** Make the high-frequency tiles (top products, Charge, tender) the largest targets and place them in the thumb zone. Keep them above the 48 dp floor and give them clear spacing. The wet-hand and gloved-hand case makes the larger size mandatory, not optional (INFERENCE, from the sources above).

## 4. Taps per transaction (Keystroke-Level Model)

**Principle: each tap and each decision costs a fixed, repeatable time, so remove every avoidable one.**

- **The unit costs are measured.** The Keystroke-Level Model assigns ~0.20 s (200 ms) to a keystroke or button press (K) and ~1.35 s to a mental-preparation step (M) ([Kieras 1997](https://www.cs.umd.edu/~golbeck/INST631/KSM.pdf), [Card, Moran & Newell 1980](https://dl.acm.org/doi/10.1145/358886.358895)). The model predicts expert task time within ~20-21% of observed time.
- **Count and cut.** To count taps-per-task, list the operators for the common flow (item → modifier → add → charge → tender). Each removed tap saves ~200 ms; each removed decision point saves ~1.35 s. On a till that runs hundreds of transactions per shift, that time repeats every time (INFERENCE, from KLM).
- **Single-tap add.** Vendor flows keep the common item at one tap. Square adds an item to the cart with a single tap on its tile ([Square](https://squareup.com/help/us/en/article/8238-build-your-customer-s-cart-in-the-square-retail-pos-app)). A default variation removes the variation screen for the common case (INFERENCE).
- **Do not confuse a tap cut with an error.** Rule §5 keeps the one order-verification step. Cut the redundant taps around it, not the check itself.

## 5. Error prevention versus confirmation

**Principle: prevent the error first; confirm only when the action is destructive, irreversible, or costly; give undo as the safety net.**

- **Prevention beats a message.** Nielsen heuristic #5, Error Prevention: "the best designs carefully prevent problems from occurring in the first place" ([NN/g heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)). Prevention includes required modifiers, sensible defaults, and disabled invalid actions.
- **When a confirmation earns its place.** Use a confirmation "before committing to actions with serious consequences — such as destroying users' work or costing large amounts of money," and for "actions that cannot be undone" ([NN/g confirmation](https://www.nngroup.com/articles/confirmation-dialog/)).
- **When a confirmation is friction.** "Do not use confirmation dialogs for routine actions." "If you cry wolf too many times, people will stop paying attention to the question." A vague "Are you sure?" gives zero protection ([NN/g confirmation](https://www.nngroup.com/articles/confirmation-dialog/)).
- **Undo is the better pattern for reversible actions.** "Do go to great lengths to provide undo, because some user errors will remain despite even the best of confirmation dialogs" ([NN/g](https://www.nngroup.com/articles/confirmation-dialog/)). POS Kitchen Display Systems already use a short undo window instead of a hard confirm (see the sibling report: Square 3 s, Lightspeed 5 s).
- **The standard names the same idea.** ISO 9241-110:2020 lists "use error robustness" as one of its seven interaction principles ([ISO 9241-110](https://www.iso.org/standard/75258.html)).
- **Consequence for Umi.** Keep a hard confirmation only on void, refund, discount, no-sale, and a large-change payment. Replace routine confirmations with an undo window (INFERENCE).

## 6. Cognitive load and glanceability under time pressure

**Principle: show the options, chunk them, and make them readable at a glance.**

- **Recognition over recall.** Nielsen heuristic #6: "Minimize the user's memory load by making elements, actions, and options visible" ([NN/g heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)). Recognition is easier than recall because the visible option gives a retrieval cue ([NN/g recognition](https://www.nngroup.com/articles/recognition-and-recall/)). Show the product grid; do not make the barista remember a code.
- **Hick's law sets the grid size.** Choice reaction time grows with the number of options: RT = a + b·log2(n + 1) ([Hick 1952, QJEP 4(1):11-26](https://www.tandfonline.com/doi/abs/10.1080/17470215208416600)). A very large flat grid slows the choice. Group items into categories and a "most-sold" set to keep each choice small (INFERENCE, from Hick).
- **Chunk to fit working memory.** The span of immediate memory is about seven chunks, plus or minus two ([Miller 1956, Psychological Review 63:81-97](https://psycnet.apa.org/doi/10.1037/h0043158)). Group the grid into labelled categories of a few items each; do not present one long list.
- **Feedback keeps the worker oriented.** Nielsen heuristic #1, Visibility of System Status: "keep users informed about what is going on, through appropriate feedback within a reasonable amount of time" ([NN/g heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)). Give an immediate visual response to each tap. NN/g's response limits set the target: 0.1 s feels instant; 1 s keeps the flow of thought ([NN/g response times](https://www.nngroup.com/articles/response-times-3-important-limits/)).
- **Color and contrast for at-a-glance reading.** WCAG 1.4.3 requires text contrast of 4.5:1 (3:1 for large text) ([W3C](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html)), and WCAG 1.4.11 requires 3:1 for UI component boundaries and states ([W3C](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html)). Use color as a redundant cue, not the only cue. Vendor KDS products use color to code ticket state (Lightspeed: gray → blue → green → brown → red; see the sibling report).

## 7. Muscle memory and consistent placement

**Principle: keep every button in a fixed position, so the expert hand learns the location.**

- **Practice makes a fixed target fast.** The Power Law of Practice says task time falls as a power function of the number of repetitions (T = a·N^-b); Card, Moran & Newell applied it to cognitive engineering ([Power Law of Practice](https://en.wikipedia.org/wiki/Power_law_of_practice), [Newell & Rosenbloom 1981](https://www.researchgate.net/publication/243783833_Mechanisms_of_skill_acquisition_and_the_law_of_practice)). An expert cashier learns the location and stops reading the label. This only works if the target does not move.
- **Consistency is a heuristic and a standard.** Nielsen heuristic #4, Consistency and Standards: "Users should not have to wonder whether different words, situations, or actions mean the same thing" ([NN/g heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)). ISO 9241-110:2020 lists "conformity with user expectations" as an interaction principle ([ISO 9241-110](https://www.iso.org/standard/75258.html)).
- **No layout shift.** Do not reflow the grid or move the primary action after a tap. A target that jumps forces the hand to re-aim and re-read, which defeats the learned motion (INFERENCE, from Fitts + Power Law).
- **Consequence for Umi.** Fix the position of Charge, tender, quantity, and the top products. Keep them in the same place across screens and states.

## 8. Order entry

**Principle: one tap for the common item, forced choices only where they prevent a wrong order, and a fast path for favourites.**

- **Grid density and favourites.** Group items into categories and a most-sold set to serve Hick's law and recognition (§6). Toast Quick Order mode is built for counter service and "can save frequent orders, allowing regular customers to complete their orders with just a few taps" ([Toast](https://support.toasttab.com/en/article/New-POS-Experience-Ordering-Screens)). Lightspeed lets the operator design the layout with drag-and-drop, colors, and pictures, and switch between grid and list views ([Lightspeed](https://o-series-support.lightspeedhq.com/hc/en-us/articles/31329442916891-Design-your-POS-look-and-layout)).
- **Modifiers: force only what is crucial.** Toast marks a modifier group "Required" to "ensure that a modifier that is crucial to the fulfillment of a menu item is specified as part of the order" ([Toast](https://doc.toasttab.com/doc/platformguide/adminRequiredModifierGroupsAndVisibilitySettingsLegacy.html)). Lightspeed offers force-modifiers, optional modifiers, and modifier chains, where one choice reveals the next relevant set (protein → sauce) ([Lightspeed](https://k-series-support.lightspeedhq.com/hc/en-us/articles/22708154090267-Using-the-Kitchen-Display-System-2-0)). A required modifier is error prevention (§5); an optional modifier must not add a tap when the worker does not need it.
- **Modifiers are the main tap inflator.** The sibling report shows each customized line adds ~3 taps on Square's documented flow. So a sensible default (the common milk, the common size) removes a screen for the common case (INFERENCE).
- **Quantity steppers.** Use a plus/minus stepper for a small count. It is faster and less error-prone than a number pad for a value near one, because each tap is a large, fixed target (INFERENCE, from Fitts). Reserve a keypad for a large quantity.

## 9. Payment and checkout

**Principle: reach the tender in as few steps as the accuracy check allows, and show the change clearly.**

- **Minimize the post-cart path.** The sibling report shows Square's post-cart path is ~3 taps (cart → tip → card tap → done) and that a stack of confirmation-type steps is the heaviest part of a checkout. Keep one review-and-confirm for the common case ([Square flow](https://squareup.com/help/us/en/article/8631-set-up-and-customize-tipping)).
- **Tender selection.** Show cash and card as large, fixed targets. Square displays exact-amount and other quick amounts on the cash screen so the cashier avoids a keypad for the common case ([Square cash](https://squareup.com/help/us/en/article/5177-accept-cash-checks-and-other-tender)).
- **Change display.** Show the change due as a large, high-contrast number and keep it on screen until the cashier starts a new sale. Square keeps the change-due amount visible until New Sale ([Square community, product behaviour](https://community.squareup.com/t5/Hardware-Setup-Troubleshooting/cash-sales-show-change-amount/m-p/356115)). This is a glanceability rule (§6): the cashier reads the change while the hands count the cash.
- **Cut the payment ceremony.** Remove the signature step and confirm the card fast; Square documents chip processing in ~2 seconds and no signature (see the sibling report). Fewer steps at the tender is the clearest tap-count win (INFERENCE).
- **Clover names two tender-flow rules.** A custom tender must include a Cancel button so the worker can exit the flow, and a customer-facing flow is full-screen to prevent navigation away ([Clover](https://docs.clover.com/dev/docs/custom-tenders)). The Cancel path is user control (ISO "controllability") and the full-screen rule reduces mis-taps during payment.

## 10. Cash handling

**Principle: make the denomination count and the change calculation the machine's job, and give clear drawer feedback.**

- **The system calculates the change and the expected drawer.** The cashier should never do mental arithmetic under time pressure. Square shows the expected cash amount from the starting cash plus cash sales, minus cash refunds and paid-outs ([Square cash management](https://squareup.com/help/us/en/article/5152-cash-drawer-management)). This removes an error class at the source (§5).
- **Denomination entry.** For a count, a denomination keypad (a row per bill and coin, with a running total) is faster and less error-prone than free typing, because each tap is a large target and the total updates live (INFERENCE, from Fitts + heuristic #1). Give an immediate running-total feedback on each entry.
- **Drawer feedback.** Give a clear signal when the drawer opens and when a cash action records. Visibility of system status (§6) applies to the physical drawer, not only the screen.

## 11. Shift open, close, and reconciliation

**Principle: guide the count as a numbered flow, show the variance plainly, and survive an interruption.**

- **A guided, numbered flow.** Square opens a session with Starting Cash → Start Drawer, and closes it with End Drawer → enter the counted amount ([Square](https://squareup.com/help/us/en/article/8344-start-and-end-a-cash-drawer-session)). Present each step as one screen with one instruction (ISO 9241-110 "suitability for the user's tasks" and "self-descriptiveness"; [ISO](https://www.iso.org/standard/75258.html)).
- **Show the variance, and define it.** Toast defines Expected Closeout Cash as "starting cash plus cash taken in, minus cash taken out," Actual Closeout Cash as the counted amount, and Over/Short as "Expected Closeout Cash minus the Actual Closeout Cash" ([Toast](https://support.toasttab.com/en/article/Cash-Drawer-Reports-Overview)). Square shows the variance as Actual − Expected, with a red shortage, a green overage, and a zero perfect count ([Square](https://squareup.com/help/us/en/article/8358-view-cash-drawer-reports)). Color is a redundant cue on the sign; keep the number and the sign visible too (§6).
- **Gate a large variance.** Toast can require a manager to approve the drawer close when the variance passes a set threshold ([Toast close-out](https://support.toasttab.com/en/article/Close-Out-Day-Z-Report-Auto-Capture)). This is a confirmation that earns its place (§5): the trigger is a real risk, not a routine close.
- **Interrupt and resume.** A shift close can take minutes and can be interrupted by a customer. Save the partial count and let the cashier resume without loss. The single most common shortage cause that vendors report is a forgotten starting balance, so the flow must show the starting balance at the count step ([Toast](https://support.toasttab.com/en/article/Cash-Drawer-Reports-Overview)) (INFERENCE, from the reported cause).

## 12. Exception flows (void, refund, discount, no-sale)

**Principle: make a rare, risky action deliberate and traceable, but do not make it slow to reach.**

- **Authorization by role, not by friction.** Toast requires a manager POS access code (or card swipe) for a void only when the worker lacks the void permission; a worker with the "Void/Refund Payments (Limited to Same Day Only)" permission voids a same-day payment without a manager ([Toast void](https://doc.toasttab.com/doc/platformguide/adminVoidingOrders.html)). Square limits refunds to the account owner or a team member with the transactions permission ([Square refund](https://squareup.com/help/us/en/article/5060-process-refunds-with-square)). Gate the action by role; do not add taps for a permitted worker.
- **Capture a reason.** Toast can present a "Select a void reason" list; the reason is optional to configure but, when configured, the worker must select one ([Toast void](https://doc.toasttab.com/doc/platformguide/adminVoidingOrders.html)). Square asks the cashier to "select a reason for the refund" in the refund flow ([Square refund](https://squareup.com/help/us/en/article/5060-process-refunds-with-square)). A short, tappable reason list is recognition, not recall (§6), so it is fast and it produces an audit trail.
- **Scope the action clearly.** Square's refund flow lets the cashier tap "Select All Items," pick specific items, or refund a specific amount, then Next → reason → Refund ([Square](https://squareup.com/help/us/en/article/5060-process-refunds-with-square)). Show what will be voided or refunded before the commit; this is the one confirmation that earns its place (§5).
- **Consequence for Umi.** For void, refund, discount, and no-sale: gate by role, show the scope, capture a tappable reason, and confirm once. Do not stack multiple confirmations; the sibling report flags stacked confirmations as Umi's heaviest checkout cost (INFERENCE).

## 13. Design rules distilled for UmiPOS (audit checklist)

A UX audit can test each rule as pass or fail.

1. **Touch target size.** Every interactive target is ≥ 48 dp (≥ 44 pt / ≥ 44 CSS px). High-frequency targets are larger ([WCAG 2.5.5](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html), [Android](https://support.google.com/accessibility/android/answer/7101858?hl=en)).
2. **Spacing.** Every target has ≥ 8 dp of spacing from its neighbour ([Android](https://support.google.com/accessibility/android/answer/7101858?hl=en)).
3. **Thumb zone.** Charge, tender, and the top products sit in the reachable zone and are the largest tiles ([Fitts 1954](https://psycnet.apa.org/record/1955-02059-001)).
4. **Single-tap add.** The common product adds to the cart in one tap, with a default variation ([Square](https://squareup.com/help/us/en/article/8238-build-your-customer-s-cart-in-the-square-retail-pos-app)).
5. **Tap budget.** The common order (add item → charge → tender) has no avoidable tap or decision; each removed tap saves ~200 ms ([Kieras KLM](https://www.cs.umd.edu/~golbeck/INST631/KSM.pdf)).
6. **Confirmation discipline.** A hard confirmation exists only on void, refund, discount, no-sale, and a large-change payment. No routine action shows "Are you sure?" ([NN/g](https://www.nngroup.com/articles/confirmation-dialog/)).
7. **Undo.** Every reversible bump or state change has a short undo window instead of a confirm dialog ([NN/g](https://www.nngroup.com/articles/confirmation-dialog/)).
8. **Recognition.** Products, modifiers, and reasons are shown as tappable options, never entered from memory ([NN/g](https://www.nngroup.com/articles/recognition-and-recall/)).
9. **Grid chunking.** The grid is grouped into labelled categories of a few items each, plus a most-sold set ([Hick 1952](https://www.tandfonline.com/doi/abs/10.1080/17470215208416600), [Miller 1956](https://psycnet.apa.org/doi/10.1037/h0043158)).
10. **Feedback.** Every tap gives a visual response within ~0.1 s; every state change is visible ([NN/g response times](https://www.nngroup.com/articles/response-times-3-important-limits/)).
11. **Contrast.** Text meets 4.5:1 and UI states meet 3:1; color is a redundant cue, never the only cue ([WCAG 1.4.3](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html), [WCAG 1.4.11](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html)).
12. **Fixed placement.** No primary action moves between screens or states; no layout shift after a tap ([NN/g heuristics #4](https://www.nngroup.com/articles/ten-usability-heuristics/)).
13. **Forced choice only when crucial.** A modifier is required only when the item cannot be made without it ([Toast](https://doc.toasttab.com/doc/platformguide/adminRequiredModifierGroupsAndVisibilitySettingsLegacy.html)).
14. **Change display.** The system calculates the change; the change-due number is large and stays visible until New Sale ([Square](https://squareup.com/help/us/en/article/5177-accept-cash-checks-and-other-tender)).
15. **Cash count.** A denomination keypad with a live running total handles the count; the system computes the expected drawer ([Square](https://squareup.com/help/us/en/article/5152-cash-drawer-management)).
16. **Shift flow.** Open and close are numbered, one-instruction steps; the starting balance is shown at the count step ([Square](https://squareup.com/help/us/en/article/8344-start-and-end-a-cash-drawer-session), [Toast](https://support.toasttab.com/en/article/Cash-Drawer-Reports-Overview)).
17. **Variance.** The close shows Expected, Actual, and the signed variance; a large variance requires a manager ([Toast](https://support.toasttab.com/en/article/Close-Out-Day-Z-Report-Auto-Capture)).
18. **Resume.** A partial count survives an interruption and resumes without loss (INFERENCE).
19. **Exception authorization.** Void, refund, discount, and no-sale are gated by role, not by extra taps for a permitted worker ([Toast](https://doc.toasttab.com/doc/platformguide/adminVoidingOrders.html), [Square](https://squareup.com/help/us/en/article/5060-process-refunds-with-square)).
20. **Reason capture.** Every exception captures a tappable reason and shows its scope before the commit ([Square refund](https://squareup.com/help/us/en/article/5060-process-refunds-with-square)).

## 14. Sources I could not access

- **ISO 9241 full texts are paywalled.** iso.org returned HTTP 403 for the standard pages. This report cites the standard by number and title (9241-110:2020 interaction principles, 9241-11:2018 usability, 9241-400 physical input devices) and takes the principle names from the ISO catalogue entry. Buy the standard for the full recommendations ([ISO 9241-110](https://www.iso.org/standard/75258.html), [ISO 9241-11](https://www.iso.org/standard/63500.html), [ISO 9241-400](https://www.iso.org/standard/38896.html)).
- **Apple HIG and Material Design pages are JavaScript-rendered.** WebFetch returned only the page title. The 44 pt (Apple) and 48 dp (Material) values are confirmed by the Google/Android accessibility page and by Apple's own guideline text, and this report cites the owning pages.
- **Fitts (1954) and Miller (1956) full texts are behind APA PsycNet.** The citations are the canonical primary references; the report links the record pages.
- **No POS vendor publishes a UX design specification.** The vendor rules here are read from first-party help and platform docs (order entry, modifiers, tender, cash management, void, refund), not from a design guideline document. Treat each vendor rule as a documented product behaviour, not a stated principle.
