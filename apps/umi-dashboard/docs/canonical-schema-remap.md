# Dashboard → Canonical Schema Remap (2026-06-20)

The 2026-06-18 unified DB rebuild (prod project `xbudknbimkgjjgohnjgp`, PG17) replaced the
old `platform.*` / `kds.*` / `cash.*` / `conversaflow.*` schemas with the canonical schema.
`server.js` was written against the old design and must be re-pointed. Authoritative source:
`docs/migration/2026-06-18-curated-column-mapping.md` + live DB column dump.

## Table mapping

| old reference | canonical table | key columns (canonical) |
|---|---|---|
| platform.tenants | core.tenants | id, slug, name, status, timezone, metadata, created_at, updated_at |
| platform.users | core.users | id, email, display_name, password_salt, password_hash, password_algorithm, status, person_id |
| platform.tenant_memberships | core.tenant_memberships | id, tenant_id, user_id, status, created_at, updated_at |
| platform.membership_roles | core.membership_roles | membership_id, role_id |
| platform.roles | core.roles | id, tenant_id, key, name, description |
| platform.role_permissions | core.role_permissions | role_id, permission_id |
| platform.permissions | core.permissions | id, key, description |
| platform.password_reset_tokens | core.password_reset_tokens | id, user_id, token_hash, expires_at, used_at |
| platform.product_instances | core.product_instances | id, tenant_id, location_id, product_key, status, config |
| platform.locations | core.locations | id, tenant_id, slug, name, address, lat, lng, status, metadata — **NO timezone** |
| platform.staff_members | core.staff_members | id, tenant_id, location_id, user_id, name, email, phone, status, metadata |
| platform.people | core.people | id, tenant_id, display_name, birth_date, normalized_phone, normalized_email, metadata |
| platform.contact_identities | core.contact_methods | id, tenant_id, person_id, kind, normalized_value, display_value, is_primary, verified_at |
| platform.contact_merge_candidates | core.contact_merge_candidates | id, tenant_id, left_person_id, right_person_id, person_id_least, person_id_greatest, match_type, confidence, detail, resolved_at |
| cash.loyalty_accounts | loyalty.accounts | id, tenant_id, person_id, program_id, status |
| cash.loyalty_cards | loyalty.cards | id, tenant_id, account_id, card_number, balance_cents, total_visits, visits_this_cycle, pending_rewards, qr_token, status |
| cash.wallet_programs | loyalty.programs | id, tenant_id, name, card_prefix, topup_enabled, self_registration, pass_style, birthday_reward_enabled, birthday_reward_name, branding(jsonb), status |
| (reward config) | loyalty.reward_configs | id, tenant_id, program_id, visits_required, reward_name, reward_description, reward_cost_cents, is_active, activated_at |
| cash.gift_cards | loyalty.gift_cards | id, tenant_id, code, amount_cents, balance_cents, created_by_staff_member_id, sender_name, recipient_*, redeemed_at, redeemed_loyalty_card_id, expires_at |
| kds.tickets | ops.v_kds_tickets (view) | ticket_id, tenant_id, source_transaction_id, source_channel, customer_person_id, status, station_id, station_name, pickup_person, customer_note, cancellation_reason, total_cents, created_at, updated_at, items(jsonb) |
| (ticket base) | ops.orders | id, tenant_id, location_id, person_id, status, kitchen_status, station_id, station_name, total_cents, placed_at, ... |
| kds.ticket_items | ops.order_items | id, tenant_id, order_id, product_id, name, variant_name, quantity, unit_price_cents, notes, kitchen_status, is_cancelled |
| kds.ticket_events | ops.order_events | id, tenant_id, order_id, event_kind, old_status, new_status, kitchen_sequence, source, payload, occurred_at |
| kds.stations | kitchen.stations | id, tenant_id, location_id, station_key, name, status, sort_order |
| kds.device_sessions | device.sessions | id, tenant_id, device_id, station_id, device_name, token_hash, is_active, last_used_at |
| (device base) | device.devices | id, tenant_id, location_id, station_id, name, device_type, status |
| conversaflow.conversations | comms.conversations | id, tenant_id, person_id, status, current_state, summary, last_message_at, created_at |
| conversaflow.messages | comms.messages | id, tenant_id, conversation_id, role, content, intent, message_index, created_at |
| conversaflow.memory_items | comms.memory_items | id, tenant_id, person_id, conversation_id, memory_type, content |
| conversaflow.businesses | ops.businesses | id, tenant_id, name, business_type, city, config, open_times, branding |

## Behavior changes

- **No `super_admin` role** in canonical DB. Roles are `admin / owner / staff / viewer`
  (per `core.roles`). `normalizeRoleKey` and permission wildcard must not assume super_admin.
- **Tenant branding/loyalty/promo/hours** moved off `core.tenants` into `loyalty.programs`
  (card_prefix, pass_style, topup, self-reg, birthday, `branding` jsonb) and
  `ops.businesses` / `ops.business_hours`. Settings reads/writes must target those.
- **`core.locations` has no `timezone`** — drop it from location selects (fall back to tenant tz).
- **KDS tickets** are `ops.orders` projected by `ops.v_kds_tickets`; items are `ops.order_items`.
- Superadmin = a `core.users` row with active `core.tenant_memberships` on multiple tenants
  (membership-driven tenant switcher). No special role required for viewing.
