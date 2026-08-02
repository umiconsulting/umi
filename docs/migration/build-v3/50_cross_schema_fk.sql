-- ============================================================================
-- build-v3 · 50_cross_schema_fk
-- The circular umi->tenant FKs, deferred from 10_umi (tenant did not exist yet).
-- (tenant->umi FKs are inline in 20_tenant; umi is built first.)
-- NOTE: umi.audit_log.business_id stays a SOFT ref (no FK) by design — audit
--       exhaust must outlive the row it describes.
-- ============================================================================

alter table umi.user_role
  add constraint user_role_business_fk foreign key (business_id)
  references tenant.business(id) on delete cascade;

alter table umi.user_role
  add constraint user_role_branch_fk foreign key (branch_id)
  references tenant.branch(id) on delete cascade;

alter table umi.subscription
  add constraint subscription_business_fk foreign key (business_id)
  references tenant.business(id) on delete cascade;

alter table umi.invoice
  add constraint invoice_business_fk foreign key (business_id)
  references tenant.business(id) on delete cascade;

-- ---- umi -> tenant (permission overrides) ----------------------------------
alter table umi.user_permission_override
  add constraint permission_override_business_fk foreign key (business_id)
  references tenant.business(id) on delete cascade;

alter table umi.user_permission_override
  add constraint permission_override_branch_fk foreign key (branch_id)
  references tenant.branch(id) on delete cascade;

-- ---- tenant -> runtime (POS operator sessions) -----------------------------
-- These point the other way from the block above: `runtime` is built AFTER `tenant`,
-- so a tenant table cannot reference an operator session inline. `on delete restrict`
-- on the command: an accepted offline sale must not become unattributable because
-- someone's shift row was cleaned up.
alter table tenant.pos_cart
  add constraint pos_cart_operator_session_fk foreign key (operator_session_id)
  references runtime.operator_session(id) on delete restrict;

alter table tenant.offline_replay_command
  add constraint offline_replay_command_operator_session_fk foreign key (operator_session_id)
  references runtime.operator_session(id) on delete restrict;
