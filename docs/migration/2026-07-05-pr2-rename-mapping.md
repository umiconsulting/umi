# PR2 — Reviewed Per-Relation Rename+Reshape Mapping (the build sheet)

**Date:** 2026-07-05
**Status:** Working doc (LOCAL, untracked). The mandated "reviewed per-relation mapping" that PR2 in [`2026-07-05-platform-restructure-implementation-plan.md`](2026-07-05-platform-restructure-implementation-plan.md) §5 requires **before** any find/replace. Derived from `build-v2/*.sql` (the merged #37 DDL) + a full audit of umi-api's schema-qualified SQL.
**Scope of umi-api surface:** ~474 raw qualified-identifier hits across **76 `.ts` files** (43 distinct relations/functions). Only **2 spec files** reference old identifiers; **no spec asserts SQL text** → renames won't break vitest. That is exactly the H1 trap: broken SQL stays green locally; real validation is the gated live cutover.

---

## 0. Two findings that change PR2's risk profile

**F1 — H1 (the top risk) is largely already mitigated in umi-api.** The plan assumed "session validation, KDS pairing, owner-console audit run on the `umi_app` pool today." Audit of the actual code:

- `auth.repository.ts` — **worker pool** already (`pg.query`; header: "…never `withTenant`").
- `customer-session.service.ts` (writes `core.sessions`) — **worker pool** already (`pg.query`).
- `kds.repository.ts` (pairing + `device.sessions` + `device.devices`) — **worker pool** already (`pg.query`/`workerTx`; header line 16 states it explicitly).
- **No `audit_log`/`config_change` writer exists in umi-api at all** (owner-console audit isn't wired here yet).

→ The H1 _pool reassignment_ is **close to a no-op** for umi-api. Every `withTenant` (umi_app-pool) call site touches tables that stay in the RLS-enrolled `tenant` schema (cash/customers/tenants/staff/hours/voice) — all reachable by `umi_app` post-rename. **What survives of H1 is the SESSION _reshape_ (F2), not a pool move.** Still add a live `umi_app`-pool `/auth/login` + KDS-pairing check to the go/no-go (cheap, guards regressions).

**F2 — the real session work is a column reshape, not a rename.** `core.sessions(token, user_id, person_id)` + `device.sessions(token_hash, device_id)` → `runtime.session(token_hash, principal_type, principal_id)`. So `customer-session.service` INSERT must **hash the token** and map `user_id`/`person_id` → `(principal_type, principal_id)`. KDS device-session writes map `device_id` → `('device', id)`. This is the "M (new #37)" risk item.

---

## 1. DDL gaps in `build-v2` surfaced by the sweep (feed back to the DDL, merged in #37)

| Gap                                                                                                                                                                | Impact                                           | Options                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No `v_kds_tickets` view** authored. KDS board reads `ops.v_kds_tickets` (4 refs, `kds.repository.ts`).                                                           | KDS board returns nothing / errors post-cutover. | (a) add `tenant.v_kds_tickets` view to `build-v2` (projection over `tenant."order"`+`order_item`+`order_event`); **(b, rec)** reimplement the projection in TS in `kds.repository` (matches the Phase-4 precedent — board already reimplemented over the view). |
| **No `f_unaccent` / `unaccent`** in `build-v2`. `core.f_unaccent` used (1 ref) for accent-insensitive product search. Target uses `gin_trgm_ops` + `lower()` only. | Product fuzzy-search query breaks.               | drop the `f_unaccent` wrap (rely on trigram+lower), or add `unaccent` to `00_foundation` + a `tenant.f_unaccent` wrapper.                                                                                                                                       |

Both are DDL-completeness issues, not pure backend — but PR2 is where they bite. Decide handling as part of PR2 (they're small).

---

## 2. Relation mapping — classified by execution class

**Classes:** `RENAME` = schema prefix only · `RENAME+COL` = prefix + column renames (target cols exist 1:1) · `RESHAPE-PR2` = a forced change the plan puts in PR2 · `DEFER` = deep reshape overlapping PR3/PR4 (needs resolver/split, cannot be a rename) · `DROP` = table gone · `FN` = function · `FP` = false positive (not SQL).

### Safe — pure rename / column-rename (mechanical, low risk)

| Current                      | Target                        | Class      | Notes                                                                                                                    |
| ---------------------------- | ----------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `core.tenants`               | `tenant.tenant`               | RENAME     | RLS root; cols align (slug/name/status/timezone/metadata).                                                               |
| `core.locations`             | `tenant.branch`               | RENAME     | +`business_id` (nullable, ignore on read).                                                                               |
| `core.staff_members`         | `tenant.staff`                | RENAME     | cols align.                                                                                                              |
| `core.users`                 | `tenant.login`                | RENAME     | RLS-exception principal; auth already worker-pool.                                                                       |
| `core.password_reset_tokens` | `tenant.password_reset_token` | RENAME     | login-keyed.                                                                                                             |
| `ops.businesses`             | `tenant.business`             | RENAME     | +`menu_source` (PR4 authoring).                                                                                          |
| `ops.products`               | `tenant.product`              | RENAME+COL | `price`→`price_cents`; `metadata.source`→col is PR4.                                                                     |
| `ops.product_categories`     | `tenant.product_category`     | RENAME     |                                                                                                                          |
| `ops.business_hours`         | `tenant.open_hours`           | RENAME+COL | day_of_week/opens_at/closes_at/is_closed align.                                                                          |
| `ops.order_items`            | `tenant.order_item`           | RENAME     | per-line `kitchen_status` **restored** in target — keep.                                                                 |
| `comms.messages`             | `tenant.message`              | RENAME+COL | `role`→`sender`, `content`→`body`, `embedding`→`body_embedding`.                                                         |
| `kitchen.stations`           | `tenant.station`              | RENAME+COL | folds station_groups → `group_key`/`group_name`/`product_refs`/`product_keys`.                                           |
| `device.devices`             | `tenant.device`               | RENAME     | worker-pool today; `device_type` discriminator.                                                                          |
| `queue.outbox_events`        | `runtime.outbox_events`       | RENAME     | worker-pool; sealed schema OK.                                                                                           |
| `queue.inbound_events`       | `runtime.inbound_events`      | RENAME     | worker-pool.                                                                                                             |
| `queue.dead_letters`         | `runtime.dead_letters`        | RENAME     | worker-pool.                                                                                                             |
| `queue.idempotency_keys`     | `runtime.idempotency_keys`    | RENAME     | worker-pool.                                                                                                             |
| `grow.leads`                 | `umi.prospect`                | RENAME+COL | worker-pool; map lead cols → prospect (email/name/phone/company/role_title/consent_state/lifecycle_status/diagnostic_*). |
| `grow.lead_events`           | `umi.prospect_event`          | RENAME     | worker-pool.                                                                                                             |
| `loyalty.visit_events`       | `tenant.visit`                | RENAME     |                                                                                                                          |
| `loyalty.reward_configs`     | `tenant.reward_rule`          | RENAME     | `program_id` dropped.                                                                                                    |
| `loyalty.reward_redemptions` | `tenant.reward_redemption`    | RENAME     |                                                                                                                          |
| `loyalty.birthday_rewards`   | `tenant.birthday_reward`      | RENAME     | kept distinct.                                                                                                           |
| `loyalty.lifecycle_sends`    | `runtime.nudge_sent`          | RENAME+COL | worker-pool (lifecycle cron); UNIQUE(tenant,card,journey).                                                               |

### RESHAPE — the 4 forced changes the plan assigns to PR2

| Current                                                                      | Target                                         | Notes                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loyalty.cards`                                                              | `tenant.card` (identity-only)                  | **DROP** `balance_cents`/`total_visits`/`visits_this_cycle`/`pending_rewards`; `account_id`→`customer_id`. Reads of balance → `SUM(card_ledger.delta)`.                                                                                           |
| `loyalty.points_ledger` + `loyalty.wallet_transactions` + `loyalty.balances` | `tenant.card_ledger` (append-only)             | Collapse to ONE ledger. `delta bigint`; **`idempotency_key` NOT NULL** on every insert; `+staff_id`. Delete the `cash-write.repository.ts` double-cache writes (wallet_transactions/balances/cards.balance_cents).                                |
| `loyalty.gift_cards` + `loyalty.gift_card_ledger`                            | `tenant.gift_card` / `tenant.gift_card_ledger` | drop `gift_cards.balance_cents` cache → `SUM(gift_card_ledger.delta)`; `idempotency_key` on ledger inserts.                                                                                                                                       |
| `ops.orders` (kitchen_status + 6 cancel cols) + `ops.order_events`           | `tenant."order"` + `tenant.order_event`        | **De-overload:** kitchen lifecycle + cancellation move OUT of the order row INTO `order_event` (`event_kind`/`kitchen_status`/`reason*`). `channel`/`source`→`channel_id`; `location_id`→`branch_id`; `person_id`→`customer_id`. Quote `"order"`. |

### RESHAPE — session (F2, the surviving half of H1)

| Current                   | Target            | Notes                                                                                                                                                   |
| ------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.sessions`           | `runtime.session` | `token`(plaintext)→`token_hash`(hashed); `user_id`/`person_id`→`(principal_type,principal_id)`. `customer-session.service` INSERT. Worker-pool already. |
| `device.sessions`         | `runtime.session` | `device_id`→`('device', id)`; `token_hash` kept. `kds.repository`.                                                                                      |
| `device.pairing_requests` | `runtime.pairing` | worker-pool already; `approved_by`→`tenant.login`.                                                                                                      |

### DEFER — deep reshapes that are NOT renames (need PR3/PR4 work; cannot be swept)

| Current                                                                                                                | Target                                                   | Why deferred                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.people`                                                                                                          | `tenant.customer`                                        | Needs the **contact node** (`contact_id`); `display_name`→`name`, `birth_date`→`born_at`, `normalized_phone`/`normalized_email` **dropped** (reachability moves to `contact_identity`). Phone lookups must JOIN `contact_identity`. → **PR4 identity resolver.** |
| `core.contact_methods`                                                                                                 | `tenant.contact_identity`                                | New `contact` anchor + `channel_id` + `normalize_identity`. → **PR4.**                                                                                                                                                                                           |
| `core.contact_merge_candidates`                                                                                        | folded into `contact_identity`                           | → PR4.                                                                                                                                                                                                                                                           |
| `core.resolve_contact` (FN)                                                                                            | TS resolver                                              | **Not authored** in build-v2 (bypass-RLS SECURITY DEFINER removed). → **PR4** (`customer-identity-resolution` skill).                                                                                                                                            |
| `comms.customer_preferences`                                                                                           | `tenant.customer_note`                                   | Aggregate blob → atomic facts (re-grain, not rename).                                                                                                                                                                                                            |
| `comms.conversations`                                                                                                  | `tenant.conversation` **+ `runtime.conversation_state`** | Cart/CAS columns split to a different table AND schema. → PR3 ("cart repos re-labeled runtime").                                                                                                                                                                 |
| `comms.conversation_turns`                                                                                             | `runtime.conversation_turn`                              | Sealed-schema move; conversation/person/message → SOFT uuids. → PR3.                                                                                                                                                                                             |
| RBAC ×5: `core.tenant_memberships`, `core.roles`, `core.membership_roles`, `core.role_permissions`, `core.permissions` | `tenant.tenant_access` (+role enum)                      | 5 tables → 1 + role flattening. Read-heavy in `auth.repository`. Unassigned by the plan — **needs a decision** (fold into PR2 auth, or its own PR2b).                                                                                                            |
| `core.product_instances`                                                                                               | `umi.subscription_item`                                  | Reshape into billing; per DDL file-11 comment.                                                                                                                                                                                                                   |

### DROP / FN / FP

| Token                                                                 | Disposition                                                                               |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `loyalty.wallet_transactions`, `loyalty.balances`                     | DROP (folded into `card_ledger`).                                                         |
| `loyalty.programs`                                                    | → `tenant.loyalty_settings` (folded; RESHAPE, small).                                     |
| `loyalty.accounts`                                                    | DROP (folded into `tenant.customer`; part of DEFER identity).                             |
| `comms.memory_items`                                                  | DROP.                                                                                     |
| `core.normalize_phone` (FN)                                           | → `tenant.normalize_phone` (**still exists** in build-v2) or `tenant.normalize_identity`. |
| `core.f_unaccent` (FN)                                                | **GAP** — not in build-v2 (see §1).                                                       |
| `queue.jobs`, `queue.job_attempts`                                    | DROP — **refs are comments only** (FP).                                                   |
| `queue.repository`/`.module`/`.upsert`/`.remove`/`.shift`/`.register` | **FP** — BullMQ methods / file paths, not SQL.                                            |
| `ops.channels` + `ops.channel_accounts`                               | → `tenant.whatsapp_number` (COLLAPSE 2→1; RESHAPE, small).                                |
| `ops.v_kds_tickets`                                                   | **GAP** — view not authored (see §1).                                                     |

---

## 3. Recommended PR2 slice (keeps PRs reviewable + honest about reshape)

**PR2 (this pass) = SAFE renames + the 4 forced RESHAPE-PR2 changes + session reshape (F2) + the two small collapses (`programs`→`loyalty_settings`, `channels`+`channel_accounts`→`whatsapp_number`) + the two DDL-gap fixes (§1) + a live `umi_app`-pool auth/KDS smoke in go/no-go.**

**Defer** the DEFER cluster: identity graph + `resolve_contact` → **PR4** (as the plan already states); conversation split → **PR3**; RBAC 5→1 → **decision (fold into PR2 or PR2b)**.

Coherence note: deferring leaves `core.people`/`contact_methods`/`conversations`/RBAC refs pointing at dropped schemas until their PRs land. That's fine **only because cutover is one coordinated deploy** — the live-apply waits for the whole PR2→PR5 set. No PR in the middle is independently deployable against `build-v2`, and that's by design (plan §5 "one coordinated rename deploy").

---

## 4. Open decisions for the user (before mass edits)

1. **PR2 granularity:** slice as §3 (rec) vs. one big data-layer PR.
2. **RBAC 5→1 collapse:** fold into PR2 (auth.repository is the main reader) vs. its own PR2b.
3. **`v_kds_tickets`:** reimplement projection in KDS repo (rec) vs. add a `tenant.v_kds_tickets` view to build-v2.
4. **`f_unaccent`:** drop the wrap (trigram+lower) vs. add `unaccent` back to build-v2.
