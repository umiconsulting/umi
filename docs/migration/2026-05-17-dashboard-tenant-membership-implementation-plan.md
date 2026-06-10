# Dashboard Tenant, Membership, Branch, and Product Entitlement Plan

Date: 2026-05-17

## Decision

Implement tenant, membership, branch, and product selection through the existing Umi dashboard and platform schema. Do not create another owner/admin frontend.

The dashboard should become a tenant-aware modular shell:

- login resolves the user's accessible tenants
- tenant selection chooses the active business account
- branch selection chooses an optional active location inside that tenant
- product entitlements decide which modules exist for that tenant and branch
- role state decides what the signed-in user can do inside available modules

For the current Kalala scope:

- one tenant: Kalala
- two locations/branches under that tenant
- active products: `dashboard`, `conversaflow`, `kds`
- inactive product: `cash`
- only active role/permission path for now: `super_admin`

`super_admin` must not bypass product entitlements. If `cash` is inactive, Wallet, loyalty, gift cards, Cash settings, wallet pass personalization, and Cash API calls remain unavailable.

## Source Basis

Documented facts:

- Current Umi platform schema already defines `platform.tenants`, `platform.locations`, `platform.tenant_memberships`, `platform.roles`, `platform.permissions`, `platform.membership_roles`, and `platform.product_instances` in `docs/migration/local-postgres/001_platform_core.sql`.
- Current migration plan already names dashboard tenant switching as the first app-visible milestone in `docs/migration/2026-05-15-optimized-database-transition-plan.md`.
- Current dashboard still depends on `VITE_BUSINESS_SLUG` in `apps/umi-dashboard/src/data.jsx`.
- Current dashboard local login returns tenants from `platform.tenant_memberships` in `apps/umi-dashboard/server.js`.
- Current Settings screen mixes tenant settings and Cash settings in `apps/umi-dashboard/src/screens/settings.jsx`.

Source-backed tradeoffs:

- PostgreSQL row security defaults to deny when row security is enabled and no allowing policy exists, so tenant isolation should be enforced below the frontend.
- Supabase RLS guidance supports using database policies for browser/API data safety and warns against user-editable metadata for authorization.
- Stripe Entitlements models subscribed features as active customer entitlements and recommends persisting them internally for faster access checks.
- OpenFeature defines feature flags as runtime behavior changes without deployments; Umi should keep its local capability object compatible with future flag providers, but not depend on one yet.

Primary sources checked:

- PostgreSQL row security policies: https://www.postgresql.org/docs/17/ddl-rowsecurity.html
- Supabase Row Level Security: https://supabase.com/docs/guides/auth/auth-deep-dive/auth-row-level-security
- Stripe Billing Entitlements: https://docs.stripe.com/billing/entitlements
- Stripe subscription webhooks: https://docs.stripe.com/billing/subscriptions/webhooks
- OpenFeature introduction: https://openfeature.dev/docs/reference/intro/

Umi-specific inference:

- `platform.product_instances` is the correct first source for product availability.
- A central dashboard capability object should become the API contract that every nav item, route, settings panel, and API guard uses.
- Cash should be removed from active Kalala workflows until its product instance is active.

## Target Hierarchy

```txt
platform.user
  -> platform.tenant_memberships
    -> platform.tenant
      -> platform.locations
      -> platform.product_instances
      -> platform.roles / membership_roles
        -> dashboard module capabilities
```

The branch selector is a location selector, not a tenant selector. One business with two branches remains one tenant with two locations unless customer bases, billing, settings, accounting, or product availability need to diverge.

## Capability Contract

Add a tenant-first capability response:

```json
{
  "tenant": {
    "id": "uuid",
    "slug": "kalalacafe",
    "name": "Kalala",
    "timezone": "America/Mazatlan"
  },
  "selectedLocation": {
    "id": "uuid",
    "slug": "chapultepec",
    "name": "Chapultepec"
  },
  "locations": [
    { "id": "uuid", "slug": "chapultepec", "name": "Chapultepec", "status": "active" },
    { "id": "uuid", "slug": "second-branch", "name": "Second Branch", "status": "active" }
  ],
  "membership": {
    "id": "uuid",
    "role": "super_admin",
    "permissions": ["*"]
  },
  "products": {
    "dashboard": { "status": "active" },
    "conversaflow": { "status": "active" },
    "kds": { "status": "active", "locationScoped": true },
    "cash": { "status": "missing" },
    "observability": { "status": "missing" }
  },
  "modules": {
    "overview": { "available": true },
    "conversations": { "available": true },
    "orders": { "available": true, "locationScoped": true },
    "devices": { "available": true, "locationScoped": true },
    "hours": { "available": true, "locationScoped": true },
    "settings": { "available": true },
    "wallet": { "available": false, "reason": "product_missing", "product": "cash" },
    "members": { "available": false, "reason": "product_missing", "product": "cash" },
    "giftCards": { "available": false, "reason": "product_missing", "product": "cash" }
  }
}
```

The capability contract must be generated server-side. The frontend can cache it, but it must not invent access or product availability.

## Module Registry

Create one dashboard module registry, then use it everywhere:

```ts
const MODULES = {
  overview: { product: "dashboard" },
  conversations: { product: "conversaflow" },
  orders: { product: "kds", locationScoped: true },
  devices: { product: "kds", locationScoped: true },
  hours: { product: "conversaflow", locationScoped: true },
  settings: { product: "dashboard" },
  productsBilling: { product: "dashboard", role: "super_admin" },
  wallet: { product: "cash" },
  members: { product: "cash" },
  giftCards: { product: "cash" }
}
```

Required helper functions:

- `isProductActive(productKey, capabilities)`
- `canShowModule(moduleKey, capabilities)`
- `canNavigateToModule(moduleKey, capabilities)`
- `canCallProductApi(productKey, capabilities)`
- `requireTenantAccess(req, tenantId)`
- `requireProduct(req, tenantId, productKey)`
- `requireLocationAccess(req, tenantId, locationId)`

## API Plan

Add tenant-first routes:

```txt
GET /api/me/tenants
GET /api/tenants/:tenantId/capabilities
GET /api/tenants/:tenantId/settings
PATCH /api/tenants/:tenantId/settings
GET /api/tenants/:tenantId/locations
PATCH /api/tenants/:tenantId/locations/:locationId
GET /api/tenants/:tenantId/conversaflow/conversations
GET /api/tenants/:tenantId/conversaflow/hours?locationId=...
PATCH /api/tenants/:tenantId/conversaflow/hours?locationId=...
GET /api/tenants/:tenantId/kds/orders?locationId=...
POST /api/tenants/:tenantId/kds/orders/:ticketId/transition
GET /api/tenants/:tenantId/kds/devices?locationId=...
POST /api/tenants/:tenantId/kds/devices/provision
PATCH /api/tenants/:tenantId/kds/devices/:deviceId
```

Keep existing slug routes temporarily:

```txt
/api/:slug/...
```

but implement them as compatibility wrappers that resolve `slug -> tenant_id` and then call the tenant-first handlers.

## Data Model Adjustments

### Required now

Add `super_admin` without expanding the full permission model yet:

- create a global or tenant role key `super_admin`
- assign it to the initial owner membership
- treat `super_admin` as all action permissions for that tenant
- still enforce product availability separately from role

Correct Kalala product instances:

```txt
dashboard     active
conversaflow  active
kds           active
cash          missing
observability missing, unless current logs support is intentionally exposed
```

Represent the two Kalala branches as `platform.locations`. If KDS is only active in one branch at first, use location-scoped `platform.product_instances` for `kds`; otherwise keep `kds` active at tenant scope and filter operational data by selected location where available.

### Later

Add billing tables only when subscription activation is wired:

- `platform.billing_customers`
- `platform.subscriptions`
- `platform.subscription_items`
- `platform.active_entitlements`

Those tables should mirror Stripe state, not replace Stripe. Product access remains materialized into `platform.product_instances` for fast checks.

## Frontend Plan

### App shell

Add a `TenantProvider` that owns:

- accessible tenants
- selected tenant id
- selected location id
- capabilities
- module availability

Storage:

- store selected tenant/location in local storage only as preference
- revalidate against `/api/me/tenants` and `/api/tenants/:tenantId/capabilities` on load
- if the stored tenant is no longer accessible, fall back to the first accessible tenant

### Tenant selector

For one tenant:

- show Kalala as current business in the topbar/sidebar
- no bulky tenant switcher needed

For multiple tenants later:

- add a compact tenant switcher in the sidebar footer or topbar
- switching tenant clears selected location if it is not part of the new tenant

### Branch selector

Add a branch selector only where branch context changes data:

- KDS Orders
- KDS Devices
- Hours/Availability
- location-scoped operational views

Do not make branch selection global unless most screens become branch-scoped. Global branch state can silently filter unrelated screens and confuse owners.

### Settings

Split Settings into composed panels:

```txt
Settings
  Business
    Profile
    Brand identity
    Locations / branches
  Operations
    Hours & availability
    KDS stations/devices
  ConversaFlow
    WhatsApp availability
    Conversation behavior
  Products & Billing
    Active: ConversaFlow
    Active: KDS
    Not active: Umi Cash
```

Move all wallet/pass/reward/gift-card settings into a `CashSettingsPanel`.

Mount `CashSettingsPanel` only when `products.cash.status` is `active` or `trialing`. If Cash is missing, show only a compact Products & Billing card.

### Navigation

The sidebar should be generated from the module registry and capabilities.

For Kalala now:

- show Overview if it only uses active products or gracefully excludes Cash metrics
- show Orders
- show Devices
- show Staff if current implementation is still operationally needed
- show Conversations
- show Hours
- show Settings
- hide Members
- hide Gift Cards
- hide wallet personalization entrypoints

## Backend Enforcement Plan

Every tenant-first handler must:

1. resolve authenticated `platform.user`
2. verify active membership in `platform.tenant_memberships`
3. verify requested `location_id` belongs to tenant when provided
4. verify active product instance for the route's product
5. run the existing data query with `tenant_id`, and `location_id` when scoped

Do not rely on frontend hiding to protect inactive products.

Cash routes must return `404` or `403` for Kalala while `cash` is missing. Prefer:

- `403 product_not_active` when tenant exists and user has access
- `404 tenant_not_found` only when tenant cannot be resolved or is inaccessible

## Iteration Loop

Use a small loop for every phase:

1. Route: confirm owner and runtime path.
2. Read: inspect current code and data contract.
3. Shape: write or adjust the contract.
4. Implement: make the smallest working slice.
5. Verify: run build/tests and manual flow.
6. Log: update checklist and any routing notes.
7. Repeat: move to the next module only after the previous slice works.

This keeps the migration from turning into a broad rewrite.

## Implementation Phases

### Phase 0 - Contract and seed correction

Files:

- `docs/migration/local-postgres/010_seed_product_matrix.sql`
- `docs/migration/local-postgres/030_platform_identity_backfill.sql`
- `docs/migration/validation/001_core_validation.sql`

Work:

- add or map `super_admin`
- correct Kalala product matrix to `cash = missing`
- verify Kalala has two `platform.locations`
- add validation query for active product matrix by tenant
- add validation query that no inactive product route is reported available

Done when:

- local validation shows Kalala has one tenant, two locations, active ConversaFlow/KDS, missing Cash

### Phase 1 - Tenant session and capability APIs

Files:

- `apps/umi-dashboard/server.js`
- new server helpers under `apps/umi-dashboard/server/` if the file needs to be split

Work:

- add `GET /api/me/tenants`
- add `GET /api/tenants/:tenantId/capabilities`
- centralize `getCurrentUser`, `requireTenantAccess`, `requireProduct`, and `requireLocationAccess`
- make local auth and Supabase auth return the same session shape

Done when:

- login returns accessible tenants
- capabilities return tenant, locations, membership, products, and module availability
- inaccessible tenant requests fail

### Phase 2 - Dashboard state providers

Files:

- `apps/umi-dashboard/src/lib/auth.jsx`
- new `apps/umi-dashboard/src/lib/tenant-context.jsx`
- `apps/umi-dashboard/src/app.jsx`
- `apps/umi-dashboard/src/shell.jsx`

Work:

- add `TenantProvider`
- remove `VITE_BUSINESS_SLUG` as the app's runtime tenant selector
- add selected tenant/location state
- fetch capabilities after login
- generate nav from module registry and capabilities

Done when:

- dashboard loads from session tenant state
- Kalala sees only active modules
- URL navigation to inactive Cash modules lands in a product-unavailable state

### Phase 3 - Tenant-first data client

Files:

- `apps/umi-dashboard/src/data.jsx`
- `apps/umi-dashboard/server.js`

Work:

- replace `_SLUG` fetch paths with selected `tenantId`
- add location-aware query params for KDS/hours where needed
- keep slug routes as wrappers only
- ensure all product data hooks check module availability before fetching

Done when:

- no active dashboard path requires `VITE_BUSINESS_SLUG`
- no inactive Cash request is made for Kalala

### Phase 4 - Settings decomposition

Files:

- `apps/umi-dashboard/src/screens/settings.jsx`
- new settings panel components under `apps/umi-dashboard/src/screens/settings/`

Work:

- split tenant profile, branch settings, ConversaFlow settings, KDS settings, and Products & Billing
- move Cash wallet/pass/reward controls behind `products.cash.status`
- turn inactive Cash into a Products & Billing card only

Done when:

- Kalala Settings has no editable wallet/pass/reward controls
- active product settings remain discoverable

### Phase 5 - Branch-scoped operational views

Files:

- `apps/umi-dashboard/src/screens/orders.jsx`
- `apps/umi-dashboard/src/screens/devices.jsx`
- `apps/umi-dashboard/src/screens/hours.jsx`
- relevant dashboard API handlers

Work:

- add branch selector to branch-scoped screens
- pass `locationId` to KDS orders/devices/hours APIs
- make "All branches" explicit only where aggregate views are supported

Done when:

- switching branch changes KDS/hours data without changing tenant
- branch selection does not affect non-branch-scoped screens

### Phase 6 - Products & Billing upgrade path

Files:

- new Products & Billing screen or settings panel
- future billing handlers

Work:

- show active products and inactive products
- use Stripe Checkout for first activation later
- use Stripe Customer Portal for existing subscription management later
- use webhooks to update internal entitlement mirrors and `platform.product_instances`

Done when:

- super admin can see Cash as not active
- non-active products do not expose operational controls

## Verification Gates

Data:

- Kalala has one tenant and two locations.
- Kalala has active `dashboard`, `conversaflow`, and `kds`.
- Kalala has missing `cash`.
- RLS returns rows only for accessible tenants.
- No user context returns zero tenant rows.

API:

- `GET /api/me/tenants` returns Kalala for the super admin.
- `GET /api/tenants/:tenantId/capabilities` returns inactive Cash modules.
- `GET /api/tenants/:tenantId/cash/...` fails while Cash is missing.
- KDS and ConversaFlow routes succeed for Kalala.
- Location-scoped routes reject a location outside the tenant.

UI:

- Kalala does not show Members/Gift Cards/Wallet in daily nav.
- Settings does not show editable Cash wallet controls.
- Products & Billing shows Cash as not active.
- Branch selector appears on KDS/hours surfaces only.
- Deep links to inactive modules do not crash.

Build:

- `npm run build` passes in `apps/umi-dashboard`.
- Local dashboard runs with `npm run dev:local`.

## Implementation Checkpoint - 2026-05-17

Implemented:

- platform seeds/backfill now model Kalala as one tenant with two active locations
- Kalala product contract is `dashboard`, `conversaflow`, and `kds` active; `cash` and `observability` missing
- local owner is a Kalala `super_admin`; `super_admin` keeps all action permissions but still cannot bypass missing product entitlements
- Dashboard API now exposes tenant-first `me`, capabilities, settings, locations, KDS, ConversaFlow, staff, and Cash wrapper routes
- legacy Cash slug routes reject inactive/missing Cash in the platform transition profile
- dashboard runtime state now selects tenant/location from authenticated context instead of `VITE_BUSINESS_SLUG`
- nav, route guards, data hooks, Settings, and Products & Billing use the shared module/product registry

Critical review fixes applied:

- changed stale Kalala Cash/Observability rows in the current local database from active to missing
- added the missing Kalala local-owner membership and `super_admin` membership role
- added a server-side guard for direct legacy Cash routes, not just tenant-first routes
- removed the misleading editable subscription selector from Settings
- made Products & Billing responsive across narrow viewports
- made CORS follow `VITE_DEV_PORT` so the local dashboard can call the API on `4010 -> 4011`

Verified:

- `npm run build` passes in `apps/umi-dashboard`
- `node --check server.js` passes in `apps/umi-dashboard`
- `docs/migration/validation/001_core_validation.sql` returns zero Kalala product-contract violations
- `GET /api/me/tenants` returns Cash-only, full-stack, and Kalala for the local owner
- `GET /api/tenants/:tenantId/capabilities` returns Cash modules unavailable for Kalala
- tenant-first and legacy Kalala Cash stats routes return `403 product_not_active`
- Cash-only and full-stack tenant capability responses expose the expected modules
- `npm run dev:local` serves the dashboard at `http://localhost:4010/`

Remaining outside this checkpoint:

- staff action restrictions beyond the temporary `super_admin` path
- developer/tech assist support-only access behavior
- production billing activation handlers and Stripe webhook entitlement updates

## Invalidation Criteria

Revisit this plan if:

- Kalala needs separate billing or separate customer bases per branch.
- Cash becomes active for Kalala before tenant-first dashboard APIs are complete.
- Multiple businesses under one owner require consolidated reporting or billing.
- Branch-specific product activation becomes common enough that tenant-level product instances are insufficient.
- A dedicated internal Umi ops console becomes necessary for support users.
