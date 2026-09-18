# UX patterns and design north star

- Date: 2026-09-15
- Question: What design north star and which interaction patterns make UmiPOS feel fast, elegant, and inevitable? The target device is a 1024 x 768 touch terminal. The target taste is refined, elegant, and Apple-like. The target taste is not the default shadcn look.
- Scope: the Flutter POS in `apps/umi-pos` and the React dashboard in `apps/umi-dashboard`. This report covers design principles, café ergonomics, role first screens, implicit connection patterns, hard-screen flows, motion and feedback, and competitor screen sources.
- Method: primary sources only. The report reads the Apple Human Interface Guidelines (HIG) through the Apple documentation data files. It reads Nielsen Norman Group articles, W3C and ISO standards, peer-reviewed studies, AndroidX motion source, and first-party vendor documents. Each claim carries a label: **Fact** (documented fact with a source), **Tradeoff** (source-backed balance of two rules), or **Inference** (a Umi-specific rule derived from the sources).
- Related research: this file does not repeat the sibling reports. Read [design principles](2026-09-05-pos-ux-design-principles.md) for touch targets and tap count, [navigation and IA](2026-09-05-pos-navigation-and-cashier-vs-manager-ia.md) for the cashier and manager split, [action volume](2026-09-05-pos-cashier-kitchen-action-volume-research.md) for throughput data, [table map](2026-09-13-pos-table-map-and-order-traceability.md) for visits and traceability, and [floor-plan editor alternatives](2026-09-13-floor-plan-editor-alternatives.md) for the editor choice.

## North star

UmiPOS must feel like a well-made instrument that a barista trusts at rush hour. The screen stays calm, so the operator sees the next action at a glance. Every control keeps a stable position, so the hand learns the path. One sale shows its whole story in one place: order, kitchen ticket, guest, drawer, and receipt. Money actions feel solid, and they undo without fear.

## 1. Apple HIG as a specification

### 1.1 Which principles Apple states today

**Fact.** The current Apple HIG page lists eight design principles: Purpose, Agency, Responsibility, Familiarity, Flexibility, Simplicity, Craft, and Delight ([Apple HIG design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles)).

**Fact.** Apple writes four rules that matter most for Umi. "Stay out of the way." "The best designs are unobtrusive and present when people need them." "Give people the freedom to explore." "Help people recover from mistakes." ([Apple HIG design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles))

**Fact.** The words clarity, deference, and depth do not appear on the current HIG design principles page. The word deference does not appear in the 21 HIG pages that this research fetched. The old address for the design themes redirects to the HIG root. Those three words belong to older Apple design writing, and this research did not find a current Apple page that states them.
**Inference.** Do not quote the three words as a current Apple rule in a design review. Use the eight published principles instead. The three words stay useful as a plain description of the target taste.

**Inference.** Map the owner's words to Apple's published words. Use **Simplicity** for clarity. Use **Craft and Delight** for the refined look. Use **Agency and Responsibility** for money actions and for undo. This mapping keeps the design review tied to a published Apple document.

### 1.2 The numbers Apple publishes

**Fact.** These values come from the HIG accessibility page ([Apple HIG accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)).

| Item                                     | Value                                                   | Platform        |
| ---------------------------------------- | ------------------------------------------------------- | --------------- |
| Minimum control size                     | 44 x 44 pt                                              | iOS, iPadOS     |
| Minimum control size                     | 60 x 60 pt                                              | visionOS        |
| Minimum control size                     | 66 x 66 pt                                              | tvOS            |
| Padding around a control with a bezel    | about 12 pt                                             | Apple platforms |
| Padding around a control without a bezel | about 24 pt                                             | Apple platforms |
| Text size increase                       | at least 200 percent                                    | Apple platforms |
| Color contrast                           | 4.5 to 1 up to 17 pt; 3 to 1 at 18 pt and for bold text | Apple platforms |

**Fact.** Apple gives the default and minimum text sizes per platform. For iOS and iPadOS the default is 17 pt, and the minimum is 11 pt ([Apple HIG typography](https://developer.apple.com/design/human-interface-guidelines/typography)).

**Fact.** Apple warns against light font weights. "Prefer Regular, Medium, Semibold, or Bold font weights, and avoid Ultralight, Thin, and Light font weights" ([Apple HIG typography](https://developer.apple.com/design/human-interface-guidelines/typography)).

**Fact.** Apple states the purpose of a material. "A material is a visual effect that creates a sense of depth, layering, and hierarchy between foreground and background elements." Apple limits this effect to the control layer and keeps the content layer plain ([Apple HIG materials](https://developer.apple.com/design/human-interface-guidelines/materials)).

**Fact.** Apple gives a rule for animated content inside glass. Use a dark layer at 35 percent opacity behind clear glass over bright content ([Apple HIG materials](https://developer.apple.com/design/human-interface-guidelines/materials)).

### 1.3 Motion and feedback in the HIG

**Fact.** Apple gives four motion rules for apps. Add motion for a purpose. Make motion optional. Keep feedback motion brief and precise. Do not make people wait for an animation ([Apple HIG motion](https://developer.apple.com/design/human-interface-guidelines/motion)).

**Fact.** Apple states a direct rule for high-frequency actions: "In apps, generally avoid adding motion to UI interactions that occur frequently" ([Apple HIG motion](https://developer.apple.com/design/human-interface-guidelines/motion)).

**Fact.** Apple rates the level of interruption against the importance of the message. Use passive feedback for status. Use an alert only for a critical message ([Apple HIG feedback](https://developer.apple.com/design/human-interface-guidelines/feedback)).

**Fact.** Apple states when a warning belongs. Warn when the data loss is unexpected and irreversible. Do not warn when the loss is the expected result of the action ([Apple HIG feedback](https://developer.apple.com/design/human-interface-guidelines/feedback)).

**Fact.** Apple names a money example for confirmation. "People appreciate getting feedback that confirms a successful Apple Pay transaction." Apple adds that a confirmation belongs only on important actions ([Apple HIG feedback](https://developer.apple.com/design/human-interface-guidelines/feedback)).

### 1.4 Applying the HIG to a 1024 x 768 touch POS

**Fact.** Apple publishes the minimum size, the padding, and the text scale. These pages give no layout for a point-of-sale terminal. The layout numbers below are therefore a Umi proposal.

**Inference.** Use these layout numbers on a 1024 x 768 terminal. Keep a top bar of 56 px. Keep a cart panel of 360 px on the right at a width of 1024 px. Keep a bottom action bar of 80 px. Set the outer margin to 16 px and the gutter to 12 px.

**Inference.** Fit 5 product tiles across the product area with the cart panel open. A tile of 96 x 96 px with a 12 px gutter gives 528 px of width. The product area holds 632 px after the cart panel and the margins. Show 9 columns when the cart panel closes, because the area then holds 992 px. Five rows fit in the 600 px of height after the top bar and the bottom bar. So 25 tiles stay visible without a scroll at the normal state.

**Inference.** Set the tap floor at 48 x 48 px for every control. Set the primary action, Charge, at 96 px high. Set a top-bar control at 48 px. This keeps the floor above the Apple value of 44 pt and the Material value of 48 dp.

**Inference.** Keep the charge total and the change due at 40 px or larger. Keep the product tile name at 16 pt or larger. Keep a secondary label at 13 pt or larger. Do not go below the Apple minimum of 11 pt at any place on the terminal.

**Inference.** Test the physical size on the real panel. Measure one control with a ruler. The target is 9 mm or larger. A 1024 x 768 panel of 10 inches gives about 5 px per mm, so a 48 px control is near 9.5 mm.

**Inference.** Use one material layer only, on the navigation bar and the modal sheets. Keep the product grid, the cart, and the receipt flat. A second glass layer hides the product images and slows reading.

## 2. Real café ergonomics

### 2.1 What the operator can do

**Fact.** Hoober recorded 1,333 observations of people who used a mobile device in public. Of those, 780 people touched the screen. The grip was one hand for 49 percent, a cradle for 36 percent, and two hands for 15 percent ([Hoober, UXmatters, 2013](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php)).

**Fact.** Hoober reports the reason for one-hand use. "One-handed use seems to be highly correlated with users' simultaneously performing other tasks." He lists carrying bags, steadying the body, climbing stairs, opening doors, and holding babies ([Hoober, UXmatters, 2013](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php)).

**Fact.** Hoober reports the grip for one-hand use. The right thumb touched the screen in 67 percent of the cases. The left thumb touched the screen in 33 percent ([Hoober, UXmatters, 2013](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php)).

**Inference.** Treat the café operator as a one-hand user with a second task in progress. The second task is the conversation with the guest. A handheld POS must keep the main action in the thumb arc. A fixed POS must keep the main action in the lower half of the screen.

### 2.2 Body load and injury

**Fact.** Dainty and co-authors studied 59 baristas and analyzed 10 on video. Low-back pain affected 73 percent, and shoulder pain affected 68 percent. Tamping produced lumbar compression of about 2,800 to 4,100 N against the NIOSH action limit of 3,400 N ([Dainty et al., Ergonomics, 2014](https://pubmed.ncbi.nlm.nih.gov/24837283/)).

**Fact.** The Texas Division of Workers' Compensation sets an injury threshold for the arms and the wrists at more than 10 repetitions per minute ([Texas DWC](https://www.tdi.texas.gov/pubs/videoresource/fsergofood.pdf)).

**Inference.** Do not add a physical motion for the software. Do not require a reach to a far corner, a long drag, or a repeat of one gesture. Prefer one tap in the near zone.

### 2.3 Sound in the workplace

**Fact.** Monteiro and co-authors measured the noise in one fast food establishment during a normal work week. They then tested 15 people at 45, 60, and 68 dB(A). At 68 dB(A) with alarm sounds, the error count was higher and the reaction time was longer ([Monteiro et al., Noise and Health, 2018](https://pubmed.ncbi.nlm.nih.gov/30516172/)).

**Fact.** Apple states that a device in silent mode plays only the audio that the person starts ([Apple HIG playing audio](https://developer.apple.com/design/human-interface-guidelines/playing-audio)).

**Tradeoff.** A sound confirms an action for a worker who looks away from the screen. The same sound adds to the noise load of the room. The measured noise load already lowers attention and short-term memory at 68 dB(A).

**Inference.** Use a short sound only for a rare and important event, such as a new kitchen ticket or an offline queue. Do not use a sound for a routine tap. Keep every sound optional, and keep the visual signal equal in strength.

### 2.4 Distance, glare, and hands

**Fact.** Apple requires a minimum control of 44 x 44 pt and about 12 pt to 24 pt of padding around a control. Apple also requires text enlargement support of 200 percent ([Apple HIG accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)).

**Fact.** A study in Applied Ergonomics reports that the location of a touch target changes both the performance and the physical demand of a touchscreen task ([Applied Ergonomics, 2017](https://doi.org/10.1016/j.apergo.2017.01.015)).

**Tradeoff.** A larger control helps a wet or gloved hand. A larger control reduces the number of items on a fixed 1024 x 768 screen. The operator then needs a scroll or a category change.

**Inference.** Keep the tiles large and accept a category change for the long menu tail. Keep the top 20 products visible without a scroll. The sibling action-volume report shows that one drink order repeats many times per shift. The same report shows that a café bar makes 60 to 80 milk drinks per hour at peak.

**Inference.** No primary study was found that measures touch accuracy for a café worker with wet or greasy hands. No primary study was found that measures glare on a POS under a window. Treat those two recommendations as opinion: use a matte screen, keep the terminal out of the window reflection, and raise the tile size above the floor.

**Inference.** Keep one-hand and two-hand paths open. Repeat the charge action in the bottom bar and in the cart panel. The operator uses the nearer one.

## 3. Role first screens

### 3.1 The role model

**Fact.** Square uses three permission levels. Standard takes transactions. Enhanced updates inventory and manages shifts. Full reads reports and manages permissions ([Square permission levels](https://squareup.com/help/us/en/article/5822-employee-permissions)).

**Fact.** Toast uses two permission layers. POS job roles control the terminal. Web access roles control the back office ([Toast permissions](https://doc.toasttab.com/doc/platformguide/adminPermissions.html)).

**Fact.** Clover applies one role set to every device and to the web dashboard ([Clover roles and permissions](https://www.clover.com/en-US/help/employee-roles-and-permissions)).

**Fact.** Lightspeed groups POS users into user groups with shared permissions ([Lightspeed users and user groups](https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804594570-About-users-and-user-groups)).

**Fact.** Apple states a rule for what the screen shows. Show the important items near the top and the leading side of the window ([Apple HIG layout](https://developer.apple.com/design/human-interface-guidelines/layout)).

### 3.2 First screen per role

**Inference.** The table below gives one first screen per role. It also gives the data that stays hidden from that role. The role split comes from the vendor permission models above. The specific screen content is a Umi design proposal.

| Role             | First screen                        | Data shown at once                                                              | Data kept hidden                                     |
| ---------------- | ----------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Owner            | Dashboard home                      | Sales today, sales this week, cash variance, top items, open alerts             | Line-item entry, tender steps, device pairing        |
| Manager on shift | Shift board                         | Labor against plan, open draws, voids and refunds, low stock, unresolved alerts | Owner finance and payroll                            |
| Supervisor       | Floor and service board             | Table states, late tickets, unserved items, staff assignment, void approvals    | Full finance reports, permission setup               |
| Cashier          | Tender screen with the current cart | Cart, total, tender options, change due, shift drawer state                     | Inventory cost, other staff shifts, permission setup |
| Waiter           | Table map with the assigned section | Own tables, guest count, time at table, unserved items, ready items             | Other sections, cost data, device settings           |
| Kitchen operator | Kitchen board for one station       | Tickets for the station, item counts, elapsed time, next state                  | Prices, payment state, guest identity                |
| Host             | Wait list and table map             | Free tables, party size, wait time, next seating                                | Prices, void history, finance                        |

**Inference.** Hide a control that the current role cannot use. The sibling navigation report gives this rule and cites the ISO 9241-110 principle "suitability for the user's tasks".

**Inference.** Keep the first screen of every role at one glance. Use one screen for the role task and no welcome screen. A splash screen with a logo spends time and shows nothing.

**Tradeoff.** A single fused screen for every role shows every option at once. That reduces the training effort for a new operator. The same screen hides the role task inside a larger set. The operator then reads more items to find the next action. Apple hides the lowest-priority item first. Apple also keeps the count of top-bar actions small ([Apple HIG toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)).

**Inference.** Separate the role first screens, and keep one switch path. A manager can enter the cashier view in one tap. The manager does not lose the shift state.

## 4. Implicit connection patterns

This section answers the owner's key request. The goal is a link between related objects without an explicit menu or a label.

### 4.1 Why an implicit link works

**Fact.** Nielsen defines progressive disclosure. Show the few important options first. Disclose the larger set on request ([NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/)).

**Fact.** A contextual menu holds the actions for one object. The contents depend on the object. Kebab and meatball icons are recognized as "more options". The same menus have low information scent, so a user cannot predict the contents ([NN/g contextual menus](https://www.nngroup.com/articles/contextual-menus-guidelines/)).

**Fact.** The first NN/g guideline for a contextual menu: use it for a secondary and noncritical action. Do not hide an essential, high-frequency action behind an extra tap ([NN/g contextual menus](https://www.nngroup.com/articles/contextual-menus-guidelines/)).

**Fact.** Working memory has a small capacity. When a task needs more data than the buffer holds, the user drops an item and makes a mistake or works more slowly. A user interface can carry the load instead ([NN/g working memory](https://www.nngroup.com/articles/working-memory-external-memory/)).

**Fact.** Spatial memory needs two conditions. The user needs stable position of the objects. The user needs repeated practice ([NN/g spatial memory](https://www.nngroup.com/articles/spatial-memory/)).

**Fact.** Spatial memory forms against boundaries and landmarks. A stable boundary with a clear edge supports the memory. A reflow of the layout destroys it ([NN/g spatial memory](https://www.nngroup.com/articles/spatial-memory/)).

**Fact.** "Glancing" means a quick read of one or two words during another task. A larger size, a noncondensed width, and uppercase text improved glance reading in the NN/g study ([NN/g glanceable fonts](https://www.nngroup.com/articles/glanceable-fonts/)).

**Fact.** Search suggestions reduce the interaction cost and the mental effort. Users pick a term instead of a full query. Users still used a suggestion in only 23 percent of the cases where the site offered one ([NN/g site search suggestions](https://www.nngroup.com/articles/site-search-suggestions/)).

### 4.2 The object graph rule

**Fact.** The sibling competitive scan records the shared data shape of the market. One connected graph of item, category, order, and customer feeds the register, the kitchen, the online store, and the reports ([competitive scan](2026-09-06-competitive-scan-and-gap-audit/README.md)).

**Inference.** Treat one sale as one object with named parts: the visit, the order, the items, the kitchen ticket, the guest, the payment, the receipt, and the cash shift. Give each part a stable open action. Open the kitchen ticket from the sale line with one tap. Open the sale from the kitchen ticket with one tap. Open the drawer from the payment line with one tap.

**Inference.** Do not build one screen per database table. Build one screen per object, and put the linked objects at the edge of that screen. The link is a rule of the object, not a menu item.

### 4.3 How to make the link visible

**Inference.** Use four patterns. Each pattern keeps the link near the object, and each pattern needs no menu label.

1. **A live status line on the row.** Show the kitchen state beside the item name. The operator sees the link between the item and the ticket without a tap.
2. **A context strip under the selected object.** A selected table shows its visit time, its server, and its balance. A selected sale shows its ticket number and its receipt state.
3. **A detail sheet from the object edge.** A tap on the status chip opens the linked object. The sheet closes back to the same position.
4. **A keyboard path in the dashboard.** A search field accepts an order number, a table label, or a guest name. The result opens the object. NN/g shows that a suggestion list lowers the interaction cost, and that the list still needs a full typed path.

**Tradeoff.** A context strip saves taps and adds pixels. NN/g measures a hidden-navigation cost, and the sibling navigation report records up to about 50 percent lower discoverability for a hidden control. An implicit link is not a hidden control, because the object stays visible.

**Inference.** Keep the strip to two lines and 48 px high. Keep the strip in the same place for every object type. A stable position lets the operator build spatial memory.

**Inference.** Keep one landmark per screen. Use the same corner for the object identity on every screen. A landmark in the same place supports the memory of the other objects around it.

**Inference.** A command palette is a promising dashboard pattern, and it has no measured evidence in the sources for this report. NN/g does not publish a command-palette study. Treat the dashboard command palette as opinion, and validate it with real owners before release.

## 5. Flow patterns for hard screens

**Fact.** Square splits a check by item or by seat, and splits a payment by amount. The two actions are separate ([Square check splits](https://squareup.com/help/us/en/article/8165-split-a-payment-and-check-with-square-for-restaurants)).

**Fact.** Toast transfers a check to an occupied table, and then merges the checks or keeps them apart. Permissions control the transfer ([Toast table management](https://support.toasttab.com/en/article/New-POS-Managing-Tables)).

**Fact.** Square builds a floor plan in the dashboard ([Square floor plans](https://squareup.com/help/us/en/article/6427-building-your-floor-plan)).

**Fact.** Square documents the refund path as transactions, then payment, then Issue refund, then items or amount, then a reason, then Refund ([Square refunds](https://squareup.com/help/us/en/article/5060-process-refunds-with-square)).

**Fact.** Toast can require a void reason from a list, and it gates the void by permission ([Toast voiding](https://doc.toasttab.com/doc/platformguide/adminVoidingOrders.html)).

**Fact.** Square KDS completes a whole ticket with one tap and offers an undo window of three seconds. Toast KDS uses a double tap or two bump-bar presses. Lightspeed KDS 2.0 uses a double tap per state with a five-second undo ([Square KDS](https://squareup.com/help/us/en/article/8171-complete-orders-with-square-kds), [Toast KDS](https://doc.toasttab.com/doc/platformguide/platformKDSOverview.html), [Lightspeed KDS](https://k-series-support.lightspeedhq.com/hc/en-us/articles/22708154090267-Using-the-Kitchen-Display-System-2-0)).

**Fact.** Odoo shows table cards with guest count, item progress, elapsed time, and alerts on a preparation display ([Odoo preparation display](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/extra/preparation.html)).

**Fact.** SoftRestaurant publishes its own training academy for operators ([SoftRestaurant academy](https://academia.softrestaurant.com/)).

**Inference.** Use these flow rules for the hard screens.

1. **Order taking.** Add the common item in one tap. Show a default variation. Force a modifier only when the kitchen cannot make the item without it.
2. **Modifiers.** Use a chain: one choice reveals the next group. Toast and Lightspeed both document this pattern.
3. **Split and merge.** Separate the item split, the payment split, the table move, and the check merge. Show the result before the commit.
4. **Checkout.** Keep the post-cart path near three taps. Collapse the review step and the confirm step into one panel. Keep a second confirmation only for a large change, a split, and a refund.
5. **Refunds and voids.** Gate the action by role. Show the affected items. Ask for a reason from a list. Confirm one time.
6. **Inventory count.** Use one row per item with a large stepper. Show the system count and the counted value side by side. Show the difference after each entry.
7. **Recipe costing.** Show the cost of each ingredient and the total cost of the plate on one screen. Keep the selling price and the margin in the same view.
8. **Cash shift close.** Use a numbered flow. Show the counted denomination, the running total, the expected amount, and the signed variance. Require a manager above a set variance.
9. **KDS bump.** Advance the common state with one direct tap and a three-second undo. Reserve a confirm for cancel.
10. **Floor plan and table map.** Keep the editor in the dashboard and the service actions in the POS. Show position, shape, capacity, guest count, time at table, and an attention signal on each table.

**Inference.** Keep a fixed order of the four split actions in the interface. A fixed order supports the learned path and reduces a wrong commit.

## 6. Motion and feedback

### 6.1 Durations

**Fact.** NN/g gives measured guidance on duration. A simple feedback animation takes about 100 ms. A substantial screen change takes 200 to 300 ms. At 500 ms an animation feels like a drag. A range of 100 to 400 ms fits most cases. An object needs slightly longer to enter than to leave: about 300 ms to appear and 200 to 250 ms to disappear ([NN/g animation duration](https://www.nngroup.com/articles/animation-duration/)).

**Fact.** The Material 3 motion tokens define four duration groups. Short is 50 to 200 ms. Medium is 250 to 400 ms. Long is 450 to 600 ms. Extra long is 700 to 1000 ms ([AndroidX MotionTokens](https://raw.githubusercontent.com/androidx/androidx/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/MotionTokens.kt)).

**Fact.** The Material 3 emphasized easing curve is `cubic-bezier(0.2, 0, 0, 1)`. The standard curve uses the same values. The emphasized decelerate curve is `cubic-bezier(0.05, 0.7, 0.1, 1.0)` ([AndroidX MotionTokens](https://raw.githubusercontent.com/androidx/androidx/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/MotionTokens.kt)).

**Fact.** NN/g sets three response limits. A response below 0.1 s feels instant to the user. A response below 1 s keeps the flow of thought. A response of 10 s holds attention ([NN/g response times](https://www.nngroup.com/articles/response-times-3-important-limits/)).

**Fact.** Apple states the same rule in a different form: do not make people wait for an animation ([Apple HIG motion](https://developer.apple.com/design/human-interface-guidelines/motion)).

**Fact.** The Keystroke-Level Model assigns about 0.20 s to a button press and about 1.35 s to one mental step. The model predicts the expert task time within about 20 percent ([Kieras, KLM](https://www.cs.umd.edu/~golbeck/INST631/KSM.pdf)).

**Inference.** Use these times in UmiPOS. Set a tap response at 100 ms or less. Set a panel entry at 200 ms. Set a modal sheet at 250 ms. Do not exceed 300 ms for any action on the hot path. Set the Charge response at 100 ms.

**Inference.** Use the emphasized curve for a state change. Use a linear curve only for a progress bar. Do not run an animation on the product grid.

### 6.2 Optimistic user interface

**Fact.** Apple requires an immediate display of content or a placeholder during a load ([Apple HIG loading](https://developer.apple.com/design/human-interface-guidelines/loading)).

**Fact.** Apple requires people to keep the ability to do other work while content loads ([Apple HIG loading](https://developer.apple.com/design/human-interface-guidelines/loading)).

**Fact.** The sibling table-map report states the delivery rule for the POS. Socket.IO keeps message order and defaults to at-most-once delivery. Recovery can fail, and the client still needs a state synchronization ([Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/)).

**Tradeoff.** An optimistic update keeps the operator fast. A later rejection then shows a wrong state on the screen. The operator needs to see the correction.

**Inference.** Add the cart line at once, and mark it as pending until the server accepts it. Change the mark to a warning if the server rejects the line. Never show a rejected line as accepted.

### 6.3 Haptics and sound

**Fact.** Apple defines two haptic building blocks. A transient event feels like a tap. A continuous event feels like a sustained vibration. The design controls the sharpness and the intensity ([Apple HIG playing haptics](https://developer.apple.com/design/human-interface-guidelines/playing-haptics)).

**Fact.** Apple gives four haptic rules. Use a consistent pattern for one meaning. Match the intensity of the haptic to the intensity of the animation. Avoid overuse. Make haptics optional ([Apple HIG playing haptics](https://developer.apple.com/design/human-interface-guidelines/playing-haptics)).

**Fact.** Apple states that a haptic and a sound work best together with the visual signal ([Apple HIG playing haptics](https://developer.apple.com/design/human-interface-guidelines/playing-haptics)).

**Inference.** A 1024 x 768 terminal usually has no haptic engine. Use haptics only on the handheld case, such as a tablet in the café. On the fixed terminal, use a short visual confirmation and a short sound.

**Inference.** Use one short sound for a completed payment. Use a different pattern for a failed payment. Keep the visual message equal in strength, because the room noise is high.

### 6.4 Feedback rules for money

**Inference.** Use these rules for a money action in UmiPOS.

1. Show the amount, the tender, and the change in one panel.
2. Confirm the commit with a large visual signal within 100 ms.
3. Keep the change due on the screen until the operator starts the next sale.
4. Play one short sound at the commit. Do not play a sound at each key press.
5. Show the receipt state after the commit. Use the words Printed, Sent, and Failed.
6. Offer one undo path for a reversible step. Use a hard confirm only for a void, a refund, a discount, and a large change.

## 7. Competitor screen sources

### 7.1 Local screenshots already in the workspace

**Fact.** The workspace holds ten competitor screenshots from 2026-09-06 in `docs/research/2026-09-06-competitive-scan-and-gap-audit/assets/`. The set covers Square, Toast, Lightspeed, Odoo, and PoloTab ([competitive scan](2026-09-06-competitive-scan-and-gap-audit/README.md)).

### 7.2 Public URLs and the fetch result

**Fact.** These results come from a direct fetch on 2026-09-15 with a desktop browser user agent. A code of 200 means the server returned the page. A code of 403 means the server refused the request. A code of 000 means no connection.

| Vendor         | URL                                                                                                             | Result | Note                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------ |
| Square         | https://squareup.com/us/en/point-of-sale/restaurants                                                            | 200    | Product page with screen images      |
| Square         | https://squareup.com/help/us/en/article/8238-build-your-customer-s-cart-in-the-square-retail-pos-app            | 200    | Help page, real UI flow              |
| Square         | https://squareup.com/help/us/en/article/6427-building-your-floor-plan                                           | 200    | Help page with plan images           |
| Square         | https://apps.apple.com/us/app/square-point-of-sale-pos/id335393788                                              | 200    | App Store listing with screenshots   |
| Square         | https://www.youtube.com/@Square                                                                                 | 200    | Channel page                         |
| Toast          | https://support.toasttab.com/en/article/New-POS-Managing-Tables                                                 | 200    | Help page, real UI flow              |
| Toast          | https://doc.toasttab.com/doc/platformguide/platformKDSOverview.html                                             | 200    | Platform guide                       |
| Toast          | https://central.toasttab.com/                                                                                   | 200    | Training portal                      |
| Toast          | https://pos.toasttab.com/                                                                                       | 403    | The server refused the request       |
| Toast          | https://www.toasttab.com/restaurant-pos                                                                         | 403    | The server refused the request       |
| Toast          | https://www.youtube.com/@toasttab                                                                               | 200    | Channel page                         |
| Clover         | https://www.clover.com/pos-systems/restaurants                                                                  | 200    | Product page                         |
| Clover         | https://www.clover.com/en-US/help/employee-roles-and-permissions                                                | 200    | Help page                            |
| Clover         | https://docs.clover.com/dev/docs/custom-tenders                                                                 | 200    | Developer guide with flow rules      |
| Clover         | https://www.youtube.com/@clover                                                                                 | 200    | Channel page                         |
| Clover         | https://apps.apple.com/us/app/clover-go-dashboard-pos/id969311778                                               | 200    | App Store listing                    |
| Lightspeed     | https://www.lightspeedhq.com/pos/restaurant/                                                                    | 200    | Product page                         |
| Lightspeed     | https://k-series-support.lightspeedhq.com/hc/en-us/articles/22708154090267-Using-the-Kitchen-Display-System-2-0 | 200    | Help page with KDS states            |
| Lightspeed     | https://www.youtube.com/@lightspeedhq                                                                           | 200    | Channel page                         |
| Lightspeed     | https://apps.apple.com/us/app/lightspeed-restaurant-pos-k/id1486190847                                          | 200    | App Store listing                    |
| Odoo           | https://www.odoo.com/app/point-of-sale-shop                                                                     | 200    | Product page                         |
| Odoo           | https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/extra/preparation.html                 | 200    | Preparation display with table cards |
| Odoo           | https://www.youtube.com/@odoo                                                                                   | 200    | Channel page                         |
| Fudo           | https://fudo.app/                                                                                               | 200    | Product page                         |
| Fudo           | https://apps.apple.com/us/app/fudo-software-gastron%C3%B3mico/id1137158486                                      | 200    | App Store listing                    |
| Fudo           | https://fudo.com/ and https://www.fudo.com/                                                                     | 000    | No connection                        |
| Fudo           | https://ayuda.fudo.app/                                                                                         | 000    | No connection                        |
| PoloTab        | https://www.polotab.com/                                                                                        | 200    | Product page                         |
| PoloTab        | https://www.polotab.com/soporte                                                                                 | 200    | Support index                        |
| PoloTab        | https://www.polotab.com/soporte/crear-mesas                                                                     | 200    | Help page for tables                 |
| SoftRestaurant | https://www.softrestaurant.com/                                                                                 | 200    | Product page                         |
| SoftRestaurant | https://www.softrestaurant.com/soft-restaurant-12                                                               | 200    | Product page for version 12          |
| SoftRestaurant | https://academia.softrestaurant.com/                                                                            | 200    | Training portal with screens         |
| SoftRestaurant | https://softrestaurant.zohodesk.com/portal/es/home                                                              | 200    | Support portal                       |
| YouTube        | https://www.youtube.com/results?search_query=toast+pos+walkthrough                                              | 200    | Search page, JavaScript only         |

### 7.3 What a tool can fetch

**Fact.** Most vendor help centers return static HTML. A tool can fetch the text and the image URLs. A tool cannot read the rendered page without a browser engine.

**Fact.** Apple HIG pages return a shell of HTML that needs JavaScript. The readable text sits in a data file. The path is `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/<page>.json` ([example](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/motion.json)).

**Fact.** The Material Design site m3.material.io returns "This website requires JavaScript" in the raw HTML. The motion values were verified from the AndroidX source file instead.

**Fact.** Two Toast marketing domains answer with code 403. Use `support.toasttab.com` and `doc.toasttab.com` for the Toast text and the images.

**Inference.** Use this method to collect the competitor screens.

1. Use Playwright with a desktop viewport of 1280 x 800.
2. Capture the full page and save a web-sized JPEG.
3. Prefer a help-center page over a marketing page, because a help page shows the real product states.
4. Capture the app screens from the App Store listing, because the listing returns a plain image file.
5. Store the files in `docs/research/<date>-<topic>/assets/` with a vendor prefix.
6. Record the URL, the date, and the viewport in a source note beside the images.
7. Set one capture at 1024 x 768, because that is the UmiPOS target.

**Inference.** Do not copy a vendor layout into Umi. The vendors optimize for a wide feature set. Umi optimizes for one café workflow with a calm screen.

## Screen table: best in class for each screen

| Screen                   | Best-in-class example                                | What to copy                                                                                            | What to avoid                                                             |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Floor plan and table map | Square dashboard plan and Toast table service        | Plan editing in the dashboard, service actions in the POS, stable table identity, a map and list switch | Furniture detail, seat-level editing, a plan editor on the service screen |
| Table detail             | Odoo preparation cards                               | Guest count, elapsed time, item progress, and an attention signal on the card                           | Payment state as the only table state                                     |
| Order taking             | Square item grid                                     | One-tap add, a default variation, a most-sold set, a fixed grid position                                | A deep category tree, a search-only path, a moving grid                   |
| Modifiers                | Toast required groups and Lightspeed modifier chains | A forced choice only when the kitchen needs it, a chain of one choice to the next group                 | A full modifier list on every item, a separate screen per modifier        |
| Split and merge          | Square check and payment split                       | A separate action for each split type, a visible result before the commit                               | One button that both moves and merges                                     |
| Checkout and payment     | Square post-cart flow                                | About three taps after the cart, one review panel, a large change-due number                            | Stacked confirmations, a signature step, a loading screen over the tender |
| Refund and void          | Square refund and Toast void                         | A role gate, a visible scope, a reason from a list, one confirm                                         | A hidden refund path, a free-text reason, two confirmations               |
| Inventory count          | Square inventory reporting                           | One row per item, a large stepper, a visible difference                                                 | A free-text quantity field, a count without the system value              |
| Recipe costing           | Lightspeed recipes                                   | The ingredient cost and the plate cost in one view, the margin beside the price                         | A separate cost report from the recipe screen                             |
| Cash shift close         | Square drawer session and Toast variance gate        | A numbered flow, a blind count, the expected and actual values, a manager gate                          | A single free-text total, a silent close on a large variance              |
| KDS bump                 | Square KDS and Lightspeed KDS 2.0                    | One direct tap, a short undo, states with different names                                               | A confirm dialog on the common state change                               |
| Dashboard home           | Square Dashboard                                     | One screen with today, this week, cash, top items, and alerts                                           | A wall of charts without a next action                                    |
| Guest detail             | Square Customer Directory                            | One object with orders, visits, and payments in a timeline                                              | A separate CRM screen with its own search                                 |
| Shift open               | Square drawer session                                | One instruction per screen, the starting balance visible at the count                                   | A long form, a hidden starting balance                                    |

## Anti-patterns to ban

**Inference.** Ban these patterns in UmiPOS and in the dashboard. Each ban follows a source rule. The note names the rule.

1. Ban an icon-only primary action. Add a visible label. Source rule: NN/g icon research and the sibling navigation report.
2. Ban a control below 44 pt, and below 48 dp on the POS. Source rule: Apple HIG and Material.
3. Ban a layout that moves after a tap. Source rule: NN/g spatial memory and the Power Law of Practice.
4. Ban a reflow of the product grid during a shift. Source rule: NN/g spatial memory.
5. Ban a confirm dialog on a routine action. Source rule: NN/g confirmation dialogs.
6. Ban two or more confirmations on one money action. Source rule: the sibling action-volume report.
7. Ban a hidden high-frequency action inside a kebab menu. Source rule: NN/g contextual menus, guideline one.
8. Ban a contextual menu icon that sits far from its object. Source rule: NN/g contextual menus.
9. Ban a status that color alone carries. Source rule: WCAG 1.4.3 and 1.4.11.
10. Ban a primary action that moves between screens. Source rule: the NN/g consistency heuristic.
11. Ban an animation longer than 400 ms on the hot path. Source rule: NN/g animation duration.
12. Ban an animation on a high-frequency interaction. Source rule: Apple HIG motion.
13. Ban a sound as the only signal for an important event. Source rule: the Monteiro noise study and Apple HIG feedback.
14. Ban a blocking modal during order entry. Source rule: Apple HIG agency.
15. Ban a separate screen for each link between two objects. Source rule: the working-memory rule and NN/g spatial memory.
16. Ban a decorative shape, a glow, or a shadow without a function. Source rule: Apple HIG materials.
17. Ban a light font weight for a label or a number. Source rule: Apple HIG typography.
18. Ban a text size below 11 pt, and below 13 pt for a secondary label on the POS. Source rule: Apple HIG typography.

## Sources

All URLs below answered with code 200 on 2026-09-15 unless a note says something else. The fetch used a desktop browser user agent.

### Apple Human Interface Guidelines

- Design principles: https://developer.apple.com/design/human-interface-guidelines/design-principles
- Accessibility: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Layout: https://developer.apple.com/design/human-interface-guidelines/layout
- Typography: https://developer.apple.com/design/human-interface-guidelines/typography
- Materials: https://developer.apple.com/design/human-interface-guidelines/materials
- Motion: https://developer.apple.com/design/human-interface-guidelines/motion
- Feedback: https://developer.apple.com/design/human-interface-guidelines/feedback
- Loading: https://developer.apple.com/design/human-interface-guidelines/loading
- Playing haptics: https://developer.apple.com/design/human-interface-guidelines/playing-haptics
- Playing audio: https://developer.apple.com/design/human-interface-guidelines/playing-audio
- Gestures: https://developer.apple.com/design/human-interface-guidelines/gestures
- Toolbars: https://developer.apple.com/design/human-interface-guidelines/toolbars
- Context menus: https://developer.apple.com/design/human-interface-guidelines/context-menus
- Searching: https://developer.apple.com/design/human-interface-guidelines/searching
- Text data file for one page: `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/<page>.json`

Note. The HIG pages return an HTML shell that needs JavaScript. The command line fetch reads the data file instead. The old address `https://developer.apple.com/ios/human-interface-guidelines/overview/themes/` redirects to the HIG root, and it does not state the words clarity, deference, and depth.

### Standards

- W3C WCAG 2.5.5 target size: https://www.w3.org/WAI/WCAG21/Understanding/target-size.html
- W3C WCAG 1.4.3 contrast: https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html
- W3C WCAG 1.4.11 non-text contrast: https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html
- Android accessibility, 48 dp and spacing: https://support.google.com/accessibility/android/answer/7101858?hl=en
- ISO 9241-110:2020: https://www.iso.org/standard/75258.html

Note. The ISO standard is behind a paywall. This report cites the principle names only.

Note on the fetch result. The w3.org pages answered with code 200 to a plain fetch and with code 403 to a fetch that carried a browser user agent. The server has a bot rule, and the page is present. The iso.org page returned code 403 in both cases.

### Usability research

- Progressive disclosure: https://www.nngroup.com/articles/progressive-disclosure/
- Contextual menus, 10 guidelines: https://www.nngroup.com/articles/contextual-menus-guidelines/
- Working memory and external memory: https://www.nngroup.com/articles/working-memory-external-memory/
- Spatial memory: https://www.nngroup.com/articles/spatial-memory/
- Recognition and recall: https://www.nngroup.com/articles/recognition-and-recall/
- Typography for glanceable reading: https://www.nngroup.com/articles/glanceable-fonts/
- Site search suggestions: https://www.nngroup.com/articles/site-search-suggestions/
- Animation duration: https://www.nngroup.com/articles/animation-duration/
- Response time limits: https://www.nngroup.com/articles/response-times-3-important-limits/
- Confirmation dialogs: https://www.nngroup.com/articles/confirmation-dialog/
- Icon usability: https://www.nngroup.com/articles/icon-usability/
- Touch target size: https://www.nngroup.com/articles/touch-target-size/
- Ten usability heuristics: https://www.nngroup.com/articles/ten-usability-heuristics/
- Hamburger menus and hidden navigation: https://www.nngroup.com/articles/hamburger-menus/
- How people hold a mobile device: https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php

### HCI models and ergonomics

- Keystroke-Level Model, Kieras: https://www.cs.umd.edu/~golbeck/INST631/KSM.pdf
- Keystroke-Level Model, Card, Moran and Newell: https://dl.acm.org/doi/10.1145/358886.358895
- Fitts law: https://psycnet.apa.org/record/1955-02059-001
- FFitts model for finger touch: https://www3.cs.stonybrook.edu/~xiaojun/pdf/FFitts.pdf
- Barista pain and tamp load, Dainty et al. 2014: https://pubmed.ncbi.nlm.nih.gov/24837283/
- Noise and attention in a fast food workplace, Monteiro et al. 2018: https://pubmed.ncbi.nlm.nih.gov/30516172/
- Touch target location and physical demand: https://doi.org/10.1016/j.apergo.2017.01.015
- Texas DWC repetition threshold: https://www.tdi.texas.gov/pubs/videoresource/fsergofood.pdf

Note. The two PubMed pages returned code 203 to the command line client on 2026-09-15. That is a bot gate and not a missing article. The abstracts were read through the PubMed E-utilities interface.

Note. The address https://dl.acm.org/doi/10.1145/358886.358895 returned code 403 to this fetch. The Keystroke-Level Model values in this report come from the Kieras file, which answered with code 200.

### Motion tokens

- Material 3 motion tokens in AndroidX: https://raw.githubusercontent.com/androidx/androidx/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/MotionTokens.kt

Note. The site m3.material.io returns only "This website requires JavaScript" in the raw HTML. The token values come from the AndroidX source file above.

### Vendor documents

- Square cart building: https://squareup.com/help/us/en/article/8238-build-your-customer-s-cart-in-the-square-retail-pos-app
- Square refunds: https://squareup.com/help/us/en/article/5060-process-refunds-with-square
- Square check and payment split: https://squareup.com/help/us/en/article/8165-split-a-payment-and-check-with-square-for-restaurants
- Square floor plans: https://squareup.com/help/us/en/article/6427-building-your-floor-plan
- Square permission levels: https://squareup.com/help/us/en/article/5822-employee-permissions
- Square KDS: https://squareup.com/help/us/en/article/8171-complete-orders-with-square-kds
- Square inventory reporting: https://squareup.com/help/us/en/article/6370-square-inventory-reporting
- Toast voiding: https://doc.toasttab.com/doc/platformguide/adminVoidingOrders.html
- Toast permissions: https://doc.toasttab.com/doc/platformguide/adminPermissions.html
- Toast KDS: https://doc.toasttab.com/doc/platformguide/platformKDSOverview.html
- Toast table management: https://support.toasttab.com/en/article/New-POS-Managing-Tables
- Clover tenders: https://docs.clover.com/dev/docs/custom-tenders
- Clover roles and permissions: https://www.clover.com/en-US/help/employee-roles-and-permissions
- Lightspeed KDS 2.0: https://k-series-support.lightspeedhq.com/hc/en-us/articles/22708154090267-Using-the-Kitchen-Display-System-2-0
- Lightspeed users and user groups: https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804594570-About-users-and-user-groups
- Odoo preparation display: https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/extra/preparation.html
- PoloTab tables: https://www.polotab.com/soporte/crear-mesas
- SoftRestaurant academy: https://academia.softrestaurant.com/
- Socket.IO delivery guarantees: https://socket.io/docs/v4/delivery-guarantees/

### Sources that did not answer

- `https://pos.toasttab.com/` returned code 403.
- `https://www.toasttab.com/restaurant-pos` returned code 403.
- `https://fudo.com/` and `https://www.fudo.com/` returned code 000. Use `https://fudo.app/`.
- `https://ayuda.fudo.app/` returned code 000.
- `https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804611229-Inventory-counts` returned code 404. This report does not cite that address.
- `https://www.iso.org/standard/75258.html` and `https://dl.acm.org/doi/10.1145/358886.358895` returned code 403 to both fetch styles.
- The three w3.org pages returned code 403 to a fetch with a browser user agent and code 200 to a plain fetch.

## Limits of this research

**Fact.** This research read documents and measured no user. It ran no application test and made no change to application code.

**Inference.** The layout numbers in section 1.4 need a check on the real panel and with real operators. The role first screens in section 3.2 need a pilot with a real café. The command palette in section 4.3 needs an owner test.
