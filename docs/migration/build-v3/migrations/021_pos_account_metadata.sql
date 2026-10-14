-- Account numbers are operational references. They are not fiscal receipt numbers.
alter table merchant.pos_cart add column if not exists account_number bigint generated always as identity;
create unique index if not exists pos_cart_account_number_uidx on merchant.pos_cart(account_number);
grant usage,select on sequence merchant.pos_cart_account_number_seq to api,worker;
alter table merchant.customer_order add column if not exists source_context jsonb not null default '{}'::jsonb;
alter table merchant.kitchen_order add column if not exists source_context jsonb not null default '{}'::jsonb;
grant update(source_context) on merchant.customer_order to api;
grant update(source_context) on merchant.kitchen_order to api;
