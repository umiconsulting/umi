-- POS FCM registrations belong to one operator, device, location, and Firebase project.
-- The registration is a delivery address, not a source of order or kitchen truth.
alter table merchant.pos_cart_line
  add column if not exists fired_by_user_id uuid references umi.user(id);

create index if not exists pos_cart_line_fired_actor_idx
  on merchant.pos_cart_line (merchant_id,order_item_id,fired_by_user_id)
  where order_item_id is not null;

create table if not exists runtime.pos_push_token (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete cascade,
  location_id uuid not null,
  user_id uuid not null references umi.user(id) on delete cascade,
  device_id uuid not null,
  operator_session_id uuid not null references runtime.operator_session(id) on delete cascade,
  environment text not null check (environment in ('development','test','staging','pilot','production')),
  project_id text not null,
  platform text not null check (platform = 'android'),
  token text not null check (length(token) between 20 and 4096),
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint pos_push_token_location_fk foreign key (merchant_id,location_id)
    references merchant.location(merchant_id,id),
  constraint pos_push_token_device_fk foreign key (merchant_id,device_id)
    references merchant.device(merchant_id,id),
  constraint pos_push_token_value_uq unique (token)
);

create index if not exists pos_push_token_recipient_idx
  on runtime.pos_push_token (merchant_id,location_id,user_id,environment,project_id,last_seen_at desc)
  where revoked_at is null;
create index if not exists pos_push_token_session_idx
  on runtime.pos_push_token (operator_session_id)
  where revoked_at is null;
