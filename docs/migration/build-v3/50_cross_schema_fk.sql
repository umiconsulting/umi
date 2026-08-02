-- ============================================================================
-- build-v3 · 50_cross_schema_fk
-- The circular umi->merchant FKs, deferred from 10_umi (merchant did not exist yet).
-- (merchant->umi FKs are inline in 20_merchant; umi is built first.)
-- NOTE: umi.audit_log.merchant_id stays a SOFT ref (no FK) by design — audit
--       exhaust must outlive the row it describes.
-- ============================================================================

alter table umi.user_role
  add constraint user_role_merchant_fk foreign key (merchant_id)
  references merchant.merchant(id) on delete cascade;

alter table umi.user_role
  add constraint user_role_location_fk foreign key (location_id)
  references merchant.location(id) on delete cascade;

alter table umi.subscription
  add constraint subscription_merchant_fk foreign key (merchant_id)
  references merchant.merchant(id) on delete cascade;

alter table umi.invoice
  add constraint invoice_merchant_fk foreign key (merchant_id)
  references merchant.merchant(id) on delete cascade;

-- ---- umi -> merchant (permission overrides) ----------------------------------
alter table umi.user_permission_override
  add constraint permission_override_merchant_fk foreign key (merchant_id)
  references merchant.merchant(id) on delete cascade;

alter table umi.user_permission_override
  add constraint permission_override_location_fk foreign key (location_id)
  references merchant.location(id) on delete cascade;

-- ---- merchant -> runtime (POS operator sessions) -----------------------------
-- These point the other way from the block above: `runtime` is built AFTER `merchant`,
-- so a merchant table cannot reference an operator session inline. `on delete restrict`
-- on the command: an accepted offline sale must not become unattributable because
-- someone's shift row was cleaned up.
alter table merchant.pos_cart
  add constraint pos_cart_operator_session_fk foreign key (operator_session_id)
  references runtime.operator_session(id) on delete restrict;

alter table merchant.offline_replay_command
  add constraint offline_replay_command_operator_session_fk foreign key (operator_session_id)
  references runtime.operator_session(id) on delete restrict;
