-- Gate 4A: authoritative kitchen projection for the existing KDS.
-- Commercial orders stay authoritative for sold items. Kitchen state is separate.

insert into umi.permission (key,description) values
  ('kitchen.cancel_ack','Acknowledge an authoritative kitchen cancellation'),
  ('kitchen.complete','Complete assigned kitchen work'),
  ('kitchen.diagnostics','Read KDS device and recovery diagnostics'),
  ('kitchen.merchant.read','Read kitchen operations across merchant locations'),
  ('kitchen.prepare','Start assigned kitchen preparation'),
  ('kitchen.priority','Change kitchen priority'),
  ('kitchen.read','Read an assigned kitchen projection'),
  ('kitchen.ready','Mark assigned kitchen work ready'),
  ('kitchen.recall','Recall ready kitchen work'),
  ('kitchen.station.manage','Manage kitchen stations and routes'),
  ('kitchen.station.read','Read kitchen station configuration')
on conflict (key) do update set description=excluded.description;

insert into umi.role_permission (role_id,permission_id)
select r.id,p.id
  from (values
    ('admin','kitchen.cancel_ack'),('admin','kitchen.complete'),
    ('admin','kitchen.diagnostics'),('admin','kitchen.prepare'),
    ('admin','kitchen.merchant.read'),
    ('admin','kitchen.priority'),('admin','kitchen.read'),('admin','kitchen.ready'),
    ('admin','kitchen.recall'),('admin','kitchen.station.manage'),
    ('admin','kitchen.station.read'),
    ('cashier','kitchen.read'),
    ('manager','kitchen.cancel_ack'),('manager','kitchen.complete'),
    ('manager','kitchen.diagnostics'),('manager','kitchen.prepare'),
    ('manager','kitchen.priority'),('manager','kitchen.read'),('manager','kitchen.ready'),
    ('manager','kitchen.recall'),('manager','kitchen.station.manage'),
    ('manager','kitchen.station.read'),
    ('owner','kitchen.cancel_ack'),('owner','kitchen.complete'),
    ('owner','kitchen.diagnostics'),('owner','kitchen.prepare'),
    ('owner','kitchen.merchant.read'),
    ('owner','kitchen.priority'),('owner','kitchen.read'),('owner','kitchen.ready'),
    ('owner','kitchen.recall'),('owner','kitchen.station.manage'),
    ('owner','kitchen.station.read'),
    ('staff','kitchen.read'),
    ('supervisor','kitchen.cancel_ack'),('supervisor','kitchen.complete'),
    ('supervisor','kitchen.diagnostics'),('supervisor','kitchen.prepare'),
    ('supervisor','kitchen.priority'),('supervisor','kitchen.read'),
    ('supervisor','kitchen.ready'),('supervisor','kitchen.recall'),
    ('supervisor','kitchen.station.read'),
    ('viewer','kitchen.read'),('viewer','kitchen.station.read')
  ) grant_row(role_key,permission_key)
  join umi.role r on r.key=grant_row.role_key
  join umi.permission p on p.key=grant_row.permission_key
on conflict do nothing;

create schema if not exists kds;

alter table merchant.product
  add column requires_preparation boolean not null default false,
  add column preparation_target_seconds integer
    check (preparation_target_seconds is null or preparation_target_seconds between 30 and 86400);

alter table merchant.product_category
  add constraint product_category_merchant_id_uk unique (merchant_id,id);

alter table merchant.station
  add column capabilities text[] not null default '{}',
  add column version bigint not null default 1 check (version > 0),
  add constraint station_merchant_id_uk unique (merchant_id,id),
  add constraint station_location_id_uk unique (merchant_id,location_id,id);

alter table merchant.customer_order
  add constraint customer_order_merchant_id_uk unique (merchant_id,id),
  add constraint customer_order_location_id_uk unique (merchant_id,location_id,id);

alter table merchant.order_item
  add constraint order_item_order_id_uk unique (order_id,id);

create table merchant.kitchen_route (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null,
  product_id uuid,
  category_id uuid,
  station_id uuid not null,
  requires_preparation boolean not null default true,
  route_priority integer not null default 100 check (route_priority between 0 and 10000),
  target_seconds integer check (target_seconds is null or target_seconds between 30 and 86400),
  active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kitchen_route_target_ck check (num_nonnulls(product_id,category_id) <= 1),
  constraint kitchen_route_location_fk foreign key (merchant_id,location_id)
    references merchant.location(merchant_id,id),
  constraint kitchen_route_product_fk foreign key (merchant_id,product_id)
    references merchant.product(merchant_id,id),
  constraint kitchen_route_category_fk foreign key (merchant_id,category_id)
    references merchant.product_category(merchant_id,id),
  constraint kitchen_route_station_fk foreign key (merchant_id,location_id,station_id)
    references merchant.station(merchant_id,location_id,id)
);
create unique index kitchen_route_product_uidx
  on merchant.kitchen_route (merchant_id,location_id,product_id)
  where product_id is not null and active;
create unique index kitchen_route_category_uidx
  on merchant.kitchen_route (merchant_id,location_id,category_id)
  where category_id is not null and product_id is null and active;
create unique index kitchen_route_default_uidx
  on merchant.kitchen_route (merchant_id,location_id)
  where product_id is null and category_id is null and active;
create index kitchen_route_resolution_idx
  on merchant.kitchen_route (merchant_id,location_id,active,route_priority);

create table merchant.kitchen_order (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null,
  source_order_id uuid not null,
  public_reference text not null,
  source text not null check (source in ('whatsapp','pos','web','dashboard')),
  fulfillment_type text,
  business_date date not null,
  status text not null default 'queued'
    check (status in ('queued','in_preparation','partially_ready','ready','completed','cancelled','exception')),
  priority text not null default 'normal' check (priority in ('normal','high','urgent')),
  version bigint not null default 1 check (version > 0),
  route_snapshot jsonb not null default '[]'::jsonb,
  cancellation_code text,
  cancellation_note text check (cancellation_note is null or length(cancellation_note) <= 500),
  queued_at timestamptz not null,
  preparation_started_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kitchen_order_location_fk foreign key (merchant_id,location_id)
    references merchant.location(merchant_id,id),
  constraint kitchen_order_source_fk foreign key (merchant_id,location_id,source_order_id)
    references merchant.customer_order(merchant_id,location_id,id) on delete restrict,
  unique (merchant_id, source_order_id),
  unique (merchant_id, id),
  unique (merchant_id, location_id, id)
);
create index kitchen_order_board_idx
  on merchant.kitchen_order (merchant_id,location_id,status,priority,queued_at,id);

create table merchant.kitchen_order_item (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null,
  kitchen_order_id uuid not null,
  source_order_id uuid not null,
  source_order_item_id uuid not null,
  station_id uuid,
  status text not null default 'queued'
    check (status in ('queued','preparing','ready','cancelled','exception')),
  product_id uuid,
  product_name text not null,
  variant_name text,
  modifiers jsonb not null default '[]'::jsonb,
  quantity integer not null check (quantity > 0),
  preparation_note text check (preparation_note is null or length(preparation_note) <= 500),
  display_order integer not null,
  route_reason text not null,
  target_seconds integer check (target_seconds is null or target_seconds between 30 and 86400),
  version bigint not null default 1 check (version > 0),
  preparation_started_at timestamptz,
  ready_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kitchen_item_order_fk foreign key (merchant_id,location_id,kitchen_order_id)
    references merchant.kitchen_order(merchant_id,location_id,id) on delete restrict,
  constraint kitchen_item_location_fk foreign key (merchant_id,location_id)
    references merchant.location(merchant_id,id),
  constraint kitchen_item_station_fk foreign key (merchant_id,location_id,station_id)
    references merchant.station(merchant_id,location_id,id),
  constraint kitchen_item_source_order_fk foreign key (source_order_id,source_order_item_id)
    references merchant.order_item(order_id,id) on delete restrict,
  unique (merchant_id, source_order_item_id),
  unique (merchant_id, id),
  unique (merchant_id, location_id, id),
  constraint kitchen_item_routing_ck check (
    (station_id is not null and status <> 'exception') or
    (station_id is null and status = 'exception')
  )
);
create index kitchen_item_station_board_idx
  on merchant.kitchen_order_item (merchant_id,location_id,station_id,status,kitchen_order_id,display_order);

create table merchant.kitchen_command (
  id uuid primary key,
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null,
  device_id uuid references merchant.device(id) on delete restrict,
  actor_user_id uuid references umi.user(id) on delete restrict,
  kitchen_order_id uuid not null,
  kitchen_order_item_id uuid,
  command_type text not null
    check (command_type in ('start_preparation','mark_item_ready','mark_order_ready','complete','recall','cancel_ack','change_priority')),
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  payload_fingerprint text not null check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  expected_version bigint not null check (expected_version > 0),
  status text not null default 'pending' check (status in ('pending','succeeded','conflict','failed')),
  result jsonb,
  correlation_id text not null check (length(correlation_id) between 8 and 200),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint kitchen_command_location_fk foreign key (merchant_id,location_id)
    references merchant.location(merchant_id,id),
  constraint kitchen_command_order_fk foreign key (merchant_id,location_id,kitchen_order_id)
    references merchant.kitchen_order(merchant_id,location_id,id),
  constraint kitchen_command_item_fk foreign key (merchant_id,location_id,kitchen_order_item_id)
    references merchant.kitchen_order_item(merchant_id,location_id,id),
  constraint kitchen_command_actor_ck check (num_nonnulls(device_id,actor_user_id)=1),
  unique (merchant_id, idempotency_key)
);
create index kitchen_command_recovery_idx
  on merchant.kitchen_command (merchant_id,device_id,created_at desc);

create table merchant.kitchen_event (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  event_id uuid not null unique,
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null,
  kitchen_order_id uuid not null,
  kitchen_order_item_id uuid,
  station_id uuid,
  kind text not null
    check (kind in ('order_created','order_updated','item_updated','order_cancelled','priority_changed','order_recalled','recovery_required')),
  aggregate_version bigint not null check (aggregate_version > 0),
  status text,
  safe_payload jsonb not null default '{}'::jsonb,
  correlation_id text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint kitchen_event_location_fk foreign key (merchant_id,location_id)
    references merchant.location(merchant_id,id),
  constraint kitchen_event_order_fk foreign key (merchant_id,location_id,kitchen_order_id)
    references merchant.kitchen_order(merchant_id,location_id,id),
  constraint kitchen_event_item_fk foreign key (merchant_id,location_id,kitchen_order_item_id)
    references merchant.kitchen_order_item(merchant_id,location_id,id),
  constraint kitchen_event_station_fk foreign key (merchant_id,location_id,station_id)
    references merchant.station(merchant_id,location_id,id)
);
create index kitchen_event_cursor_idx
  on merchant.kitchen_event (merchant_id,location_id,sequence);
create index kitchen_event_station_cursor_idx
  on merchant.kitchen_event (merchant_id,location_id,station_id,sequence);
create trigger kitchen_event_append_only before update or delete on merchant.kitchen_event
  for each row execute function merchant.tg_append_only();

create table merchant.kitchen_device_station (
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null,
  device_id uuid not null references merchant.device(id) on delete restrict,
  station_id uuid not null,
  active boolean not null default true,
  configuration_version bigint not null default 1 check (configuration_version > 0),
  assigned_by uuid references umi.user(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (device_id,station_id),
  constraint kitchen_device_location_fk foreign key (merchant_id,location_id)
    references merchant.location(merchant_id,id),
  constraint kitchen_device_station_fk foreign key (merchant_id,location_id,station_id)
    references merchant.station(merchant_id,location_id,id)
);
create index kitchen_device_active_idx
  on merchant.kitchen_device_station (merchant_id,location_id,device_id,active);

-- The KDS schema contains read projections only. API commands write merchant tables.
create view kds.station_order with (security_invoker = true) as
select ko.id, ko.merchant_id, ko.location_id, i.station_id, ko.source_order_id,
       ko.public_reference, ko.source, ko.fulfillment_type, ko.business_date,
       ko.status, ko.priority, ko.version, ko.queued_at, ko.preparation_started_at,
       ko.ready_at, ko.completed_at, ko.cancelled_at, ko.updated_at,
       coalesce(jsonb_agg(jsonb_build_object(
         'id',i.id::text,'sourceOrderItemId',i.source_order_item_id::text,
         'status',i.status,'productName',i.product_name,'variantName',i.variant_name,
         'modifiers',i.modifiers,'quantity',i.quantity,'preparationNote',i.preparation_note,
         'displayOrder',i.display_order,'targetSeconds',i.target_seconds,'version',i.version
       ) order by i.display_order,i.id) filter (where i.id is not null),'[]'::jsonb) items,
       coalesce(e.last_event_sequence,0) as last_event_sequence
  from merchant.kitchen_order ko
  join merchant.kitchen_order_item i on i.kitchen_order_id=ko.id and i.merchant_id=ko.merchant_id
  left join lateral (
    select max(event.sequence) as last_event_sequence
      from merchant.kitchen_event event
     where event.kitchen_order_id=ko.id and event.merchant_id=ko.merchant_id
  ) e on true
 group by ko.id,i.station_id,e.last_event_sequence;

create view kds.station_event with (security_invoker = true) as
select id,event_id,sequence,merchant_id,location_id,kitchen_order_id,
       kitchen_order_item_id,station_id,kind,aggregate_version,status,
       safe_payload,correlation_id,occurred_at
  from merchant.kitchen_event;

alter table merchant.kitchen_route enable row level security;
alter table merchant.kitchen_route force row level security;
alter table merchant.kitchen_order enable row level security;
alter table merchant.kitchen_order force row level security;
alter table merchant.kitchen_order_item enable row level security;
alter table merchant.kitchen_order_item force row level security;
alter table merchant.kitchen_event enable row level security;
alter table merchant.kitchen_event force row level security;
alter table merchant.kitchen_command enable row level security;
alter table merchant.kitchen_command force row level security;
alter table merchant.kitchen_device_station enable row level security;
alter table merchant.kitchen_device_station force row level security;

comment on schema kds is 'Kitchen read projections. UMI API remains the command authority.';
comment on table merchant.kitchen_order is
  'Kitchen state that references one committed commercial order. It never owns sale or payment facts.';
comment on table merchant.kitchen_event is
  'Ordered append-only kitchen feed. Payloads contain preparation-safe data only.';
