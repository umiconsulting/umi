# Phase 3c — Agent Tools: Order-Write Binding Preflight

**Date:** 2026-06-26
**Status:** **RESOLVED (2026-06-26).** Full order-write contract pinned: schema/constraints/triggers/idempotency via the local prod-schema replica (`umiapi_pg`/db `umi`), and the variant price unit via one read-only live-prod sample. A1-A3 confirmed, A4 deferred to Phase 4 (KDS). See RESULTS for the exact `ops.orders`/`ops.order_items`/`ops.order_events`/`ops.products` write contract + the centavos/pesos rule + the KDS deploy-sequencing flag. **Cleared to port 3c.**

---

## RESULTS — replica introspection (2026-06-26, db `umi` on `umiapi_pg`)

**A1 direct write — CONFIRMED viable.** `ops.orders` is a rich denormalized order+ticket table that carries everything the bot needs.
**A2 KDS via kitchen_status — CONFIRMED.** `ops.v_kds_tickets` = `SELECT … FROM ops.orders o LEFT JOIN ops.order_items oi … WHERE o.kitchen_status IS NOT NULL GROUP BY o.id` (ticket_id = order id; items aggregated from `order_items`). Set `ops.orders.kitchen_status='new'` (+ items) → the order surfaces as a fresh ticket. **No trigger, no ticket table.**
**A3 idempotency — CONFIRMED.** `CREATE UNIQUE INDEX ops_orders_source_transaction_uidx ON ops.orders (tenant_id, source_transaction_id) WHERE source_transaction_id IS NOT NULL`. Use `source_transaction_id = 'conversaflow:turn:<turn_id>'` → ON CONFLICT DO NOTHING dedups a retried turn.
**A4 partial-cancel — DEFER to Phase 4** (KDS-owned; `confirm_order_changes` + partial `cancel_order` + `getActivePartialCancelledOrder` read `kds.*`).

**No triggers** on `ops.orders` / `ops.order_items` → the bot sets `kitchen_status` + (optionally) writes `ops.order_events` explicitly; nothing is auto-derived.

**`ops.orders` write contract (NN w/o default ⇒ must supply):** `tenant_id` (NN). Defaulted: `id`, `source`('whatsapp'), `status`('pending'), `total_cents`(0; CHECK ≥0), `details`('{}'), `metadata`('{}'), `created_at`/`updated_at`. Nullable/optional we set: `person_id`, `location_id`, `channel`('whatsapp'), `kitchen_status`('new'; CHECK `new|accepted|preparing|ready|completed|cancelled|partial_cancelled`), `pickup_person`, `notes`(customer_note), `source_transaction_id`(idempotency), `placed_at`(now). `source` CHECK = `whatsapp|pos|kiosk|dashboard|sms|web`. Legacy `details.{items,customer_note,pickup_person,personal_message}` → store snapshot in `details` jsonb (column exists) + structured rows in `order_items`.

**`ops.order_items` write contract:** `tenant_id`(NN), `order_id`(NN), `name`(NN) supply; `quantity`(NN def 1, ≥0), `unit_price_cents`(NN def 0, ≥0), `display_order`(NN def 0), `is_cancelled`(def false), `metadata`('{}'). Optional: `product_id`, `variant_name`, `notes`, `kitchen_status`('new'). **Money = centavos.**

**`ops.order_events` (optional create event):** `tenant_id`(NN), `order_id`(NN), `event_kind`, `old_status`, `new_status`, `kitchen_sequence`, `source`, `idempotency_key`, `payload`('{}'), `metadata`('{}'), `occurred_at`. KDS board deltas (Phase 4) poll this; a `created`/`order_upserted` event on confirm is nice-to-have, not required for the `v_kds_tickets` snapshot.

**`ops.products` read contract:** `id, tenant_id(NN), category_id, name(NN), description, price_cents(NN, CENTAVOS), is_available(NN), variants jsonb(NN), name_embedding vector, embedding_model, synced_at, metadata, …`. `ops.product_categories` present (join for category name). Cosine on `name_embedding` + ILIKE waterfall.

**[RESOLVED] variants price unit (live prod sample, 2026-06-26).** Product `price_cents` = CENTAVOS, but `variants[].price` inside the jsonb = PESOS (decimal). E.g. Coca cola price_cents=2800 / variant price 28.0; Vianelo 11000 / 110.0. Element shape = `{ sku: string|null|"", name: string, price: number(pesos) }` -- `name` is the free-form Zettle label (may have trailing whitespace, trim it). Port rule: order/cart unit_price_cents = variant item -> round(variant.price*100); non-variant item -> price_cents directly. Data is Zettle-POS-native; cross-POS normalization is future work.

**⚠️ CROSS-PHASE FLAG — KDS consumption (CONFIRMED unresolved, owner 2026-06-26).** KDS is **not yet on the canonical structure** (`v_kds_tickets`/`ops.orders`) — that's Phase 4. 3c writing `ops.orders` + `kitchen_status='new'` is the correct canonical target and is forward-correct (KDS will surface these via `v_kds_tickets` once ported, no bot change). **Implication is purely deploy-sequencing, not code:** the Phase 3 WhatsApp cutover (Twilio webhook → new bot) MUST land **before/with Phase 4 (KDS)**, never after — otherwise confirmed WhatsApp orders write to `ops.orders` but don't appear on the (still-legacy) kitchen display. Does NOT block writing the 3c port.

**Product/variant data is Zettle-POS-native (owner 2026-06-26).** `ops.products` (incl. `variants` jsonb + the size/temp/milk-encoded variant names) is synced from Zettle and **not yet normalized across POS vendors** — so the port handles the Zettle-native `{sku,name,price}` element shape + encoded variant-name tokens as-is (the tools' existing token parsing already does this). Cross-POS normalization is future work. The one open item is the in-jsonb price unit (pesos vs centavos) — confirming via one live sample.

---

### (original open checklist — now answered above except the variants unit)
**Status (original):** OPEN — blocks the checkout/order-write tools (`confirm_order`, `reorder_last_order`, `cancel_order`). The read/cart tools (`search_menu`, `add_to_cart`, `edit_cart`, `get_business_info`, `get_business_hours`, `get_recent_customer_orders`) are unblocked (bind to confirmed `ops.products` + `comms.conversations.draft_cart` + `ops.orders` reads).
**Why this exists:** the source `tools.ts` checkout path is built on three objects that **do not exist in the canonical schema** — a `transactions` table, a `transactions → kds.tickets` AFTER-INSERT projection trigger, and the `kds.confirm_partial_cancellation` RPC. Porting order/money writes onto canonical is an architectural rebind, not a column rename, and must be pinned against the live prod-schema replica before any money code is written.

---

## 0. The legacy order-write path (what we're replacing)

`whatsapp-handler/tools.ts`:
- `createTransactionFromItems()` → `INSERT INTO transactions (transaction_type='order', details jsonb {items, customer_note, pickup_person, personal_message}, total_amount, status='pending')`. **Money in PESOS** (`total_amount` decimal; `product.price` decimal).
- `confirmOrder()` → creates the transaction, then **verifies a `kds.tickets` row exists** for `source_transaction_id` (a synchronous AFTER-INSERT trigger projected it), then clears the draft cart.
- `getRecentCustomerOrders()` / `getLastReusableOrder()` / `reorderLastOrder()` → read `transactions` where `transaction_type='order'`; reconstruct cart items from `details.items`.
- `cancelOrder()` → `UPDATE transactions SET status='cancelled'` on the latest `pending` order (+ a partial-cancellation branch that reads `kds.tickets`).
- `confirmOrderChanges()` → `kds.confirm_partial_cancellation` RPC.
- **Bug to fix on port:** `createTransactionFromItems` uses `crypto.randomUUID()` each call → no idempotency. A retried `turn.process` (BullMQ) would create duplicate orders.

Canonical (confirmed live, preflight 2026-06-25 §3): orders live in **`ops.orders` + `ops.order_items` + `ops.order_events`**; KDS reads **`ops.order_items.kitchen_status` via the `ops.v_kds_tickets` view** (Phase 4). There is **no `transactions` table** (it was migrated → `ops.orders` by `041_commerce_order_backfill`).

---

## 1. Architectural decisions the owner must make

| # | Decision | Recommendation |
|---|---|---|
| A1 | **Where does a confirmed WhatsApp order land?** (a) bot writes `ops.orders` + `ops.order_items` directly on the worker pool; (b) bot writes a `queue.outbox_events` `order.submitted` and a consumer creates the order. | **(a) direct write.** Orders are the `ops` domain; the dashboard already reads `ops.orders`, and KDS reads `ops.order_items` via `v_kds_tickets`. The customer-notify side effect already flows through the turn-reply outbox. A single direct `ops` write (worker pool, BYPASSRLS) is simplest (KISS) and matches how cash writes `loyalty.*` directly. Confirm no architectural objection. |
| A2 | **How does the order reach KDS?** Legacy relied on a `transactions→kds.tickets` trigger. Canonical KDS reads `v_kds_tickets` over `ops.order_items.kitchen_status`. | The bot inserts `ops.order_items` **with `kitchen_status` set to the "new ticket" value** → it appears in `v_kds_tickets` automatically (no trigger, no ticket table). **Confirm the kitchen_status value that = a fresh ticket** (see Q2). Drop the legacy post-insert "verify kds ticket" check (replace with "verify order_items inserted"). |
| A3 | **Idempotency key** for confirm/reorder (the bug fix). | Use `source_transaction_id = 'conversaflow:turn:<turn_id>'` (the turn is the natural idempotency unit) **and** a `UNIQUE(tenant_id, source, source_transaction_id)` guard (or `queue.idempotency_keys` claim) so a retried turn can't double-create. Confirm the unique constraint exists (Q1). |
| A4 | **Partial-cancellation** (`confirm_order_changes`, the partial branch of `cancel_order`, `getActivePartialCancelledOrder`). | **DEFER to Phase 4 (KDS).** These depend on `kds.tickets` + `kds.confirm_partial_cancellation` (KDS-owned). In 3c, `confirm_order_changes` returns a safe "no pending changes" terminal error and `cancel_order` handles only the plain `pending`-order path. |

---

## 2. Introspection checklist (run against the prod-schema replica, read-only)

Run these and paste results back; the checkout port binds to whatever they return.

**Q1 — `ops.orders` write contract**
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='ops' AND table_name='orders' ORDER BY ordinal_position;
-- status enum:
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid='ops.orders'::regclass AND contype='c';
-- uniqueness for idempotency:
SELECT indexdef FROM pg_indexes WHERE schemaname='ops' AND tablename='orders';
```
Confirm: NOT-NULL columns w/o defaults (must be supplied on INSERT); `status` allowed values + the value for a fresh WhatsApp order (`'pending'`?); is `location_id` required (→ resolve via the channel account / `resolveLocationIdWorker`)? `channel`/`source` allowed values (`'whatsapp'`/`'conversaflow'`?); is `total_cents` or `subtotal_cents`+`total_cents`; is there `UNIQUE(tenant_id, source, source_transaction_id)`?

**Q2 — `ops.order_items` write contract + kitchen_status**
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='ops' AND table_name='order_items' ORDER BY ordinal_position;
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid='ops.order_items'::regclass AND contype='c';
```
Confirm: line columns (`order_id`, `tenant_id?`, `product_id`, product name column, `variant_name?`, `quantity`, unit price column + unit, line total column, `display_order?`, `metadata?`); **`kitchen_status` allowed values + the "new ticket" value**; any NOT-NULLs.

**Q3 — `ops.v_kds_tickets` projection (sanity, Phase 4 owns it)**
```sql
SELECT pg_get_viewdef('ops.v_kds_tickets'::regclass, true);
```
Confirm it derives tickets from `ops.order_items.kitchen_status` (so inserting items with the right status surfaces a ticket) and which `kitchen_status` values it treats as active.

**Q4 — `ops.order_events` (append-only) + any order triggers**
```sql
SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_schema='ops' AND table_name='order_events' ORDER BY ordinal_position;
SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
WHERE tgrelid IN ('ops.orders'::regclass,'ops.order_items'::regclass) AND NOT tgisinternal;
```
Confirm: is an `order_events` row expected on create (and its `event_type`)? Is there any trigger that auto-sets `kitchen_status`/creates events (so the bot must NOT)? Append-only guard `ops.block_order_event_mutation` confirmed (events insert-only).

**Q5 — `ops.products` read shape (also affects `add_to_cart` pricing)**
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='ops' AND table_name='products' ORDER BY ordinal_position;
SELECT variants FROM ops.products WHERE variants IS NOT NULL AND jsonb_array_length(variants) > 0 LIMIT 3;
```
Confirm: **`variants` jsonb element shape** (legacy is `{sku, name, price}` in PESOS — canonical keys + price unit?) and that `price_cents` is **centavos**. This pins the unit conversion for cart `unit_price` and order line prices.

**Q6 — money unit end-to-end**
Confirm the unit stored in `comms.conversations.draft_cart.items[].unit_price` going forward (recommend **centavos**, consistent with `loyalty.*`/dashboard) and therefore `ops.orders.total_cents` = `sum(quantity * unit_price_centavos)`. The legacy used pesos throughout — the port must convert at the `ops.products.price_cents` boundary.

---

## 3. What unblocks immediately (no order-write binding needed)

These bind only to confirmed objects and can be ported now (the bot can browse the menu + build/edit a draft cart; checkout returns a safe "ordering not available yet" until §2 is confirmed):
- `search_menu` → `ops.products` cosine (`name_embedding`) + ILIKE waterfall + `ops.product_categories` (read-only). Pure scoring/variant-resolution helpers port verbatim.
- `add_to_cart` / `edit_cart` → read `ops.products` (price/variants), write `comms.conversations.draft_cart` (CAS on `draft_cart_version`, already in `ConversationsRepository.updateDraftCartCas`).
- `get_business_info` / `get_business_hours` → delegate to the existing `BusinessHoursService` (3a/hours-unification).
- `get_recent_customer_orders` → **read** `ops.orders` + `ops.order_items` (rebind from `transactions.details.items`; read-only, lower risk — still confirm `ops.order_items` columns in Q2 to reconstruct line items).

**Gated on §2 (money writes):** `confirm_order`, `reorder_last_order`, `cancel_order` (plain path). **Gated on Phase 4 (KDS):** `confirm_order_changes`, `cancel_order` partial path, `getActivePartialCancelledOrder`.

---

## 4. Port plan once confirmed

1. `ops.products` repository: `searchByQuery` (cosine + ILIKE) + `getByIds` (validation). Bind variants/price per Q5/Q6.
2. `orders` repository: `createOrder` (CAS-free; `ops.orders` + `ops.order_items` in one `workerTx`, idempotent via A3; `kitchen_status` per Q2; optional `order_events` per Q4), `recentOrders`/`lastReusableOrder` reads, `cancelPendingOrder`.
3. `tools/{catalog,cart,checkout,customer}.tools.ts` + a real `ToolsService` (replaces `StubToolsService`) aggregating `TOOL_DEFINITIONS` + dispatch.
4. Money in centavos end-to-end; idempotency key = `conversaflow:turn:<turn_id>`.
5. Contract tests: search ranking/variant resolution, cart CAS, order idempotency (retried turn → one order), unit conversion.
