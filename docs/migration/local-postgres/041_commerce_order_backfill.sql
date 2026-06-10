insert into commerce.orders (
  id,
  tenant_id,
  location_id,
  contact_id,
  order_number,
  source_product,
  source_ref,
  status,
  channel,
  currency,
  subtotal_cents,
  tax_cents,
  discount_cents,
  total_cents,
  notes,
  metadata,
  placed_at,
  created_at,
  updated_at
)
select
  legacy.stable_uuid('conversaflow:order:' || t.id::text),
  tm.tenant_id,
  lm.location_id,
  cm.contact_id,
  null,
  'conversaflow',
  t.id::text,
  case t.status
    when 'completed' then 'completed'
    when 'cancelled' then 'cancelled'
    else 'pending'
  end,
  coalesce(nullif(t.details->>'source_channel', ''), 'whatsapp'),
  'MXN',
  round(t.total_amount * 100)::integer,
  0,
  0,
  round(t.total_amount * 100)::integer,
  nullif(t.details->>'customer_note', ''),
  jsonb_strip_nulls(jsonb_build_object(
    'source_transaction_type', t.transaction_type,
    'source_status', t.status,
    'source_total_amount', t.total_amount,
    'source_total_cents', round(t.total_amount * 100)::integer,
    'source_service_id', t.service_id,
    'slack_message_ts', t.slack_message_ts,
    'channel_inferred', not (t.details ? 'source_channel'),
    'cancellation_reason', t.details->>'cancellation_reason',
    'cancellation_reason_code', t.details->>'cancellation_reason_code',
    'cancellation_reason_note', t.details->>'cancellation_reason_note',
    'partial_cancellation_reason', t.details->>'partial_cancellation_reason'
  )),
  t.created_at,
  t.created_at,
  t.created_at
from src_platform_conversaflow.transactions t
join legacy.tenant_mappings tm
  on tm.source_product = 'conversaflow'
 and tm.source_schema = 'conversaflow'
 and tm.source_table = 'businesses'
 and tm.source_id = t.business_id::text
left join legacy.location_mappings lm
  on lm.source_product = 'conversaflow'
 and lm.source_schema = 'conversaflow'
 and lm.source_table = 'services'
 and lm.source_id = t.service_id::text
left join legacy.contact_mappings cm
  on cm.source_product = 'conversaflow'
 and cm.source_schema = 'conversaflow'
 and cm.source_table = 'customers'
 and cm.source_id = t.customer_id::text
on conflict (id) do nothing;

update commerce.orders o
set metadata = o.metadata || jsonb_strip_nulls(jsonb_build_object(
    'source_total_amount', t.total_amount,
    'source_total_cents', round(t.total_amount * 100)::integer
  ))
from src_platform_conversaflow.transactions t
where o.id = legacy.stable_uuid('conversaflow:order:' || t.id::text)
  and o.source_product = 'conversaflow';

insert into commerce.order_items (
  id,
  tenant_id,
  order_id,
  product_ref,
  name,
  quantity,
  unit_price_cents,
  total_cents,
  variant_name,
  metadata,
  created_at
)
select
  legacy.stable_uuid('conversaflow:order_item:' || t.id::text || ':' || item_ordinal::text),
  o.tenant_id,
  o.id,
  nullif(item->>'product_id', ''),
  item->>'product_name',
  (item->>'quantity')::integer,
  round((item->>'unit_price')::numeric * 100)::integer,
  round(((item->>'unit_price')::numeric * (item->>'quantity')::numeric) * 100)::integer,
  nullif(item->>'variant_name', ''),
  jsonb_strip_nulls(jsonb_build_object(
    'source_item_ordinal', item_ordinal,
    'source_cancelled', case when item ? 'cancelled' then item->'cancelled' end
  )),
  t.created_at
from src_platform_conversaflow.transactions t
join commerce.orders o
  on o.id = legacy.stable_uuid('conversaflow:order:' || t.id::text)
cross join lateral jsonb_array_elements(coalesce(t.details->'items', '[]'::jsonb))
  with ordinality as source_item(item, item_ordinal)
where nullif(item->>'product_name', '') is not null
  and jsonb_typeof(item->'quantity') = 'number'
  and (item->>'quantity')::integer > 0
  and jsonb_typeof(item->'unit_price') = 'number'
on conflict (id) do nothing;

insert into commerce.order_events (
  id,
  tenant_id,
  order_id,
  event_type,
  previous_status,
  next_status,
  payload,
  occurred_at
)
select
  legacy.stable_uuid('conversaflow:order_event:' || e.id::text),
  o.tenant_id,
  o.id,
  'status_changed',
  e.old_status,
  e.new_status,
  jsonb_strip_nulls(jsonb_build_object(
    'source_event_id', e.id,
    'acted_by_slack_user', e.acted_by_slack_user,
    'acted_in_channel', e.acted_in_channel
  )),
  e.acted_at
from src_platform_conversaflow.transaction_status_events e
join commerce.orders o
  on o.id = legacy.stable_uuid('conversaflow:order:' || e.transaction_id::text)
on conflict (id) do nothing;

insert into legacy.order_mappings (
  source_product,
  source_schema,
  source_table,
  source_id,
  tenant_id,
  order_id,
  metadata
)
select
  'conversaflow',
  'conversaflow',
  'transactions',
  t.id::text,
  o.tenant_id,
  o.id,
  jsonb_build_object('source_business_id', t.business_id, 'source_customer_id', t.customer_id)
from src_platform_conversaflow.transactions t
join commerce.orders o
  on o.id = legacy.stable_uuid('conversaflow:order:' || t.id::text)
on conflict (source_product, source_schema, source_table, source_id) do nothing;

insert into platform.external_refs (
  tenant_id,
  product_key,
  external_schema,
  external_table,
  external_id,
  metadata
)
select
  o.tenant_id,
  'conversaflow',
  'conversaflow',
  'transactions',
  t.id::text,
  jsonb_build_object('target_table', 'commerce.orders')
from src_platform_conversaflow.transactions t
join commerce.orders o
  on o.id = legacy.stable_uuid('conversaflow:order:' || t.id::text)
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
  o.tenant_id,
  'conversaflow',
  'warning',
  'conversaflow_order_missing_contact_mapping',
  'conversaflow',
  'transactions',
  t.id::text,
  jsonb_build_object('source_customer_id', t.customer_id, 'reason', 'customer was not imported as a verified production contact'),
  'open'
from src_platform_conversaflow.transactions t
join commerce.orders o
  on o.id = legacy.stable_uuid('conversaflow:order:' || t.id::text)
left join legacy.contact_mappings cm
  on cm.source_product = 'conversaflow'
 and cm.source_schema = 'conversaflow'
 and cm.source_table = 'customers'
 and cm.source_id = t.customer_id::text
where cm.contact_id is null
  and not exists (
    select 1
    from observability.data_quality_findings existing
    where existing.product_key = 'conversaflow'
      and existing.finding_key = 'conversaflow_order_missing_contact_mapping'
      and existing.subject_schema = 'conversaflow'
      and existing.subject_table = 'transactions'
      and existing.subject_id = t.id::text
  );

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
  o.tenant_id,
  'conversaflow',
  'warning',
  'conversaflow_order_missing_location_mapping',
  'conversaflow',
  'transactions',
  t.id::text,
  jsonb_build_object('source_service_id', t.service_id, 'reason', 'source service table was not present in the copied ConversaFlow schema'),
  'open'
from src_platform_conversaflow.transactions t
join commerce.orders o
  on o.id = legacy.stable_uuid('conversaflow:order:' || t.id::text)
where o.location_id is null
  and not exists (
    select 1
    from observability.data_quality_findings existing
    where existing.product_key = 'conversaflow'
      and existing.finding_key = 'conversaflow_order_missing_location_mapping'
      and existing.subject_schema = 'conversaflow'
      and existing.subject_table = 'transactions'
      and existing.subject_id = t.id::text
  );

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
  o.tenant_id,
  'conversaflow',
  'info',
  'conversaflow_order_total_differs_from_item_sum',
  'conversaflow',
  'transactions',
  t.id::text,
  jsonb_build_object(
    'source_total_cents', round(t.total_amount * 100)::integer,
    'item_total_cents', item_totals.item_total_cents,
    'reason', 'source total preserved on order while item totals are imported independently'
  ),
  'open'
from src_platform_conversaflow.transactions t
join commerce.orders o
  on o.id = legacy.stable_uuid('conversaflow:order:' || t.id::text)
cross join lateral (
  select coalesce(sum(round(((item->>'unit_price')::numeric * (item->>'quantity')::numeric) * 100)::integer), 0) as item_total_cents
  from jsonb_array_elements(coalesce(t.details->'items', '[]'::jsonb)) item
) item_totals
where round(t.total_amount * 100)::integer <> item_totals.item_total_cents
  and not exists (
    select 1
    from observability.data_quality_findings existing
    where existing.product_key = 'conversaflow'
      and existing.finding_key = 'conversaflow_order_total_differs_from_item_sum'
      and existing.subject_schema = 'conversaflow'
      and existing.subject_table = 'transactions'
      and existing.subject_id = t.id::text
  );
