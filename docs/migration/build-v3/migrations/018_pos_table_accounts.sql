-- A table visit ends when the party leaves. Checkout closes only the account.
alter table merchant.pos_cart
  add column if not exists table_id uuid,
  add column if not exists table_name text,
  add column if not exists table_visit_id uuid;
alter table merchant.pos_cart_line
  add column if not exists order_item_id uuid references merchant.order_item(id);
create unique index if not exists pos_cart_open_table_uidx
  on merchant.pos_cart(merchant_id,location_id,table_id)
  where table_id is not null and status in ('draft','prepared');
create index if not exists pos_cart_line_order_item_idx
  on merchant.pos_cart_line(order_item_id) where order_item_id is not null;
grant update(table_id,table_name,table_visit_id) on merchant.pos_cart to api;
grant update(order_item_id) on merchant.pos_cart_line to api;
alter table merchant.table_state add column if not exists visit_id uuid;
update merchant.table_state set visit_id=gen_random_uuid() where seated_at is not null and visit_id is null;
create or replace function merchant.table_state_visit_guard() returns trigger language plpgsql as $$
begin
  if TG_OP='UPDATE' and old.seated_at is not null and new.seated_at is null
     and exists (select 1 from merchant.pos_cart c where c.merchant_id=old.merchant_id
       and c.location_id=old.location_id and c.table_id=old.table_id and c.status in ('draft','prepared')) then
    raise exception 'TABLE_HAS_OPEN_ACCOUNT' using errcode='23514';
  end if;
  if new.seated_at is null then new.visit_id=null;
  elsif TG_OP='INSERT' then new.visit_id=gen_random_uuid();
  elsif old.seated_at is null then new.visit_id=gen_random_uuid();
  else new.visit_id=old.visit_id;
  end if;
  return new;
end $$;
drop trigger if exists table_state_visit_guard on merchant.table_state;
create trigger table_state_visit_guard before insert or update on merchant.table_state
  for each row execute function merchant.table_state_visit_guard();
