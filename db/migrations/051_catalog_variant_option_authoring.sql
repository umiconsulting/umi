\set ON_ERROR_STOP on

-- Product authoring needs to retire a choice without deleting its history.
--
-- A removed modifier may already be part of a cart line or a committed sale. The
-- historical row must stay, but the editor and the POS must stop offering it.
-- `active` is that fact. `display_order` is the order the owner chose; name order
-- was the only order before this file, so the value defaults to zero and remains
-- backwards-compatible.

alter table merchant.product_option_group
  add column if not exists active boolean not null default true;

alter table merchant.product_option_group
  add column if not exists display_order integer not null default 0;

alter table merchant.product_modifier
  add column if not exists active boolean not null default true;

alter table merchant.product_modifier
  add column if not exists display_order integer not null default 0;

create index if not exists product_option_group_active_idx
  on merchant.product_option_group (product_id, display_order, id)
  where active;

create index if not exists product_modifier_active_idx
  on merchant.product_modifier (option_group_id, display_order, id)
  where active;

comment on column merchant.product_option_group.active is
  'Retired option groups stay in the record for old cart lines but are not offered to new orders.';
comment on column merchant.product_modifier.active is
  'Retired modifiers stay in the record for old cart lines but are not offered to new orders.';
