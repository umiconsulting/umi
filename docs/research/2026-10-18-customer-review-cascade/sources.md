# Review cascade sources

Date accessed: 2026-10-18

Evidence labels:

- **HD**: vendor document or vendor image.
- **IV**: independent testimony.
- **HL**: local product evidence.
- **NV**: not verified.

## Tool record

| Tool | Version | Use | Result |
| --- | --- | --- | --- |
| Repository tools | `rg`, `jq`, `curl`, `perl` as installed | Search local documents and parse public feeds | Used |
| Playwright | 1.62.1 | Open sites that require a JavaScript browser | Used with system Chromium |
| Chromium | System package | Read vendor community pages | Used |
| Search Service connector | Current session | Primary web search | Failed with `not available to the model` |
| Brave Search | Public web interface | Fallback source discovery | Used |
| DuckDuckGo | Public HTML endpoint | Fallback source discovery | Bot challenge |
| Apple iTunes RSS | Public review feed | Review samples in MX, AR, US, FR and BR | Used |
| Google Play | Public app page | Review samples in Spanish MX | Used |
| Capterra MX | Public review page | Fudo and Soft Restaurant reviews | Used through Chromium |
| Software Advice | Public review page | Square, Toast and Lightspeed reviews | Used |

Reddit scripted access returned a network-policy block. This pass did not use Reddit as evidence.

### Second pass

The second pass used:

| Tool | Use | Result |
| --- | --- | --- |
| Apple iTunes RSS | Review samples in US, MX, CA, FR, and BR | 1,596 reviews |
| Google Play pages | Operator and manager app reviews | Used |
| GetApp | Verified review summaries and samples | Used |
| Trustpilot through Jina Reader | Recent independent reviews | Used |
| PullPush with Reddit links | Public operator posts | Used |
| Square Community search | Seller reports and vendor replies | Used |

The second pass also encountered these limits:

- DuckDuckGo and Mojeek blocked scripted search;
- Toast and Lightspeed communities used Cloudflare challenges;
- Capterra and G2 used Cloudflare challenges;
- PullPush rate-limited a later query batch;
- no licensed competitor POS was available.

## Square

- **HD:** [Split a check by item or seat](https://squareup.com/help/us/en/article/8165-split-a-payment-and-check-with-square-for-restaurants)
- **HD:** [Manage checks](https://squareup.com/help/us/en/article/6429-check-management-with-square-for-restaurants)
- **IV:** [“So many issues with Square for Restaurants”](https://community.squareup.com/t5/Orders-Menu-Items-Catalog/So-many-issues-with-Square-for-Restaurants/td-p/125223)
- **IV:** [Split payment for guests who leave early](https://community.squareup.com/t5/Orders-Menu-Items-Catalog/Split-payment-on-square-for-restaurants-for-guests-leaving-early/m-p/643108)
- **IV:** [Duplicate KDS tickets after a split](https://community.squareup.com/t5/Payments-Troubleshooting/Square-KDS-Duplicate-Tickets-when-Splitting-Checks/m-p/241602)
- **IV:** [Lost open orders after an update](https://community.squareup.com/t5/Orders-Menu-Items-Catalog/I-lost-all-open-orders-with-the-new-update/m-p/821799)
- **IV:** [Slow register on Wi-Fi](https://community.squareup.com/t5/Hardware-Setup-Troubleshooting/Square-register-very-slow-laggy-on-wifi/m-p/847362)
- **IV:** [KDS delivery delay](https://community.squareup.com/t5/Hardware-Setup-Troubleshooting/KDS-is-slow-to-receive-delivery-orders/m-p/794073)
- **IV:** [Offline payments became zero](https://community.squareup.com/t5/Payments-Troubleshooting/Offline-Payment-Issue/m-p/847771)
- **IV:** [GetApp verified reviews](https://www.getapp.com/restaurant-software/a/square-for-restaurants/reviews/)
- **IV:** [Split a single item](https://community.squareup.com/t5/Feature-Requests/Split-a-single-item/idi-p/634697)
- **IV:** [Limit the number of cards in a split](https://community.squareup.com/t5/Square-for-Restaurants/Can-I-limit-the-number-of-cards-to-split-a-check-tender/m-p/636184)
- **IV:** [Square for Restaurants App Store reviews, MX](https://apps.apple.com/mx/app/id335393788?see-all=reviews)
- **IV:** [Square for Restaurants App Store reviews, US](https://apps.apple.com/us/app/id335393788?see-all=reviews)
- **IV:** [Software Advice reviews](https://www.softwareadvice.com/retail/square-for-restaurants-profile/reviews/)
- **IV:** [Square restaurant quick tips PDF](https://d1g145x70srn7h.cloudfront.net/documents/support/restaurants-pos/rst-pos-quicktips-full.pdf)

## Toast

- **HD:** [New POS ordering screens](https://support.toasttab.com/en/article/New-POS-Experience-Ordering-Screens)
- **HD:** [Manage tables](https://support.toasttab.com/en/article/New-POS-Managing-Tables)
- **HD:** [Split checks](https://support.toasttab.com/en/article/Splitting-Checks-by-Item-1492811097734)
- **HD:** [Offline mode local sync](https://doc.toasttab.com/doc/platformguide/platformOfflineModeLocalSync.html)
- **IV:** [Simplify splitting a ticket](https://community.toasttab.com/t5/restaurant-operations/simplify-splitting-a-ticket-in-a-table-in-toast/m-p/13813)
- **IV:** [KDS production item count lag](https://community.toasttab.com/t5/restaurant-operations/kds-production-item-count-lag/m-p/18240)
- **IV:** [KDS with the Toast network down](https://community.toasttab.com/t5/back-office-team/does-kds-still-work-when-toast-network-is-down/m-p/7378)
- **IV:** [Handhelds drop Wi-Fi](https://community.toasttab.com/t5/restaurant-operations/handhelds-dropping-wifi/m-p/12282)
- **IV:** [AWS outage and offline mode checklist](https://community.toasttab.com/t5/toast-community-hub/aws-outage-impacting-toast-systems-offline-mode-checklist/m-p/17063)
- **IV:** [Software Advice reviews](https://www.softwareadvice.com/retail/toast-pos-profile/reviews/)
- **IV:** [Toast Tables App Store reviews](https://apps.apple.com/us/app/id1588284147?see-all=reviews)
- **IV:** [Toast POS verified reviews](https://www.getapp.com/restaurant-software/a/toast-pos/reviews/)
- **IV:** [Toast Trustpilot reviews](https://www.trustpilot.com/review/toasttab.com)
- **IV:** [Peak-service freeze and printer drop](https://www.reddit.com/r/restaurant/comments/1sul2od/pos_system_randomly_freezing_and_kitchen_printers/)
- **IV:** [Local Network Error](https://www.reddit.com/r/ToastPOS/comments/1of1oby/internet_working_toast_pos_still_showing_offline/)
- **IV:** [Handheld lost KDS and printing](https://www.reddit.com/r/ToastPOS/comments/1e32cri/handheld_disconnecting_from_internet/)
- **IV:** [Toast Now on Google Play](https://play.google.com/store/apps/details?id=com.toasttab.toastoperator)
- **IV:** [MyToast on Google Play](https://play.google.com/store/apps/details?id=com.toasttab.toastemployee)

## Lightspeed

- **HD:** [Processing payments](https://k-series-support.lightspeedhq.com/hc/en-us/articles/360051089473-Processing-payments)
- **HD:** [Check splitting](https://k-series-support.lightspeedhq.com/hc/en-us/articles/360051089493-Check-splitting)
- **IV:** [Software Advice reviews](https://www.softwareadvice.com/retail/lightspeed-restaurant-profile/reviews/)
- **IV:** [Software Advice reviews, page 3](https://www.softwareadvice.com/retail/lightspeed-restaurant-profile/reviews/?page=3)
- **IV:** [Software Advice reviews, page 5](https://www.softwareadvice.com/retail/lightspeed-restaurant-profile/reviews/?page=5)
- **IV:** [Lightspeed Restaurant K App Store reviews](https://apps.apple.com/us/app/id1486190847?see-all=reviews)
- **IV:** [Lightspeed Restaurant App Store reviews](https://apps.apple.com/us/app/id474723658?see-all=reviews)
- **IV:** [Lightspeed verified restaurant reviews](https://www.getapp.com/restaurant-software/a/lightspeed-restaurant/reviews/)
- **IV:** [Lightspeed Trustpilot reviews](https://www.trustpilot.com/review/lightspeedhq.com)

## Odoo

- **HD:** [Restaurant POS](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/restaurant.html)
- **IV:** [Odoo App Store reviews, MX](https://apps.apple.com/mx/app/id1272543640?see-all=reviews)
- **IV:** [Odoo App Store reviews, FR](https://apps.apple.com/fr/app/id1272543640?see-all=reviews)
- **IV:** [Odoo App Store reviews, ES](https://apps.apple.com/es/app/id1272543640?see-all=reviews)
- **IV:** [Odoo App Store reviews, BR](https://apps.apple.com/br/app/id1272543640?see-all=reviews)
- **NV:** Odoo POS-specific independent reviews with a stable public URL were not found in this pass.
- **IV:** [Odoo verified reviews](https://www.getapp.com/retail-software/a/odoo/reviews/)
- **IV:** [Odoo Trustpilot reviews](https://www.trustpilot.com/review/odoo.com)
- **IV:** [Equal split gap](https://www.reddit.com/r/Odoo/comments/1sn2dwr/odoo_pos_split_bill_equally/)
- **IV:** [Offline KOT and printer question](https://www.reddit.com/r/Odoo/comments/1t3j09v/does_odoo_pos_offline_mode_still_send_kots_and/)
- **HD:** [Offline merge issue](https://github.com/odoo/odoo/issues/189836)
- **HD:** [Payment idempotency fix](https://mergebot.odoo.com/odoo/odoo/pull/273504)

## PoloTab

- **HD:** [PoloTab](https://polotab.com/)
- **HD:** [PoloTab plans](https://polotab.com/planes)
- **NV:** No independent review set was found. The repository screenshots and help pages remain the evidence.

## Fudo

- **HD:** [Open tables](https://soporte.fu.do/es/articles/11730839-1-abrir-mesas)
- **HD:** [Split the account on the MX terminal](https://soporte.fu.do/es/articles/14627530-terminal-de-fudo-mx-como-dividir-la-cuenta)
- **IV:** [Fudo App Store reviews, MX](https://apps.apple.com/mx/app/id1137158486?see-all=reviews)
- **IV:** [Fudo App Store reviews, AR](https://apps.apple.com/ar/app/id1137158486?see-all=reviews)
- **IV:** [Fudo Google Play, MX](https://play.google.com/store/apps/details?id=do.fu.app&hl=es_MX&gl=MX)
- **IV:** [Fudo Capterra MX](https://www.capterra.mx/software/1023879/fudo)

## Soft Restaurant

- **HD:** [SRC mobile manual](https://softrestaurant.zohodesk.com/portal/es/kb/articles/manual-src-móvil)
- **HD:** [Soft Restaurant](https://softrestaurant.com/)
- **IV:** [Soft Restaurant Cloud on Google Play](https://play.google.com/store/apps/details?id=softrestaurant.cloud&hl=es_MX&gl=MX)
- **IV:** [NS POS on Google Play](https://play.google.com/store/apps/details?id=com.nationalsoft.nsposventa&hl=es_MX&gl=MX)
- **IV:** [SR Admin on Google Play](https://play.google.com/store/apps/details?id=com.nationalsoft.nsreportesweb&hl=es_MX&gl=MX)
- **IV:** [Soft Restaurant Capterra MX](https://www.capterra.mx/software/200701/soft-restaurant)

## Clover

- **HD:** [Clover Dining](https://www.clover.com/restaurants)
- **HD:** [Clover KDS](https://www.clover.com/restaurants/kitchen-display-system)
- **IV:** [Clover App Store reviews](https://apps.apple.com/us/app/id428620381?see-all=reviews)
- **IV:** [Clover Go App Store reviews](https://apps.apple.com/us/app/id969311778?see-all=reviews)
- **IV:** [Clover verified reviews](https://www.getapp.com/restaurant-software/a/clover/reviews/)
- **IV:** [Clover Trustpilot reviews](https://www.trustpilot.com/review/clover.com)
- **IV:** [Orders tab crash](https://www.reddit.com/r/CloverPOS/comments/1j0paru/orders_app_crashing/)
- **IV:** [Open-tab tip attribution](https://www.reddit.com/r/CloverPOS/comments/1ba9y68/pre_auth_confuses_tips_from_open_orders_at_shift/)

## Parrot

- **IV:** [Parrot App Store reviews, MX](https://apps.apple.com/mx/app/id6449471803?see-all=reviews)
- **IV:** [Parrot report app crash](https://apps.apple.com/mx/app/parrot-app/id6449471803)
- **HL:** [Parrot local architecture study](../2026-10-16-parrot-local-architecture/README.md)
- **HL:** [Parrot account and split screens](../2026-10-18-pos-table-account-flow/README.md)

## Fresh KDS

- **HD:** [Fresh KDS help centre](https://help.freshkds.com/en/)
- **HD:** [Fresh KDS ticket completion](https://help.freshkds.com/en/articles/6383865-how-do-i-mark-items-as-complete)
- **HD:** [Fresh KDS clear orders](https://help.freshkds.com/en/articles/6383990-how-do-i-clear-orders)
- **IV:** [Fresh KDS Google Play reviews](https://play.google.com/store/apps/details?id=com.freshtechnology.kds)
- **IV:** [Dropped tickets and 15-minute reboot, 2026](https://play.google.com/store/apps/details?id=com.freshtechnology.kds&reviewId=fe520216-862c-43ac-ac5f-3e5bf5b32ff3)

## GoTab

- **HD:** [GoTab full-service coursing](https://success.gotab.io/knowledge/full-service-pos-coursing)
- **IV:** [GoTab POS App Store listing](https://apps.apple.com/us/app/id6474589653)
- **NV:** The public App Store listing did not provide a usable review sample.

## REVO XEF

- **HD:** [REVO support: open tables](https://support.revo.works/es/articles/103)
- **HD:** [REVO support: tableless operations](https://support.revo.works/es/articles/119)
- **IV:** [REVO XEF App Store listing](https://apps.apple.com/es/app/id942396398)
- **NV:** No usable public review sample was found for the POS client.

## Loyverse

- **HD:** [Loyverse help centre](https://help.loyverse.com/)
- **IV:** [Loyverse POS on Google Play](https://play.google.com/store/apps/details?id=com.loyverse.sale)
- **IV:** [Open-ticket and partial-payment limits, 2026](https://play.google.com/store/apps/details?id=com.loyverse.sale&reviewId=9656cb23-2c2f-4b11-9ad5-347ccf20a883)

## Wansoft

- **HD:** [Wansoft support centre](https://soporte.wansoft.net/hc/es-419)
- **HD:** [Change the payment method of an account](https://soporte.wansoft.net/hc/es-419/articles/18559091897997-Cambiar-la-forma-de-pago-de-una-cuenta)
- **NV:** No stable public review corpus was found.

## Consul Rest

- **HD:** [Consul Rest cashier and payment guide](https://wiki.consul.rest/mesero/cobro/)
- **NV:** No stable public review corpus was found.

## Pacto

- **HD:** [Pacto product site](https://www.pacto.co)
- **HD:** [Pacto miniPOS page](https://www.pacto.co/tpvminipos)
- **NV:** The split-account page returned 404 in the prior pass. No stable review corpus was found.

## SambaPOS

- **HD:** [SambaPOS community ticket-close discussion](https://forum.sambapos.com/t/how-to-automatically-close-ticket-after-cancelling-last-item/7039)
- **IV:** [SambaPOS MC3 on Google Play](https://play.google.com/store/apps/details?id=com.sambapos.mc_v3)
- **IV:** [Variant setup failure, 2025](https://play.google.com/store/apps/details?id=com.sambapos.mc_v3&reviewId=d2a696b1-6ec4-4519-ae0e-1be0e7d448b2)

## Umi local evidence

- [Account-first interaction model](../../architecture/2026-10-18-account-first-interaction-model.md)
- [Account-first slice report](../../reports/2026-10-18-account-first-interaction-slice.md)
- [Offline KDS flow report](../../reports/2026-10-18-offline-kds-flow.md)
- [Ticket printing latency report](../../reports/2026-10-18-ticket-printing-latency.md)
- [Local-first plan](../../pilot/UMIPOS_LOCAL_FIRST_IMPLEMENTATION_PLAN.md)
- [Table, account and split review](../2026-10-18-pos-table-account-flow/README.md)
