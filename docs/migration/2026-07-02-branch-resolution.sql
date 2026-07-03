-- Branch resolution — durable per-conversation branch selection.
--
-- ADDITIVE + DORMANT: `selected_location_id` is only read/written for a tenant
-- that actually has more than one active branch (see OrderLocationResolver — the
-- fulfillment-location policy). Single-branch tenants never touch it. There is NO
-- feature flag: behavior is derived from the data (active-location count), so
-- once this column exists and the code is deployed, every multi-branch tenant
-- gets branch resolution at once.
--
-- DEPLOY ORDERING (owner-gated): apply THIS migration BEFORE deploying the code
-- that reads the column. It is additive and safe to apply well ahead of deploy.
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
