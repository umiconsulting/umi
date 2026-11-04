# Inventory purchase entry: implementation research

Date: 2026-11-03. Scope: manual purchases, optional documents, receipt reuse, and upload limits.
This note uses repository code and installed vendor documentation. It contains no implementation or database probes.

## Tools and source method

**Documented fact:** The existing tools are NestJS, Fastify, node-postgres, and PostgreSQL procurement tables.
They already own authentication, commands, documents, stock, and receipt costs.
Use these tools before adding a service, storage provider, OCR provider, or upload framework.

| Tool                       | Installed version               | License                        | Adoption cost and maintenance evidence                                                            |
| -------------------------- | ------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| Fastify                    | 5.8.5                           | MIT                            | Already installed. Route limits need configuration and an HTTP integration test.                  |
| `@nestjs/platform-fastify` | 11.1.27                         | MIT                            | Already installed. Its adapter source determines how route metadata reaches Fastify.              |
| `pg`                       | 8.22.0                          | MIT                            | Already installed. Reuse existing transaction and merchant scope methods.                         |
| `fast-xml-parser`          | 5.11.1                          | MIT                            | Already installed. Keep the existing CFDI parser.                                                 |
| `sharp`                    | 0.34.5                          | Apache-2.0                     | Already installed. Optional image validation; server compression cannot bypass the ingress limit. |
| Browser canvas             | Browser API, no package version | Browser implementation license | No new dependency. Compression quality and device behavior require browser verification.          |

**Documented fact:** Versions and licenses above come from installed package manifests under `apps/umi-api/node_modules/`.
The lockfile records Fastify, NestJS, XML parser, and sharp versions.
**UNVERIFIED:** Latest upstream releases and current security support were outside this bounded research.
No package upgrade is proposed.

**Inference:** These tools work without interactive setup. Source inspection is the fallback when public documentation is unnecessary.
The existing repository source is the primary authority for Umi behavior.
Installed Fastify documentation is research rung 1. Installed NestJS and Fastify source is rung 3.

Sources:

- [API dependencies](../../apps/umi-api/package.json)
- [Lockfile](../../pnpm-lock.yaml)
- [Fastify route documentation](https://fastify.dev/docs/v5.8.x/Reference/Routes/)
- [Fastify hook documentation](https://fastify.dev/docs/v5.8.x/Reference/Hooks/)
- Installed `fastify/docs/Reference/Routes.md:114` and `Hooks.md:561`.
- Installed `@nestjs/platform-fastify/adapters/fastify-adapter.js:475`.
- [HTML canvas specification](https://html.spec.whatwg.org/multipage/canvas.html#dom-canvas-toblob-dev).

**Documented fact:** The repository research skill and root rules were read.
Root references `product-feature-review`, but its skill file is absent in this checkout.
The controller independently confirmed its absence. No external source requests failed.

## Existing purchase and document behavior

**Documented fact:** `supplier_invoice.supplier_id` permits NULL.
`purchase_order.supplier_id` requires a supplier and has a merchant-scoped foreign key.
Receipt headers require `purchase_order_id`. Receipt lines require both order and order-line identifiers.

**Documented fact:** `createPurchaseOrder` requires an existing, active supplier.
Its item checks enforce merchant ownership, active items, normalized quantities, and rounded totals.
`loadPurchaseOrders` uses an inner join to `merchant.supplier`.
The `PurchaseOrder` contract requires supplier ID, reference, and name.
Changing only a database constraint would therefore break reads and contract validation.

**Documented fact:** `receivePurchaseOrder` rejects drafts and closed orders.
It writes the ledger before immutable receipt lines, inside the supplied transaction.
`purchase_received` increases on-hand quantity and decreases in-transit quantity.
`sendPurchaseOrder` first increases in-transit quantity through `purchase_ordered`.

**Documented fact:** Inventory cost basis queries read `purchase_order_receipt_line` directly.
They aggregate all receipt quantities by item, scale, and unit cost.
They do not filter by receipt date or supplier.
An inventory adjustment alone cannot create this purchase cost evidence.

**Documented fact:** XML upload creates invoice lines through the existing CFDI parser.
Photo upload stores bytes but creates no lines. The service refuses `source: manual`.
Invoice commit requires an existing purchase order and existing order-line identifiers.
It delegates stock changes to `receivePurchaseOrder`.

Sources:

- [Procurement constraints](../../db/69_procurement.sql), lines 123–199 and 278–350.
- [Invoice constraints](../../db/76_recipes_inventory.sql), lines 510–638.
- [Repository](../../apps/umi-api/src/modules/procurement/procurement.repository.ts), methods `createPurchaseOrder`, `loadPurchaseOrders`, `sendPurchaseOrder`, `receivePurchaseOrder`, and `commitSupplierInvoice`.
- [Service](../../apps/umi-api/src/modules/procurement/procurement.service.ts), `uploadSupplierInvoice`.
- [Contract](../../packages/contract/src/procurement.ts), `PurchaseOrder` and invoice request schemas.
- [Cost basis](../../apps/umi-api/src/modules/inventory-costing/inventory-costing.repository.ts), `readCostBasis`.

## Supplier and receipt recommendation

**Inference — recommended:** Add one direct-purchase administrative command within the existing procurement owner.
In one business transaction, create invoice evidence and an internal order, then send and receive that order.
Use the same command identity and fingerprint for its ledger entries.
The ledger distinguishes the send and receive by entry type and source identifier.
The owner completes one purchase form and never creates an order first.

**Inference:** Add an explicit order origin, such as `direct_purchase`, with the existing order origin as default.
Allow a NULL supplier only for direct purchases through a database check.
Keep supplier requirements for the ordinary purchase-order command.
Change order loading to a left join and allow nullable supplier fields in the read contract.
Render absent suppliers as display text; do not create a supplier party from that text.

**Source-backed tradeoff:** This changes the order schema and read contract, but retains receipt foreign keys and cost queries.
An internal order also creates send evidence for an already completed purchase.
Its explicit origin must distinguish that evidence from a planned order.
The transaction leaves zero net in-transit change and commits the complete receipt only.

| Alternative                         | Benefit                       | Cost and reason                                                                                              |
| ----------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Internal unassigned supplier        | Few schema changes            | Creates a party that does not identify the seller. Existing SKU and history matching use supplier identity.  |
| Require a real supplier             | Existing schema works         | Adds mandatory owner work that the requested manual entry does not require.                                  |
| Nullable supplier on internal order | Reuses receipt and cost paths | Needs a bounded migration, explicit origin, nullable read fields, and left join. Recommended.                |
| Orderless receipts                  | Direct model of a purchase    | Changes header and line foreign keys, posting assumptions, receipt APIs, and transit behavior. Larger scope. |
| Inventory adjustment                | Existing quantity mutation    | Does not write receipt cost evidence. Does not fulfill the purchase requirement.                             |

**Source-backed tradeoff:** A shared unassigned supplier is more than a display placeholder.
`proposeMatches` searches past orders and invoice lines by supplier ID.
Supplier-SKU and historical matches could combine unrelated sellers under that party.
A sentinel would require reserved identity rules, exclusions from matching, and supplier-list behavior.
Those costs weaken its apparent simplicity.

**Inference:** Keep direct-purchase matching manual when the supplier is absent.
Validate each invoice line against its selected item and generated order line.
Existing invoice commit checks line membership, but it does not establish every proposed mapping invariant.
Reject duplicate line IDs, wrong item mappings, incomplete confirmed lines, and foreign inventory locations before stock writes.
Keep the existing CFDI UUID uniqueness behavior.

**Inference:** Expose one purchase command for manual input and confirmed XML input.
Reuse the existing upload command for documents when separate upload reduces request size.
Do not call public create/send/receive services as three independent commands.
Call repository operations inside the existing integrity transaction.
Append one purchase audit event with invoice, order, receipt, location, amount, and document metadata.

## Date semantics

**Documented fact:** `tg_business_date` derives the date from its timestamp argument and merchant settings.
The receipt trigger passes `created_at`, and the trigger overwrites supplied `business_date`.
Invoice `issued_on` already stores a document date.

**Inference — narrow default:** Store the selected purchase document date in `issued_on`.
Keep `created_at` as the capture timestamp and receipt business date as the posting date.
Make the date meaning explicit in the form and history.

**Source-backed tradeoff:** If the selected date must move stock into a past business day, the narrow default is insufficient.
That requirement needs an explicit effective timestamp or date, a targeted trigger change, and backdating policy tests.
Do not falsify `created_at` or assume an inserted `business_date` survives the current trigger.

Sources: [Business-date function](../../db/60_triggers.sql), line 247; [receipt triggers](../../db/69_procurement.sql), line 595.

## Existing form context

**Documented fact:** `PosInventoryService.currentBusinessDate(merchantId)` delegates to `PosInventoryRepository.currentBusinessDate`.
The repository method at line 1886 uses merchant timezone and `business_day_start`.
Use this calculation for the initial merchant business date, rather than the browser UTC date.

**Documented fact:** `inventory-production.jsx:129–142` loads stock areas through the `inventory.overview` administrative operation.
It filters `response.result.locations` for active areas and auto-selects only a single available area.
`PosInventoryRepository.overview` queries `merchant.inventory_location` by merchant and location.
The method also expires reservations and requires an inventory policy; it is not a pure metadata read.

**Documented fact:** `inventory-workspace.jsx:134–135` reads currency from the selected merchant or merchant capabilities.
The canonical database field is `merchant.merchant.currency`.
No combined procurement date/currency/location helper was found.

**Inference:** A small authenticated procurement context read can expose the date, currency, and active stock areas.
Reuse the existing calculation and scoped query within the procurement owner.
This avoids a dependency on reservation expiration when the form only needs metadata.
Validate merchant currency again during purchase submission; client context is not write authority.

Sources: [Inventory repository](../../apps/umi-api/src/modules/pos-inventory/pos-inventory.repository.ts), methods `currentBusinessDate` and `overview`;
[production form](../../apps/umi-dashboard/src/screens/inventory-production.jsx);
[inventory workspace](../../apps/umi-dashboard/src/screens/inventory-workspace.jsx).

## Photo ingress limits

**Documented fact:** The global HTTP parser limit is 1,048,576 bytes.
The invoice decoder and database permit 12,582,912 decoded bytes.
The contract permits a 20,000,000-character base64 string.
Base64 expansion means a valid maximum artifact cannot pass the current HTTP route.

**Documented fact:** All invoice writes currently enter the shared administrative-command endpoint.
No existing scoped upload limit or resource-guard class was found in application code.
Repository searches found the global Fastify limit as the ingress bound.
This is a source inspection result, not a claim about an external gateway.

**Inference — narrow recommendation:** Keep the global limit and compress receipt photos in the client.
Use a bounded JPEG/WebP conversion and a maximum of 700 KiB for the final binary artifact.
700 KiB becomes 955,736 base64 characters, leaving about 90 KiB for the upload envelope.
Send the photo through a separate document command, without the purchase line array.
Measure the final UTF-8 JSON body and enforce its limit before transport.
The server must enforce the same artifact bound for new uploads.

**Source-backed tradeoff:** Compression avoids a new route and infrastructure configuration.
It can reduce the legibility of long receipts.
Preserve an image preview and verify real phone photos before accepting this limit.
Reject an unreadable or unsupported result with a clear file-size instruction.
Do not silently truncate or crop the document.
Large stored artifacts can remain readable; lowering upload limits does not require rewriting old rows.

**Inference — alternative when legibility requires larger photos:** Add a dedicated authenticated artifact upload route in the same API.
Restrict the route to the invoice-upload operation and delegate to the same administrative execution pipeline.
Retain the 12 MiB decoded cap and set a bounded route limit, for example 18 MiB of JSON.
The existing 20M schema bound should then match the actual encoded maximum plus data-URL allowance, if supported.
Do not increase the shared administrative endpoint for every operation.

**Documented fact:** Fastify supports a route-level `bodyLimit`.
NestJS `@RouteConfig` puts values under Fastify `config`; it does not copy `bodyLimit` to the route root.
Thus `@RouteConfig({ bodyLimit: ... })` alone does not change parser behavior.
An `onRoute` hook can set the actual option for one explicitly marked upload route.
Register that hook before Nest registers routes, and test the actual HTTP parser.

**Inference:** The larger-route alternative adds a route, marker/hook, contract registration, and HTTP tests.
It adds no service or storage boundary.
Verify deployment ingress limits separately before selecting it. Those limits remain UNVERIFIED here.

Sources:

- [Limits](../../apps/umi-api/src/shared/operations/resource-limits.ts) and [bootstrap](../../apps/umi-api/src/main.ts).
- [Administrative controller](../../apps/umi-api/src/modules/administrative-commands/administrative-command.controller.ts).
- [Artifact decoder](../../apps/umi-api/src/modules/procurement/procurement.service.ts), `decodeInvoiceArtifact`.
- Installed Fastify `lib/route.js:298,382` and `lib/content-type-parser.js:235`.
- Installed NestJS adapter `adapters/fastify-adapter.js:475–508`.

## Audit, replay, and artifact reads

**Documented fact:** The administrative journal stores fingerprints, context, status, and results.
The business journal stores fingerprints and result data.
Neither inspected claim method stores the original input parameters or artifact base64.
Current invoice projections omit artifact bytes, so successful command results do not duplicate the image.

**Documented fact:** Generic secret redactors do not recognize `artifactBase64` or `cfdiXml`.
Do not assume they make a future input/result copy safe.
Keep artifact bytes out of logs, audit public data, and command responses.
Preserve content-sensitive fingerprints so changed content with the same key causes a conflict.
Do not remove artifact content from the fingerprint without replacing it with a stable content digest.

**Inference:** Add an authenticated artifact GET to the existing supplier-invoice controller.
Use the controller's authentication, membership, entitlement, and `merchant.manage` guards.
Read through `runWithMerchant` and filter by both merchant ID and invoice ID.
Return 404 for unavailable or foreign artifacts.
Serve bytes with the stored allowlisted MIME type, `X-Content-Type-Options: nosniff`, and private/no-store cache policy.
Never expose a public storage URL.

**Inference:** Return only `hasArtifact`, content type, and optional byte length in invoice metadata.
Keep bulk invoice queries free of `artifact_bytes` and base64.
The dashboard can fetch the authenticated blob and revoke its local object URL after preview.
Use the existing PNG, JPEG, and WebP allowlist and signature checks.
Bound dimensions if image decoding is introduced; a compressed byte cap does not bound decoded image memory.

Sources:

- [Administrative journal](../../apps/umi-api/src/modules/administrative-commands/administrative-command.repository.ts), `claimCommand` and `completeCommand`.
- [Administrative fingerprint](../../apps/umi-api/src/modules/administrative-commands/administrative-command-context.service.ts), `create`.
- [Business journal](../../apps/umi-api/src/modules/integrity/integrity.repository.ts), `claimCommand` and `succeed`.
- [Redaction](../../apps/umi-api/src/shared/operations/redaction.ts) and [canonical JSON](../../apps/umi-api/src/modules/integrity/canonical-json.ts).
- [Invoice projection](../../apps/umi-api/src/modules/procurement/procurement.repository.ts), `loadSupplierInvoices`.
- [Invoice read guards](../../apps/umi-api/src/modules/procurement/procurement.controller.ts), `SupplierInvoiceController`.

## Required implementation evidence

**Inference:** The next plan should verify these behaviors with focused integration tests and real browser use:

- One purchase writes one receipt and the expected stock/cost evidence.
- Replay returns the original result and posts no second stock movement.
- Any invalid line rolls back the complete purchase transaction.
- Supplier absence does not create a business party or exclude purchase history rows.
- Supplier, location, item, invoice, and artifact access remain merchant scoped.
- Selected document date and posting date follow the stated rule.
- Photo upload passes the real parser boundary, and excessive bodies receive a bounded refusal.
- Invoice lists and journal rows contain no image/base64 payload.
- Artifact GET rejects other merchants and unsupported MIME content.
- A real phone receipt remains readable after client compression.

This research made no API writes, database writes, git mutations, or package installations.
