-- Branch resolution (Phase 1) — durable per-conversation branch selection.
--
-- ADDITIVE + DORMANT: the application only reads/writes this column when
-- BRANCH_RESOLUTION_ENABLED = true AND the tenant has more than one active
-- location. It is kept out of the conversation hot-path SELECT, so this is safe
-- to apply to prod (xbudknbimkgjjgohnjgp) ahead of the deploy + flag flip.
--
-- DEPLOY ORDERING (owner-gated): apply THIS migration BEFORE flipping
-- BRANCH_RESOLUTION_ENABLED for any tenant. Single-branch tenants and flag-off
-- deploys never touch the column.
--
-- selected_location_id: the branch the customer chose for the in-flight order,
-- persisted so the choice survives across turns. The bot re-derives its working
-- location from the inbound WhatsApp number every turn (turn.service.ts), so
-- without a durable column it would forget a mid-conversation branch pick. The
-- composite (tenant_id, selected_location_id) FK mirrors ops.orders.location_id:
-- a cross-tenant branch id is structurally impossible, and deleting a branch
-- nulls any stale pick.

alter table comms.conversations
  add column if not exists selected_location_id uuid;

alter table comms.conversations
  drop constraint if exists conversations_selected_location_fk;

alter table comms.conversations
  add constraint conversations_selected_location_fk
  foreign key (tenant_id, selected_location_id)
  references core.locations (tenant_id, id) on delete set null;
