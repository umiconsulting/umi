# Dashboard Connectivity Audit
**Date:** 2026-05-13  
**Author:** Claude Code

---

## 1. Database State

### Current schema layout (single Supabase project `xbudknbimkgjjgohnjgp`)

| Schema | Tables | Status |
|--------|--------|--------|
| `umi_cash` | Tenant, User, LoyaltyCard, Visit, Transaction, RewardConfig, RewardRedemption, BirthdayReward, GiftCard, Session, GiftCardRedemption | ✅ Live, dashboard reads here |
| `kds` | tickets, ticket_items, ticket_events, device_sessions | ✅ Live, 49 tickets |
| `conversaflow` | businesses, conversations, transactions, products, jobs, outbox, messages, memory, prompts | ✅ Live |
| `platform` | (empty) | ⚠️ Reserved, not used |

### On the "copy umi_cash → platform" question
**This was NOT done.** The dashboard currently reads `umi_cash` schema directly via Prisma in the Express API. The platform schema is empty. Recommendation: **leave it** — there is no benefit to copying; it would create a sync problem. The single source of truth is `umi_cash`. ✅ Already correct.

---

## 2. Repo Map

### `umi-kds` — iOS SwiftUI iPad app
- **Not a web API** — native Swift, no REST routes to call from dashboard
- Reads from Supabase via 2 PostgREST RPCs:
  - `kds.get_board_snapshot(p_business_id, p_station_id)` — snapshot + items JSONB
  - `kds.get_ticket_events(p_business_id, p_after_sequence, p_limit)` — sequenced event log
- All mutations go through `kds-command` **Supabase edge function** (not a Next.js route)
  - `action: transition_ticket` — advance/cancel lifecycle
  - `action: partial_cancel_items` — cancel individual line items
- Device auth: anon JWT (project-level, no per-device token currently required by app)
- Device provisioning: `kds.provision_device_token(business_id, device_name, station_id)` — **service_role only**, returns one-time plaintext token

### `umi-cash` — Next.js loyalty app (Vercel)
Admin API routes available at `/api/[slug]/admin/`:

| Route | Dashboard uses it? |
|-------|--------------------|
| `settings` GET/PATCH | ✅ Yes |
| `stats` GET | ✅ Yes |
| `analytics` GET | ✅ Yes |
| `customers` GET | ✅ Yes (Members screen) |
| `reward-config` GET/PATCH | ✅ Yes |
| `gift-cards` GET | ❌ No screen yet |
| `scan` POST | ❌ Not in dashboard |
| `topup` POST | ❌ Not in dashboard |
| `purchase` POST | ❌ Not in dashboard |
| `export` GET | ❌ Not in dashboard |
| **`staff`** | ⚠️ **Missing from umi-cash** — dashboard Express server implements it directly |

### `umi-conversaflow` — Supabase backend (edge functions + migrations)
- Owns the ConversaFlow/WhatsApp operational schema
- KDS is a **read projection** from `conversaflow.transactions` → `kds.tickets`
- `businesses.open_times` — JSON field dashboard already reads/writes via Express raw SQL
- No REST API for the dashboard to call directly — everything is Supabase RPC or edge functions

### `umi-logs` — Next.js trace viewer
- Separate read-only dashboard for ConversaFlow operational traces
- Not connected to umi-dashboard, no overlap needed

---

## 3. Dashboard Screen Status

### ✅ Working / Connected

| Screen | Data source | Notes |
|--------|-------------|-------|
| **Settings** | `umi_cash.Tenant` via Express | Full read/write |
| **Staff** | `conversaflow.staff_members` via Express | Operational roster now lives by business tenant in ConversaFlow. Existing Cash staff rows are compatibility/auth data only. |
| **Members** | `umi_cash.User + LoyaltyCard` via Express | Pagination, search, sort |
| **Customers** | `platform.contacts` via tenant API, legacy phone fallback when needed | Customer 360 list/profile with WhatsApp, orders, loyalty, notes, and identity/data tabs |
| **Hours** | `conversaflow.businesses.open_times` via Express raw SQL | Read/write, real KalalaCAFÉ hours |
| **Overview** — loyalty KPIs | `umi_cash` analytics via Express | Real data |

### ⚠️ Partially Working

| Screen | Issue |
|--------|-------|
| **Orders** | Express reads `kds.tickets` + `kds.ticket_items`; actions proxy to `kds-command` | Real list/detail/action flow. Requires `SUPABASE_SERVICE_ROLE_KEY` for status mutations. |
| **Devices** | Express reads/provisions/deactivates `kds.device_sessions` | Add Device now creates a one-time token server-side. |
| **Overview** — KDS panel | Express orders/devices/ticker routes | KDS counts and ticker now come from `kds` tables. Empty/error states render as empty. |

### ❌ Missing Screens / Features

| Missing | What's needed |
|---------|--------------|
| **Realtime subscription** | Current ticker is real server-polled `kds.ticket_events`, not a browser Realtime subscription. Browser realtime can still be added later if needed. |
| **Gift Cards screen** | Added screen and Express read route backed by `umi_cash.GiftCard`. |
| **Ticket detail** | Added slide-out detail from `kds.ticket_items`. |
| **Device provisioning** | Added Express provisioning route that creates `kds.device_sessions` and returns one-time token. |
| **Order status actions** | Added Express proxy to `kds-command` edge function. |
| **Conversations screen** | Retired as primary navigation; legacy route redirects into Customers WhatsApp filter. |

### 2026-05-26 customer platform update

- Primary navigation now uses `Customers`; legacy `/conversations/*` redirects to `/customers?filter=whatsapp`.
- Legacy `/insights` redirects to `Customers`; customer signal counts remain inside the Customers screen.
- Tenant-first customer routes are implemented:
  - `GET /api/tenants/:tenantId/customers`
  - `GET /api/tenants/:tenantId/customers/:contactId`
  - `GET /api/tenants/:tenantId/customers/:contactId/timeline`
  - `GET /api/tenants/:tenantId/customers/:contactId/conversations`
  - `GET /api/tenants/:tenantId/customers/:contactId/orders`
  - `GET /api/tenants/:tenantId/customers/:contactId/cash`
  - `GET /api/tenants/:tenantId/customers/:contactId/identity`
  - `GET /api/tenants/:tenantId/insights/customer-platform`
- Owner Dashboard does not expose raw traces, tool-call payloads, embedding vectors, or service-role diagnostics.

---

## 4. Required Backend Work

### A. Dashboard tenant linking
Apply the ConversaFlow migration:
```sql
apps/umi-conversaflow/supabase/migrations/20260513190000_dashboard_staff_and_external_refs.sql
```
This creates `conversaflow.business_external_refs` and `conversaflow.staff_members`, then backfills known Cash staff into the new operational roster.

### B. Device provisioning via Express
Implemented in `server.js`:
```
POST /api/:slug/admin/devices/provision
  → creates kds.device_sessions server-side
  → returns { device_id, token } once

PATCH /api/:slug/admin/devices/:device_id  
  → deactivate (set is_active = false)
```
No browser anon grants are needed for device management.

### C. Order mutations via Express
Implemented as an Express proxy to `kds-command`:
```
POST /api/:slug/orders/:ticket_id/transition
  → { action: "transition_ticket", ticket_id, target_status }
  → proxies to kds-command edge function
```
Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in server `.env`.

### D. Staff source of truth
Staff is no longer a Cash-owned dashboard surface. The dashboard reads/writes `conversaflow.staff_members`, linked to Cash tenants through `conversaflow.business_external_refs`. Cash `User` rows with `STAFF`/`ADMIN` remain only for existing Cash auth and historical loyalty audit compatibility.

---

## 5. Priority Order

| Priority | Task |
|----------|------|
| 🔴 **P0** | Apply `20260513190000_dashboard_staff_and_external_refs.sql` to create tenant links and staff source of truth |
| 🔴 **P0** | Add `SUPABASE_SERVICE_ROLE_KEY` to dashboard server `.env` for KDS mutations |
| 🟠 **P1** | Verify `conversaflow.business_external_refs` contains every dashboard slug before adding more tenants |
| 🟡 **P2** | Replace server-polled ticker with Supabase Realtime if latency or event volume requires it |
| 🟢 **P3** | Migrate Cash admin auth/audit references away from `umi_cash.User` staff when a unified auth model is ready |
