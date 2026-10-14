\set ON_ERROR_STOP on
-- Run after migration 020 in a disposable ONCA database.
-- Assign the waiter baseline only when Mesero still has a legacy default role.
-- Preserve a custom merchant role. Renew the operator login after a role change.
begin;
update merchant.staff s set merchant_role_id=waiter.id,updated_at=now()
from merchant.merchant m,merchant.role waiter,umi."user" u
where s.merchant_id=m.id and m.handle='onca'
  and s.user_id=u.id and lower(u.email)='mesero@onca.mx'
  and waiter.merchant_id=m.id and waiter.key='waiter' and waiter.status='active'
  and (s.merchant_role_id is null or exists (
    select 1 from merchant.role old_role where old_role.id=s.merchant_role_id
      and old_role.merchant_id=m.id and old_role.key in ('staff','cashier')
      and old_role.legacy_role_id is not null
  ));
commit;
