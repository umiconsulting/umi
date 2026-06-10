both # Optimized Database Transition Checklist - 2026-05-15

This checklist executes `docs/migration/2026-05-15-optimized-database-transition-plan.md`.

Status legend:

- `[ ]` not started
- `[~]` in progress
- `[x]` complete
- `[!]` blocked or needs decision

## 0. Safety and scope

- [ ] Keep `apps/umi-conversaflow/supabase/migrations/20260513190000_dashboard_staff_and_external_refs.sql` out of production.
- [ ] Keep all production changes additive until compatibility and rollback are documented.
- [ ] Do not add new product logic to `public`.
- [ ] Do not make Dashboard a tenant, staff, contact, order, or product-data authority.
- [ ] Define a migration branch/checkpoint before writing import SQL.

## 1. Decision confirmations

- [!] Confirm whether the 1 ConversaFlow business maps to one of the 3 Cash tenants.
- [ ] Confirm that KDS maps to the same tenant as the ConversaFlow business that produced the source transactions.
- [ ] Confirm whether tenant grouping is needed now. Default: no `platform.organizations` in phase 1.
- [ ] Choose auth direction:
  - [ ] temporary Supabase Auth only as provider
  - [ ] managed OIDC provider
  - [ ] self-hostable OIDC provider
- [ ] Confirm staff login policy:
  - [ ] staff/admin rows become `platform.staff_members`
  - [ ] staff/admin rows become `platform.users` only when they need login access
- [ ] Confirm phone policy:
  - [ ] store unverified phone identities
  - [ ] use exact normalized matches for auto-merge
  - [ ] record last-10 matches as candidates only
- [ ] Confirm `conversaflow.transactions.total_amount` conversion with source samples.
- [ ] Confirm operational retention policy for imported jobs, outbox, traces, logs, and attempts.

## 2. Target schema refinements

- [ ] Add identity verification columns to `platform.contact_identities`.
- [ ] Add mapping tables under `legacy`:
  - [ ] `legacy.tenant_mappings`
  - [ ] `legacy.location_mappings`
  - [ ] `legacy.user_mappings`
  - [ ] `legacy.staff_mappings`
  - [ ] `legacy.contact_mappings`
  - [ ] `legacy.order_mappings`
  - [ ] `legacy.kds_ticket_mappings`
  - [ ] `legacy.public_compat_imports`
  - [ ] `legacy.replay_queue`
- [ ] Add indexes for all old id lookup columns in `legacy`.
- [ ] Ensure every target product table has `tenant_id uuid not null references platform.tenants(id)`.
- [ ] Ensure every location-scoped target table has `location_id uuid references platform.locations(id)`.
- [ ] Ensure target RLS helpers use Umi-owned session settings, not Supabase-only `auth.uid()`.
- [ ] Add explicit role/permission seed data for owner, admin, staff, developer, and tech assist.

## 3. Data profiling before import SQL

- [ ] Sample all `conversaflow.transactions.details` shapes without committing PII.
- [ ] Profile `conversaflow.transactions.total_amount` values and verify pesos-to-centavos conversion.
- [ ] Compare `public.*` and `conversaflow.*` tables by primary key and row hash where possible.
- [ ] Identify public-only rows that need compatibility import.
- [ ] Profile Cash users by role: `CUSTOMER`, `STAFF`, `ADMIN`.
- [ ] Profile duplicate phones/emails in Cash after normalization.
- [ ] Profile ConversaFlow phones after normalization.
- [ ] Generate candidate contact matches:
  - [ ] exact normalized tenant phone
  - [ ] exact normalized tenant email
  - [ ] last-10 phone candidate only
- [ ] Profile KDS tickets/items/events against source transactions.

## 4. Platform import

- [ ] Import Cash tenants into `platform.tenants`.
- [ ] Import or map ConversaFlow business into `platform.tenants`.
- [ ] Import Cash locations into `platform.locations`.
- [ ] Create default ConversaFlow location only if operational behavior needs it.
- [ ] Populate `platform.product_instances` for every tenant:
  - [ ] `cash`
  - [ ] `conversaflow`
  - [ ] `kds`
  - [ ] `dashboard`
  - [ ] `observability`
- [ ] Import platform users from current auth/admin/staff sources.
- [ ] Import tenant memberships.
- [ ] Import staff members from Cash `STAFF` and `ADMIN` users.
- [ ] Import contacts from Cash `CUSTOMER` users.
- [ ] Import contacts from ConversaFlow customers.
- [ ] Import contact identities:
  - [ ] phone
  - [ ] whatsapp
  - [ ] email
  - [ ] wallet pass
  - [ ] external/source ids
- [ ] Populate `platform.external_refs` for every old id and slug.

## 5. Commerce import

- [ ] Import eligible `conversaflow.transactions` into `commerce.orders`.
- [ ] Preserve source transaction id in mappings and order metadata.
- [ ] Convert `total_amount` to `total_cents` using validated conversion.
- [ ] Extract `commerce.order_items` from transaction `details`.
- [ ] Validate order item count against `kds.ticket_items`.
- [ ] Import status history into `commerce.order_events`.
- [ ] Record unresolved item extraction cases as `observability.data_quality_findings`.

## 6. Cash import

- [ ] Map Cash `Tenant` to `platform.tenants` and `cash.wallet_programs`.
- [ ] Map Cash customer `User` rows to `platform.contacts` and `cash.loyalty_accounts`.
- [ ] Import `LoyaltyCard` to `cash.loyalty_cards`.
- [ ] Import `Visit` to the chosen Cash event model.
- [ ] Import `Transaction` to `cash.wallet_transactions`.
- [ ] Import `RewardConfig` to `cash.reward_configs`.
- [ ] Import `RewardRedemption` to `cash.reward_redemptions`.
- [ ] Import `GiftCard` to `cash.gift_cards`.
- [ ] Import Apple/Google pass identifiers to `cash.passes`.
- [ ] Import `ApplePushToken` to `cash.pass_devices`.
- [ ] Exclude or separately archive `Session`.
- [ ] Exclude or short-window migrate `OtpVerification`.

## 7. ConversaFlow import

- [ ] Import channels and channel accounts with `tenant_id`.
- [ ] Import conversations with `tenant_id` and `contact_id`.
- [ ] Import messages with `tenant_id`, `contact_id`, provider ids, and payload metadata.
- [ ] Import conversation turns and outcomes.
- [ ] Import customer preferences/memory into `conversaflow.memory_items` or compatible product tables.
- [ ] Import products and embeddings where target extension support is ready.
- [ ] Import workflow jobs as historical or active according to cutover classification.
- [ ] Import job attempts.
- [ ] Import outbox rows without making old rows automatically deliverable.
- [ ] Stage any deliberate replays into `legacy.replay_queue`.

## 8. KDS import

- [ ] Import stations where known or create default/unassigned station records.
- [ ] Import tickets with canonical `tenant_id`, `contact_id`, and `order_id`.
- [ ] Import ticket items with `order_item_id` where matched.
- [ ] Import ticket events as kitchen history.
- [ ] Import device sessions if operationally useful.
- [ ] Preserve existing KDS status values and cancellation reasons.
- [ ] Add tenant-first RPCs.
- [ ] Keep `p_business_id` compatibility RPCs until the iPad app migrates.

## 9. Observability import

- [ ] Move pipeline traces to `observability.pipeline_traces`.
- [ ] Move edge function logs to `observability.runtime_logs`.
- [ ] Move security logs to `observability.runtime_logs` or `observability.audit_events`.
- [ ] Move AI turn logs to runtime/trace history with cost/token fields preserved in metadata.
- [ ] Move eval traces if still useful.
- [ ] Record all import anomalies as `observability.data_quality_findings`.
- [ ] Update Logs app read path after observability tables are populated.

## 10. Dashboard tenant switching milestone

- [ ] Add `GET /api/me/tenants`.
- [ ] Add `GET /api/tenants/:tenantId/capabilities`.
- [ ] Add selected tenant state in Dashboard app shell.
- [ ] Remove hard dependency on `VITE_BUSINESS_SLUG`.
- [ ] Keep old `/api/:slug/...` routes as compatibility wrappers.
- [ ] Gate modules from `platform.product_instances`.
- [ ] Implement unavailable states for missing products.
- [ ] Verify Cash-only tenant flow.
- [ ] Verify full-stack tenant flow.
- [ ] Verify one user can switch between multiple tenants.
- [ ] Verify staff permissions restrict actions.
- [ ] Verify developer/tech assist role has support access without business staff privileges.

## 11. Replication and cutover

- [ ] Create target PostgreSQL staging database.
- [ ] Apply refined schema from scratch.
- [ ] Run full backfill into staging.
- [ ] Enable logical replication or define fallback incremental imports.
- [ ] Run repeated delta imports until drift is small.
- [ ] Freeze writes for final cutover window.
- [ ] Run final delta import.
- [ ] Run validation gates.
- [ ] Switch Dashboard read path.
- [ ] Switch Cash read path.
- [ ] Switch Cash write path.
- [ ] Switch KDS read path.
- [ ] Switch ConversaFlow contact/order path.
- [ ] Switch Logs read path.
- [ ] Keep compatibility adapters active through the soak window.

## 12. Validation queries and gates

- [ ] Row counts match expected source counts by table.
- [ ] No unmapped source tenant/business ids.
- [ ] No unmapped source customers/users.
- [ ] No orphan product rows without tenant mapping.
- [ ] No KDS tickets without mapped orders unless explicitly recorded.
- [ ] No order items with missing order ids.
- [ ] No contact identity duplicates except approved candidates.
- [ ] No replayable outbox rows unless explicitly staged.
- [ ] RLS returns rows only for accessible tenants.
- [ ] RLS returns zero rows for no user context.
- [ ] Dashboard can load with no global slug.

## 13. Post-cutover cleanup

- [ ] Keep old source tables read-only through the soak period.
- [ ] Keep `public.*` compatibility views or tables until all apps stop reading them.
- [ ] Archive old Supabase internals only after the Supabase exit phase.
- [ ] Document final ownership in root docs and repo contexts.
- [ ] Remove compatibility adapters only after product owners approve.
