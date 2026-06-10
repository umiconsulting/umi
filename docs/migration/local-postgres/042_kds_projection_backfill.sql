insert into kds.stations (
  id,
  tenant_id,
  location_id,
  station_key,
  name,
  metadata,
  created_at,
  updated_at
)
select distinct
  legacy.stable_uuid('kds:station:' || kt.business_id::text || ':' || kt.station_id),
  tm.tenant_id,
  lm.location_id,
  kt.station_id,
  coalesce(nullif(kt.station_name, ''), kt.station_id),
  jsonb_build_object(
    'source_business_id', kt.business_id,
    'location_mapping_reason', lm.metadata->>'reason'
  ),
  min(kt.created_at) over (partition by kt.business_id, kt.station_id),
  max(kt.updated_at) over (partition by kt.business_id, kt.station_id)
from src_platform_kds.tickets kt
join legacy.tenant_mappings tm
  on tm.source_product = 'conversaflow'
 and tm.source_schema = 'conversaflow'
 and tm.source_table = 'businesses'
 and tm.source_id = kt.business_id::text
left join legacy.location_mappings lm
  on lm.source_product = 'conversaflow'
 and lm.source_schema = 'conversaflow'
 and lm.source_table = 'businesses.default_location'
 and lm.source_id = kt.business_id::text
where nullif(kt.station_id, '') is not null
on conflict (id) do nothing;

insert into kds.tickets (
  id,
  tenant_id,
  location_id,
  order_id,
  contact_id,
  source_channel,
  customer_name,
  customer_phone,
  pickup_person,
  status,
  station_id,
  customer_note,
  cancellation_reason,
  partial_cancellation_reason,
  total_cents,
  created_at,
  updated_at,
  last_event_sequence,
  last_projected_at
)
select
  legacy.stable_uuid('kds:ticket:' || kt.ticket_id::text),
  o.tenant_id,
  coalesce(o.location_id, lm.location_id),
  o.id,
  o.contact_id,
  coalesce(nullif(kt.source_channel, ''), 'conversaflow'),
  kt.customer_name,
  kt.customer_phone,
  kt.pickup_person,
  case kt.status::text
    when 'new' then 'new'
    when 'accepted' then 'accepted'
    when 'preparing' then 'preparing'
    when 'ready' then 'ready'
    when 'completed' then 'completed'
    when 'cancelled' then 'cancelled'
    when 'partial_cancelled' then 'partial_cancelled'
    else 'new'
  end,
  case
    when nullif(kt.station_id, '') is not null
      then legacy.stable_uuid('kds:station:' || kt.business_id::text || ':' || kt.station_id)
  end,
  kt.customer_note,
  kt.cancellation_reason,
  kt.partial_cancellation_reason,
  round(kt.total_amount * 100)::integer,
  kt.created_at,
  kt.updated_at,
  kt.last_event_sequence,
  kt.last_projected_at
from src_platform_kds.tickets kt
join commerce.orders o
  on o.id = legacy.stable_uuid('conversaflow:order:' || kt.source_transaction_id::text)
left join legacy.location_mappings lm
  on lm.source_product = 'conversaflow'
 and lm.source_schema = 'conversaflow'
 and lm.source_table = 'businesses.default_location'
 and lm.source_id = kt.business_id::text
on conflict (id) do nothing;

insert into kds.ticket_items (
  id,
  tenant_id,
  ticket_id,
  order_item_id,
  display_order,
  name,
  quantity,
  variant_name,
  notes,
  unit_price_cents,
  is_cancelled
)
select
  legacy.stable_uuid('kds:ticket_item:' || ki.ticket_item_id::text),
  t.tenant_id,
  t.id,
  oi.id,
  ki.display_order,
  ki.name,
  ki.quantity,
  ki.variant_name,
  ki.notes,
  round(ki.unit_price * 100)::integer,
  coalesce(ki.is_cancelled, false)
from src_platform_kds.ticket_items ki
join kds.tickets t
  on t.id = legacy.stable_uuid('kds:ticket:' || ki.ticket_id::text)
left join commerce.order_items oi
  on oi.id = legacy.stable_uuid('conversaflow:order_item:' || ki.source_transaction_id::text || ':' || ki.display_order::text)
where ki.quantity > 0
  and nullif(ki.name, '') is not null
on conflict (id) do nothing;

insert into kds.ticket_events (
  sequence,
  tenant_id,
  ticket_id,
  order_id,
  kind,
  status,
  occurred_at,
  source,
  source_event_key,
  payload
)
select
  ke.sequence,
  t.tenant_id,
  t.id,
  t.order_id,
  case ke.kind::text
    when 'snapshot_reconciled' then 'snapshot_reconciled'
    when 'order_upserted' then 'order_upserted'
    when 'status_changed' then 'status_changed'
    when 'order_removed' then 'order_removed'
    when 'device_action' then 'device_action'
    else 'snapshot_reconciled'
  end,
  ke.status::text,
  ke.occurred_at,
  coalesce(nullif(ke.source, ''), 'projection'),
  ke.source_event_key,
  coalesce(ke.payload, '{}'::jsonb) || jsonb_build_object(
    'source_sequence', ke.sequence,
    'source_transaction_id', ke.source_transaction_id
  )
from src_platform_kds.ticket_events ke
join kds.tickets t
  on t.id = legacy.stable_uuid('kds:ticket:' || ke.ticket_id::text)
on conflict (sequence) do nothing;

select setval(
  pg_get_serial_sequence('kds.ticket_events', 'sequence'),
  greatest((select coalesce(max(sequence), 1) from kds.ticket_events), 1),
  true
);

insert into legacy.kds_ticket_mappings (
  source_schema,
  source_table,
  source_ticket_id,
  source_transaction_id,
  tenant_id,
  ticket_id,
  order_id,
  metadata
)
select
  'kds',
  'tickets',
  kt.ticket_id::text,
  kt.source_transaction_id::text,
  t.tenant_id,
  t.id,
  t.order_id,
  jsonb_build_object('source_business_id', kt.business_id, 'source_status', kt.status::text)
from src_platform_kds.tickets kt
join kds.tickets t
  on t.id = legacy.stable_uuid('kds:ticket:' || kt.ticket_id::text)
on conflict (source_schema, source_table, source_ticket_id) do nothing;

insert into platform.external_refs (
  tenant_id,
  product_key,
  external_schema,
  external_table,
  external_id,
  metadata
)
select
  t.tenant_id,
  'kds',
  'kds',
  'tickets',
  kt.ticket_id::text,
  jsonb_build_object('target_table', 'kds.tickets', 'source_transaction_id', kt.source_transaction_id)
from src_platform_kds.tickets kt
join kds.tickets t
  on t.id = legacy.stable_uuid('kds:ticket:' || kt.ticket_id::text)
on conflict (product_key, external_schema, external_table, external_id) do nothing;

insert into observability.data_quality_findings (
  tenant_id,
  product_key,
  severity,
  finding_key,
  subject_schema,
  subject_table,
  subject_id,
  detail,
  status
)
select
  t.tenant_id,
  'kds',
  'info',
  'kds_ticket_events_missing_source_event_key',
  'kds',
  'ticket_events',
  null,
  jsonb_build_object(
    'source_rows', count(*),
    'reason', 'source sequence was used for idempotent event import because source_event_key is null'
  ),
  'open'
from src_platform_kds.ticket_events ke
join kds.tickets t
  on t.id = legacy.stable_uuid('kds:ticket:' || ke.ticket_id::text)
where ke.source_event_key is null
  and not exists (
    select 1
    from observability.data_quality_findings existing
    where existing.tenant_id = t.tenant_id
      and existing.product_key = 'kds'
      and existing.finding_key = 'kds_ticket_events_missing_source_event_key'
      and existing.subject_schema = 'kds'
      and existing.subject_table = 'ticket_events'
      and existing.subject_id is null
  )
group by t.tenant_id;
