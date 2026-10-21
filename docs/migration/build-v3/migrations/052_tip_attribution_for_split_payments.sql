\set ON_ERROR_STOP on

-- A split tip can belong to the employee who served the account or to the
-- employee who processed the payment. The choice is location policy. Each new
-- partial payment keeps both actors and the employee selected by that policy.
--
-- Existing partial payments stay immutable. Their actor columns stay null
-- because the table trigger refuses to rewrite a confirmed payment.

alter table merchant.pos_checkout_policy
  add column if not exists tip_attribution text not null default 'account_owner';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'merchant.pos_checkout_policy'::regclass
       and conname = 'pos_checkout_policy_tip_attribution_check'
  ) then
    alter table merchant.pos_checkout_policy
      add constraint pos_checkout_policy_tip_attribution_check
      check (tip_attribution in ('account_owner','payment_processor'));
  end if;
end $$;

comment on column merchant.pos_checkout_policy.tip_attribution is
  'Selects the employee who receives a split-payment tip.';

alter table merchant.pos_partial_payment
  add column if not exists service_operator_user_id uuid,
  add column if not exists processed_by_user_id uuid,
  add column if not exists tip_recipient_user_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'merchant.pos_partial_payment'::regclass
       and conname = 'pos_partial_payment_service_operator_fk'
  ) then
    alter table merchant.pos_partial_payment
      add constraint pos_partial_payment_service_operator_fk
      foreign key (service_operator_user_id) references umi."user"(id) on delete restrict;
  end if;
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'merchant.pos_partial_payment'::regclass
       and conname = 'pos_partial_payment_processor_fk'
  ) then
    alter table merchant.pos_partial_payment
      add constraint pos_partial_payment_processor_fk
      foreign key (processed_by_user_id) references umi."user"(id) on delete restrict;
  end if;
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'merchant.pos_partial_payment'::regclass
       and conname = 'pos_partial_payment_tip_recipient_fk'
  ) then
    alter table merchant.pos_partial_payment
      add constraint pos_partial_payment_tip_recipient_fk
      foreign key (tip_recipient_user_id) references umi."user"(id) on delete restrict;
  end if;
end $$;

create index if not exists pos_partial_payment_tip_recipient_idx
  on merchant.pos_partial_payment
    (merchant_id, location_id, tip_recipient_user_id, business_date)
  where tip_recipient_user_id is not null;

comment on column merchant.pos_partial_payment.service_operator_user_id is
  'Employee who opened or received the account. Null on historical rows.';
comment on column merchant.pos_partial_payment.processed_by_user_id is
  'Employee who processed this partial payment. Null on historical rows.';
comment on column merchant.pos_partial_payment.tip_recipient_user_id is
  'Employee selected by tip policy to receive this partial payment tip.';
