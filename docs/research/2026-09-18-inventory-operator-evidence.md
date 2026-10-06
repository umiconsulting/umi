# Inventory work by what operators do, and where they expect the screen to live

- Date: 2026-09-18 (local, America/Mazatlan).
- Question: what do operators really do all day, and where do they expect the inventory
  screen to live?
- This file holds **operator evidence only**: reviews, complaints, forum posts, and
  vendor-run walkthroughs. The vendor surface map is in a sibling file. The design and
  RBAC literature is in a second sibling file. See "Related files" at the end.
- The question is not "which product is best". The question is "where does the task live,
  and who does it".

## How to read the labels

| Label                  | Meaning                                           |
| ---------------------- | ------------------------------------------------- |
| Documented fact        | The source states it. The URL is given.           |
| Source-backed tradeoff | Two sources disagree, or one source names a cost. |
| Inference              | I reason from the facts. The reasoning is shown.  |
| UNVERIFIED             | I could not confirm the claim.                    |

Every quotation below is verbatim. A quote keeps its original punctuation and spelling,
including the errors. The source URL follows each quote. The marker `...` inside a quote
is **my** omission, and the text on each side of it is verbatim.

## 1. The routes, and what each returned

The negative results are half the finding. A blocked source is not an absent product.

| Route                                               | Observed result                                                                                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple App Store customer-review RSS                 | **Works.** `https://itunes.apple.com/us/rss/customerreviews/id=<APPID>/sortBy=mostRecent/json`. HTTP 200 for every app.                                        |
| Apple per-review permalink                          | **Works.** The feed entry field `author.uri.label` is a real review URL. Verified: `https://itunes.apple.com/us/reviews/id943277914` answers HTTP 200.         |
| Apple JSON `page=1..5`                              | HTTP 200, up to 50 reviews per app per sort order.                                                                                                             |
| Google Play review text                             | **Works through the `google-play-scraper` package** (version 10.1.3). See section 3. The plain page HTML holds no review text.                                 |
| Google Play listing page                            | HTTP 200 but the review text is absent. Only the app description is present. The listing alone is not evidence.                                                |
| Reddit plain JSON (`/search.json`, `restrict_sr=1`) | **403** through `curl` and **403** through Obscura. The IP is blocked.                                                                                         |
| Reddit Atom feed (`/search.rss`, `restrict_sr=1`)   | **Works**, HTTP 200. Rate limit is tight: one call per 40-50 seconds. Two calls faster than that returned 429.                                                 |
| Reddit comment feed (`/comments/<id>/.rss`)         | **Works**, HTTP 200 with the same pacing.                                                                                                                      |
| Trustpilot through `curl`                           | **403**, 991 bytes, on `toasttab.com`, `squareup.com` and `loyverse.com`.                                                                                      |
| Trustpilot through Obscura                          | **Wall.** The page returns 175 KB of "we don't support your browser" plus a reCAPTCHA notice. `INV=0`, review nodes `0`. Trustpilot is blocked on both routes. |
| YouTube watch page and auto captions                | **Works** through `yt-dlp` 2026.08.19. See section 11.                                                                                                         |
| Zendesk help-centre public JSON API                 | **Works** where a help centre exists. 39 documents read from 11 vendors.                                                                                       |
| G2, Capterra, Software Advice, GetApp               | **403.** Blocked from this workstation. Two attempts, then stopped, as instructed.                                                                             |

**Inference:** the consumer review sites do not carry this category. Apple, Google Play,
Reddit and the vendor help centres carry it. That changes where future research should look.

## 2. The tools, with the version and the source

| Tool                  | Version                          | Use here                                                   | Why this tool                                                     |
| --------------------- | -------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `curl`                | 8.5.0                            | Apple RSS, Reddit Atom, Zendesk JSON                       | The endpoints answer without a browser.                           |
| `jq`                  | 1.7                              | Parse the Apple and Zendesk JSON                           | Installed.                                                        |
| Obscura over CDP      | Docker tag `h4ckf0r0day/obscura` | Reddit and Trustpilot second routes, Google Play page text | The playbook names it as the default for a walled page.           |
| `google-play-scraper` | 10.1.3                           | Google Play review text                                    | A proven package. It avoids a hand-rolled `batchexecute` payload. |
| `yt-dlp`              | 2026.08.19                       | YouTube captions                                           | It reads the caption track directly.                              |
| Python `xml`/`re`     | 3.12.3                           | Parse the Atom feeds and the VTT captions                  | The feed is XML.                                                  |

**Hand-rolled exception:** I wrote a 40-line CDP client for Obscura. The published
Obscura container rejects `Page.enable` on the `/json/list` target. The working shape is
`Target.createTarget`, then `Target.attachToTarget` with `flatten: true`, then a
session-scoped send. No published client does this, so the wrapper is the smallest fix.

**Hand-rolled exception 2:** `google-play-scraper` was the first choice, not a wrapper.
The `batchexecute` route was not needed.

## 3. The corpus

| Source              | Items read                                       | Distinct items quoted here |
| ------------------- | ------------------------------------------------ | -------------------------- |
| Apple App Store     | 3,477 reviews across 37 apps                     | 28 reviews                 |
| Google Play         | 3,683 reviews across 18 apps                     | 20 reviews                 |
| Reddit              | 8 search feeds, 6 comment feeds, 25 entries each | 7 posts or comments        |
| YouTube captions    | 8 transcripts (2 videos were unavailable)        | 5 walkthroughs             |
| Vendor help centres | 39 documents across 11 vendors                   | 23 documents               |

## 4. Theme A: the operator does not do inventory at the till

This is the strongest pattern in the whole corpus. Operators name the device, and the
device is not the till.

**Documented fact, Reddit r/KitchenConfidential, 2023-02-01.**
https://www.reddit.com/r/KitchenConfidential/comments/10r830o/am_i_crazy_for_thinking_that_switching_to_doing_a/

```
Our company is switching to a new inventory software that has the ability to enter inventory into an iPad as you count instead of writing it down then entering it into a computer. The higher ups think that because of this, inventory is going to be sooooo much easier and take waaaaaaaay less time, so we should do it every week. As the GM it takes me 30 minutes or so to manually enter in inventory off of the count sheets. It still takes around 6 hours to count the entire building, and that won't change.
```

**Inference:** the operator separates two jobs. Job one is walking the building and
counting. Job two is typing the numbers in. The iPad changes job two only. The six hours
of job one stay. A back-office design that shortens typing but not walking does not
shorten the task.

**Documented fact, Apple App Store, Clover Go - Dashboard & POS, 1 star, 2020-04-22.**
https://itunes.apple.com/us/reviews/id943277914

```
I only moved to clover to be able to manage everything from my phone, and now I’m being told I have to do everything from my laptop, who carries their laptop around all day! Seriously fix this ASAP, or give me the option to go back to the previous version.
```

**Documented fact, Apple App Store, Clover Go - Dashboard & POS, 1 star, 2024-10-03.**
https://itunes.apple.com/us/reviews/id26965314

```
I use the items list via mobile when I am purchasing at various warehouses, to check inventory levels before purchasing. New changes have nested the data in yet one more window, making the display area even narrower. Impossible to use for item name and qty on hand to be visible as 40% of your screen is now window borders, even when using filtered columns. ... Do it the new way 100 times and 100 clicks becomes 300 clicks. Devs have added more complexity and less usability. Attention Devs: this is a mobile app. Try testing it on MOBILE.
```

**Source-backed tradeoff:** this operator uses a phone _away from the store_, at a
wholesaler. That is a buying decision, not a counting decision. The same screen serves
both jobs badly.

**Documented fact, Apple App Store, MarketMan, 1 star, 2021-11-27.**
https://itunes.apple.com/us/reviews/id328073044

```
Don’t use this app if you’re in a rush. Just for the app to open it takes an eternity. And DO NOT USE THIS FOR INVENTORY. ... Unless you remember to save your counts every five minutes in the app, your best bet would be walking around with a computer and using the actual website. This app is garbage.
```

**Documented fact, Apple App Store, MarketMan, 5 stars, 2023-10-20.**
https://itunes.apple.com/us/reviews/id1284231557

```
The app is an extension of an incredible online software. The app is almost marketman light which allows us at the restaurant to handle simple task like taking inventory, scanning and ordering. The software itself on the laptop does all the heavy lifting.
```

**Source-backed tradeoff:** the same product holds a one-star "the app is garbage" and a
five-star "the app is almost marketman light". Both reviewers accept the same split. The
app is thin. The laptop is the real system.

**Documented fact, Apple App Store, Craftable Inventory, 1 star, 2025-04-05.**
https://itunes.apple.com/us/reviews/id335421763

```
Be warned, the syncing of inventory on Craftable is awful. Save yourself the headache of recounting and variance headaches, just enter inventory directly into Craftable via a laptop.
```

**Documented fact, Apple App Store, xtraCHEF, 1 star, 2023-10-16.**
https://itunes.apple.com/us/reviews/id769746248

```
Always always always closes when finishing an inventory and you lose all info you just spent hours counting. The app is absolute garbage. Only use on computer as it won’t crash.
```

**Documented fact, Apple App Store, inFlow Inventory, 3 stars, 2026-04-30.**
https://itunes.apple.com/us/reviews/id146125473

```
This new update is unusable. I should not need to create a sub location when it was never needed before. My barcode scanner also does not work. The system worked just fine before this change. I now have to use the desktop website to do my inventory
```

**Documented fact, Apple App Store, Square Retail POS, 5 stars, 2021-08-30.**
https://itunes.apple.com/us/reviews/id1276085750

```
When you create new item it doesn’t have the option to add vendors. I have to use my back office computer to add vendors to each item. And I can’t create purchase order.
```

**Documented fact, Apple App Store, Square Dashboard, 1 star, 2023-05-14.**
https://itunes.apple.com/us/reviews/id237084618

```
This is so dumb, why would you remove the ability for users to see data on the go?? Now our entire team has to stop and jump on a laptop to see breakdowns and gather data. This is not ideal for folks who are using their phone as their primary way of viewing sales data.
```

**Documented fact, Apple App Store, Fishbowl Advanced, 2 stars, 2026-07-30.**
https://itunes.apple.com/us/reviews/id41981304

```
The app is not user friendly. There are so many things that I need to be able to do as a warehouse manager from the mobile app that I have to go back to my desktop for.
```

**Documented fact, Apple App Store, Fishbowl Advanced, 1 star, 2021-12-26.**
https://itunes.apple.com/us/reviews/id884863262

```
No error is easily fixed or remedied from the app and must be done on the desktop
```

## 5. Theme B: the tablet is the counting device, and the phone is the second choice

Operators count on a tablet or an iPad. They accept a phone when the phone shows the
right picture and hides nothing. They reject the phone when a feature disappears.

**Documented fact, Apple App Store, WISK.ai: Bar & Food Inventory, 5 stars, 2021-04-13.**
https://itunes.apple.com/us/reviews/id154365820

```
Since I started using WISK, my team is taking inventory 5x faster and they can work at the same time. Plus not only does my team now take inventory from all of our shelves without any internet issues, even from the freezer - wisk also has an ordering feature that makes my life simple!
```

**Inference:** "even from the freezer" is the real requirement. The counting device must
work with no signal, in a cold room, away from a desk. A back-office screen cannot pass
this test.

**Documented fact, Apple App Store, Partender - Bar Inventory, 5 stars, 2025-08-06.**
https://itunes.apple.com/us/reviews/id175088981

```
Now, what used to take hours or even days can be done in under 30 minutes. I can walk through the bar, use the app to visually record each bottle, and instantly generate reports that show exactly what we have and what we need. ... Everyone—from barbacks to managers—feels more empowered and accountable.
```

**Documented fact, Reddit r/KitchenConfidential, comment by `/u/tongmaster`, on the thread
of 2023-02-01.**
https://www.reddit.com/r/KitchenConfidential/comments/10r830o/am_i_crazy_for_thinking_that_switching_to_doing_a/j6yxgax/

```
I will say that at that job when we switched to doing inventory on our phones, it definitely made me faster because I could do it throughout the shift when I had free ten minutes instead of doing it all after close.
```

**Inference, and this is the sharpest design point in the corpus.** The gain is not speed
per screen. The gain is that a phone-sized task fits into a free ten minutes. A count
that needs a desk must be scheduled. A count that fits in a pocket does not.

**Documented fact, Apple App Store, MarketMan, 5 stars, 2022-02-08.**
https://itunes.apple.com/us/reviews/id585763799

```
Super easy to do inventory counts on my phone
```

**Documented fact, Apple App Store, Loyverse POS, 5 stars, 2017-06-14.**
https://itunes.apple.com/us/reviews/id108387051

```
Simple tool to add inventory and make sales with your tablet or phone. Then keep track of sales in your laptop/phone in the back office.
```

**Documented fact, Google Play, Loyverse POS, 5 stars, 2025-08-23 (Spanish, verbatim).**
https://play.google.com/store/apps/details?id=com.loyverse.sale&reviewId=c436cde1-b776-4686-8a32-c4736a658e69

```
una aplicacion muy facil de usar, esta muy completa, la uso en telefono, tablet y pc
```

**Source-backed tradeoff:** this operator uses all three devices. The evidence does not
support one device. It supports one task model that each device can enter.

**Documented fact, Google Play, Loyverse Dashboard, 1 star, 2018-03-24.**
https://play.google.com/store/apps/details?id=com.loyverse.dashboard&reviewId=5465c113-d40e-4ac3-a95c-b1fa5c34fc7c

```
Cant even login, always shown no connection. I can only online via browser to view back office. Andriod phone isnt really being supported.. My ipad works fine, but the data from pos app and the back office isnt sync simultaneously.
```

**Documented fact, Google Play, Sortly, 1 star, 2020-05-01.**
https://play.google.com/store/apps/details?id=com.sortly.mythings&reviewId=559821e6-dc26-407e-a8dd-b8878eb63da3

```
I also downloaded it into my tablet as I would want to use it there more and when running it the application clearly looks like a phone app running on a tablet. The text and buttons don't show correctly in some cases part of the screen are hidden with no scrollbar.
```

**Inference:** the operator does not ask for a separate tablet product. The operator asks
that the same screen use the space. This is a layout requirement, not a second app.

**Documented fact, Google Play, Square Dashboard, 1 star, 2025-11-09.**
https://play.google.com/store/apps/details?id=com.squareup.dashboard&reviewId=bee8c9ac-6239-4d2e-84be-44e803107c33

```
This is very limited compared to the browser. i thought it would be nice to be able to update/add items quickly from my phone while I unpack new stock. nope. It's basically just reports.
```

**Inference:** "while I unpack new stock" is a receiving task, done standing at a
delivery. The operator expects the phone to accept a stock change at that moment.

## 6. Theme C: screen complaints, and what they are really about

**Documented fact, Apple App Store, Square Retail POS, 1 star, 2024-05-12.**
https://itunes.apple.com/us/reviews/id662922064

```
Inventory is super hard to count because Square does not allow you to select more than 250 items at a time. I have more than 5000 items. How can one count the inventory and keep track selecting 250 at a time?
```

**Documented fact, Apple App Store, Square Retail POS, 3 stars, 2024-02-22.**
https://itunes.apple.com/us/reviews/id446994566

```
There’s a huge issue with the items tab that makes taking inventory a headache and a half. Whenever you exit an item page it snaps back to the top of the screen, forcing you to scroll down to your position after correcting each individual item.
```

**Documented fact, Google Play, MarketMan, 2 stars, 2025-09-08.**
https://play.google.com/store/apps/details?id=com.app.marketman&reviewId=a2d309ec-d4ed-44bf-8d2d-59824f5401fb

```
don't dare accidentally hit the back button on your phone while doing inventory, or, without a warning, it just deletes your entire count.
```

**Documented fact, Apple App Store, MarketMan, 1 star, 2024-04-02.**
https://itunes.apple.com/us/reviews/id1641918858

```
If you’d like to spend hours counting your inventory only for it to be deleted, or revert back to old data that you have fixed repeatedly, or glitch as you scroll/search through product, download this dumpster fire now!!
```

**Documented fact, Apple App Store, MarginEdge, 1 star, 2022-10-03.**
https://itunes.apple.com/us/reviews/id32831842

```
Hope you're not trying to get a lot done. Everytime you save is a good 30 second wait even if you're standing next to the wifi hub. Also there are no scroll bars, so when you search it'll look like th
```

**Documented fact, Apple App Store, Square Retail POS, 1 star, 2026-01-20.**
https://itunes.apple.com/us/reviews/id1448547927

```
No items came out of inventory until 36 hours later. No way of knowing what was in stock or wasn’t.
```

**Source-backed tradeoff:** the loudest complaints are not about missing features. They
are about **lost work**. A count that deletes, a screen that jumps to the top, a save
that takes 30 seconds. The operator counted a real shelf for an hour. The app must not
throw that away.

**Inference:** for a counting screen, "save and resume" is not a convenience. It is the
feature that makes the screen trustworthy.

**Documented fact, Apple App Store, Toast Now, 1 star, 2024-06-05.**
https://itunes.apple.com/us/reviews/id275407636

```
Considering how expensive toast is, I expected the app to function at least as well as an app like Square. But it does not at all. You cannot update inventory, which seems like it would be a pretty basic function. sales data lags terribly.
```

**Documented fact, Google Play, Clover Go, 3 stars, 2026-02-09.**
https://play.google.com/store/apps/details?id=clover.companion.app&reviewId=7e679ad6-8a61-42bd-8fd0-273ef1a0f18e

```
It has been quite convenient having Clover as an app that I can access the dashboard but not sure if there was an update recently but the item list section is totally broken, I'm unable to access or adjust inventory or pricing as the app crashed saying "microapp failed to mount" -- very disappointing as I'm trying to update inventory and am unable to do so on my phone. Please fix!
```

**Documented fact, Google Play, Clover Go, 2 stars, 2024-06-13.**
https://play.google.com/store/apps/details?id=clover.companion.app&reviewId=be42de6c-b8a8-4296-ba28-7514ef7577e3

```
I use clover across 3 different devices, and being unable to pick the orientation is extremely frustrating. These companies don't take into account other use cases, just what they want you to use it for. For example, I use this app in a tablet walking around, why cant I force it into portrait mode, which is way easier to handle.
```

**Documented fact, Google Play, Clover Go, 1 star, 2025-01-24.**
https://play.google.com/store/apps/details?id=clover.companion.app&reviewId=3159d9ac-46ec-4407-adaa-ba4208cd2380

```
Very common tablet and can't install on it
```

**Documented fact, Google Play, Clover Go, 1 star, 2025-07-31.**
https://play.google.com/store/apps/details?id=clover.companion.app&reviewId=25742252-ba30-4717-aeec-73e5d54e469d

```
whatever redesign that was just done destroyed usability on phones. Now you need about 10 screens to see what used to be visible on 1. UI is cumbersome and huge on phones. whoever decided to match the iPad app design made a huge mistake.
```

**Source-backed tradeoff:** one Clover operator says the phone edition is too small. The
other says the iPad design broke the phone. Both are the same complaint. One layout does
not serve two sizes.

**Documented fact, Google Play, Zoho Inventory, 2 stars, 2024-05-16.**
https://play.google.com/store/apps/details?id=com.zoho.inventory&reviewId=ae829773-071a-4d0e-a420-fdf656230d6c

```
pricelists needs to be activated in zoho Books and zoho Inventory on Mobile apps. currently, other pricelists can't be seen or prices edited through phone. a major lapse this currently.
```

**Documented fact, Google Play, MarketMan, 1 star, 2020-03-14.**
https://play.google.com/store/apps/details?id=com.app.marketman&reviewId=1ce25724-e237-48be-a6a3-3bb1cc63b903

```
So many flaws with the system. Cannot handle delivery notes or proper scanning. Neither can it handle a tablet. Only designed for portrait phone.
```

**Documented fact, Google Play, Sortly, 2 stars, 2021-09-05.**
https://play.google.com/store/apps/details?id=com.sortly.mythings&reviewId=86b4adc8-4052-4263-a394-9036c56a0e14

```
What isn't questionable is Sortly's terrible search algorithm and space-wasting UI. Search gave me different results depending on whether I used the iphone or laptop I was provided with.
```

**Documented fact, Google Play, Shopify POS, 3 stars, 2024-10-24.**
https://play.google.com/store/apps/details?id=com.shopify.pos&reviewId=b0f863cf-76b7-4bb5-b7f7-3698b8ac0f0b

```
I wish you would allow and optimize it. To be used with chrome book/PC as a programmer myself its not that hard to set up. I use it on my chrome book but everytime it has a update I have to go through the program of the computer to trick it to thinking its a tablet. I understand you made it for IOS and Android but a PC is much nicer for certain stuff.
```

**Documented fact, Google Play, SpotOn Restaurant Reports, 3 stars, 2022-02-27.**
https://play.google.com/store/apps/details?id=com.emaginepos.reports&reviewId=46513ac3-edb5-4d81-a614-3686cbd7e438

```
App doesn't allow you to save pdf files ... Better off using the web portal unless you're just checking in on numbers.
```

**Documented fact, Google Play, Loyverse Dashboard, 3 stars, 2022-03-08.**
https://play.google.com/store/apps/details?id=com.loyverse.dashboard&reviewId=95021180-cde8-44d6-be89-285cc02bed61

```
It says this App is not optimised for my device and i cant access thr back office from POS. The screen is blank
```

## 7. Theme D: who may change stock

This is the sharpest split in the corpus. The evidence shows two different models in
live use.

**Model 1: the count is a management job.**

**Documented fact, Apple App Store, Partender, 5 stars, 2024-11-01.**
https://itunes.apple.com/us/reviews/id637592748

```
At other bars I’ve worked out inventory was solely done by management. Learning to use Partender makes it easier for everyone, also builds a great bar team where everyone is on the same page.
```

**Model 2: the count is a shift job, and every station does it.**

**Documented fact, Apple App Store, Partender, 5 stars, 2024-08-15.**
https://itunes.apple.com/us/reviews/id924396987

```
All bartenders have to do inventory at their stations each night and this app help A ton!
```

**Documented fact, Google Play, Partender, 5 stars, 2024-03-21.**
https://play.google.com/store/apps/details?id=com.partender.android&reviewId=dc33f861-1c80-452b-b391-a35d44a1444c

```
I'm a bartender at Amex Centurion Lounge and this app has been a life saver. We can see exactly what was poured out so we don't run out of stock or over order. ... Must have for bartenders who want to best serve their guests and make more tips
```

**Source-backed tradeoff, and it matters for our design.** The same product serves both
models. The vendor does not force one rule. The operator sets the rule. The screen
supports a non-manager counter and a manager counter.

**Documented fact, Apple App Store, Shopify Point of Sale, 4 stars, 2025-12-01.**
https://itunes.apple.com/us/reviews/id849026995

```
Everything’s pretty great except I want staff to have access to inventory but not all the reports
```

**Inference:** this is the cleanest statement of the real requirement in the whole corpus.
The operator does not want "staff access" and does not want "no staff access". The
operator wants **inventory without reports**. That is a split of one permission group into
two, not a role.

**Documented fact, Apple App Store, inFlow Inventory, 5 stars, 2023-06-01.**
https://itunes.apple.com/us/reviews/id123607455

```
User permissions for warehouse operations. It helps me locate my inventory fast and accurate. Straight forward and easy to delegate to nontechnical staff
```

**Documented fact, Apple App Store, Zoho Inventory, 1 star, 2022-04-18.**
https://itunes.apple.com/us/reviews/id509127287

```
Because a former employee linked their account with another Zoho app, I can’t delete them. Unacceptable!
```

**Documented fact, Google Play, Shopify POS, 3 stars, 2024-11-30.**
https://play.google.com/store/apps/details?id=com.shopify.pos&reviewId=6daaa1bc-aad5-42e0-bb4e-f4659045da24

```
Always giving our staff issues where they can't access the store even though they have full permissions.
```

**Documented fact, Google Play, Square Dashboard, 3 stars, 2025-01-24.**
https://play.google.com/store/apps/details?id=com.squareup.dashboard&reviewId=91442157-8c84-4067-8899-9702b9ad2752

```
New version has removed my permissions for seeing sales reports despite me having full access online.
```

**Source-backed tradeoff:** both reviews describe the same failure. The permission model
of the mobile app and the permission model of the web product disagree. The operator must
learn two rules for one job.

**Documented fact, Apple App Store, Partender, 5 stars, 2024-11-01 (same review as above).**
https://itunes.apple.com/us/reviews/id637592748

```
All bartenders have to do inventory at their stations each night and this app help A ton!
```

## 8. Theme E: cost and margin in front of staff

**Documented fact, Apple App Store, Shopify Point of Sale, 1 star, 2022-08-10.**
https://itunes.apple.com/us/reviews/id135905312

```
Your employees will see all your sales reports all the way back to when you started using the app. They will see the costs as well as sales of other associates.
```

**Documented fact, Google Play, Clover Go, 1 star, 2024-09-10.**
https://play.google.com/store/apps/details?id=clover.companion.app&reviewId=ea5a46a8-c41e-4320-aa71-7793798ab23e

```
What a POS system that does not show a margin % of the product. Any POS system I've used before automatically showed margin % after entering item's cost and price. No inventory valuation report found. Clover Go Dashboard & POS mobile app is useless.
```

**Source-backed tradeoff, and it is a real tension.** One operator is angry that cost is
**hidden** from a manager. One operator is angry that cost is **shown** to staff. Both are
correct for their business. The product cannot pick one answer. The owner must set the
answer, and the screen must honour it.

**Inference:** a single global "hide cost" flag is not enough. The evidence needs at
minimum three states: hide cost at the till, show cost to a manager, and show cost while
counting.

**UNVERIFIED:** I could not measure how common this complaint is. The corpus holds two
opposite statements, not a rate. I read 3,683 Google Play reviews and 3,477 App Store
reviews. Only these two name cost visibility directly. The theme may be rare on these
venues, or operators may raise it in a training setting instead of a review.

## 9. Theme F: the losing workaround, and what it proves

When the app fails, the operator returns to a spreadsheet. This is the strongest
possible signal that the product does not hold the task.

**Documented fact, Reddit r/BarOwners, comment by `/u/jackatman`, thread of 2021-08-16.**
https://www.reddit.com/r/BarOwners/comments/p5p30t/worthwhile_inventory_apps/h9bzhtl/

```
I'm currently using bevager (mandated) and it is such a ridiculous hassle to sync it with the POS for depletions on one side and the ordering and invoicing on the other that it's just not worth it. When the pour cost numbers are off I end up rooting around in it's dumb byzantine slow web-based system for hours just to find out the problem is some invoice didn't get 'marked as received' and not over pouring or a bartender nicking a bottle. With a simple excel spreadsheet I can go through a months of orders by texts, my copies of the invoices, and the pmix and find the culprit in 30.
```

**Documented fact, Reddit r/BarOwners, comment by `/u/pournographer`, same thread.**
https://www.reddit.com/r/BarOwners/comments/p5p30t/worthwhile_inventory_apps/h99yt8a/

```
Just hit 3 years with my bar. Excel is the way. I have 4 columns. 1) the booze (alphabetically by type) 2) whole bottles 3) tenths 4) par. I go through the liquor room and write down how many full bottles. Then i go out to the bar and estimate the open bottles to the nearest 10th. Then i go down the list and if the amount I have is less than the par, i order more. I have approx 80 bottles - takes about 15 minutes.
```

**Documented fact, Reddit r/restaurateur, post by `/u/Bartman-75`, 2023-04-11.**
https://www.reddit.com/r/restaurateur/comments/12j1j8e/inventory_program/

```
I've got 4 restaurants that have similar but not identical products in inventory. Currently I'm keeping an inventory template (google sheets) loaded onto tablets in each location. Each month I edit the document to update key item pricing but it's up to my managers to add inventory that isn't on our master list.
```

**Source-backed tradeoff:** a bar owner counts 80 bottles in 15 minutes with four columns
of paper and a spreadsheet. A 5,000-item retail store cannot do that. The spreadsheet wins
at small scale and loses at large scale. Our product must beat the spreadsheet at the
scale where the spreadsheet breaks.

**Documented fact, Reddit r/smallbusiness, comment by `/u/Fit-Glass-1924`, 2026-03-03.**
https://www.reddit.com/r/smallbusiness/comments/1rjsjh8/how_do_you_handle_physical_inventory_counts_in/o8fg55n/

```
Honestly, most of the "simple" barcode scanning apps I've tried ended up being more trouble than they're worth. They either crash constantly, or the data export is a nightmare. What I've found works reasonably well, assuming you don't need too much sophistication, is just using Google Sheets with the built-in barcode scanner. ... You can use your phone's camera or get a cheap Bluetooth scanner.
```

**Documented fact, Reddit r/smallbusiness, comment by `/u/neilpotter`, same thread.**
https://www.reddit.com/r/smallbusiness/comments/1rjsjh8/how_do_you_handle_physical_inventory_counts_in/o8iaw4h/

```
You can do a lot with a barcode scanner and spreadsheet. Scanners are much easier and quicker to use than phones for scanning.
```

**Documented fact, Google Play, Square Dashboard, 1 star, 2023-09-05.**
https://play.google.com/store/apps/details?id=com.squareup.dashboard&reviewId=7aefd52d-1ffd-4929-bfc5-f15cac90a7d4

```
App has limited information available and is a waste of time when I can just log in via mobile browser.
```

**Documented fact, Apple App Store, Zoho Inventory, 3 stars, 2020-10-05.**
https://itunes.apple.com/us/reviews/id161935750

```
The app works, but the online browser works much better. ... I have an iPad and its easier to just go on safari to the website. I can do way more there than on the app. That doesn’t make sense.
```

**Inference:** "that doesn't make sense" is the correct verdict from the operator. The
app must not be the weaker copy of the web page. The app must be the better tool for the
one job that is done standing up.

## 10. What the vendors say in their own documents

These statements come from the vendor help centres. They show where the vendor puts the
surface, and who the vendor permits to use it. The full vendor map is in the sibling file
`2026-09-18-inventory-ui-ux-surfaces.md`.

### The device and the surface

**Square.** Documented fact,
https://squareup.com/help/us/en/article/8249-conduct-full-inventory-counts-with-square-for-retail

```
Full and cycle counting are available on iOS and Android devices, including Square Register, Square Terminal, and Square Handheld.
```

**Loyverse.** Documented fact, https://help.loyverse.com/help/advanced-inventory-management

```
Advanced Inventory Management is a set of additional Back Office features that helps you track stock levels more efficiently, monitor inventory changes, and calculate business profitability with greater accuracy.
```

**Loyverse.** Documented fact, https://help.loyverse.com/help/displaying-stock-and-cost-items-pos

```
This way, sellers can quickly check available stock and update it directly in the POS, ensuring accurate inventory management even without accessing the Back Office.
```

**MarginEdge.** Documented fact,
https://help.marginedge.com/hc/en-us/articles/6766940782355-Mobile-Inventory-on-your-Phone

```
You can now take an inventory count from your mobile device! This should make it a lot easier to walk around your restaurant to do counts quickly in the palm of your hand.
```

```
We'll note that the inventory tool on the mobile app does not have every capability that you're used to on the web app.
```

```
Can I make changes to a Count Sheet or reopen it from the mobile app? No. All edits will have to go through the web app.
```

**Source-backed tradeoff:** MarginEdge ships the walking-around count on the phone and
keeps the setup on the web. That is a deliberate split, and the vendor states it. This is
the clearest published split in the corpus.

**MarginEdge.** Documented fact,
https://help.marginedge.com/hc/en-us/articles/218822407-Getting-Started-with-Inventory

```
enter counts in [me] from your computer, phone or tablet as you take inventory in the restaurant
```

**Lightspeed X-Series (Retail).** Documented fact,
https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534036376091-Full-inventory-counts

```
If the device you're using to perform the inventory count (computer or iPad) has a barcode scanner set up, you can scan the items into the inventory count to record them.
```

**Lightspeed K-Series.** Documented fact,
https://k-series-support.lightspeedhq.com/hc/en-us/articles/4407510354715-Performing-stock-counts

```
Log in to the Inventory module with your Lightspeed credentials.
```

```
Multiple employees can count together by each resuming the same stock count from different devices.
```

**Inference:** "multiple employees count together from different devices" is the strongest
published requirement for a count that resumes on more than one screen. This matches the
Reddit complaint about a lost count. Resume is the shared primitive.

**Wisk.** Documented fact,
https://help.wisk.ai/en/articles/6473414-starting-a-new-inventory-count

```
To start a new inventory count: Tap "Inventories" along the bottom menu bar Tap "Start Inventory"
```

**Clover.** Documented fact, https://www.clover.com/help/create-track-items-with-inventory-management

```
Can I manage inventory from a Clover device? Yes. You can add and update items directly from the Inventory app on your Clover device.
```

**Toast.** Documented fact,
https://support.toasttab.com/en/article/Setting-the-Stock-Status-and-Count-for-Menu-Items

```
In Toast Web, navigate to the menu builder by selecting Menus > Menu management > Menu builder, or by selecting Menu builder from the Quick actions section of your Toast Web homepage.
```

```
You can also update inventory on your POS using Quick Edit mode or the Toast Now app.
```

**Shopify.** Documented fact,
https://help.shopify.com/en/manual/sell-in-person/shopify-pos/inventory-management

```
You can create products in your Shopify admin and then use your Shopify admin or Shopify POS to track, adjust, count, receive, and manage inventory based on the workflow. Some workflows, such as creating inventory transfers, require the Shopify admin.
```

**Apicbase.** Documented fact, https://support.apicbase.com/help/counting-your-inventory

```
Never do a stock count when your POS is active and generating sales tickets, your stock will not be updated at night!
```

**Inference:** Apicbase tells the operator to close the till before a count. That is the
strongest vendor statement that a count is not a till activity.

**MarketMan (Meal Ticket).** Documented fact,
https://mealticket.my.site.com/helpcenter/s/article/65d629c70f31e

```
Go to "Inventory Actions"  >  "Inventory Counts"
```

### Who may change stock, in the vendor's words

**Toast.** Documented fact, https://support.toasttab.com/en/article/Access-Permissions-Reference

```
2 Inventory & Quantity Allows the employee to edit inventory counts and quantity limits for menu items from the POS.
```

**Shopify.** Documented fact,
https://help.shopify.com/en/manual/sell-in-person/shopify-pos/inventory-management/changing-inventory-quantities-pos

```
To adjust inventory quantities with the Quick count POS UI extension, the user who logged in to Shopify POS needs the Manage inventory (excluding transfers) permission. This permission applies to the logged-in user, not to the staff member who enters a PIN to perform the count.
```

**Caution:** the permission follows the app session, not the person at the counter. A
shared till gives the counter person the manager's permission.

**Square.** Documented fact, https://squareup.com/help/us/en/article/6110-manage-inventory-with-the-retail-pos-app

```
Account owners or team members with item and inventory permissions to update item availability, modifier availability, and stock counts on your point of sale. Set permissions in Square Dashboard.
```

**Loyverse.** Documented fact, https://help.loyverse.com/help/how-manage-access-rights-employees

```
The owner can give employees different access rights to the POS app ( Play Market or App Store ) and the Back Office.
```

```
By default, there are four preset roles: Owner, Administrator, Manager, and Cashier.
```

**MarginEdge.** Documented fact, https://help.marginedge.com/hc/en-us/articles/115006784907

```
User: A "User" can upload invoices, place orders, enter inventory counts, and view most operational information in [me]. They cannot add, edit or remove products or recipes, nor can "users" setup, close or delete inventories. This role is typically used by in-store non-managerial staff.
```

```
Manager: A "Manager" in [me] has all the privileges of a "User" plus they can add or edit count sheets, close, re-open, and configure inventory, and add other "Users" or "Managers".
```

**Inference, and it is the answer to the "who may change stock" question.** MarginEdge
splits the action, not the person. A non-manager may **enter** a count. A manager may
**open or close** a count. That single split lets a bartender count a station and stops
the bartender from voiding the count.

**Wisk.** Documented fact, https://help.wisk.ai/en/articles/11889650-hiding-inventory-values

```
All of the standard roles (Admin, Manager, Employee) by default are able to see the costs of items when taking inventory.
```

```
if you want to limit which users can see this information, you can create a custom role and disable the "Show item costs / inventory values" permission
```

**Lightspeed X-Series.** Documented fact,
https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534171377819-Setting-user-roles-and-permissions

```
The Show product costs permission allows Cashiers or Managers to view and calculate product costs and markups on the Sell screen, in the product catalog, in reports, and on the Stock control page (Inventory > Stock control). This is enabled by default for Managers.
```

**Lightspeed X-Series.** Documented fact,
https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534265760027

```
By default, Cashier and Manager user roles cannot edit a products inventory levels on the Edit Product page or via a CSV/XLSX import. Inventory management on the Edit Product page and via a CSV/XLSX import is only available to Admin user roles by default.
```

**Documented fact, price gate.** Loyverse, https://loyverse.com/pricing

```
Advanced inventory Manage purchase orders, stock transfers and gain deeper inventory insights. $25 USD/month per store $250 USD/year per store
```

**Documented fact, price gate.** Square, https://squareup.com/us/en/pricing

```
Square Restaurant Inventory by MarketMan ... — $99/mo. per location
```

**Documented fact, price gate.** Clover, https://www.clover.com/help/create-track-items-with-inventory-management

```
Inventory management is included with some of the Clover service plans at no additional charge.
```

**Source-backed tradeoff:** the vendors disagree on the money model. Toast, Square and
Loyverse charge for depth. Clover bundles some of it. The operator evidence shows the
same split. The small bar uses a free sheet. The 5,000-item shop pays.

## 11. What the official walkthroughs show on screen

The transcript proves the device, because the presenter says the device name while the
screen shows the count.

**Square, "How To Count Inventory | Square for Retail Tutorial", channel `Square`,
https://www.youtube.com/watch?v=FD85GU9i2bA.**

At `00:00:48`:

```
use the square retail POS app paired with a barcode scanner or simply use the camera on your iPhone or iPad
```

At `00:00:56`:

```
tap inventory to start your cycle count
```

At `00:02:20`:

```
Full Count then take out your iPhone or iPad camera or your barcode scanner to scan or search for the item you want to count then add the quantity if you'd like to save partial progress to come back later
```

**Documented fact:** Square's own walkthrough counts inside the POS app, on a phone or an
iPad, and it names partial save. Square answers the resume problem inside the POS app.

**Toast, "Get Started with xtraCHEF - Inventory", channel `Toast, Inc.`,
https://www.youtube.com/watch?v=r_d4Lndbdqc.**

At `00:00:43`:

```
Begin by logging in and selecting inventory through our navigation menu
```

At `00:01:48`:

```
then assign users and roles this grants access to specific users in your account to complete these inventory accounts here you can choose a specific employee or indicate that anyone with restaurant manager access in your actual Chef account can complete this account
```

At `00:04:24`:

```
to complete an inventory count select the expand button then select add and start then go item by item and indicate how much of each you have on hand
```

**Documented fact:** the Toast walkthrough shows a **desktop web page**. It never shows
the Toast POS or a phone. The inventory product is xtraCHEF, reached from a browser.

**Source-backed tradeoff:** Square counts in the POS app. Toast counts in a separate web
product. Two large vendors pick opposite answers to the same question.

**Loyverse, "How to Work with Inventory Count in Loyverse", channel `Loyverse Point of Sale
System`, https://www.youtube.com/watch?v=0HBt0FKRENA.**

At `00:02:49`:

```
with a barcode scanner by scanning the
```

At `00:02:57`:

```
useful when you count the items by blocks for example if there are 10 pieces in one block you can scan the barcode 10 times or enter the number 10 in the quantity field
```

**Documented fact:** the walkthrough shows a barcode scanner and a block count. It does
not name a tablet or a phone. **UNVERIFIED:** the Loyverse video does not state the
device.

**MarginEdge, "Taking Inventory Series with MarginEdge: Getting Started VIDEO 1", channel
`MarginEdge`, https://www.youtube.com/watch?v=cNrMYCn_pIY.**

At `00:00:04`:

```
on the main menu on the left you'll see an inventory section with three different options
```

At `00:00:19`:

```
count sheets is where you'll go to access your account sheets to edit them create them or print them
```

**Documented fact:** the MarginEdge setup walkthrough shows a desktop web page with a
left-hand menu, and it offers a print action. This is a desk task.

**Thrive by Shopventory, "Thrive Inventory Stock Counts Walkthrough", channel
`Thrive Inventory`, https://www.youtube.com/watch?v=vSV-aU0Y6gU.**

At `00:00:03`:

```
and in your back office reduce stockouts
```

At `00:00:37`:

```
use your Clover or external scanner to scan a skew or product code to add items to the stock count
```

At `00:00:45`:

```
on the page each subsequent scan adds plus one to the count you do not need to scan items in any particular order
```

**Documented fact:** the walkthrough shows a Clover device with a scanner. The count is a
hardware task, at the device.

**Videos that failed.** Two MarketMan videos returned
`ERROR: This video is not available` from `yt-dlp` on 2026-09-18:
`https://www.youtube.com/watch?v=obfDHej2E1w` ("Daily Tasks: Inventory Counts") and
`https://www.youtube.com/watch?v=BwTVJhK2R4w` ("Mobile Inventory Counts & Scanning with
MarketMan"). The caption track could not be read.

## 12. What the evidence supports

**1. The count is a floor task. Design for the floor first.**
Label: Documented fact, sections 4 and 5. More than twenty sources name a place away from
the till: back room, freezer, shelves, bar walk, warehouse floor, delivery dock.

**2. The till belongs to the sale. Do not put the count there.**
Label: Inference, from section 4 plus the Apicbase warning. The operator at the till is
serving a guest. A count needs minutes of attention. A till screen cannot give it.

**3. The phone is a counting device when the task is small.**
Label: Source-backed tradeoff, section 5. The bar counts 80 bottles in 15 minutes on a
phone. The 5,000-item shop needs a larger screen.

**4. The count must save and resume across devices and across people.**
Label: Documented fact, section 6 and section 10. Square publishes partial save.
Lightspeed publishes resume from different devices. Two reviews describe a lost count as
the worst failure in the product.

**5. The permission split is on the action, not on the person.**
Label: Inference, supported by the MarginEdge role text and the Shopify review. One
operator wants "inventory but not all the reports". Another wants "everyone counts, only
management closes". Split entry from open/close, and split inventory from reports.

**6. Cost is a separate permission from stock.**
Label: Source-backed tradeoff, section 8 and section 10. Wisk publishes a
"Show item costs / inventory values" permission. Lightspeed publishes "Show product
costs". Both vendors found this split necessary.

**7. A separate back-office product is the market default only for depth, not for the count.**
Label: Documented fact, section 10. Every vendor publishes a back office. Only MarginEdge
ships a mobile count with a documented web-only limit.

**8. The operator will return to a spreadsheet, and that is a fair test of our product.**
Label: Documented fact, section 9.

### The shape this suggests

```
        TILL (POS)                       FLOOR (count)                 DESK (setup)
   +-------------------+            +--------------------+        +--------------------+
   | sell              |            | count stock        |        | item and recipe    |
   | 86 an item        |            | waste entry        |        | vendor and order   |
   | mark out of stock |  ------->  | receive a delivery | -----> | costing            |
   |                   |            | save and resume    |        | count sheet setup  |
   +-------------------+            +--------------------+        +--------------------+
     any employee                    any employee                    owner / manager
     no cost, no margin              no cost, no margin              cost and margin
     seconds, mid-sale               minutes, standing               hours, scheduled
                                     phone or tablet                 desktop
```

**Inference:** the three columns are jobs, not products. One job is "sell". One job is
"count". One job is "configure". The observed failure is that the market puts "count" in
the "configure" column. That is why the operator must find a desk, and that is why the
operator loses the count when the phone app closes.

**Inference, and the direct answer to the question in the brief:** inventory does not
belong in the POS as a screen. Inventory belongs in the POS only as one small action,
"this item is out". The count belongs on the floor device. The setup, the costing and the
vendor work belong in the dashboard. The permission model must cross all three, because
the same person uses more than one of them.

## 13. Routes that failed, with the status

The negative results are part of the result. Each entry was tried at least twice.

| Route                                                                | Observed status                                             |
| -------------------------------------------------------------------- | ----------------------------------------------------------- |
| Reddit `www.reddit.com/r/*/search.json` via `curl`                   | 403, HTML block page                                        |
| Reddit `/search.json` via Obscura, `restrict_sr=1`, `raw_json=1`     | 403, 189,906 bytes of block page                            |
| Reddit RSS, second call faster than 40 seconds                       | 429                                                         |
| Reddit RSS, single call after a pause                                | 200                                                         |
| Trustpilot `toasttab.com`, `squareup.com`, `loyverse.com` via `curl` | 403, 991 bytes each                                         |
| Trustpilot through Obscura                                           | reCAPTCHA wall, 0 review nodes, 175 KB of shell             |
| G2 and Capterra                                                      | 403. Two attempts each, then stopped                        |
| Google Play `play.google.com/store/apps/details` page HTML           | 200, but no review text in the page                         |
| `com.toasttab.android` on Play                                       | 404. The real Toast package is `com.toasttab.toastoperator` |
| `com.clover.app` on Play                                             | 404. The real package is `clover.companion.app`             |
| YouTube `obfDHej2E1w` and `BwTVJhK2R4w`                              | "This video is not available" from `yt-dlp`                 |
| `help.meez.com`                                                      | 200, but the domain now serves unrelated content            |
| TouchBistro `help.touchbistro.com`                                   | HTTP 401 on every route; the help centre is login-gated     |
| SpotOn `help.spoton.com`                                             | 403 from Cloudflare                                         |

## 14. Counts

- Distinct reviews and posts collected: **55**.
- Apple App Store: 3,477 reviews read across 37 apps, 28 quoted.
- Google Play: 3,683 reviews read across 18 apps, 20 quoted.
- Reddit: 8 search feeds and 6 comment feeds, 7 posts or comments quoted.
- YouTube: 8 transcripts fetched, 5 walkthroughs quoted, 2 videos unavailable.
- Vendor documents: 39 read across 11 vendors, 23 quoted in this file.
- Sources blocked: 8. Reddit JSON, Trustpilot, G2, Capterra, TouchBistro, SpotOn,
  the Google Play page HTML, and two YouTube videos.

## 15. Verification of the citations

I re-checked every citation in this file on 2026-09-18 after I wrote it.

- All 28 Apple review permalinks answered HTTP 200.
- All 20 Google Play review permalinks answered HTTP 200.
- All 7 Reddit permalinks answered HTTP 200.
- 23 vendor URLs were re-checked. Nineteen answered HTTP 200. Three hosts answer 403 to a
  plain HTTP client and were read through a real browser: `help.marginedge.com`,
  `help.shopify.com` and `x-series-support.lightspeedhq.com`. One vendor URL,
  `mealticket.my.site.com/helpcenter/s/article/65d629c70f31e`, answers 301 and then
  resolves.

## 16. Related files

- `docs/research/2026-09-18-inventory-ui-ux-surfaces.md` — the vendor surface map, with
  the real screen names and paths for nine products.
- `docs/research/2026-09-18-inventory-ux-principles-and-rbac.md` — the platform-design
  guides and the RBAC literature, with the exact permission names.
- `docs/research/2026-09-17-inventory-kitchen-systems-and-reviewers.md` — the earlier
  reviewer pass. It carries the ratings and the specialist-vendor coverage.
- `docs/research/2026-09-16-research-channels-playbook.md` — the method for each source.

## 17. Source index

Apple App Store customer-review API:

- `https://itunes.apple.com/us/rss/customerreviews/id=<APPID>/sortBy=mostRecent/json`
- `https://itunes.apple.com/us/rss/customerreviews/id=<APPID>/sortBy=mostHelpful/json`
- Per-review permalink: the `author.uri.label` field of a feed entry.

Google Play:

- Package `google-play-scraper`, version 10.1.3, method `reviews()` and `search()`.
- Review URL shape: `https://play.google.com/store/apps/details?id=<PKG>&reviewId=<ID>`.

Reddit:

- Search feed: `https://www.reddit.com/r/<sub>/search.rss?q=<term>&restrict_sr=1&sort=relevance&t=all`
- Comment feed: `https://www.reddit.com/r/<sub>/comments/<id>/<slug>/.rss?limit=100`
- The angle brackets mark a template. Use one real subreddit, post id and slug.

YouTube:

- `yt-dlp --skip-download --write-auto-subs --sub-format vtt --sub-langs "en.*" <URL>`

Tool versions on the test day: `curl` 8.5.0, `jq` 1.7, Python 3.12.3, Node.js 22.23.2,
`yt-dlp` 2026.08.19, `google-play-scraper` 10.1.3, Obscura Docker image
`h4ckf0r0day/obscura` (Chrome/145.0.0.0 protocol 1.3).
