# Inventory purchase entry implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Record inventory purchases manually, with an optional photo, or directly from a reviewed XML invoice.

**Architecture:** A procurement command composes existing order send/receive operations in one transaction. A focused dashboard form performs exact validation and persists a bounded attempt before sending. The existing invoice upload and matching flow remains the XML entry point.

**Tech Stack:** Existing NestJS/Fastify, PostgreSQL, Zod contract generator, React, Lingui, Vitest, Playwright, and native browser image APIs.

**Spec:** `docs/plans/2026-11-03-inventory-purchases-design.md`

## Global Constraints

- One new PR from `feat/inventory-purchase-entry` directly to `staging`; atomic commits; leave open for approval.
- Base is current `origin/staging`, initially `91aad948`. Preserve other worktrees, test environments, credentials, and production/staging data.
- Backend owns writes, merchant/location authority, audit, versions, ledger and idempotency. No client-generated stock adjustments.
- One transaction records the complete purchase or nothing. Reuse existing receipt posting and cost evidence.
- Supplier is optional only for `direct_purchase`; ordinary orders retain their active-supplier requirement.
- Date is document `issued_on`; preserve capture time and the existing receipt business-day rule.
- Max 100 distinct active items; positive exact quantities; safe integer cent amounts; point-only input; existing half-up line-total rule.
- Original photo <=12 MiB, final photo <=700 KiB, complete UTF-8 request <=1 MiB. Keep the global HTTP limit unchanged.
- Image types: JPEG, PNG, WebP; server sniffing; authenticated merchant-scoped retrieval; no bytes in invoice lists or journal results.
- Freeze and persist exact request/identities in sessionStorage before sending. Ambiguous results never allocate another identity.
- Simple Spanish via Lingui, keyboard and mobile; no OCR, notifications, or production deployment.

## Ownership

- Contract schemas, operation enum, route table, generated SDK/checksum, and version belong to `packages/contract`.
- The nullable-supplier/origin change is a new `db/migrations/062_inventory_direct_purchase.sql`; do not edit applied SQL.
- `procurement.repository.ts` keeps shared order persistence and posting. Use focused `purchase-entry.repository.ts` and `purchase-entry.service.ts` for the new orchestration.
- `invoice-artifact.ts` may hold the existing bounded decoder shared by upload and purchase entry.
- Dashboard entry form, pure amount/model logic, image handling and attempt persistence live in focused purchase files beside the invoice screen.
- `data.jsx` exposes explicit-merchant reads and command helpers. The existing invoice screen adds entry actions and direct XML receiving.

### Task 1: Procurement contracts, direct purchase posting and private artifacts

**Files:**

- Modify: `packages/contract/src/procurement.ts`, `dashboard-operations.ts`, `route-table.ts`, generated contract artifacts and package version as required by repository conventions.
- Add: `db/migrations/062_inventory_direct_purchase.sql`.
- Create: `apps/umi-api/src/modules/procurement/purchase-entry.{service,repository}.ts`, focused tests, optional `invoice-artifact.ts`.
- Modify: `procurement.repository.ts`, `.controller.ts`, `.module.ts`, `.service.ts`; administrative execution/policy and their relevant tests.

**Interfaces:**

- `RecordInventoryPurchaseRequest`: injected command identity; `locationId`, `inventoryLocationId`, `issuedOn`, `currency`; nullable/optional `supplierId`, `folio`, `note`; `lines: {inventoryItemId, quantity: PurchaseQuantity, unitCostMinor}[]`; optional `artifactBase64`.
- `ReceiveSupplierInvoiceDirectRequest`: injected identity and `supplierInvoiceId`; `locationId`, `inventoryLocationId`, nullable/optional `note`. Server uses all persisted invoice lines.
- Operation `inventory.purchase.record` targets the new invoice ID; `inventory.invoice.receive_direct` targets an existing invoice. Both require `inventory.invoice.approve` in dashboard context.
- `PurchaseEntryService.recordPurchase(user, access, context, dto)` and `.receiveInvoiceDirect(user, access, context, dto)` return `{commandId, supplierInvoice, correlationId}`.
- `procurement.purchaseEntryContext` GET `/api/merchants/:merchantId/purchase-entry-context?locationId=:locationId` returns `{locationId,currency,businessDate,inventoryLocations:[{id,displayName}]}` under existing dashboard/merchant.manage guards.
- `procurement.supplierInvoiceArtifact` GET `/api/merchants/:merchantId/supplier-invoices/:supplierInvoiceId/artifact` returns `{contentType,dataBase64,correlationId}` under the invoice read guards. UUID validation and merchant scope precede byte access.
- `SupplierInvoice.hasArtifact: boolean`; `PurchaseOrder.origin: 'order'|'direct_purchase'`; order supplier identity/name/reference become nullable in the read model only.

- [ ] Write RED contract tests for valid manual/no-photo input, optional supplier, photo size, 100-line limit, duplicate IDs, invalid dates/amounts and direct XML request shape.

```ts
expect(RecordInventoryPurchaseRequest.safeParse({ ...identity, locationId, inventoryLocationId,
  issuedOn:'2026-11-03', currency:'MXN', lines:[{inventoryItemId, quantity:{value:1250,scale:3,unit:'kilogram'},unitCostMinor:1250}]
}).success).toBe(true);
```

- [ ] Add the forward migration: origin defaults `order`, supplier nullable, check forbids a null supplier on ordinary orders. Apply/reapply through the canonical migration runner; keep checksums and base definitions intact.
- [ ] Adapt shared order validation/reads for the internal direct origin, retaining the ordinary API's required active supplier. Add no invented supplier row.
- [ ] Implement the focused orchestration. Record manual invoice metadata/lines with exact selected items. Create an internal direct order, send it, then reuse commit/receive with all line links and the same outer command/fingerprint. Entry type separates ordered/received ledger facts. No nested transaction or external send.
- [ ] For direct XML receiving, lock/load the existing invoice and use every stored matched line. Reject empty/unmatched/already committed invoices, unsupported quantity conversions and wrong scope before receipt posting. Do not replace parsed XML amounts with client values.
- [ ] Validate safe totals with existing domain functions. Enforce current user/location authority, active destination and items, duplicate lines, precision, supplier ownership and archive state. Any late refusal must roll back all writes.
- [ ] Share the existing artifact byte decoder without weakening XML/legacy photo handling. New purchase input enforces <=700 KiB final bytes and complete request size <=1 MiB. Return only hasArtifact in projections/results.
- [ ] Add pure context read using merchant timezone AND business_day_start calculation from PosInventoryRepository.currentBusinessDate, currency from merchant, and active scoped inventory_location rows. Do not call overview with reservation side effects.
- [ ] Add authenticated artifact read and privacy tests (no artifact/other merchant/unauthorized). Never log base64.
- [ ] Write/run actual PostgreSQL tests: manual purchase no supplier/photo; photo bytes round trip; XML direct receive; exact cost and stock; net transit zero; replay/concurrency one receipt; invalid second line rollback; foreign merchant/location rejection. Existing ordinary purchasing and invoice tests remain valid.

```ts
const before = await stock(itemId);
const first = await recordManualPurchase(request);
await recordManualPurchase(request);
expect((await stock(itemId)).onHand - before.onHand).toBe(1250n);
expect((await stock(itemId)).inTransit).toBe(before.inTransit);
expect(await receiptsFor(first.supplierInvoice.id)).toHaveLength(1);
```

- [ ] Generate/build contract, typecheck/build API and run relevant unit/integration tests. Use the isolated local database supplied by controller. Record exact RED/GREEN outputs and commands.
- [ ] Commit self-contained migration/contract/backend changes atomically by concern. Report interfaces and artifacts for Task 2.

### Task 2: Manual purchase form, photo handling and XML direct receiving

**Files:**

- Create: `apps/umi-dashboard/src/screens/purchase-entry-dialog.jsx`, `purchase-entry-model.js`, `purchase-entry-photo.js`, `purchase-entry-session.js`, and their focused tests; optional `purchase-entry.css`.
- Modify: `invoice-inbox.jsx`, `invoice-model.js` only where direct receiving integrates, `data.jsx`, catalogs and committed browser scenarios.

**Interfaces:**

- `PurchaseEntryDialog({ invoice = null, onClose, onSaved })`; null means manual form, existing reviewed invoice means direct XML receiving review.
- `fetchPurchaseEntrySnapshot(merchantId, locationId) -> {context,items,suppliers}`: load all item/supplier pages with existing pagination safeguards and explicit original merchant. Context uses Task 1 endpoint.
- `fetchSupplierInvoiceArtifact(merchantId, invoiceId)` uses authenticated API fetch and returns the Task 1 artifact shape.
- Pure `buildPurchaseEntry({draft,snapshot}) -> {parameters,errors,totalMinor}`: command parameters only, no random identity or write. Exact amounts use integers/BigInt and the canonical half-up rule.
- `preparePurchaseAttempt({merchantId,locationId,operation,targetId,parameters,storage})` persists exact envelope once; `readPurchaseAttempt`, `runPurchaseAttempt` and explicit clear validate shape, scope and outcome.
- Photo preparation accepts a File and returns allowed image base64/preview <=700 KiB. Keep a <=700 KiB source file when valid; adjust larger supported images with native image/canvas APIs. White background for JPEG conversion, bound resize/quality attempts, abort on dialog/context change, revoke temporary object URLs. No new dependency.

- [ ] Write RED pure model tests for scale 0/3/6, zero cost, decimals, line totals, totals overflow, repeated/archived/foreign items, missing destination, invalid selected supplier, and blank optional fields.

```js
const result=buildPurchaseEntry({draft: validDraftWith('1.250','12.50'), snapshot});
expect(result.parameters.lines[0]).toMatchObject({quantity:{value:1250,scale:3,unit:'kilogram'},unitCostMinor:1250});
expect(result.totalMinor).toBe(1563);
```

- [ ] Build photo helper and real file/browser tests for JPEG/PNG/WebP, unsupported formats, original limit, final limit and complete UTF-8 envelope limit. Provide clear retry/remove messages; never substitute an unreadable image silently.
- [ ] Implement session attempt recovery. Storage failure means zero sends; unknown/5xx outcomes retain identical payload and IDs; success cannot replay; definitive errors permit deliberate correction/new identity only after resolved result. Persist original merchant/location/destination and bounded photo data. Clear temporary photo after known success.
- [ ] Add `Registrar compra` gated by merchant.manage and inventory.invoice.approve. Existing capture-only XML path retains its permissions. Supplier is optional and selection uses IDs. Destination is scoped to selected branch; default only when there is exactly one active choice.
- [ ] Build native-dialog form with date, rows, exact unit labels, calculated total, optional supplier/reference/note/photo, `Revisar compra`, `Guardar compra`, `Cancelar`. Freeze the reviewed snapshot during a pending/ambiguous request. Reference loading errors block confirmation.
- [ ] Integrate direct XML registration after existing matching; offer destination/review and send `inventory.invoice.receive_direct`. Preserve receiving against an existing order. Display backend failures in simple Spanish, never raw objects/codes.
- [ ] Add `Ver comprobante` only when hasArtifact. Fetch lazily through original merchant, open a protected dialog/image preview, release client data on close; never request images in every list row.
- [ ] Make close/reload/merchant/location switching safe: unsent operation stops, an in-flight result belongs to original journal, new merchant list never refreshes from it. Same-tab recovery is offered before another purchase.
- [ ] Run real browser RED/GREEN for opening form, selecting items, reviewing/canceling without writes, optional photo and supplier, confirmed manual save, exact retry after a lost response, XML direct receive, attachment retrieval, mobile 390 px and focus/Escape. Use isolated controller stack and meaningful loaded UI; do not rely on networkidle.
- [ ] Extract/compile Lingui, fill English translations, run focused/full dashboard checks once, and commit functional units atomically. Report observed browser evidence and backend request shapes.

### Task 3: Integrated purchase verification and delivery evidence

**Files:** durable API/browser tests and sanitized `docs/verification/2026-11-03-inventory-purchases/` evidence. Credentials and fixture scripts stay private under `/private/tmp`.

- [ ] Read current LOCAL_VERIFICATION_PLAYBOOK. Use a new isolated PostgreSQL database, API/dashboard ports 4092/4093, and a dedicated headed CDP context/port 9227. Preserve all previous test services and databases.
- [ ] Seed owner/approver, capture-only/restricted actor, second merchant, two branches, stock areas, quantity-scale 0/3/6 items, supplier and a reviewed XML fixture. Do not enable outbox/notifications.
- [ ] Record purchases through actual UI/API: manual without any document/provider, manual with a large readable receipt photo compressed below cap, and XML without a pre-existing order. Inspect real stored artifacts and no invented supplier rows.
- [ ] Assert exact SQL: document date, source, nullable supplier, internal order origin, received lines, invoice links, cost basis, on-hand increase and unchanged final transit. Replaying/double-clicking/concurrent requests/lost response creates one receipt and one set of stock effects.
- [ ] Verify invalid mixed lines roll back all invoice/order/receipt/ledger facts; archived/other-merchant item/supplier/destination and wrong branch scope are refused. Ordinary order missing supplier still fails.
- [ ] Test actual HTTP body size boundary with the unchanged 1 MiB limit. Check authenticated image read and no artifact bytes in list/result/journal JSON.
- [ ] Review desktop/mobile screenshots and receipt legibility. Test keyboard, cancel, reload recovery, merchant switch and explicit errors for file/permission/storage failure. Check no writes before confirmation.
- [ ] Run applicable contract/API/dashboard tests/build/lint, migration checks and PR_BASE_REF=origin/staging pnpm check:pr; scan only feature range/prepared changes with Gitleaks --redact. Existing staging CI baseline issue, if still present, must be named rather than hidden or mixed into feature scope without controller ruling.
- [ ] Commit durable tests and sanitized evidence. Report observed facts, tools/versions and limitations without credentials or base64.

## Delivery

After each task review, complete the final whole-branch review and required checks.
Fetch origin/staging again and integrate new base changes only after inspecting them.
Push this feature branch and create one PR with base staging. Leave it open for approval.
Do not merge, enable auto-merge, deploy production or change operational staging data.
