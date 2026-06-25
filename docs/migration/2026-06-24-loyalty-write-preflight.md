# Loyalty Write Surface — Preflight & Confirmed Map (full cash port)

**Date:** 2026-06-24
**Status:** Confirmed against the live platform DB (`xbudknbimkgjjgohnjgp`) by read-only introspection (`default_transaction_read_only=on`, no DDL/DML). Unblocks the **full, live** cash-write port (owner reversed D11: cash ships production, not inert).
**Source of truth for logic:** `apps/umi-cash/src/lib/wallet.ts` + the umi-cash API route handlers (the live writer of these exact tables since the 2026-06-20 cutover).

---

## 0. Two findings that change the plan

1. **`loyalty.wallet_transactions.type` is LOWERCASE on live data** (`topup`, `purchase` — confirmed by `GROUP BY type`). The dashboard's `server.js` analytics/stats filter `type = 'TOPUP'`/`'PURCHASE'` (uppercase) → **they match zero rows**, so the dashboard's "topups today/this month" and revenue numbers have been silently **zero**. This was inherited verbatim into `cash-read.service`. **Fix:** use lowercase `topup`/`purchase` everywhere (read + write). umi-cash's lowercase convention is canonical.
2. **No `loyalty` schema RPCs exist.** The spec/§11.5 assumed gated `SECURITY DEFINER` RPCs (`award_points`, …). The live model is **direct append-only ledger writes** (the `wallet.ts` pattern). So the cash-write port writes `loyalty.*` tables directly inside transactions — there is no RPC layer to bind to, and the "`umi_app` has no EXECUTE on RPCs" guard is moot. Isolation is via explicit `tenant_id` predicates + the composite FKs.

---

## 1. Confirmed write tables (column-exact)

All have `tenant_id uuid NN` FK `core.tenants` and composite `UNIQUE(tenant_id, id)`; child tables FK `(tenant_id, loyalty_card_id) → loyalty.cards(tenant_id, id)`.

| Table | Key columns | Notes |
|---|---|---|
| `points_ledger` | `id, tenant_id, loyalty_card_id, delta int, reason text NN, source_type, source_id, idempotency_key NN, metadata, created_at` | **append-only; `UNIQUE(idempotency_key)`** = the dedup gate. The source of truth for balance. |
| `wallet_transactions` | `id, tenant_id, loyalty_card_id, staff_member_id, type text NN (lowercase), amount_cents int NN, description, metadata, created_at` | human-facing history; signed `amount_cents`. |
| `balances` | `tenant_id, loyalty_card_id, balance int NN, updated_at` | **PK = `loyalty_card_id`** → `ON CONFLICT (loyalty_card_id)`. Derived cache. |
| `cards` | `id, tenant_id, account_id, card_number UNIQUE, balance_cents, total_visits, visits_this_cycle, pending_rewards, qr_token, qr_issued_at, status, metadata, created_at, updated_at` | balance_cents mirrors `SUM(points_ledger.delta)`. |
| `gift_cards` | `id, tenant_id, code UNIQUE, amount_cents, balance_cents, created_by_staff_member_id, sender_name, message, recipient_*, redeemed_at, redeemed_loyalty_card_id, expires_at, created_at` | `isRedeemed` is derived (`redeemed_at IS NOT NULL`). |
| `gift_card_ledger` | `id, tenant_id, gift_card_id, delta, reason NN, source_type, source_id, idempotency_key NN, metadata, created_at` | **`UNIQUE(idempotency_key)`**. |
| `reward_redemptions` | `id, tenant_id, loyalty_card_id, reward_config_id NN, staff_member_id, note, redeemed_at` | FK to `reward_configs`. |
| `visit_events` | `id, tenant_id, loyalty_card_id, staff_member_id, note, metadata, occurred_at` | one per visit. |
| `accounts` | `id, tenant_id, person_id NN, program_id NN, status, metadata, created_at, updated_at` | customer↔card link. |

## 2. The single wallet write path (port of `wallet.ts applyWalletDelta`)

Inside one transaction, for a signed `deltaCents`:
1. `INSERT loyalty.points_ledger (... idempotency_key)` — append-only, dedups on retry.
2. `INSERT loyalty.wallet_transactions (type, amount_cents=delta, ...)`.
3. `balance = SELECT COALESCE(SUM(delta),0) FROM points_ledger WHERE tenant_id, loyalty_card_id` (absolute → idempotent vs any trigger).
4. `INSERT loyalty.balances ON CONFLICT (loyalty_card_id) DO UPDATE balance=…`.
5. `UPDATE loyalty.cards SET balance_cents=balance`.

`type ∈ {topup, purchase, adjustment, gift_card_redeem}` (lowercase). Idempotency keys: `topup_{cardId}_{ts}`, `purchase_{cardId}_{ts}`, `giftredeem_{giftCardId}`, gift ledger `giftissue_{id}` / `giftledger_{id}`.

## 3. Identity (customer/staff)

- **Staff attribution:** `core.staff_members` has a `user_id` column → `getStaffMemberId(tenantId, userId)` = `SELECT id FROM core.staff_members WHERE tenant_id AND user_id AND status='active'`. Nullable on txn rows.
- **Customer find-or-create:** `core.resolve_contact(tenant, kind, rawValue, displayName, sourceSystem, externalId) → person_id` and `core.normalize_phone(raw) → e164` RPCs exist (in `core`, not `loyalty`). Used by gift-redeem (find person by phone/email) and customer/card creation.

## 4. Authorization mapping

umi-cash gated writes with its own customer/staff JWT (`requireAuth(['STAFF','ADMIN'])`). In `umi-api` these map to the **dashboard auth**: `AuthGuard → TenantAccessGuard` (membership) + a staff-capable role (`@Roles('super_admin','owner','admin','staff', …)`). `staff_member_id` for audit comes from the authed `user.id` via `getStaffMemberId`.

## 5. ⚠️ Dual-writer reality — confirm before routing live traffic

`umi-cash` (cash.umiconsulting.co) is **currently the live writer** of these exact `loyalty.*` tables (post-2026-06-20 cutover). The append-only-SUM + `UNIQUE(idempotency_key)` design is concurrency-safe at the ledger level (two writers can't double-apply one keyed op, and balance is always a recomputed SUM), so **building and even deploying** the umi-api writes is safe. The **routing/cutover** decision — does umi-cash get decommissioned, or do both run — is the owner's call (the Phase-7 activation, now pulled forward). Building the code does not commit to that; it's flagged here so the cutover is deliberate.

## 6. Wallet-pass push (Apple/Google)

umi-cash calls `sendApplePushUpdate` + `updateGoogleWalletObject` best-effort (`.catch(warn)`) after each money write. These are **cert/secret-bound** (APN cert, Google service-account key, pass web-service URL). Ported as a config-gated `WalletPassAdapter` seam: it performs the push when the certs are configured and logs-and-continues otherwise (same graceful behavior as the live code). The full PassKit/Google-Wallet cert port + `webServiceURL` repoint remains infra work (certs in VPS secrets).
