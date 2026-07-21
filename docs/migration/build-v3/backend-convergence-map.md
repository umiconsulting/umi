# Backend convergence map — build-v2 → build-v3

Phase 1 of the gated cutover plan. The `apps/umi-api` backend was written against **build-v2**
(4-schema) vocabulary; this maps every relation its SQL uses to the **build-v3** target. Three
categories — **A pure rename**, **B cross-schema move**, **C model rework (NOT a rename — needs
design/decision)**. Apply A+B mechanically per file (reviewed, not global find/replace); route C
through Phase 3 (new writers) with an owner decision.

Counts = occurrences found in `src` (2026-07-12). Build-v3 targets are authoritative per
`docs/migration/build-v3/{10_umi,20_tenant,30_runtime}.sql`.

## A · Pure renames (same schema, new name)

| build-v2 (backend today)                        | build-v3 target                      | n   |
| ----------------------------------------------- | ------------------------------------ | --- |
| `tenant.tenant` (root)                          | `tenant.business`                    | 56  |
| `tenant.card`                                   | `tenant.loyalty_card`                | 24  |
| `tenant.visit`                                  | `tenant.loyalty_visit`               | 23  |
| `tenant.card_ledger`                            | `tenant.loyalty_stored_value_ledger` | 20  |
| `tenant.reward_rule`                            | `tenant.loyalty_reward`              | 16  |
| `tenant.reward_redemption`                      | `tenant.loyalty_redemption`          | 10  |
| `tenant.loyalty_settings`                       | `tenant.loyalty_program`             | 8   |
| `tenant.gift_card`                              | `tenant.loyalty_gift_card`           | 7   |
| `tenant.gift_card_ledger`                       | `tenant.loyalty_gift_card_ledger`    | 2   |
| `runtime.outbox_events`                         | `runtime.outbox_event`               | 16  |
| `runtime.nudge_sent`                            | `runtime.reminder_sent`              | 7   |
| `runtime.inbound_events`                        | `runtime.inbound_event`              | 6   |
| `runtime.dead_letters`                          | `runtime.dead_letter`                | 5   |
| `runtime.idempotency_keys`                      | `runtime.idempotency_key`            | 2   |
| column `display_name` (on the login/user reads) | `full_name`                          | —   |

Already correct (no change): `tenant.customer`, `tenant.message`, `tenant.conversation`,
`tenant.business` (mixed in already), `tenant.order_event/order_item`, `tenant.station`,
`tenant.branch`, `tenant.device`, `tenant.contact`, `tenant.staff`, `tenant.product(_category)`,
`tenant.customer_note`, `runtime.session`, `runtime.pairing`, `runtime.conversation_state`,
`umi.prospect(_event)`, `umi.subscription_item`, `umi.role_permission`.

> **Status 2026-07-12 — Batch 1 (all of A) APPLIED + verified.** The 14 pure
> renames below are done (`find … -exec perl -i`), `tsc` clean, 325 mocked tests
> green, RLS harness 7/7. Verified by the new **schema-parity gate**
> (`apps/umi-api/src/shared/database/schema-parity.integration.ts`): it extracts
> every `from|join|into|update <schema>.<name>` reference from the backend and
> asserts it exists in the live build-v3 DB. The gate dropped 24 → 10; the
> remaining 10 are all in B/C below and are **all reworks** (see the correction).

## ~~B · Cross-schema moves~~ → CORRECTED: these are reworks, not mechanical moves

The original premise ("B = mechanical cross-schema rename") is **false at the
column level** (verified against build-v3 `information_schema`, 2026-07-12). Only
`password_reset_token` is near-mechanical, and it is dead until `login→user` lands,
so the whole cluster moves to Phase 3.

| build-v2 (backend today)      | build-v3 target                | why it is a REWORK (column evidence)                                                                                                                                                                                                        |
| ----------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenant.channel`              | `umi.channel_type`             | v2 columns `namespace / normalization_rule / deterministic_matchable / default_trust` have **no home** in `umi.channel_type {key,name,supports_outbound}`. It is the identity-resolver's channel table — entangled with `contact_identity`. |
| `tenant.login`                | `umi.user`                     | `umi.user` has **no `contact_id`** (used by `cash-write.repository.ts:73`); `display_name`→`full_name`. The user↔contact link moved.                                                                                                        |
| `tenant.tenant_access`        | `umi.user_role`                | shape differs: `user_role {user_id,role_id,business_id,branch_id,granted_by}` vs a per-tenant single-role edge. RBAC/`super_admin` query must be rewritten.                                                                                 |
| `tenant.password_reset_token` | `runtime.password_reset_token` | near-mechanical (table move + `login_id`→`user_id`) **but** meaningless until `login→user`; do it inside the auth cluster.                                                                                                                  |

## Resolved identity model (2026-07-12 — derived from code+schema, NOT a pending decision)

`umi.user` has no `contact_id` because build-v3 **splits the dual-purpose build-v2
`tenant.login`** along a staff/customer seam (verified against `backfill_identity.sql` +
`customer-session.service.ts` + live columns):

- **Staff / operator** = `umi.user` (email + creds + `full_name`) → `umi.user_role`
  grants → `tenant.staff` employment. The backfill builds exactly this (9 users, all
  hold grants; `person_id`/`phone` deliberately dropped).
- **Customer** = `tenant.customer` — its PK **is** the umi-cash session principal
  (`customer-session.service.ts`: CUSTOMER JWT `sub` = `tenant.customer.id`,
  `principal_type='person'` in `runtime.session`). `tenant.customer` carries
  `contact_id` directly (used in `findCard` as `person_id`). **No customer-login table.**

Concrete rewrites this fixes (removes the "need decision" from the auth cluster):

- `auth.repository` staff creds (`tenant.login`) → `umi.user` (worker pool; `api` column-locked on hash/salt/algorithm per 90_rls).
- `tenant.password_reset_token` (`login_id`) → `runtime.password_reset_token` (`user_id`), worker pool.
- `cash-write.getUserPersonId` (`tenant.login.contact_id`) → `select contact_id from tenant.customer where id = :customerId` (the authed customer principal).
- `tenant_access` role JOINs → `umi.user_role` (backfill already flattened memberships→user_role, 12 grants).
- STILL needs a read of `identity.resolver.ts`: how `contact_identity` folds into `tenant.contact`, and where `tenant.channel`'s normalization rules (`e164`, `deterministic_matchable`) live in build-v3 (likely code-side, since `umi.channel_type` has no such columns).

## C · Model reworks — NOT renames (Phase 3, need decision)

| build-v2 (backend today)                                                                   | build-v3 reality                                                                                                                                                                                                    | what it needs                                                                                                                                         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenant.contact_identity`                                                                  | **DROPPED** — collapsed into `tenant.contact`; resolver-scratch table gone                                                                                                                                          | rewrite reads/writes to the single `tenant.contact` + the TS `identity.resolver`; **the load-bearing item** the whole identity/auth cluster hangs off |
| `tenant.channel` + `tenant.login` + `tenant.tenant_access` + `tenant.password_reset_token` | see corrected-B                                                                                                                                                                                                     | do as ONE **identity/auth/RBAC cluster** with `contact_identity` — they share `auth.repository.ts` + `identity.resolver.ts`                           |
| `tenant.open_hours`                                                                        | **jsonb column on `tenant.business`**, not a table (parity gate caught this; map's earlier "column false-positive" was wrong — the backend uses it as a TABLE: `FROM/INSERT INTO/DELETE FROM`, one row per weekday) | rewrite `hours.repository.ts` + cash-scan open-hours join to jsonb ops                                                                                |
| `tenant.whatsapp_number`                                                                   | dissolved into `tenant.integration WHERE provider='whatsapp'` (`external_account_id`=number)                                                                                                                        | rewrite inbound-routing lookup (`channel.repository.ts:35`) over `tenant.integration`                                                                 |
| `tenant.birthday_reward`                                                                   | folded into `tenant.loyalty_reward` (`type='birthday'`)                                                                                                                                                             | rewrite as a typed reward row                                                                                                                         |
| `runtime.conversation_turn`                                                                | **DROPPED** — write-once telemetry → OTel                                                                                                                                                                           | remove turn-table writes; emit externally (or drop)                                                                                                   |
| `runtime.v_kds_tickets` (view)                                                             | not in build-v3 DDL                                                                                                                                                                                                 | define the view over `tenant.customer_order`+`order_event`, or inline                                                                                 |

## Genuine grep false-positives (parity gate does NOT flag these — anchored to from/join)

`tenant.timezone` (column), `tenant.normalize_phone`/`normalize_identity` (functions),
`tenant.guard`/`controller`/`test`, `umi.test`. (`open_hours` was mis-listed here before — it IS a table ref.)

## Execution order — CORRECTED

1. **A (14 pure renames): DONE + parity-gate-verified.** ← Phase 1 mechanical scope complete.
2. **Everything else (10 identifiers) = Phase 3 reworks**, sequenced as clusters:
   (a) identity/auth/RBAC (`contact_identity` + `login` + `channel` + `tenant_access` + `password_reset_token`),
   (b) hours→jsonb, (c) whatsapp_number→integration, (d) birthday_reward fold,
   (e) conversation_turn drop, (f) v_kds_tickets view.
3. Each cluster: rewrite → `tsc` clean → parity gate green for its identifiers → the
   repository's live queries exercised by an extended harness (catches column drift the
   table-name gate cannot).

**DoD for Phase 1 (met):** A applied, `tsc` clean, 325 mocked green, RLS harness 7/7,
parity gate 24→10. The 10 remaining are Phase-3 reworks, each requiring the model
decisions above; they are NOT blind renames.
