# KDS Device-Scope Authorization & Order Location Resolution — 2026-07-01

Scope:

- backend owner: `apps/umi-api` (`src/modules/kds/*`)
- client owner: `apps/umi-kds` (frozen iPad contract)
- write producer: `apps/umi-conversaflow` (WhatsApp turn engine → `ops.orders`)
- runtime schemas: canonical `ops.*` (orders, order_events, `v_kds_tickets`), `device.*`, `kitchen.*`

Evidence base:

- code read of `kds.service.ts`, `kds.repository.ts`, `dto/kds-contract.ts`, `kds-dashboard.controller.ts` at HEAD
- direct live queries against the platform Supabase project `xbudknbimkgjjgohnjgp` (Management API)
- reproduced from a real report: an operator could not cancel a 3,410-minute-old WhatsApp order on the iPad; the request failed silently (no error on the delete, on the KDS UI, or in Xcode)

## Executive summary

A location-bound KDS iPad could see a WhatsApp order on the board but could not cancel (or otherwise transition) it. The command returned `404 ticket_not_found`, which the iPad swallows, so the operator saw a silent no-op.

The defect is **not** the one missing conditional that produced the 404. It is that **"what a device may see" and "what a device may act on" are encoded twice** — once as a SQL `WHERE` clause in the board read, once as a hand-written boolean in the command guard — and the two encodings drifted. The null-escape mismatch is only the first drift to surface; the structure guarantees more.

A stop-the-bleeding fix has shipped. The durable fix is to **collapse the two encodings into one scope predicate** (make divergence unrepresentable) and to **make the residual loud** (a user-initiated mutation must never fail silently). Separately, the upstream data condition that triggered it — WhatsApp orders landing with `location_id = null` — is a *legitimate* domain state for multi-location tenants and must be **handled**, not outlawed; it can be **reduced** with a tenant-aware location resolver.

## 1. Incident

- Order `09695aa6-0e37-4853-ad60-5c3d3a77f96f`, tenant `1860305f-…`, `kitchen_status = new`, `status = pending`, `location_id = null`, `station_id = null`, age ≈ 3,410 min, `source_transaction_id = conversaflow:turn:5768510b-…`, customer "Lucio Martinez" (`+5266722…6855`).
- Live iPad session `bc8b42f5-…`: `is_active = true`, `station_id = 026c0526-…`, `metadata.location_id = 7cb0a615-…` (i.e. **location-bound**).
- The order was on the board (status `new` is a board-active status; its null station passes the board filter). The cancel returned `404`.

## 2. Root cause

Two independent encodings of device scope:

**Board read** — `KdsRepository.boardSnapshot` (`kds.repository.ts`):

```sql
WHERE t.tenant_id = $1
  AND ($2::text IS NULL OR t.station_id IS NULL OR t.station_id = $2)  -- station, with NULL escape
  AND t.status = ANY($3::text[])
-- NOTE: no location_id filter at all
```

**Command guard** — `ticketBelongsToDevice` (`kds.service.ts`), gating both `transition_ticket` and `partial_cancel_items`:

```ts
const tenantMatches   = order.tenant_id === session.tenantId;
const locationMatches = !session.locationId || order.location_id === session.locationId; // NO null escape
const stationMatches  = !session.stationId || order.station_id === session.stationId || order.station_id == null;
return tenantMatches && locationMatches && stationMatches;
```

`session.locationId` is derived in `verifyDevice` from `device.sessions.metadata.location_id` (set at pairing from `pairing.location_id`).

For Lucio's order the guard evaluated:

```
locationMatches = !('7cb0a615…') || (null === '7cb0a615…') = false || false = false
```

→ guard returns `false` → `command` returns `{ status: 404, error: 'ticket_not_found' }`. The board never checks `location_id`, so it displayed the order regardless. Result: **visible but unactionable.** Note `stationMatches` already has the correct `|| order.station_id == null` broadcast escape; `locationMatches` was simply missing the symmetric one.

Because the guard gates *every* command action, a location-bound device could not accept / ready / complete / cancel / partial-cancel **any** null-location order — not just cancel.

### Why it was silent

The iPad treats a non-2xx command response as a no-op and surfaces nothing. A `404` on a user-initiated mutation therefore looks identical to success-then-nothing. Silent failure on a mutation is worse than a visible error.

### Why the dashboard was unaffected

`transitionFromDashboard` (`kds.service.ts`) loads the order by tenant only (`loadOrderForScope`) and does **not** call `ticketBelongsToDevice`. So the owner-authed dashboard path can cancel the same order today — this is the current manual unblock for stuck orders. (Caveat: the dashboard *orders list* uses a 24 h window, so a >24 h order may not be listed even though the transition endpoint accepts its id.)

## 3. Fix shipped (stop-the-bleeding)

`ticketBelongsToDevice` now mirrors the station broadcast semantics:

```ts
const locationMatches =
  !session.locationId ||
  order.location_id === session.locationId ||
  order.location_id == null;            // ← broadcast (null-location) orders, like null-station
```

Still tenant-scoped (no cross-tenant exposure); a *different, explicit* location on the order is still rejected. Regression test added in `kds.service.spec.ts` (`ticketBelongsToDevice lets a location-bound device act on a broadcast (null-location) order`) — the pre-existing test used a location-*unbound* session, which is why it never caught this. `43/43` KDS tests pass.

This is a patch, not the resolution. It closes the location dimension; it does not remove the ability to introduce a new divergence.

## 4. Decision — make the structural cause impossible; make the residual loud

"Impossible" and "loud" answer different questions — *can this invalid state be represented?* vs *if it happens anyway, do we find out?* — and are assigned per layer.

### 4.1 Impossible: one scope predicate (primary)

Delete the second encoding. Define device scope **once** and use it in both the board read and the command's order load, so "shown on the board" and "loadable to act on" are the same query by construction:

```sql
-- one shared fragment: order o is in device scope iff
tenant_id = :tenant
AND (:stationId  IS NULL OR station_id  IS NULL OR station_id  = :stationId)
AND (:locationId IS NULL OR location_id IS NULL OR location_id = :locationId)
```

- Apply the fragment inside `loadOrderForScope`; the command's existing `if (!order) → 404` path *becomes* the authorization. `ticketBelongsToDevice` is then deleted — there is no second predicate to keep in sync.
- Divergence is not tested-against; it is unrepresentable. A future scope dimension is added in one place.
- **Behavior change to flag:** `boardSnapshot` currently applies **no** location filter, so a location-bound device is presently *over-showing* (it sees every location's orders) while *under-acting*. Unifying fixes both directions: a location-bound device will see its own location's orders plus broadcasts. Confirm that is the intended board semantics before shipping.

### 4.2 Loud: the residual (backstop)

Even with one scope, mutations can legitimately fail (lost row-lock race, terminal-state transition, revoked device). Those cannot be designed away, so they must be impossible to miss:

1. **Client (iOS):** a KDS command response that is not `ok: true` must surface something. Silent swallow of a user-initiated mutation is itself a client-contract bug. (Owned by `apps/umi-kds`; tracked separately.)
2. **Server:** emit a `warn` + a counter when a device `command` hits `ticket_not_found` / `invalid_transition`. After §4.1 these should be rare, so each one is a signal (stale board, revoked device, real race) worth alerting on — not a silent 404.

Priority: §4.1 first. A loud-but-still-broken cancel is still a broken cancel; loudness is the backstop for what remains, not a substitute for eliminating the invalid state.

## 5. Upstream — order location resolution

`location_id = null` on a WhatsApp order is a **legitimate** domain state: a multi-location tenant cannot know the pickup branch from chat alone. It cannot be outlawed; it must be handled (as broadcast, per §4.1). It can be **reduced** by resolving location at order ingest.

Deciding fact (live query, active locations per tenant):

| tenant | active locations |
|---|---|
| `1860305f-…` (the stuck-order tenant) | **2** |
| `b1f5da3c-…` | 1 |
| `a13905a2-…` | 1 |

So exactly one live tenant is genuinely multi-location, and it is the one producing null-location orders. This makes the resolution policy **conditional** — "always ask the customer" would be pure friction for the two single-location tenants.

### 5.1 Resolver shape (one function, config-driven)

The function is a *location resolver*, not a "prompt for branch". It decides whether asking is even necessary:

```
resolveOrderLocation(tenantId, conversationState):
  active = activeLocations(tenantId)
  if active.length == 0 → refuse (tenant cannot take orders)
  if active.length == 1 → return active[0].id                     // auto-stamp; never ask
  else:                                                           // multi-location
     if tenant.config.whatsappDefaultLocation → return that       // owner pins a branch; no friction
     else → NEEDS_SELECTION with a numbered candidate list
```

Design constraints:

- **Reuse, don't fork.** The "oldest-active location" default already exists from the hours-unification work, and `ops.businesses.config` already holds per-tenant settings. Extend that; do not build a parallel resolver. Hours are per-location, so hours resolution must consume the same resolver.
- **The "number by tenant" is a display/selection affordance only.** Generate it at prompt time from the ordered active-locations list ("1 = Centro, 2 = Chapultepec"); the value written to `ops.orders.location_id` is always the **UUID**. Do not persist the number as identity or add a FK on it. If stable human codes are wanted, add an optional `core.locations.display_code` — identity stays the UUID.
- **The resolver reduces incidence; it does not replace §4.** Historical orders (Lucio's included) stay null-location, and a customer who abandons mid-selection still yields null. The null-safe broadcast guard (§4.1) handles the residual.

### 5.2 Recommendation (YAGNI on the picker)

Do **not** build the conversational branch-picker yet. Cover all three live tenants today with zero customer friction:

- single-location → auto-stamp the sole active location;
- multi-location → owner sets `whatsappDefaultLocation` in tenant config → auto-stamp that;
- build the customer-facing numbered picker only when a tenant genuinely fulfills WhatsApp orders at multiple branches and wants the customer to choose (a real turn-engine feature: when to ask, closed/invalid branch handling, KDS routing).

Open product question (not answerable from the DB): does `1860305f-…` actually fulfill WhatsApp orders at both branches, or one? That decides picker-vs-config-default.

## 6. Sequencing

1. **Done** — null-safe broadcast guard + regression test (`kds.service.ts`, `kds.service.spec.ts`). Needs a VPS deploy of `umi-api` to reach the iPad.
2. **Next** — collapse duplicated device-scope into one shared SQL predicate; delete `ticketBelongsToDevice` (§4.1). Add server-side `warn` + metric on device-command `ticket_not_found` / `invalid_transition` (§4.2).
3. **Next** — `resolveOrderLocation` + config default; stamp `location_id` at conversaflow order ingest (§5). Kills null-location for all three tenants today.
4. **Later, if needed** — customer-facing numbered branch picker for a genuinely multi-branch-fulfilling tenant.
5. **Cross-repo** — iPad surfaces non-2xx command responses (`apps/umi-kds`).

## 7. Immediate operational unblock

Until item 6.1 is deployed, stuck null-location orders can be cancelled through the dashboard transition endpoint, which has no location guard:

```
POST /api/tenants/{tenantId}/kds/orders/{ticketId}/transition
body: { "target_status": "cancelled" }
```

e.g. tenant `1860305f-…`, ticket `09695aa6-…`. This goes through the proper write path (`transitionTicket`: locked re-check, `order_events` append, sequence, `ops.orders.status` sync).
