# Public menu API integration

## Tool choice

**Source-backed tradeoff:** reuse the existing NestJS/Fastify API, `PosCatalogRepository`, `TableOrderService`, and Zod shared contract. No runtime dependency, database schema, separate catalog, or payment integration is introduced. Existing versions are Nest platform Fastify 11.2.10 (workspace declaration), installed `@fastify/cors` 11.2.0 (MIT), Zod ^3.24.1 (MIT), Node 22.23.4, and pnpm 10.29.3. Adoption cost is one public read controller, shared menu projection, route/contracts and a narrow CORS policy. These are already maintained dependencies of this repository; current upstream support/release status was not independently audited (**UNVERIFIED**). Sources: `apps/umi-api/package.json`, `packages/contract/package.json`, `pnpm-lock.yaml`, installed package manifests and `node -v` / `pnpm -v`.

## Evidence and boundary

- **Documented fact:** QR reads and orders already exist at `GET /api/public/table-order/:token` and `POST /api/public/table-order/:token/orders`. The token resolves merchant, branch and table; the strict order request cannot supply prices or table identity. Existing server cart pricing and transactional order writer remain authoritative. Sources: `table-order.controller.ts`, `table-order-credential.guard.ts`, `table-order.service.ts`, `packages/contract/src/table-order.ts`.
- **Documented fact:** the repository has an optional public merchant handle, constrained to lowercase letters, numbers and hyphens; active/closed branches and active/suspended merchants. It has no separate public-menu publication flag in the inspected catalog schema. Sources: `db/20_merchant.sql`, `PosCatalogRepository.products`.
- **Source-backed tradeoff:** new `GET /api/public/menu/:handle?locationId=<uuid>` exposes only an active merchant's active branches and existing active merchandise catalog. Disabled/out-of-assortment products and gift cards are excluded. This is an **active catalog policy**, not a new publishing workflow. A merchant handle makes its active catalog publicly readable. No payment/customer/private cost/inventory fields are projected. Sources: `public-menu.controller.ts`, `TableOrderService.publicMenu/menuItems`, `TableOrderRepository.publicMerchant/publicLocations`.
- **Documented fact:** one active branch is auto-selected; multiple branches return safe `{id,name}` choices with null selection and no items until the caller chooses. A foreign or inactive branch returns 404 before catalog reads. Merchant context is resolved from the handle before tenant-scoped reads; no browser merchant override is accepted. Sources: service and `public-menu.spec.ts`.
- **Documented fact:** optional nullable category and HTTPS image URL preserve old API response compatibility. Images reuse `PosCatalogRepository`'s primary-media URL, without a new upload/signing channel or invented stock image. Retired option groups/modifiers are excluded according to existing migration 051. Sources: contract schema, catalog repository, `db/migrations/051_catalog_variant_option_authoring.sql`.
- **Documented fact:** `@fastify/cors` supports per-request options through `delegator`; Nest's installed Fastify adapter forwards these options. The implementation permits arbitrary origins only for exact public-menu/token-order route shapes, with credentials disabled and only Content-Type request headers. Private routes retain the configured credentialed origin allowlist. Sources: [Fastify CORS official options/delegator documentation](https://github.com/fastify/fastify-cors#options), installed package README/types/source and a local real Fastify preflight injection.
- **Inference:** this is sufficient for public menu browser GET and JSON POST without opening the cookie-authenticated dashboard API to arbitrary origins. It does not add pickup, bill requests, customer order tracking or payment endpoints.

## Validation and limitations

Primary-source rung: repository code/schema/contracts, installed vendor source/documentation and staging read-only HTTP. No secondary sources required. Invalid-handle staging GET and invalid-token staging GET both returned 404 on 2026-11-17; these confirm safe refusal only. The new read controller still requires deploying this branch; a 404 cannot prove its current staging availability. No actual guest orders, database writes or deployments were performed. A real QR token is only shown on issuance and cannot safely be recovered from its stored hash. End-to-end order validation therefore requires local synthetic fixtures or a deliberately issued test QR.

The required `product-feature-review` skill reference was searched by the parent agent and was absent; its instructions could not be applied. No requirements were invented to replace it.

Local checks covered branch selection, foreign branch refusal, merchant context, safe projection, strict query validation, origin isolation and actual browser preflight. Those temporary checks are not retained, per user instruction. The menu retains one retry regression test. Contract artifacts are regenerated through the existing generator; API and contract typechecks use existing scripts.

## Variant selection: source review, 2026-11-24

**Documented fact — baseline.** The public request is strict and has no `variantId`.
The menu has `hasVariants`, without variant choices. `TableOrderService` prices with a null variant and refuses products with active variants.
Sources: `packages/contract/src/table-order.ts` and `apps/umi-api/src/modules/table-order/table-order.service.ts`.

**Documented fact — existing owner.** `PosCartRepository.price` accepts a variant ID and checks its product and active state.
It returns the server variant name, attributes and price delta. It does not require a variant when the input is null.
Its product query checks branch availability. The inventory-derived variant availability belongs to `PosCatalogRepository.withDetails`.
That reader projects active variants with branch-specific availability, alongside variant names, attributes and money.
Sources: `pos-cart.repository.ts:931`, `pos-catalog.repository.ts:346` and `shared/catalog/availability.ts`.

**Documented fact — persistence.** `NewOrderLine` already accepts `variantName`.
The shared writer stores that snapshot in `merchant.order_item.variant_name`.
No new order table or schema migration is needed for that snapshot.
Source: `shared/orders/order-writer.ts:53`, `:210` and `:218`.

**Umi-specific inference — minimum change.** Add optional variant choices to the public projection and optional nullable `variantId` to request lines.
Reuse the catalog availability rule and the existing server pricing function.
Require an explicit active variant for products that have variants. Refuse a foreign, retired or unavailable selection.
Pass the priced variant name to the shared order writer. Keep prices out of the request.
Use a batch reader or shared helper for variants; avoid a complete detail query for every menu product.

**Umi-specific inference — compatibility.** Do not insert a default null variant into old DTOs before the command fingerprint.
That change could make an old idempotency key describe a different payload after deployment.
Use `line.variantId ?? null` only for the pricing call. A simple browser line should omit `variantId` for older strict servers.
An old response with `hasVariants` but no choices cannot prove which variant IDs or prices exist.
The modal must explain missing data; a development proxy must not invent variant choices or translate orders into another product.

**Documented fact — instruments and checks.** This review used local source, `rg`, Node 22.23.4 and pnpm 10.29.3.
It adds no package, service or adoption cost. Existing tool licenses and dependency versions are recorded above.
Upstream maintenance status remains **UNVERIFIED**. No remote request or business write was needed for this source review.
Existing `table-order.integration.ts` checks server/POS price agreement, transactional rows and replay identity.
It has no variant scenario in this baseline. This review adds no test, per the user's limit.
