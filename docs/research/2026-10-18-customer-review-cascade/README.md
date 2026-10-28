# Customer review cascade: POS accounts, tables, splitting and reliability

Date: 2026-10-18

Status: Stage 2 research pass 1. The review graph is open for new evidence.

Question: which repeated failures cause staff to distrust a restaurant POS, and what must Umi do to keep service fast and calm?

## Result

**I:** The strongest warning in the reviews is not a missing feature. It is loss of trust after a small hesitation.

A slow tap, an unexpected login screen, a reloaded draft or a payment with an unknown state makes staff repeat work. Repetition creates tap errors. Tap errors create payment and kitchen errors. The operator then avoids the system or adds a paper workaround.

The vendors document strong account, table and split functions. Independent reviews still show five common failure groups:

1. The screen freezes or loses the draft.
2. The session ends during service.
3. Split and partial payment need too many steps.
4. The kitchen display lags or loses a ticket.
5. A printer, handheld or terminal breaks the flow.

Umi already has the right system layers for these failures. The remaining work is to prove each layer under staff pressure and to keep the account surface simple.

## Competitor inventory

The inventory comes from the repository matrix and the account-flow study.

| Provider | Market role | Review sources used | Evidence result |
| --- | --- | --- | --- |
| Square | US and global | App Store MX and US, Square Community, Software Advice | Strong split coverage and many operator complaints |
| Toast | US | Toast Community, Software Advice | Strong account model and repeated network/KDS reports |
| Lightspeed | US, Canada and global | App Store US and Canada, Software Advice | Repeated freeze, offline and split effort reports |
| Odoo | Global | App Store MX, FR, ES and BR, official docs | Repeated mobile session and usability reports |
| PoloTab | Mexico | Official product pages only | No independent review corpus found |
| Fudo | Mexico and LatAm | App Store MX and AR, Google Play MX, Capterra MX | Repeated session, draft and payment-screen reports |
| Soft Restaurant | Mexico | Google Play MX, Capterra MX, official manual | Few independent reviews; hardware and support reports |
| Clover | US and global | App Store US, official help center | Outage, lost-order and slow-workflow reports |
| Parrot | Mexico | App Store MX, local artifact study | Very small review corpus; one hard crash report |

The set has nine products. The repository also covers Fresh KDS, GoTab, REVO and Loyverse for narrower questions. This pass does not treat them as full table-account competitors.

### Adjacent and regional inventory

The repository also names providers that answer a narrower part of the same
job. They stay in scope as evidence sources. A missing public review set is a
stated limit, not a claim that the product is weak.

| Provider | Scope | Official source | Independent review source | Evidence result |
| --- | --- | --- | --- | --- |
| Fresh KDS | Kitchen display | Fresh help centre and product pages | 61 public Google Play reviews | Repeated dropped tickets, freezes, slow recall and device connection reports |
| GoTab | Full-service ordering and payment | GoTab success centre | App Store listings have no usable review sample | Product behavior documented; customer friction `NV` |
| REVO XEF | Spain and LatAm restaurant POS | REVO support articles | App Store and Google Play listings have no usable review sample | Product behavior documented; customer friction `NV` |
| Loyverse | Café, retail and small restaurant POS | Loyverse help centre | App Store and Google Play reviews | Repeated open-ticket, partial-payment and slow back-office reports |
| Wansoft | Mexico restaurant POS | Wansoft support centre | No stable public review corpus found | Product behavior documented; customer friction `NV` |
| Consul Rest | Mexico restaurant POS | Consul Rest operator wiki | No stable public review corpus found | Product behavior documented; customer friction `NV` |
| Pacto | Mexico miniPOS | Pacto product pages | No stable public review corpus found | Partial official evidence; some pages returned 404 |
| SambaPOS | Turkey and global restaurant POS | SambaPOS documentation and forum | Four public Google Play reviews on the mobile client | Repeated setup and variant failures; small sample |

Reference-only names such as TouchBistro, Revel, Shopify POS, Micros and
Simphony appear in source discovery or adjacent comparisons. They do not yet
have a complete review cascade in this pass. Their absence is `NV`, not a
negative product verdict.

### Expanded review corpus

The second pass added a larger review sample. It read:

- **1,596 App Store reviews** in the US, Mexico, Canada, France, and Brazil;
- **586 verified Clover reviews** on GetApp;
- **554 verified Toast POS reviews** on GetApp;
- **216 verified Lightspeed Restaurant reviews** on GetApp;
- **54 verified Square for Restaurants reviews** on GetApp;
- more than **1,300 verified Odoo reviews** on GetApp;
- public Trustpilot pages for Toast, Lightspeed, Odoo, and Clover;
- public seller posts from Reddit and Square Community.

The larger sample does not change the top action. It strengthens the evidence
for account durability and local response. It also exposes two new risks:

- KDS delivery can be minutes late while the receipt printer is immediate;
- owner reports can disagree with the terminal or hide pending work.

The counts describe the corpus. They are not usage rates.

## Review cascade method

The method is an issue graph, not a vendor checklist.

1. Read a concrete complaint.
2. Record the screen, action, charge or state that failed.
3. Search the same failure across other reviewers and languages.
4. Read the vendor's intended behavior.
5. Trace the same failure in Umi code and tests.
6. Assign a user cost, a frequency class and a severity.
7. Write an acceptance scenario or mark the issue `NV`.

Example:

```text
Square review: one item cannot move to its own check.
  -> Square Community: same request repeats for several years.
  -> Square Community: partial amount requires a new check.
  -> Square official help: check split and payment split are separate.
  -> Umi: one account ledger can take a partial amount.
  -> Acceptance: pay MXN 50 on an MXN 120 account. Keep MXN 70 open.
```

## Evidence labels

- **HD**: vendor documentation or a vendor image.
- **IV**: independent review, forum post, app review or verified review site.
- **HL**: local Umi code, test or device evidence.
- **I**: inference for Umi.
- **NV**: not verified.

One review is one testimony. A repeated problem needs independent authors. Vendor replies are useful for intended behavior. Vendor replies do not prove that the failure is absent.

## Cross-provider findings

| Finding | Providers with independent evidence | User cost | Evidence strength |
| --- | --- | --- | --- |
| Screen delay or freeze under load | Lightspeed, Square, Toast, Fudo, Clover | Taps repeat; checkout stops; staff lose trust | Strong |
| Session end or draft loss | Fudo, Odoo, Square, Clover | Work must be entered again; money and kitchen state diverge | Strong |
| Split or partial payment takes too many steps | Square, Toast, Lightspeed | Guest waits; staff make amount errors; checks fragment | Strong |
| Kitchen state lags or tickets duplicate | Toast, Square, Clover | Cold food; duplicate work; missed items | Strong |
| Handheld loses Wi-Fi or changes network | Toast | Service stops until staff repair the device | Medium |
| Payment state is unclear or reverses | Square, Toast, Clover | Staff cannot say whether money arrived | Strong |
| Printer or terminal recovery needs support | Lightspeed, Soft Restaurant, Square | Receipts stop; cash-up delays; manual reconciliation | Medium |
| Reports or inventory disagree with the sale | Clover, Odoo, Soft Restaurant, Square | Owners cannot reconcile money or stock | Medium |

## Issue files

- [01: Tap latency and screen freeze](issues/01-tap-latency-and-screen-freeze.md)
- [02: Session and draft continuity](issues/02-session-and-draft-continuity.md)
- [03: Split check and early departure](issues/03-split-check-and-early-departure.md)
- [04: Kitchen state lag and duplicate work](issues/04-kitchen-state-lag-and-duplicates.md)
- [05: Handheld network recovery](issues/05-handheld-network-recovery.md)
- [06: Payment truth and unknown outcome](issues/06-payment-truth-and-unknown-outcome.md)
- [07: Printer and hardware recovery](issues/07-printer-and-hardware-recovery.md)
- [08: Reports and inventory trust](issues/08-reports-and-inventory.md)

## What Umi already does well

**HL:** These are product strengths to preserve.

- Cart taps paint from a local command queue.
- A lost response stays in the encrypted journal.
- The journal orders commands and gives each command one identity.
- The table map paints from the local working copy.
- The KDS board can read from the main iMin over the service LAN.
- The iMin records KDS commands in its own replay journal.
- The checkout records an unknown terminal outcome and blocks a second capture.
- The printer sends one official receipt per sale.

## Priority

The score uses five levels. A high score is more urgent.

| Rank | Slice | Frequency | Cost | Money/data risk | Recovery | Umi fit | Total |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Protect the draft and session | 5 | 5 | 5 | 5 | 5 | 25 |
| 2 | Keep every tap local | 5 | 5 | 4 | 4 | 5 | 23 |
| 3 | One account split path | 4 | 4 | 5 | 4 | 5 | 22 |
| 4 | KDS state under load | 4 | 5 | 4 | 4 | 5 | 22 |
| 5 | Unknown payment recovery | 3 | 5 | 5 | 5 | 5 | 23 |
| 6 | Handheld roaming recovery | 3 | 4 | 3 | 4 | 5 | 19 |
| 7 | Printer queue recovery | 3 | 4 | 3 | 4 | 4 | 18 |
| 8 | Report and inventory trust | 3 | 4 | 4 | 3 | 4 | 18 |

## Next implementation order

1. Run a 30-minute peak-load tap test on the iMin, A9 and A11.
2. Measure tap-to-paint, frame build and frame raster for every account action.
3. Add an app-restart test for a queued cart and a split ledger.
4. Add equal, amount and item split modes to the one account.
5. Add a KDS board convergence test after a 60-second cloud and LAN interruption.
6. Add a Wi-Fi roam test with the TP-Link access point.
7. Add a print recovery drill with paper out, USB reconnect and duplicate retry.
8. Add a manual test script for an early-departure guest.
9. Add a report state for accepted, pending, and conflicted facts.
10. Add an update gate for open accounts, split ledgers, and queued print jobs.

## Limits

- No competitor license was available. This pass did not execute a competitor POS.
- Direct Reddit pages blocked scripted access. The second pass used the PullPush
  index to find public posts, and it does not claim that each full thread loaded.
- PoloTab has no public app-store review set. Its review findings are `NV`.
- Several review sites do not show the full review count without a browser. The cited page is the source.
- A vendor update can fix an old report. This pass labels the report date and does not claim current behavior.
- Review volume is not a usage rate. Counts in this report are counts of independent reports in the sample.
- Some app reviews cover manager apps, not the full POS.
- Fudo and PoloTab have little or no public review volume in the newer sample.
- Parrot has almost no public review volume. The APK study gives strong local
  evidence, but it is not customer testimony.

## Sources

See [sources.md](sources.md).
