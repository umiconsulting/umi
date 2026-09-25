# INDEX 05 - standards and practice

- Lane: 5 of 5. Owner of the standard, and the practitioner writing.
- Section file: `sections/05-standards-and-practice.md`
- Captured: 2026-09-18. Device class: desktop, viewport 1440 x 900, full page.
- Route: Playwright Chromium 1237 (full browser), `headless: true`, `--no-sandbox`.
  Chromium over `curl` was necessary where Cloudflare answered 403.

## This lane owns no product screens

Lane 2 and lane 3 own the competitor screens. This lane captures **rule pages**
instead: the vendor and standards pages that carry the quoted clause. The table
below records each capture, its source URL, and its role.

## Captures

| File                                | Source URL                                                                                                      | What it shows                                                                                                                                                                    | Date       |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `05-odoo-3way-match.png`            | https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/purchase/manage_deals/control_bills.html | Odoo 17.0 "3-way matching" section, the `Received quantities` bill control policy, and the `Should Be Paid` values `Yes` / `No` / `Exception`                                    | 2026-09-18 |
| `05-ms-d365-three-way-matching.png` | https://learn.microsoft.com/en-us/dynamics365/finance/accounts-payable/accounts-payable-invoice-matching        | Microsoft Dynamics 365 Finance invoice matching overview: two-way, three-way, and tolerance rules                                                                                | 2026-09-18 |
| `05-ifrs-ias2.png`                  | https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/                                      | IFRS Foundation summary of IAS 2: lower of cost and net realisable value, and the cost of purchase                                                                               | 2026-09-18 |
| `05-gruvero-grni-chain.png`         | https://www.gruvero.com/blog/goods-received-not-invoiced-grni                                                   | The five-stage chain PO -> Receipt -> GRNI -> Invoice -> AP, and "Created by the receipt - not by the PO"                                                                        | 2026-09-18 |
| `05-lacostena-portal-manual.png`    | https://www.lacostena.com.mx/media/uploads/PDFFiles/manual-de-usuario-_portal-de-proveedores.pdf                | La Costeña supplier portal manual, page 1. The manual holds the "Recepción de factura", "Recepción de complemento de pago", and "Recepción de factura sin orden de compra" flows | 2026-09-18 |

## Source documents read, and not captured as an image

| Source                                                                                               | URL                                                                                                             | Form                                                             | Read on    |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------- |
| GAO, _Standards for Internal Control in the Federal Government_, GAO-14-704G (2014)                  | https://www.gao.gov/assets/gao-14-704g.pdf                                                                      | PDF, 78 pages. Read from the Wayback capture `20210324213429id_` | 2026-09-18 |
| SAT, _Anexo 20 - Guía de llenado de los comprobantes fiscales digitales por Internet_ (CFDI 4.0)     | http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Anexo_20_Guia_de_llenado_CFDI.pdf                | PDF, 123 pages                                                   | 2026-09-18 |
| SAT, _Guía de llenado del comprobante al que se le incorpore el complemento para recepción de pagos_ | http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Guia_llenado_pagos.pdf                           | PDF, 111 pages. Latest change note: 16 January 2026              | 2026-09-18 |
| SAT, _Estándar del Complemento para recepción de Pagos_ (Pagos 2.0)                                  | http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Pagos20.pdf                                      | PDF, 66 pages. Version fixed to `2.0`                            | 2026-09-18 |
| ISO, _ISO 9001:2015 Transition, Lecture 060 Clause 8_                                                | https://archive.org/download/iso-9001-2015-transition/Lecture%20060%20Clause%208.pdf                            | PDF, 58 pages. A training deck that reproduces the clause text   | 2026-09-18 |
| ISO, _ISO 9001:2026: What businesses need to know_                                                   | https://www.iso.org/quality-management/iso-9001-2026                                                            | HTML. Read through Chromium, because `curl` received HTTP 403    | 2026-09-18 |
| La Costeña, _Manual de Usuario Portal de Proveedores VIM_                                            | https://www.lacostena.com.mx/media/uploads/PDFFiles/manual-de-usuario-_portal-de-proveedores.pdf                | PDF, 24 pages                                                    | 2026-09-18 |
| US Foods, _US Foods Electronic Ordering_                                                             | http://restaurant365training.com/wp-content/uploads/2026/06/US-Foods-Electronic-Ordering.pdf                    | PDF, 7 pages                                                     | 2026-09-18 |
| UTEP, _Purchasing and General Services Operating Procedures Manual_ (July 2020)                      | https://www.utep.edu/purchasing-and-general-services/pgs-departments/purchasing/purchasing-manual_2020-07.pdf   | PDF, 52 pages. Holds the delegated approval limits               | 2026-09-18 |
| Restaurant365, "Restaurant Food: Purchasing, Receiving and Storing Tips"                             | https://www.restaurant365.com/blog/restaurant-food-purchasing-purchasing-receiving-and-storing-food/            | HTML                                                             | 2026-09-18 |
| Genius Food Purchasing, "7 Restaurant Procurement Mistakes Killing Your Profit (2026)"               | https://geniusfoodpurchasing.com/restaurant-procurement-mistakes/                                               | HTML, dated 16 September 2026                                    | 2026-09-18 |
| The Access Group, "Restaurant Invoice Management"                                                    | https://www.theaccessgroup.com/en-gb/hospitality/software/purchase-to-pay/restaurant-invoice-management/        | HTML                                                             | 2026-09-18 |
| Supy, "2-Way vs 3-Way Invoice Matching: What Restaurants Need to Know"                               | https://supy.io/blog/2-way-vs-3-way-invoice-matching-what-restaurants-need-to-know                              | HTML                                                             | 2026-09-18 |
| Gruvero, "What Is GRNI (Goods Received Not Invoiced)?"                                               | https://www.gruvero.com/blog/goods-received-not-invoiced-grni                                                   | HTML, dated 22 August 2026                                       | 2026-09-18 |
| Procurement Tactics, "Goods Received Not Invoiced (GRNI)"                                            | https://procurementtactics.com/goods-received-not-invoiced/                                                     | HTML                                                             | 2026-09-18 |
| Accounting Scholar, "Functions in the Purchasing Process and how to Segregate Purchasing Duties"     | https://www.accountingscholar.com/purchasing-process-functions.html                                             | HTML                                                             | 2026-09-18 |
| Ramp, "Segregation of Duties in Accounts Payable Explained"                                          | https://ramp.com/blog/accounts-payable/segregation-of-duties-in-accounts-payable                                | HTML                                                             | 2026-09-18 |
| HighRadius, "Segregation of Duties in Accounts Payable"                                              | https://www.highradius.com/resources/Blog/segregation-of-duties-accounts-payable/                               | HTML                                                             | 2026-09-18 |
| Stampli, "Implement Segregation of Duties for AP in Four Steps"                                      | https://www.stampli.com/blog/accounts-payable-fraud/segregation-of-duties/                                      | HTML                                                             | 2026-09-18 |
| Hacker News, comment 32837487 by `aqme28`                                                            | https://news.ycombinator.com/item?id=32837487                                                                   | HTML                                                             | 2026-09-18 |
| Hacker News, "Ask HN: How do you handle invoices and purchase orders?"                               | https://hn.algolia.com/api/v1/items/19591327                                                                    | JSON                                                             | 2026-09-18 |
| Microsoft, "Accounts payable invoice matching overview"                                              | https://learn.microsoft.com/en-us/dynamics365/finance/accounts-payable/accounts-payable-invoice-matching        | HTML                                                             | 2026-09-18 |
| Odoo 17.0, "Bill control policies"                                                                   | https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/purchase/manage_deals/control_bills.html | HTML                                                             | 2026-09-18 |

## Route failures

The route-failure log lives in the section file, under "Route-failure log". The
short list of blocked hosts: `gao.gov`, `www.sat.gob.mx`, `iso.org`,
`asq.org`, `www.netsuite.com`, `www.accountingtools.com`,
`www.double-entry-bookkeeping.com`, `pos.toasttab.com`,
`universitypolicies.columbia.edu`, and `www.nerldc.in`. The review sites G2,
Capterra, Trustpilot, GetApp, and Software Advice stay blocked, per the channel
playbook.

## Notes on the captures

- All captures are full-page PNG, at viewport 1440 x 900.
- Each capture is reproducible: open the source URL in Chromium, wait for the
  network to settle, and take a full-page screenshot.
- The bulk PDFs (SAT Anexo 20, SAT Pagos 2.0 and the guide, the GAO Green Book,
  the La Costena manual, the US Foods order guide, the UTEP manual) are not
  committed. The URL is the reproducible source.
