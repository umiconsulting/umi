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
