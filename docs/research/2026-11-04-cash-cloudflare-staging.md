# Umi Cash: Cloudflare staging and canonical API coverage

Research date: 2026-11-04. Deployment branch: `feat/cash-cloudflare-staging-20261104`.

## Accepted direction

**User decision:** Remove Prisma from Cash. Translate its database operations to the new schema through the canonical API.
Keep the existing client, business, and internal Umi admin panels.
Deploy the resulting Next.js application to Cloudflare Workers with Wrangler.

**Superseded proposal:** The earlier Containers proposal was research only. It was not accepted or deployed.
The remaining container notes below describe a rejected alternative, not the implementation plan.

## Runtime tools

**Documented fact:** `@opennextjs/cloudflare` 1.20.16 requires Next.js `>=15.5.29 <16 || >=16.4.5` and Wrangler `^4.148.0`.
Its public overview still mentions Next.js 14 with a Q1 2026 retirement date.
Use the current package metadata for installation compatibility.
Next.js 15.5.29 supports React 18.
Sources: [adapter metadata](https://registry.npmjs.org/@opennextjs/cloudflare/1.20.16),
[Next.js metadata](https://registry.npmjs.org/next/15.5.29), [OpenNext overview](https://opennext.js.org/cloudflare).

**Source-backed tradeoff:** OpenNext preserves the Next.js application but needs a framework upgrade.
Cloudflare now recommends vinext for new applications.
This existing application has a smaller change through a supported Next.js release and the OpenNext adapter.
Sources: [Cloudflare guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/),
[OpenNext setup](https://opennext.js.org/cloudflare/get-started).

| Tool                     | Version checked                       | Licence           | Cost of adoption                              |
| ------------------------ | ------------------------------------- | ----------------- | --------------------------------------------- |
| Wrangler                 | 4.156.0, reported by deployment agent | MIT OR Apache-2.0 | Existing authenticated CLI.                   |
| `@opennextjs/cloudflare` | 1.20.16                               | MIT               | Next.js 15 upgrade and Workers configuration. |
| Next.js                  | 15.5.29                               | MIT               | Async request APIs and route parameter types. |

**Inference:** Keep database access, native pass generation, and messaging work in `umi-api`.
Cash should contain UI, public metadata reads, and HTTP forwarding only.
No Prisma replacement belongs inside the Worker.

## Existing API coverage

All claims in this section are **local source evidence** from the baseline deployment worktree.
They do not prove which version runs on the test VPS.
The implementation agent now owns the missing API ports and their final verification status.

| Cash surface                                                    | Canonical API                                                          | Authority and coverage                                                                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Business login, refresh, logout                                 | `/api/:merchantRef/auth/login`, `/refresh`, `/logout`                  | Public merchant resolution; login and refresh are implemented despite a stale comment.                                 |
| Business settings, stats, analytics, customers, export, rewards | `/api/:merchantRef/admin/*`                                            | Existing Cash controllers accept register bearer tokens and canonical dashboard cookies.                               |
| Scan, top-up, purchase, gift-card issue                         | Same paths in `cash-scan.controller.ts` and `cash-write.controller.ts` | Merchant membership, Cash entitlement, roles, and write checks remain backend-owned.                                   |
| Customer registration, gift-card read/redeem                    | `/api/:merchantRef/customers`, `/gift/:code`                           | Public merchant guard; customer-specific auth where required.                                                          |
| Customer card and QR                                            | `/api/:merchantRef/card`, `/card/qr`                                   | Public merchant resolution plus customer token verification.                                                           |
| Apple/Google passes and strip image                             | Existing wallet controllers                                            | Keep the explicit wallet rewrite list. Remove the local native handlers from Cash.                                     |
| Public merchant configuration                                   | Missing                                                                | Needed for tenant layout, public landing page, legal pages, and browser context.                                       |
| Public reward profile                                           | Missing                                                                | Existing reward reads require staff auth. The public landing page needs the ladder.                                    |
| Lifecycle message history                                       | Missing                                                                | Old `/admin/messages` has no canonical controller port. Historical body persistence also has a gap.                    |
| Platform merchant creation                                      | `POST /api/merchants`                                                  | Canonical session plus `PlatformAdminGuard`; only `super_admin`.                                                       |
| Platform merchant list                                          | `GET /api/me/merchants`, partial                                       | Global platform grants see active merchants. No subscription state or counts; suspended/archived merchants are absent. |
| Platform merchant detail, edit, suspend, delete                 | Missing as a complete platform surface                                 | Some merchant-scoped settings/location/reward writes exist. They do not replace platform management as a group.        |
| Platform wallet push                                            | `POST /api/platform/wallet/push`, partial                              | Canonical super-admin session; Apple push only. Different request and response shapes.                                 |
| Geocoding                                                       | `GET /api/geocode?address=...`                                         | Canonical authenticated session; returns `{ location }`.                                                               |

Source files: `apps/umi-api/src/modules/cash/*controller.ts`, `cash.module.ts`,
`modules/merchants/merchants.controller.ts`, `modules/platform/platform-wallet.controller.ts`,
`modules/wallet/*controller.ts`.

## Public configuration port

**Local source evidence:** `CashRepository.branding()` in `modules/cash/cash.repository.ts` reads typed columns from
`merchant.merchant` and `merchant.loyalty_program` through a merchant-scoped transaction.
It already returns name, handle, timezone, city, program id, card prefix, colors, logo, pass style,
self-registration, birthday settings, promotion schedule, and lifecycle copy.

It does not select `topup_enabled`, `multi_seal_enabled`, locations, or subscription status.
The Cash layout needs the first two fields.
The old tenant adapter also exposes dates, active locations, and subscription state.
`businessHours` now maps to `merchant.merchant.open_hours`, with location overrides in `merchant.location.open_hours`.

**Inference:** Add one public-safe configuration projection within the Cash API module.
Resolve id or existing handle through `PublicMerchantGuard`.
Return only the fields the public page needs.
Use `handle ?? id` for navigation: new merchants deliberately have no handle.
Convert ISO dates to `Date` only where the current server helpers require dates.

**Local source evidence:** `CashRepository.rewardProfileRows(merchantId, null)` returns the standard and upgrade rows.
`shared/loyalty/reward-profile.ts` owns `resolveRewardProfile()`.
The public landing page currently calls the Prisma helper `getTenantRewardProfile()`.

**Inference:** Include the resolved public ladder in the new projection.
Do not expose a staff-only endpoint to serve the public page.
Do not replace a two-tier ladder with the first reward row.

## Platform authentication and merchant shapes

**Local source evidence:** Old `/api/umi/auth` accepts one shared password and signs `umi_session`.
Canonical platform routes do not accept that cookie.
`POST /api/auth/local/login` takes `{ username, password, remember? }`.
It sets `umi_access`, `umi_refresh`, and `umi_csrf` cookies.
It can return an MFA challenge instead of a session.
The corresponding refresh and logout paths are `/api/auth/local/refresh` and `/api/auth/local/logout`.

**Local source evidence:** Authenticated mutations with `umi_access` need `x-umi-csrf` equal to `umi_csrf`.
Bearer-only register requests are exempt from this cookie check.
See `modules/auth/csrf.guard.ts` and `auth.controller.ts`.

**Inference:** Adapt the platform login to canonical identity.
Preserve the panel workflow while keeping the backend role and MFA checks.
Do not translate a shared-password cookie into platform authority.

**Local source evidence:** `ProvisionMerchantDto` differs from the old create form:

- `plan` is required: `starter`, `growth`, or `pro`.
- `timezone` is explicit and optional, rather than inferred from coordinates.
- `visitsRequired` becomes `stampsRequired`.
- `slug` is absent by design. Existing handles preserve issued pass URLs; new merchants route by id.
- The response is `{ merchantId, userId }`, rather than `{ ok, slug }`.

Source files: `modules/merchants/dto/provision-merchant.dto.ts`, `merchants.service.ts`, `merchants.repository.ts`.

**Local source evidence:** The old platform list needs subscription status, trial end, user/card counts, and rewards.
The old delete route performs a cascading tenant delete.
`GET /api/me/merchants` supplies none of those deletion semantics or list details.
A new management port needs deliberate archive/delete behavior against the new schema.
Do not infer a destructive operation from the old Prisma cascade.

## Lifecycle history: data gap

**Local source evidence:** The old messages route returns `{ page, limit, total, counts, events }`.
Each event includes `{ id, journey, body, sentAt, customer: { cardId, cardNumber, name, phone } }`.

Canonical `LifecycleRepository.claimSend()` ignores its `_body` argument.
It stores only the dedup record in `runtime.reminder_sent`.
The journey value becomes `reminder_type`.
`OutboundProcessor` sends `whatsapp.lifecycle` through Twilio and returns without a `merchant.message` insert.
The repository comment says the body lives there, but the inspected delivery path does not persist it.

**Inference:** A history port can report real reminder metadata with missing content explicit.
It must not render today's template as if it were the historical message body.
Future delivery persistence needs an authoritative link if full historical bodies remain a requirement.
A runtime read must carry an explicit merchant constraint and respect the sealed runtime permissions.

Source files: `modules/lifecycle/lifecycle.repository.ts`, `lifecycle.service.ts`, `jobs/outbound.processor.ts`,
`apps/umi-cash/src/app/api/[slug]/admin/messages/route.ts`.

## Wallet push: shape and delivery gaps

**Local source evidence:** The old endpoint accepts `{ cardIds?, tenantSlugs? }` with bearer `CRON_SECRET`.
It returns `{ pushed, total, google }` and refreshes both Apple and the Google fleet.
The canonical endpoint accepts `{ cardIds?, merchantIds? }` with a super-admin session.
It returns `{ cards, sent, pushConfigured }` and invokes `ApplePushService` only.
Empty targets are rejected.

**Inference:** Translate merchant references before forwarding.
Preserve visible delivery outcomes and test Google refresh separately.
Do not claim wallet parity from the existing Apple-only endpoint.

## Operational wallet scripts

**Local source evidence:** `apps/umi-cash/scripts/broadcast-message.ts` writes old card metadata,
updates the card timestamp, pushes Apple, and patches Google with a lifecycle announcement.
The canonical schema already has typed fields: `merchant.loyalty_card.lifecycle_message` and `lifecycle_message_at`.
Do not add a replacement metadata object.

Existing canonical methods:

- `CashScanRepository.writeLifecycleMessage(c, merchantId, cardId, message)` writes the typed fields and `updated_at`.
- `WalletPassRepository.renderData()` reads those fields for both wallet builders.
- `ApplePassBuilder` emits a watched `lifecycleMessage` field with `changeMessage: '%@'`.
- `ApplePushService.pushCards(cardIds)` and `pushMerchant(merchantId)` touch cards and push their devices.
- `WalletPassService.refreshGoogleObjectWithOutcome(cardId)` refreshes one stored Google object.
- `WalletPassService.refreshMerchantGoogleObjects(merchantId)` refreshes the merchant's Google objects.
- `GooglePassService.updateObject()` invokes its private `notify()` method when the lifecycle message is present.

**Local source evidence:** `notify()` sends Google's `addMessage` with `TEXT_AND_NOTIFY`.
It derives the notification id from the card id and message timestamp.
An unsuccessful notification only creates a warning; the outer method can still return `updated`.
Therefore an object refresh count is not a count of confirmed notifications.
No custom-announcement HTTP endpoint exists in the inspected baseline.

**Inference:** A broadcast API belongs in `umi-api` and must enforce explicit operator authority and merchant scope.
Commit the message before provider calls, then report provider outcomes separately.
Keep the broadcast client as a small HTTP tool.
The typed card fields are current display state, not a durable announcement history.

The existing resync endpoint is `POST /api/:merchantRef/admin/reward-config/resync?platform=apple|google`.
It accepts register or dashboard authentication and requires `merchant.manage`.
It returns `{ apple, google }`.
Apple returns `{ cards, sent }`; Google returns `{ total, refreshed, missing, failed }`.
The unselected provider is null.
It refreshes existing content; it does not create a custom announcement.

| Legacy tool                        | Existing equivalent or remaining work                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `google-wallet/backfill-hero.mjs`  | Merchant Google resync renders canonical hero image state. Historical provider-only repair can remain an API-owned tool.       |
| `google-wallet/backfill-saldo.mjs` | Merchant Google resync renders canonical balance modules. The legacy script instead derives money from provider objects.       |
| `google-wallet/patch-classes.mjs`  | No canonical class-template management method or CLI found. Preserve this separate provider operation under the backend owner. |
| `google-wallet/set-logo.mjs`       | No Google class-logo management equivalent found. Merchant branding upload alone does not patch a Google loyalty class.        |
| `google-wallet/preview.mjs`        | No isolated class/sample preview equivalent found. Keep the tool under the backend owner.                                      |
| `test-apn.ts`                      | No live provider-key diagnostic equivalent found. Mocked Apple push tests do not perform this check.                           |

**Local source evidence:** The Google tools read `.env.vercel.production` through a fixed relative path.
They import dependencies through relative `node_modules` paths.
`test-apn.ts` loads local environment files and sends a bogus token to Apple.
It interprets `BadDeviceToken` as acceptance of the provider credentials.
These file paths and imports need an explicit update when the tools move.
No existing API script directory or wallet operation equivalent was found under `apps/umi-api`, `scripts`, or `tools`.

## Rejected Containers alternative

**Documented fact:** Containers can preserve the legacy Node runtime through Wrangler and a Linux image.
They require Docker for the image build and paid Workers usage.
The direct Durable Object API uses `scheduling_policy: "durable_object"`.
The optional helper package supports only `default` scheduling.
Sources: [get started](https://developers.cloudflare.com/containers/get-started/),
[Container class](https://developers.cloudflare.com/containers/api/container-class/),
[pricing](https://developers.cloudflare.com/containers/platform/pricing/).

**User decision:** This path does not satisfy the requested removal of Prisma and its old-schema operations.
It remains unimplemented.

## Verification still required

- Prove the deployed test API includes every new endpoint.
- Verify public merchant and two-tier reward displays in a real browser.
- Verify business login, refresh, logout, one test write, and a read of its result.
- Verify platform login, role rejection, list/detail reads, and each supported edit.
- Verify tenant isolation and the public projection's field list.
- Verify lifecycle history reports actual stored data.
- Verify Apple and Google behavior separately.
- Verify the Worker bundle contains no Prisma engine or native wallet dependencies.
- Keep production DNS, production credentials, and Vercel unchanged during staging tests.

## Research routes

Primary sources used: vendor documentation, package registry metadata, and first-party source code.
Cloudflare Markdown fetches failed with content-type errors or HTTP 403.
HTML documentation and raw GitHub source worked.
No credentials or provider mutations were used by this research agent.

## Implementation evidence

The implementation removes the Cash Prisma runtime and local data handlers.
A single proxy forwards API traffic. The backend now serves the missing public and internal admin projections.
The old internal interface remains available with canonical identity and platform authorization.
Google Wallet tools and APN diagnostics now belong to the API.

The standard Worker build succeeds with Next 15.5.29 and React 19.3.1.
Wrangler 4.157.0 reports about 1.1 MiB compressed upload.
No Container, R2 bucket, or production route is configured.

The frontend tests and TypeScript check pass.
The backend unit suite passes 2,150 tests. Four additional boundary checks pass.
Eight database and application-boot checks pass against a disposable canonical database.
These checks cover merchant isolation, location ownership, reward-tier preservation, and public privacy.
The secret scan finds no secrets in the staged diff.

The production dependency audit reports zero known vulnerabilities after cleanup.
Unused `jose` and `zod` dependencies were removed from Cash.
OpenNext belongs to development dependencies.
A scoped PostCSS override updates the copy pinned by Next within the same major release.
The [maintainer advisory](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp) identifies the affected source-map handling.
The adapter toolchain still has audit findings. They require a separate upgrade review.
Do not use `npm audit fix --force`: it proposes an obsolete adapter release.

Deployment and browser results belong in `docs/deployment/cash-cloudflare-staging.md` after validation.

## Isolated wallet testing decision

The user approved isolated wallet tests with live updates blocked.
Local evidence found 1,053 other wallet-pass records in staging.
The signing credentials can therefore run only with explicit merchant isolation and provider delivery blocked.

The implementation blocks delivery inside `ApplePushService` and `GooglePassService`.
This covers direct expiry jobs as well as adapter calls.
Both signing builders enforce the synthetic merchant allowlist, including Apple poll downloads.
The staging worker holds no signing keys. The API receives no APN key.
The Google class uses a separate suffix and an explicit staging label.

The canonical wallet repository previously resolved only frozen handles.
It now also resolves a merchant UUID and renders `handle ?? id` for new merchants.
Existing handles and issued URLs retain their values.
A database integration check verifies UUID lookup and rendering.

The backend suite passes 2,159 tests, including four isolation checks and two registration response checks.
The isolation checks prove that configured provider services make no outbound update call.
Ten additional database checks pass for compatibility and SQL parsing.

Runtime checks confirm isolated mode in both staging services.
Cloudflare returns HTTP 200 for both test wallet formats and HTTP 403 outside the merchant allowlist.
The Apple archive passes manifest checksum and CMS signature checks.
The staging callback URL remains separate from the production origin.

A returning customer exposed a compatibility gap during the wallet check.
The registration service threw its existing session through the global error filter, which removed the session.
The controller now returns that session directly with the existing HTTP 409 contract.
This preserves the old registration screen without changing the global error filter.
