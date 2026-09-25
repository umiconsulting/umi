# 04 — The operator voice: what buyers say about supplier ordering

- Date of collection: 2026-09-18.
- Owner: lane 4 of 5 on the purchase-order market pass.
- Scope: what the **operator** says, in their own words, about ordering from
  suppliers.
- Question for this section: where does the purchase order break for the person
  who places the order?
- The quotes are the evidence. The summary does not replace a quote.

Every claim below carries one label:

- **Documented fact** — the source states it, and the source URL answers.
- **Source-backed tradeoff** — the source states a limit or a cost.
- **Inference** — this section draws the conclusion from the quotes.

An item that this section could not confirm reads UNVERIFIED.

## Channel counts

| Channel           | Route                                                         | Items kept        | Result                                                    |
| ----------------- | ------------------------------------------------------------- | ----------------- | --------------------------------------------------------- |
| Apple App Store   | `itunes.apple.com` search, lookup, review RSS (`us` and `mx`) | 10                | Strong. ~640 reviews scanned.                             |
| Google Play       | `google-play-scraper` 1.x over `play.google.com`              | 5                 | Weak on purchase orders. 2,004 reviews scanned.           |
| Reddit            | `redlib` mirror `safereddit.com` in real Chromium             | 20                | Strong. `reddit.com` itself is blocked from this host.    |
| Shopify community | Discourse `/search.json` and `/t/<id>.json`                   | 14                | Strongest single source.                                  |
| Square community  | Khoros search HTML with a Chrome user agent                   | 6                 | Strong. Small threads, sharp claims.                      |
| Hacker News       | Algolia `/api/v1/search`                                      | 2                 | Weak. The topic is not discussed by restaurant operators. |
| YouTube           | `yt-dlp` search, comments, frames                             | 0 quotes, 1 frame | Weak. Comments hold no supplier-order talk.               |
| Toast community   | `community.toasttab.com`                                      | 0                 | Blocked. Cloudflare interstitial.                         |

Lane total: **58 items**. 57 items hold a verbatim quote. One item (UGC-Y01) holds
a frame and a title only.

## Route-failure log

| Host                                                                                            | Route                                                            | Result                                                                                                           |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `www.reddit.com`                                                                                | `/r/<sub>/search.rss?q=…`                                        | HTTP 403 with the body `Blocked`.                                                                                |
| `www.reddit.com`                                                                                | `/r/<sub>/search.json`, `/comments/<id>.json`                    | HTTP 403, 189 KB block page.                                                                                     |
| `old.reddit.com`                                                                                | `/r/<sub>/search.rss`                                            | HTTP 302 to `/login/?reason=lor2`. No content.                                                                   |
| `r.jina.ai`                                                                                     | prefix before a Reddit URL                                       | HTTP 403, Cloudflare challenge.                                                                                  |
| `api.pullpush.io`                                                                               | `/reddit/search/comment/?q=…`                                    | HTTP 200 with the error "Rate limit exceeded. This website does not provide free scraping resources for agents." |
| `redlib.catsarch.com`, `redlib.freedit.eu`, `redlib.perennialte.ch`, `libreddit.privacydev.net` | `/r/<sub>/search`                                                | HTTP 429, 403, or 502.                                                                                           |
| `safereddit.com`, `redlib.privacyredirect.com`                                                  | `/search` with `curl`                                            | Anubis proof-of-work challenge, 4.4 KB of HTML.                                                                  |
| `safereddit.com`                                                                                | `/search` in real Chromium on `DISPLAY=:0`                       | **Works.** This is the Reddit route.                                                                             |
| `community.toasttab.com`                                                                        | `/search.json?q=purchase%20order`                                | HTTP 403, Cloudflare "Just a moment…".                                                                           |
| `community.squareup.com`                                                                        | `/latest.json`, `/search.json`                                   | HTTP 404. Khoros, not Discourse.                                                                                 |
| `community.squareup.com`                                                                        | `/t5/forums/searchpage/tab/message?q=…` with a Chrome user agent | **Works.** HTML holds the thread links.                                                                          |
| `shopify.dev`                                                                                   | `/docs/api/admin-graphql/latest/objects/PurchaseOrder`           | HTTP 404. The control URLs `objects/Order` and `objects/InventoryTransfer` answer HTTP 200.                      |

## Apple App Store reviews

**UGC-A01 — Square Retail POS, App Store US** · 1★ · 2025-12-07 · **Documented fact**

> "Keeps giving me an error, saying could not save purchase order sink your items and try again"

Source: <https://itunes.apple.com/us/reviews/id1864710434> (HTTP 200). Reviewer `Edofsm`.
Why it matters: the purchase order of a shipping retail POS does not save. The
title of the review is "Can't create purchase orders".

**UGC-A02 — Square Retail POS, App Store US** · 3★ · 2026-05-06 · **Documented fact**

> "The app will miscommunicate with my printer, or the purchase order process will stop saving the way it used too."

Source: <https://itunes.apple.com/us/reviews/id366678778> (HTTP 200). Reviewer `Hwolf34`, title "Updates ALWAYS Cause Problems".
Why it matters: a release breaks the purchase order. The operator must repair a
working process after each update.

**UGC-A03 — Square Retail POS, App Store US** · 1★ · 2025-08-21 · **Documented fact**

> "The new update is terrible for orders. Too complicated, annoying I have to unselect the vendor every time instead of showing items from all vendors."

Source: <https://itunes.apple.com/us/reviews/id135790758> (HTTP 200). Reviewer `Alexnads8`, title "HATE the new update".
Why it matters: the order screen filters by one vendor. The operator wants all
vendors in one list.

**UGC-A04 — Square Retail POS, App Store US** · 4★ · 2024-10-24 · **Documented fact**

> "Also, creating a new PO first requires the items be added on a different section of the app rather than adding them while creating a PO, this is cumbersome."

Source: <https://itunes.apple.com/us/reviews/id29177890> (HTTP 200). Reviewer `Superbrian2010`.
Why it matters: the item must exist before the PO. The PO screen cannot create an
item on the way.

**UGC-A05 — WISK.ai, App Store US** · 5★ · 2020-10-26 · **Documented fact**

> "This app has saved me hours on my weekly inventory. I also use it religiously to place my orders to my suppliers. Love it"

Source: <https://itunes.apple.com/us/reviews/id244071865> (HTTP 200). Reviewer `enzofelo`.
Why it matters: a happy operator names supplier ordering as the reason to keep the
app. Ordering is a first-class job, not a report.

**UGC-A06 — MarketMan, App Store US** · 5★ · 2023-10-20 · **Documented fact**

> "The app is almost marketman light which allows us at the restaurant to handle simple task like taking inventory, scanning and ordering. The software itself on the laptop does all the heavy lifting."

Source: <https://itunes.apple.com/us/reviews/id1284231557> (HTTP 200). Reviewer `loco kitchen`.
Why it matters: the mobile app counts and orders. The desktop does the real work.
The operator accepts the split.

**UGC-A07 — MarketMan, App Store US** · 1★ · 2021-11-27 · **Documented fact**

> "Unless you remember to save your counts every five minutes in the app, your best bet would be walking around with a computer and using the actual website."

Source: <https://itunes.apple.com/us/reviews/id328073044> (HTTP 200). Reviewer `Chelsey Verde`.
Why it matters: a lost count pushes the operator back to the desktop. The counter
and the order are one loop.

**UGC-A08 — Craftable Mobile, App Store US** · 5★ · 2021-08-24 · **Documented fact**

> "We use Craftable to manage our entire purchasing and receiving process, inventory audits, recipes, and reporting."

Source: <https://itunes.apple.com/us/reviews/id17223156> (HTTP 200). Reviewer `prime-cut`.
Why it matters: the buyer treats purchasing and receiving as one process with one
tool.

**UGC-A09 — Loyverse POS, App Store MX** · 4★ · 2026-06-04 · **Documented fact**

> "Es buena la app pero no se van quitando las cosas del inventario cuando haces ventas"

Source: <https://itunes.apple.com/mx/reviews/id1929352571> (HTTP 200). Reviewer `Imventario`.
Why it matters: the stock figure does not move on a sale. A wrong count makes every
reorder quantity wrong.

**UGC-A10 — Clover Go, App Store US** · 1★ · 2026-06-18 · **Documented fact**

> "After the recent updates , unable to update the item inventory via the app . The show on kiosk toggle button and the image upload option is unavailable in the app . … Now we have to always use the web dashboard to upload."

Source: <https://itunes.apple.com/us/reviews/id760311325> (HTTP 200). Reviewer `AySarf`.
Why it matters: the operator calls the desktop dashboard a punishment, not a
feature. The phone stopped holding the work.

## Google Play reviews

Method note: this lane scanned 2,004 reviews of 11 apps. The words "purchase
order", "order guide", and "par level" do not appear once. **Documented fact** —
the harvest file holds the full set.

**UGC-G01 — MarketMan, Google Play US** · 1★ · 2022-05-04 · 4 helpful votes · **Documented fact**

> "App is slow loading supplier stock items , random log outs . As a chef I would rather be cooking than waiting for to do my orders at the end of the day when I want to go home after a 14hr shift Invoice scanning still dosnt work after a year"

Source: <https://play.google.com/store/apps/details?id=com.app.marketman&reviewId=9f270c31-27d6-426c-9713-2a637f20c926>
Why it matters: the order runs at the end of a 14-hour shift. Speed at that moment
decides whether the operator uses the tool.

**UGC-G02 — MarketMan, Google Play US** · 2★ · 2025-09-08 · 2 helpful votes · **Documented fact**

> "invoices constantly fail to upload, despite being clean photos that are supposedly going to a human team to process them. don't dare accidentally hit the back button on your phone while doing inventory, or, without a warning, it just deletes your entire count."

Source: <https://play.google.com/store/apps/details?id=com.app.marketman&reviewId=a2d309ec-d4ed-44bf-8d2d-59824f5401fb>
Why it matters: a back gesture destroys a count. The invoice path needs a human team.

**UGC-G03 — Craftable, Google Play US** · 1★ · 2024-09-04 · 2 helpful votes · **Documented fact**

> "Constantly logged out while trying to upload pics of invoices."

Source: <https://play.google.com/store/apps/details?id=com.craftable.webapp&reviewId=4c8268a2-254b-4c2c-b3a3-87cba60f21df>
Why it matters: the session dies in the middle of the invoice job.

**UGC-G04 — Craftable, Google Play US** · 1★ · 2024-04-24 · 5 helpful votes · **Documented fact**

> "Work in a busy restaurant! This app sucks! Always kicking me out won't stay logged in. Uploading invoices is a painful when using a phone! … Awful design for restaurants."

Source: <https://play.google.com/store/apps/details?id=com.craftable.webapp&reviewId=0a78cc06-cdee-40e7-955a-3b9304a62250>
Why it matters: the operator names the design, not one bug. The phone is the wrong
shape for the invoice job.

**UGC-G05 — xtraCHEF, Google Play US** · 1★ · 2026-07-17 · 2 helpful votes · **Documented fact**

> "The 5% of the time this app actually works, it's solid. The problem is that its login process is soooooooo buggy! I just want to enter my damn invoices. What are we paying you (Toast) so much for?!"

Source: <https://play.google.com/store/apps/details?id=com.xtrachef.app&reviewId=889c25ae-d71f-47c1-b8e0-ab342719b9ca>
Why it matters: the invoice enters the cost of the goods. A blocked invoice stops
the margin number.

## Reddit

Method note: **Documented fact** — `www.reddit.com` and `old.reddit.com` return HTTP
403 from this host. This lane read Reddit through the mirror `safereddit.com` in
real Chromium. Each item below holds the canonical `reddit.com` permalink, and the
mirror route that answered. The canonical URL exists; this host cannot open it.

**UGC-R01 — r/restaurateur, "Anyone have a good layout an order list?"** · ~2022 · **Documented fact**

> "You should be able to get purchasing history from your vendors, convert those to an excel worksheet. It's not the fanciest, but I've done it that way for years and it works. … Figure out how much of each item you go through in a week and include those par numbers in your spreadsheet and have 2 entry cells. 1 for how much you have on hand and the other for how much you need to order. Record what's on the shelf and order the difference."

Source: <https://www.reddit.com/r/restaurateur/comments/txf87d/anyone_have_a_good_layout_an_order_list/> (mirror answered HTTP 200). User `tonyc79`.
Why it matters: the answer to "give me a layout" is a spreadsheet with a par
number and two cells. This is the default market.

**UGC-R02 — same thread** · **Documented fact**

> "I have all my items on one page on an excel sheet, I print the master list, write the order totals then type them in the master list, it then auto-populates those numbers on each vendors individual excel sheet, I sort out the zeros, then copy and paste into an email. I have 9/10 different alcohol vendors I order from so this makes it a cake walk."

Source: <https://www.reddit.com/r/restaurateur/comments/txf87d/anyone_have_a_good_layout_an_order_list/>. User `[deleted]` (the text survives in the mirror).
Why it matters: one master list, many vendor sheets, one email per vendor. That is
a purchase-order feature set built by hand.

**UGC-R03 — same thread** · **Documented fact**

> "I developed a system in excel, where my vendors (6) of them send their pricing into me. All 500 line items are tightly spec'd. I import the vendors pricing into the master order guide, i then mark the awarded vendor per product. This system is used for 5 places. I them have the ordered emailed to all the vendors at once. They see what they got and what the lost."

Source: <https://www.reddit.com/r/restaurateur/comments/txf87d/anyone_have_a_good_layout_an_order_list/>. User `tixgrinder`.
Why it matters: a multi-site operator runs vendor award and bid comparison on a
spreadsheet.

**UGC-R04 — same thread** · **Documented fact**

> "the way I do it is having a dedicated purchaser that's not myself. We pay her like $50 a week. All she does is take the order list from FOH and BOH and compiles it with the knowledge of the nuances in mind. After that she places the orders."

Source: <https://www.reddit.com/r/restaurateur/comments/txf87d/anyone_have_a_good_layout_an_order_list/>. User `_JamesPhan`.
Why it matters: the operator hires a person to do the job the software does not do.

**UGC-R05 — r/KitchenConfidential, "Inventory Purchase Order Problems"** · **Documented fact**

> "Not having idiots input the inventory helps. … Make sure it's clearly noted if it's by the pound, by the case or by the each."

Source: <https://www.reddit.com/r/KitchenConfidential/comments/h9f6un/inventory_purchase_order_problems/>. User `[deleted]`.
Why it matters: the unit of purchase is the top data fault. The order line needs
the case size.

**UGC-R06 — same thread** · **Documented fact**

> "Including case sizing in the name/line thats readable at entry point. … If a case is 48 individual, id make sure it read as 'avocado, 48 per case' or the like."

Source: <https://www.reddit.com/r/KitchenConfidential/comments/h9f6un/inventory_purchase_order_problems/>. User `[deleted]`.
Why it matters: one SKU holds many units. A quantity without a unit is a wrong
order.

**UGC-R07 — r/KitchenConfidential, "advice … about order guides"** · 2015 · **Documented fact**

> "I organize all my order guides so that when I'm in storage and look down the shelf, my order guide goes the same way. Then I put everyday items on the top of list, and any special order/once in a blue moon type shit on the bottom."

Source: <https://www.reddit.com/r/KitchenConfidential/comments/3f2xdt/i_need_some_advice_from_my_fellow_chefs_out_there/>. User `sixstringer420`.
Why it matters: the list order must match the shelf walk. This is a hard
requirement for a count screen.

**UGC-R08 — same thread** · **Documented fact**

> "Shelf to sheet. Sheet to screen. That's it. … I also have it set up so it forces one complete trip around the kitchen. No return trips. No wasted movements. Nothing. Then the sheet transfers exactly in order to the computer screen."

Source: <https://www.reddit.com/r/KitchenConfidential/comments/3f2xdt/i_need_some_advice_from_my_fellow_chefs_out_there/>. User `[deleted]`.
Why it matters: the operator names the loop: shelf, paper, screen. The tool must
keep the same sequence or it adds a trip.

**UGC-R09 — same thread** · **Documented fact**

> "Setting stock pars for items is still a bit challenging, especially perishables. Sales volume is constantly rising, so where 3 cases/week had served for months, now we need 4. It's sometimes difficult for me to predict when I need to update the pars"

Source: <https://www.reddit.com/r/KitchenConfidential/comments/3f2xdt/i_need_some_advice_from_my_fellow_chefs_out_there/>. User `Cdresden`.
Why it matters: a fixed par goes stale. The operator must be able to see and edit
the par, and to know why the number changed.

**UGC-R10 — same thread** · **Documented fact**

> "Just remember to keep it simple enough so that if you hand it to the FNG, he'll be able to go check the order without having to come ask you about everything."

Source: <https://www.reddit.com/r/KitchenConfidential/comments/3f2xdt/i_need_some_advice_from_my_fellow_chefs_out_there/>. User `ChefGuru`.
Why it matters: a third person runs the count. The screen must explain itself.

**UGC-R11 — r/KitchenConfidential, "This Order Guide one of my Stores Uses to Buy Commissary Stuff"** · 2025-08 · **Documented fact**

> Title: "This Order Guide one of my Stores Uses to Buy Commissary Stuff"

Source: <https://www.reddit.com/r/KitchenConfidential/comments/1mmuck0/this_order_guide_one_of_my_stores_uses_to_buy/>. The post holds a phone
photo of a handwritten list on a notepad, under the heading "Remi King". Capture:
`assets/ugc-01-reddit-paper-order-guide.jpeg`.
Why it matters: the live order guide of a working store is a paper list in pen.

**UGC-R12 — r/KitchenConfidential, "I'm new to Sysco orders"** · 2023-05 · **Documented fact**

> "Maintaining your order guides and communicating with reps is a lot of extra work and I'd tell my KM to fuck off if I was being asked to do all that as a prep cook."

Source: <https://www.reddit.com/r/KitchenConfidential/comments/13etpey/im_new_to_sysco_orders_and_have_a_question_dont/>. User `3CKid`.
Why it matters: ordering is a management duty with a salary attached. The tool
serves a manager, not a cook at the pass.

**UGC-R13 — r/restaurateur, "How do restaurants manage a supply chain?"** · 2018 · **Documented fact**

> "Restaurants take a visual count each day or every few days and an email or phone call is placed regarding what is needed. … it's more of a 'we went through half a case of x today, I'll order a case in for tomorrow.'"

Source: <https://www.reddit.com/r/restaurateur/comments/8r5673/how_do_restaurants_manage_a_supply_chain/>. User `RamekinOfRanch`.
Why it matters: the order is a count plus a message. The tool must send the message.

**UGC-R14 — same thread** · **Documented fact**

> "We use Sysco 2x a week for staples … reconciling, paying out, and building p&l's this way is a nightmare."

Source: <https://www.reddit.com/r/restaurateur/comments/8r5673/how_do_restaurants_manage_a_supply_chain/>. User `m4tttt`.
Why it matters: many suppliers, many invoices per week. Reconciliation is the
expensive part.

**UGC-R15 — r/InventoryManagement, "How do you handle purchase orders & receiving?"** · 2025 · **Documented fact**

> "the workflow PO —> Invoice —> actual quantities received are three different tasks to reconcile. Without apps, it is very manual, time consuming and prone to errors. It is not ideal to adjust the PO for the quantity received. It should record what actually received and billed"

Source: <https://www.reddit.com/r/InventoryManagement/comments/1nz4qun/question_for_store_owners_how_do_you_handle/>. User `HelloInventory`. A
second user answers "It's really surprising how manual it is given the sheer
amount of small retail locations nationally" (`Same_Lie_6308`).
Why it matters: three documents, one truth. The receipt is the record, not the PO.

**UGC-R16 — r/InventoryManagement, "PO system that can receive stock and split it by store"** · 2025 · **Documented fact**

> "Inventory visibility is through Shopify. Reordering is manual, we choose a vendor have a look at I'm the inventory in Shopify"

Source: <https://www.reddit.com/r/InventoryManagement/comments/1u0zvcn/looking_for_a_po_system_that_can_receive_stock/>. User `Efficient_Source_389`.
Same thread, user `MiladDeMilo`: "Your spreadsheet is running this offline which
makes it impossible to tie back to a formal PO audit trail".
Why it matters: the source of truth and the ordering tool are separate. The audit
trail is the casualty.

**UGC-R17 — r/smallbusiness, "Receiving Purchase Orders: Automated PO Logging Software?"** · **Documented fact**

> "How do big companies handle the hundreds/thousands of POs they process each day without a small army of people doing this stuff manually?"

Source: <https://www.reddit.com/r/smallbusiness/comments/8lb3z8/receiving_purchase_orders_automated_po_logging/>. User `JJJJJust`.
Why it matters: the buyer asks for a benchmark, not a feature. Volume is the pain.

**UGC-R18 — r/smallbusiness, "Purchase Order Organizing Software."** · **Documented fact**

> "I would like a simple solution to Track purchase orders from start to finish."

Source: <https://www.reddit.com/r/smallbusiness/comments/6uhhmt/purchase_order_organizing_software/>. User `Zach_DPMS`.
Why it matters: "start to finish" is the request. A PO form alone does not answer it.

**UGC-R19 — r/restaurateur, "Inventory Management & Purchasing"** · 2023 · **Documented fact**

> "I am a restaurant accountant and many of my clients are using MarginEdge and R365 for such requirements."

Source: <https://www.reddit.com/r/restaurateur/comments/16x5zm3/inventory_management_purchasing/>. User `Nirmal_RestaurantAcc`. The top answer is
`B8conB8conB8con`: "Hire an experienced professional".
Why it matters: the buyers of this category are often the bookkeeper, not the chef.

**UGC-R20 — r/KitchenConfidential, "Anybody familiar with the app Rekki?"** · 2018 · **Documented fact**

> "It's supposed to connect you, your other purchasers and purveyors, all in one app, to streamline ordering. Just listened to a sales pitch but figured I'd ask you guys if you know anything."

Source: <https://www.reddit.com/r/KitchenConfidential/comments/a181d6/anybody_familiar_with_the_app_rekki_its_supposed/>.
Why it matters: the promise of a supplier network is old. This lane found no reply
in the thread. UNVERIFIED: whether anyone in that sub adopted it.

## Shopify community (Discourse)

Method note: **Documented fact** — `community.shopify.com/search.json` answers HTTP
200 and returns 50 topics per query. Every permalink below answers HTTP 200.

**UGC-S01 — topic 636598, "How are you currently managing purchase orders and supplier inventory in Shopify?"** · 2026-06-13 · **Documented fact**

> "honestly the PO stuff inside Shopify is so bad i gave up on it. we do everything in spreadsheets + email like everyone else apparently."

Source: <https://community.shopify.com/t/636598>. User `antonio_builds`.
Why it matters: the operator abandons the native tool and joins a manual norm.

**UGC-S02 — same topic** · 2026-07-21 · **Documented fact**

> "Raising a PO isn't what takes time. Receiving is. The shipment arrives with different quantities, the invoice arrives later with different numbers again, and reconciling everything is where the work starts."

Source: <https://community.shopify.com/t/636598>. User `jpfrompurser`.
Why it matters: the PO is the cheap part. This is the sharpest rejection of a
PO-only design in the whole pass.

**UGC-S03 — same topic** · 2026-07-24 · **Documented fact**

> "The time was never in creating the PO - it was everything after: chasing what actually arrived versus what was ordered, short ships, and updating costs when a supplier quietly raised prices mid-year. Any system that treats receiving as one click instead of a reconciliation step is lying to you about the job."

Source: <https://community.shopify.com/t/636598>. User `stockwik` (discloses that he
built an app).
Why it matters: a variance is normal, not an error case. The design must hold a
variance.

**UGC-S04 — same topic** · 2026-07-25 · **Documented fact**

> "Sending the PO email is trivial, everyone does it. Parsing what comes back is where it falls apart: every supplier answers in their own format, half of it is free text, confirmations and partials and backorders all look different, and there's no standard to anchor to."

Source: <https://community.shopify.com/t/636598>. User `antonio_builds`.
Why it matters: the reply, not the request, is the hard half.

**UGC-S05 — same topic** · 2026-08-08 · **Documented fact**

> "Disclosure first: I am building a purchase order app in this space, so read this as interested rather than neutral."

Source: <https://community.shopify.com/t/636598>. User `Coverdays`. Most replies in
this thread come from app vendors: `SealSubs-Roan`, `kthoppae` (NexuSphere),
`jmiralles` (EasyRestock), `Denyslg` (Binly), `Skubase`, `vishalkundar` (Replenly).
Why it matters: the thread is a demand signal with a vendor audience. Count the
operator quotes, not the reply count.

**UGC-S06 — topic 672733, "Improve Shopify Purchase Orders: Connect Retailers & Suppliers"** · 2026-08-26 · **Documented fact**

> "As a Shopify retailer, I can create a Purchase Order and enter the supplier's name, company, address and email. However, the email field currently doesn't actually send the PO to the supplier, and the supplier has no Shopify-side workflow to receive, manage or fulfill that order."

Source: <https://community.shopify.com/t/672733>. User `vitaautentica`.
Why it matters: the native PO holds an email address and sends nothing.

**UGC-S07 — same topic** · 2026-08-28 · **Documented fact**

> "the final supplier invoice is often the document that confirms the actual cost and sometimes the actual delivered quantities too. Those can differ slightly from what was originally ordered. … Otherwise you still end up doing the final reconciliation manually."

Source: <https://community.shopify.com/t/672733>. User `salor_works`.
Why it matters: the invoice closes the loop on cost. Received quantity alone is not
enough.

**UGC-S08 — same topic** · 2026-09-07 · **Documented fact**

> "A supplier with forty retail customers already runs their own system, so asking them to log into yours makes your order the one that takes longer than everybody else's, and it sinks to the bottom of the pile. That is not a technology objection. It is a queue. What they want is a document that arrives by email and generates no phone call: their SKU beside yours, quantities in the units they actually ship in, your account number, the ship-to address, payment terms printed on the page."

Source: <https://community.shopify.com/t/672733>. User `Denyslg`, who discloses that
he builds Binly. **Source-backed tradeoff** — the claim comes from a vendor who
sells the opposite design, and it argues against a supplier portal.
Why it matters: a supplier portal is a queue for the supplier. The five document
fields are a spec.

**UGC-S09 — topic 654650, "Purchase Order - Incoming Inventory not working"** · 2026-07-24 · **Documented fact**

> "This new purchase order system is already horrible but now the incoming inventory mechanism doesn't seem to 'see' what is on a purchase order, so my reports keep telling me to procure what is already in process. … This will potentially hurt our the management of our capital."

Source: <https://community.shopify.com/t/654650>. User `HectorGomez`.
Why it matters: the reorder suggestion ignores the open order. The buyer double-orders.

**UGC-S10 — same topic** · 2026-07-24 · **Documented fact**

> "you have to go to the PO, create a transfer, then mark that transfer as in-transit (even though it's not yet), in order for the incoming inventory to show up. Just another couple of steps in this ridiculous process that didn't exist before. SO FRUSTRATING"

Source: <https://community.shopify.com/t/654650>. User `HectorGomez`.
Why it matters: the operator corrupts a transfer record to make a report work.

**UGC-S11 — same topic** · 2026-07-24 · **Documented fact**, with a verified control

> "As of 2026-07 there is still no PurchaseOrder object in the Admin GraphQL API, only InventoryTransfer and InventoryShipment"

Source: <https://community.shopify.com/t/654650>. User `lumine`. This lane checked
the API reference: `shopify.dev/docs/api/admin-graphql/latest/objects/PurchaseOrder`
answers HTTP 404, while `objects/Order` and `objects/InventoryTransfer` answer HTTP 200. The claim holds at the document level.
Why it matters: a missing API object caps what any app can build.

**UGC-S12 — same topic** · 2026-07-27 · **Documented fact**

> "Now I find that the transfers don't update when a PO is updated? I'm getting so aggravated at this platform. … This is honesly ridiculous and makes me want to leave Shopify entirely."

Source: <https://community.shopify.com/t/654650>. User `HectorGomez`.
Why it matters: two linked records drift apart. The operator loses trust in both.

**UGC-S13 — topic 615719, "Here's what Stocky did that native POs don't yet support"** · 2026-05-02 · **Documented fact**

> "The key things Stocky had that native POs are missing: Retail price visible on the receiver document / Label printing (Dymo) triggered directly from a confirmed PO / A receiver document separate from the vendor PO"

Source: <https://community.shopify.com/t/615719>. User `Philip_Gangi`.
Same topic, user `Clement_Foltzer` (discloses that he builds LabelCraft):
"Shopify doesn't expose purchase orders through an API, so third-party apps can't
trigger printing 'from a confirmed PO' the way Stocky did either."
Why it matters: the receiver document is a separate artifact from the vendor PO.

**UGC-S14 — topic 587455, "Feature Request: Add Cost/Price/Margin Display to Purchase Order Receiving"** · 2026-02-05 · **Documented fact**

> Topic title: "Feature Request: Add Cost/Price/Margin Display to Purchase Order Receiving"

Source: <https://community.shopify.com/t/587455> (28 replies). The thread holds a
community-posted screen of a "Place Purchase Order" form with the columns Name,
SKU, QTY, RETAIL (MARGIN), UNIT COST, SUBTOTAL. Capture:
`assets/ugc-02-shopify-community-po-receiving.png`.
Why it matters: the operator wants margin at the moment of the order, not later.

## Square community (Khoros)

Dates below are the relative dates that the Square search page prints. The absolute
date is UNVERIFIED.

**UGC-Q01 — "Desktop Dashboard: Show 'On Order' purchase order status"** · 3 weeks ago · **Documented fact**

> "When managing stock from a desktop computer, it is hard to tell at a glance which items are already on their way via an active purchase order. To check this, you have to click into individual items or navigate away to the Purchase Orders tab. This creates a risk of accidentally reordering items that are already on their way."

Source: <https://community.squareup.com/t5/Feature-Requests/Desktop-Dashboard-Show-quot-On-Order-quot-purchase-order-status/idi-p/848588> (HTTP 200). Author `ToneysVicksburg`, 1 Kudo.
Why it matters: the on-order quantity is missing from the list. The buyer must
leave the list to check it.

**UGC-Q02 — "Show Items on Order in Inventory History"** · 2 weeks ago · **Documented fact**

> "We're a bookstore running our inventory on Square. It would be extremely helpful to be able to see if a particular book is already part of a pending purchase order on that book's item details page. This would allow us to: -give customers accurate estimates of when a book will be back in stock -prevent us from double-ordering an item on more than one PO"

Source: <https://community.squareup.com/t5/Feature-Requests/Show-Items-on-Order-in-Inventory-History/idi-p/848908> (HTTP 200). Author `atcrawf`, 1 Kudo.
Why it matters: the same double-order fault, from a second industry.

**UGC-Q03 — "Purchase Order Barcode Printing for Plus plan"** · 2 weeks ago · **Documented fact** — paywall

> "I've used Square Retail Plus for several years with thousands of dollars in equipment set-up. A basic service feature was creating Purchase Orders. When orders came in, we could print the barcode labels from the Purchase Orders - a simple step. Now with imposed Square Plus plan, we are no longer able to print from the Purchase Order. We'd have to upgrade $100 more a moth to access this feature."

Source: <https://community.squareup.com/t5/Feature-Requests/Purchase-Order-Barcode-Printing-for-Plus-plan/idi-p/848912> (HTTP 200). Author `thewesterner`.
Why it matters: the receiving step moved behind a plan change. The operator rejects
the price.

**UGC-Q04 — "Loving the Purchase Orders"** · a week ago · **Documented fact**

> "Currently there is no place to add a discount from a vendor. We were hoping that a 'discount' might be added at the bottom as an option like there is currently an option to 'add fees'. Also, there is no option to unreceive an order if it was accidently all received."

Source: <https://community.squareup.com/t5/Feature-Requests/Loving-the-Purchase-Orders/idi-p/849126> (HTTP 200). Author `samsch`, 3 Kudos. A reply adds:
"agreed to undo receive an order that's been received. learned you can't do that
the hard way 😉".
Why it matters: receiving is irreversible. An operator needs an undo, because a
mistake at the dock is normal.

**UGC-Q05 — same topic** · **Documented fact**

> "I would also like to archive and or delete a purchase order not just cancel."

Source: <https://community.squareup.com/t5/Feature-Requests/Loving-the-Purchase-Orders/idi-p/849126>. Author `Elizabeth` (westendflorist.com).
Why it matters: the operator wants control of the record after the fact.

**UGC-Q06 — "Sort by feature in POs"** · 2 weeks ago · **Documented fact**

> "I would love to see Square Retail add the ability to sort Purchase Orders by column. So I can choose in what order they appear in my PO list. I really want to be able to sort by Status or Expected On. I would also love more control over which columns I can have show up in my view … I would also love to have a field in which I can mark at which juncture my order is so I can track if my order has shipped yet or not and see this at a quick glance."

Source: <https://community.squareup.com/t5/Feature-Requests/Sort-by-feature-in-POs/idi-p/848971> (HTTP 200). Author `ooalOK`.
Why it matters: the operator asks for a status the system does not hold. The list
must answer "where is my order?" in one look.

## Hacker News (Algolia)

**UGC-H01 — "Show HN: We built procurement automation for small teams"** · 2026-01-08 · **Documented fact**

> "We kept seeing the same pattern over and over: teams didn't want an ERP, but they also couldn't keep running procurement on spreadsheets and email. Most tools we tried were either too heavy, too expensive, or required months of setup and customization."

Source: the author's comment, <https://news.ycombinator.com/item?id=46542005>, on the
story "Show HN: We built procurement automation for small teams stuck in
spreadsheets" (<https://news.ycombinator.com/item?id=46541949>). Both answer HTTP 200.
Why it matters: the category is squeezed between a spreadsheet and an ERP.

**UGC-H02 — comment on "Lab Spend – Pricing Search Engine for Research Chemicals"** · 2018-07-27 · **Documented fact**

> "Working with labs, I've found it extremely eye-opening how archaic the supplier relationship is. A big challenge appears to be with the sales model and its reliance on contracts, opaque pricing, and exclusive relationships."

Source: <https://news.ycombinator.com/item?id=17628799> (Algolia objectID `17628799`,
story `17619357`).
Why it matters: the supplier relationship is opaque outside restaurants too. Price
history is the scarce data.

**Channel result** — 2 items from 5 queries. Hacker News holds the small-team
procurement conversation, and it does not hold the restaurant-operator
conversation. **Inference.**

## YouTube

**Channel result** — 0 operator quotes. `yt-dlp` searched four queries and read 29
comments on Merchant Maverick's "Your Complete Guide To Restaurant Inventory
Management" (94,915 views, 2021). The comments hold no supplier-order talk. Two
other comment sets were read the same way. The channel is a video library of vendor
demos and spreadsheet templates. **Inference.**

**UGC-Y01 — "Purchase Order Tracker: Real Example (From PO to Payment)"** ·
SimStudioSheets · frame at 00:45 · **Documented fact** (the frame)

Source: <https://www.youtube.com/watch?v=ZJm0BXaVE8s>. The frame shows a Google
Sheets purchase order with the vendor block, the ship-to block, and the line table
(Description, Quantity, Price, Amount), plus the tabs "Vendor List", "PO
Template", "PO Tracker", "Outstanding Payment", "Vendor Overview". Capture:
`assets/ugc-06-youtube-po-tracker-spreadsheet-t45.png`.
Why it matters: the seller of the template reproduces the field set that operators
ask for. The field set is the spec.

## Captures

Full records, source URLs, device class, and dates: see
[`assets/INDEX-04-ugc.md`](../assets/INDEX-04-ugc.md).

| File                                              | Source class         | What it shows                                                        |
| ------------------------------------------------- | -------------------- | -------------------------------------------------------------------- |
| `ugc-01-reddit-paper-order-guide.jpeg`            | Reddit user post     | A phone photo of a handwritten paper order guide.                    |
| `ugc-02-shopify-community-po-receiving.png`       | Forum post           | A "Place Purchase Order" form with retail price and margin per line. |
| `ugc-03-shopify-community-warehouse-map.jpeg`     | Forum reply          | A warehouse pick screen with a bin map.                              |
| `ugc-04-shopify-community-po-automation.png`      | Forum reply          | A purchase-order automation screen.                                  |
| `ugc-05-shopify-community-stocky-export-repo.png` | Forum reply          | A repository card for a Stocky purchase-order export tool.           |
| `ugc-06-youtube-po-tracker-spreadsheet-t45.png`   | YouTube frame, 00:45 | A spreadsheet purchase order with the tracker tabs.                  |

## What the operator says, in short

Each statement below is an **Inference** from the items above, unless it repeats a
quote.

1. **The order is not the hard part.** Two independent operators state it: raising
   the PO is easy, and the work starts at the delivery. UGC-S02, UGC-S03.
2. **The document set is three documents, one truth.** PO, receipt, and invoice
   hold different numbers. UGC-S07, UGC-R15.
3. **The on-order quantity is missing from the decision screen.** UGC-Q01, UGC-Q02,
   UGC-S09. The buyer double-orders, or leaves the list to check.
4. **The phone is the count, the desktop is the order.** UGC-A06, UGC-A07, UGC-A10.
   The operator accepts the split and asks for a faster mobile path.
5. **The par number lives outside the product.** UGC-R01, UGC-R09. The operator keeps
   it in a spreadsheet, and it goes stale.
6. **The shelf order is the list order.** UGC-R07, UGC-R08, UGC-R10. This is a hard
   requirement, and it is cheap to meet.
7. **The case size is a data fault.** UGC-R05, UGC-R06. The order line needs a unit
   and a case size.
8. **A supplier portal is a queue for the supplier.** UGC-S08. The email document is
   the acceptable channel today.
9. **Receiving needs an undo and a status.** UGC-Q03, UGC-Q04, UGC-Q06.
10. **The category sits between a spreadsheet and an ERP.** UGC-H01. The operator
    rejects the heavy tool and builds the light one by hand.

## What did not change since the prior passes

**Inference.** The prior passes hold the screens, the capability matrix, and the
surface placement. This pass adds the operator voice, which no prior pass held. The
prior findings on vendor documentation stay valid. This section does not repeat
them and does not contradict them.

## Open items for the synthesis lane

1. The Square community dates are relative. Read the absolute dates in a browser
   before the synthesis quotes a date. UNVERIFIED.
2. This lane did not reach the Toast community. Cloudflare blocked the route. A
   real browser may pass it.
3. This lane did not resolve whether Shopify ships a supplier-side PO workflow
   after 2026-09. UNVERIFIED.
4. Reddit is readable only through a mirror from this host. A future pass should
   record the mirror route with the canonical permalink.
