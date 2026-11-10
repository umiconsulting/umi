# Purchase entry acceptance

Verified on the isolated local stack on 2026-11-10. No application source changed in Task 3.
Task 1 and Task 2 had already passed independent review; their covering runs were reused.
The final Task 3 wrapper exited **0** in controller session **95749**.

## Evidence

- [Integrated HTTP/browser/SQL results](integrated-acceptance.json) and [final manual/photo/XML SQL facts](final-sql.json).
- [Final runtime assertions and source hash comparison](runtime-results.txt).
- [Earlier actual UI request shapes](prior-ui-requests.json) and [SQL checkpoints](prior-ui-sql.json), from the final complete Task 2 run under Node 22.
- [Desktop review](desktop-review.png), [prepared receipt legibility](prepared-receipt.jpg), [390 × 844 mobile footer](mobile-footer.png), [capture role](capture-role.png) and [reader role](reader-role.png).

The fixture is synthetic. JSON identifiers are replaced by stable labels and image payloads by byte counts.
Credentials, cookies, tokens, raw command bodies and private fixture/bootstrap scripts are excluded.
Original logs, guarded runtime wrappers, fixture credentials and auth state stay in the permanent private local test stack.

## HTTP ceiling and exact SQL

The running API accepted a complete **1,048,576-byte UTF-8 JSON body with HTTP 201**.
The same request with one extra trailing space was **1,048,577 bytes and returned HTTP 413**.
The request contains multibyte text (`Límite 界 🙂`), so JavaScript string length is insufficient.
The helper measures `Buffer.byteLength(JSON.stringify(envelope), 'utf8')`, then pads the remainder with legal trailing JSON whitespace.
This isolates the existing global HTTP parser limit from the smaller business limits on note/photo fields.
It exercises the actual HTTP ingress; it does not increase the global cap or bypass the photo decoder.
Retrying the accepted request returned its existing success with no SQL delta.

The accepted purchase stored document date **2026-11-03**, source **manual**, null invoice/order supplier, origin **direct_purchase**, and one linked receipt line:

| Quantity  | Scale/unit | Unit cost (cents) | Receipt amount (cents) | Ledger type       |
| --------- | ---------- | ----------------- | ---------------------- | ----------------- |
| 1,234,567 | 6/liter    | 1,250             | 1,543                  | purchase_received |

On-hand increased by exactly **1,234,567 scaled units**. Final transit was unchanged.
One invoice, internal order, receipt and receipt line, plus two ledger entries, were created.
No supplier was invented. Both command journals contained no artifact bytes.

Six real HTTP refusals left invoice/order/receipt/line/ledger/supplier counts and stock balances unchanged:

| Reference                              | HTTP | Published code             |
| -------------------------------------- | ---- | -------------------------- |
| Archived item after a valid line       | 404  | INVENTORY_ITEM_ARCHIVED    |
| Other-merchant item after a valid line | 404  | INVENTORY_ITEM_ARCHIVED    |
| Archived supplier                      | 409  | SUPPLIER_ARCHIVED          |
| Other-merchant supplier                | 404  | SUPPLIER_NOT_FOUND         |
| Other-merchant destination             | 404  | INVENTORY_LOCATION_CHANGED |
| Destination in another branch          | 404  | INVENTORY_LOCATION_CHANGED |

Existing Task 1 real-PostgreSQL coverage verifies ordinary orders still require a supplier, concurrent/exact replay, XML rollback/unmatched lines, separate repeated prices, monetary rounding and large XML limits.
Task 2's actual manual/XML UI purchases retained separate receipt links for quantities 1,250/750 at scale 3, costs 1,250/2,000 cents and amounts 1,563/1,500 cents.
The photo purchase retained its optional supplier, two scale-zero units and zero cost.
That complete UI run added three receipts, five linked lines and ten ledger entries, with final transit unchanged.
The final guarded read-only SQL check revalidated all three actual UI purchases: exact document dates, `manual`/`photo`/`cfdi_xml` sources, supplier nullability, internal origin, one receipt per purchase and every price/link. It also verified all final Task 3 stock/transit deltas.

## Real permissions and artifact scope

Capture and reader actors signed in through the actual UI. Their generated staff rows were assigned to the existing test branch; role permissions remained restricted.
Capture could reach XML capture but had no `Registrar compra` control. Reader saw the permission notice.
Both actors received **403 PERMISSION_DENIED** for both purchase operations, with no business SQL changes.

The private image GET returned **200** with exact stored type/byte length for owner and capture (both hold `merchant.manage`), **403** for reader, **401** without authentication, and **404** through the other merchant or for an invoice without an image.
Refusals contained no image bytes. Lists, command results and both journals contained no artifact payload.
Task 2 separately verified one lazy artifact GET only after its real receipt-button click.

## Scope changes, storage and mobile

Actual scope pickers were used after closing the modal; the native modal blocks background controls while open.
Unsent reviews were canceled, then merchant/branch changes showed fresh drafts/destinations and emitted no purchase request or SQL write.
A real `Storage.prototype.setItem` quota exception showed the blocking storage error before transport.

For each in-flight branch/merchant case, the server committed once while the browser held its response.
After Escape and an actual scope-picker change, releasing that response updated only the original merchant journal to success and removed its envelope.
The other merchant journal remained absent. No late list refresh was observed through the terminal journal update and two animation frames.
Returning to the original scope showed its purchase and completed journal; the attempt was not resent.
The branch and merchant cases each produced exactly one receipt and two ledger entries.
Readiness waits target the selected scope's concrete invoice/order responses and usable controls; they do not wait for global network idleness.

At **390 × 844**, actual wheel input reached the footer. `Cancelar` occupied **x34/y715.17, 84.17 × 44 px** and `Guardar compra` **x34/y771.17, 125.20 × 44 px**.
Both controls were fully inside the viewport and passed pointer actionability checks.
A real save click created one receipt; a fresh review's real cancel click produced no further request or SQL delta.
The saved viewport screenshot shows both actions. Task 2 already verified no horizontal overflow, focus containment, Escape and focus return.

Across Task 3, the HTTP purchase and three browser saves added **4 invoices, 4 internal orders, 4 receipts, 4 receipt lines and 8 ledger entries**.
The scale-six item increased by **1,234,567**, and the scale-zero item by **3** at the original destination; final transit remained unchanged.
All **11** frozen application/test/scenario hashes matched after the final runtime.

## Verification and limits

Exact Node **22.23.3**, pnpm **10.29.3**, Playwright **1.62.1**, headed Chromium **151.0.7922.34**, PostgreSQL **17.11** and Gitleaks **8.30.1** were used.
The API reported contract **2.54.0**, compatible schema **build-v3-79** and healthy local database/Redis.
The private runtime wrapper has a 240-second watchdog, 15-second actions and 25-second navigation/HTTP bounds.

Task 1 covering evidence: PostgreSQL **40**, contract **120**, API **2,180 passed/29 skipped**, Dart/build/typecheck/lint/generation.
Task 2 covering evidence: focused **55**, dashboard **710**, strict catalogs/build and the committed warning baseline.
Task 3 adds the integrated assertions above; it does not duplicate these unchanged covering suites.
Two early wrapper attempts stopped before purchase execution: a login-navigation race, then missing branch assignment in restricted fixture staff. Both private logs are retained. Their fixes changed only harness/fixtures.

`PR_BASE_REF=origin/staging pnpm check:pr` passed after normalizing ignored local task metadata. It verified generation, pilot RBAC, full lint, the existing **68-warning** baseline, formatting, seven JSON files/checksum, migration freeze (22 applied files) and 63 use cases.
The initial required-check failures remain recorded; no warning baseline or configuration was changed.
A first read-only checker attempt expected the wrong XML source literal (`xml`); the canonical contract and stored value are `cfdi_xml`. Correcting that private assertion passed without any data or application change.

Token regeneration left `packages/tokens/dist` unchanged; all **8** token tests passed.
The dashboard build retains its disclosed Vite chunk warning; API full-suite skips remain the existing 29.
This evidence covers local synthetic data; no production/staging database, provider, notification/outbox worker, push, merge or deployment was used.
