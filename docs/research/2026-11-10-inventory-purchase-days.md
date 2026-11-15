# Weekly purchase days

Date: 2026-11-10. Scope: merchant configuration in the owner dashboard.

## Tool choice

**Inference:** Reuse the existing merchant settings flow, PostgreSQL, and class-validator. This needs no new package, service, calendar library, or scheduler.

**Documented fact:** The installed class-validator version is 0.14.4, with an MIT license. Its package identifies the TypeStack source repository.
Sources: [package metadata](../../apps/umi-api/node_modules/class-validator/package.json#L2), [repository](https://github.com/typestack/class-validator).

**Documented fact:** Installed package metadata also reports NestJS common 11.1.27, pg 8.22.0, and class-transformer 0.5.1. Each reports MIT.
Sources: `apps/umi-api/node_modules/{@nestjs/common,pg,class-transformer}/package.json`.

**Documented fact:** These packages already support the settings flow. The API manifest declares them as dependencies.
Source: [API manifest](../../apps/umi-api/package.json#L32).

**Inference:** Adoption cost is one additive column, one forward migration, and extensions to existing settings reads, validation, persistence, and controls.
The existing tools run without interactive input. The fallback is direct source inspection and existing local tests.

**UNVERIFIED:** Current upstream maintenance activity was outside this read-only local investigation. Installed versions and existing integration were verified locally.

## Narrowest owner

**Documented fact:** The settings GET already returns merchant facts. PATCH requires the dashboard product and `merchant.manage`.
The controller passes the guard-resolved merchant ID to the service.
Source: [merchant controller](../../apps/umi-api/src/modules/merchants/merchants.controller.ts#L110).

**Documented fact:** The existing permission includes admin and owner.
Sources: [admin grant](../../db/35_pos_pilot_rbac.sql#L372), [owner grant](../../db/35_pos_pilot_rbac.sql#L629).

**Inference:** Reuse this permission. The requirement describes an owner action; it does not establish a new owner-only authorization policy.
Read access can follow the existing settings GET. Editing controls must follow `merchant.manage`.

**Documented fact:** Merchant access resolves membership, constructs permissions, and sets the merchant in the request context.
Source: [access guard](../../apps/umi-api/src/modules/auth/merchant-access.guard.ts#L47).

**Documented fact:** The repository stores merchant settings with typed columns and an explicit merchant predicate.
The service already combines those facts into capabilities and the settings response.
Sources: [repository read](../../apps/umi-api/src/modules/merchants/merchants.repository.ts#L280), [capabilities](../../apps/umi-api/src/modules/merchants/merchants.service.ts#L100), [settings response](../../apps/umi-api/src/modules/merchants/merchants.service.ts#L161).

**Inference:** Add `purchaseDays` through this path. Store the value on `merchant.merchant`, because the requirement applies to each business.
Keep location, supplier, stock, purchase-order, and invoice state separate from this preference.

**Documented fact:** The contract package already names the settings route. The capabilities interface is local to the merchant service.
Sources: [route helper](../../packages/contract/src/routes.ts#L55), [capabilities interface](../../apps/umi-api/src/modules/merchants/merchants.service.ts#L19).

**Inference:** Extend the existing DTO and response shape. A new procurement command or broad contract model adds scope without a consumer need.

## Transaction, audit, and version patterns

**Documented fact:** Settings PATCH calls one repository method. That method updates one merchant row and `updated_at`.
It has no expected-version check, command identifier, or explicit audit append.
Sources: [service](../../apps/umi-api/src/modules/merchants/merchants.service.ts#L191), [UPDATE](../../apps/umi-api/src/modules/merchants/merchants.repository.ts#L526).

**Documented fact:** `withMerchant` uses a transaction on the app pool. It sets merchant and user context locally, then commits or rolls back.
Source: [database service](../../apps/umi-api/src/shared/database/pg.service.ts#L385).

**Documented fact:** Procurement supplier writes use command execution, audit events, and expected versions for updates.
Invoice writes use the administrative command surface for fingerprinting and idempotency.
Sources: [supplier service](../../apps/umi-api/src/modules/procurement/procurement.service.ts#L84), [invoice controller](../../apps/umi-api/src/modules/procurement/procurement.controller.ts#L144).

**Source-backed tradeoff:** Reuse the settings transaction and `updated_at`. This preserves the current settings concurrency behavior: the last completed write wins.
The procurement pattern provides stronger audit and version controls, with a larger command and contract surface.
The preference causes no stock or financial transaction. It does not justify that expansion in this change.
Sources: the settings and procurement methods cited above.

## Storage and value semantics

**Inference:** Use `merchant.merchant.purchase_days smallint[] NOT NULL DEFAULT '{}'::smallint[]` and JSON `purchaseDays: number[]`.
An empty array means **not configured**. It means no usual purchase days have been recorded.
It must not imply daily purchases, no future purchases, or a calculated schedule.

**Documented fact:** Existing hours code uses 0 for Sunday through 6 for Saturday, matching PostgreSQL `extract(dow)` and JavaScript `Date.getDay()`.
Source: [weekday mapping](../../apps/umi-api/src/modules/business-hours/open-hours.ts#L58).

**Inference:** Reuse that convention. Display Monday through Sunday with explicit labels; persist the corresponding numeric values in ascending order.
The values describe local weekdays for the business. No date, UTC conversion, forecast, or notification is necessary.

**Inference:** Reject duplicate days, values outside 0–6, fractions, strings, null elements, null arrays, and non-arrays.
Accept an omitted field as unchanged. Accept `[]` as an explicit clear. Limit the array to seven elements.
Use `IsArray`, `ArrayUnique`, `ArrayMaxSize(7)`, `IsInt`, `Min(0)`, and `Max(6)`.
Apply integer and range checks to each element. Validate present values before sorting; sorting must not hide duplicates.

**Documented fact:** class-validator supports element validation with `each: true`, array limits, and uniqueness.
`IsOptional` skips both undefined and null.
Sources: [array documentation](../../apps/umi-api/node_modules/class-validator/README.md#L265), [optional behavior](../../apps/umi-api/node_modules/class-validator/README.md#L801), [array decorators](../../apps/umi-api/node_modules/class-validator/README.md#L904).

**Inference:** Use an undefined-only validation condition when null must fail. Do not use `IsOptional` alone for this field.
Keep the schema constraint consistent with the API: bounded integer days, no null elements, and no duplicates.
Reject duplicate values at the database boundary too. A column check can count each allowed value with `array_positions`.
An additive typed column is simpler than a new table or catch-all JSON configuration.

## Save, cancel, and merchant scope

**Documented fact:** `_loadMerchant` maps the API response into an explicit dashboard object. New response fields need an entry here.
Source: [merchant loader](../../apps/umi-dashboard/src/data.jsx#L322).

**Documented fact:** The settings screen has local editable state and a baseline. The baseline changes after a successful save.
The current save handler submits several settings sections together.
Sources: [state](../../apps/umi-dashboard/src/screens/settings.jsx#L242), [save handler](../../apps/umi-dashboard/src/screens/settings.jsx#L373).

**Inference:** Reuse the settings screen and its existing controls. A small purchase-days section can submit only `purchaseDays` through the same helper.
Maintain its own saved baseline so a save or cancel affects that section only.
Save must disable during the request. A failure must retain the draft and show an error.
Cancel must restore the last saved days without an API call. An empty saved set must show “Sin configurar”.

**Documented fact:** `saveMerchantSettings` awaits authentication headers before it reads the selected merchant from local storage.
Source: [save helper](../../apps/umi-dashboard/src/data.jsx#L570).

**Inference:** Capture the original merchant ID and days when save starts. Pass that ID into the helper before any await.
Continue the request for that merchant if the user switches businesses. Never redirect the old draft to the newly selected merchant.
After a switch, ignore the old request's success, error, baseline, and loading updates in the new form.
Reset the draft from the new merchant's saved data. Use merchant identity plus a request token to guard completion callbacks.

**Inference:** Preserve the current guard, explicit merchant predicate, and RLS transaction. Never obtain write scope from a request body field.

## Evidence boundary

**Documented fact:** This investigation used local primary source code and installed first-party package documentation: research ladder rungs 1 and 3.
No source request failed. No external service, production database, or staging database was accessed.

**Inference:** This change can stand on the stated staging baseline. It needs no code or migration from manual-purchases PR 268.
The existing settings flow already owns every required boundary. This report is a bounded placement recommendation, not an implementation plan.
