do $$
begin
  if exists (
    select 1
    from src_platform_conversaflow.jobs
    where state in ('pending', 'claimed', 'running')
  ) then
    raise exception '4D safety gate failed: source jobs contain claimable states';
  end if;

  if exists (
    select 1
    from src_platform_conversaflow.outbox
    where state in ('pending', 'delivering')
  ) then
    raise exception '4D safety gate failed: source outbox contains deliverable states';
  end if;
end $$;

create table if not exists conversaflow.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  source_product_id text not null,
  name text not null,
  price_cents integer not null default 0,
  category text,
  available boolean not null default true,
  zettle_uuid text,
  description text,
  variants jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, source_product_id)
);

create unique index if not exists conversaflow_products_tenant_zettle_uuid_idx
  on conversaflow.products (tenant_id, zettle_uuid)
  where zettle_uuid is not null;

create index if not exists conversaflow_products_tenant_category_idx
  on conversaflow.products (tenant_id, category, available);

grant select on conversaflow.products to umi_app, umi_worker, umi_readonly;

insert into conversaflow.channels (
  id,
  tenant_id,
  key,
  name,
  created_at
)
select
  legacy.stable_uuid('conversaflow:channel:' || tm.tenant_id::text || ':' || channel_key),
  tm.tenant_id,
  channel_key,
  channel_name,
  now()
from src_platform_conversaflow.businesses b
join legacy.tenant_mappings tm
  on tm.source_product = 'conversaflow'
 and tm.source_schema = 'conversaflow'
 and tm.source_table = 'businesses'
 and tm.source_id = b.id::text
cross join (
  values
    ('whatsapp'::text, 'WhatsApp'::text),
    ('slack'::text, 'Slack'::text)
) channels(channel_key, channel_name)
on conflict (tenant_id, key) do nothing;

insert into conversaflow.channel_accounts (
  id,
  tenant_id,
  location_id,
  channel_id,
  provider,
  provider_account_id,
  address,
  config,
  status,
  created_at,
  updated_at
)
select
  legacy.stable_uuid('conversaflow:channel_account:whatsapp:' || b.id::text),
  tm.tenant_id,
  lm.location_id,
  ch.id,
  'twilio_whatsapp',
  'whatsapp:' || b.id::text,
  nullif(b.config->>'whatsapp', ''),
  jsonb_strip_nulls(jsonb_build_object(
    'source_business_id', b.id,
    'timezone', b.config->>'timezone',
    'accepts_whatsapp_orders', b.config->'accepts_whatsapp_orders',
    'order_cutoff_time', b.config->>'order_cutoff_time',
    'inferred_account', true
  )),
  'active',
  now(),
  now()
from src_platform_conversaflow.businesses b
join legacy.tenant_mappings tm
  on tm.source_product = 'conversaflow'
 and tm.source_schema = 'conversaflow'
 and tm.source_table = 'businesses'
 and tm.source_id = b.id::text
join conversaflow.channels ch
  on ch.tenant_id = tm.tenant_id
 and ch.key = 'whatsapp'
left join legacy.location_mappings lm
  on lm.source_product = 'conversaflow'
 and lm.source_schema = 'conversaflow'
 and lm.source_table = 'businesses.default_location'
 and lm.source_id = b.id::text
where b.config ? 'whatsapp'
on conflict (provider, provider_account_id) do nothing;

insert into conversaflow.channel_accounts (
  id,
  tenant_id,
  location_id,
  channel_id,
  provider,
  provider_account_id,
  address,
  config,
  status,
  created_at,
  updated_at
)
select
  legacy.stable_uuid('conversaflow:channel_account:slack:' || b.id::text),
  tm.tenant_id,
  lm.location_id,
  ch.id,
  'slack',
  coalesce(nullif(b.config->>'slack_channel_id', ''), 'slack:' || b.id::text),
  nullif(b.config->>'slack_channel_name', ''),
  jsonb_strip_nulls(jsonb_build_object(
    'source_business_id', b.id,
    'channel_name', b.config->>'slack_channel_name',
    'inferred_account', true
  )),
  'active',
  now(),
  now()
from src_platform_conversaflow.businesses b
join legacy.tenant_mappings tm
  on tm.source_product = 'conversaflow'
 and tm.source_schema = 'conversaflow'
 and tm.source_table = 'businesses'
 and tm.source_id = b.id::text
join conversaflow.channels ch
  on ch.tenant_id = tm.tenant_id
 and ch.key = 'slack'
left join legacy.location_mappings lm
  on lm.source_product = 'conversaflow'
 and lm.source_schema = 'conversaflow'
 and lm.source_table = 'businesses.default_location'
 and lm.source_id = b.id::text
where b.config ? 'slack_channel_id'
on conflict (provider, provider_account_id) do nothing;

insert into conversaflow.conversations (
  id,
  tenant_id,
  location_id,
  contact_id,
  channel_account_id,
  provider_thread_id,
  status,
  metadata,
  opened_at,
  updated_at
)
select
  legacy.stable_uuid('conversaflow:conversation:' || c.id::text),
  tm.tenant_id,
  lm.location_id,
  cm.contact_id,
  ca.id,
  c.id::text,
  case c.status
    when 'active' then 'open'
    else 'archived'
  end,
  jsonb_strip_nulls(jsonb_build_object(
    'source_conversation_id', c.id,
    'source_business_id', c.business_id,
    'source_customer_id', c.customer_id,
    'source_status', c.status,
    'current_state', c.current_state,
    'state_data', c.state_data,
    'summary', c.summary,
    'history_migrated', c.history_migrated,
    'draft_cart', c.draft_cart,
    'state_version', c.state_version,
    'draft_cart_version', c.draft_cart_version,
    'pending_clarification', c.pending_clarification
  )),
  c.created_at,
  coalesce(c.last_message_at, c.created_at)
from src_platform_conversaflow.conversations c
join legacy.tenant_mappings tm
  on tm.source_product = 'conversaflow'
 and tm.source_schema = 'conversaflow'
 and tm.source_table = 'businesses'
 and tm.source_id = c.business_id::text
join legacy.contact_mappings cm
  on cm.source_product = 'conversaflow'
 and cm.source_schema = 'conversaflow'
 and cm.source_table = 'customers'
 and cm.source_id = c.customer_id::text
left join legacy.location_mappings lm
  on lm.source_product = 'conversaflow'
 and lm.source_schema = 'conversaflow'
 and lm.source_table = 'businesses.default_location'
 and lm.source_id = c.business_id::text
left join conversaflow.channel_accounts ca
  on ca.provider = 'twilio_whatsapp'
 and ca.provider_account_id = 'whatsapp:' || c.business_id::text
on conflict (id) do nothing;

insert into conversaflow.messages (
  id,
  tenant_id,
  conversation_id,
  contact_id,
  provider_message_id,
  role,
  body,
  payload,
  received_at,
  created_at
)
select
  legacy.stable_uuid('conversaflow:message:' || m.id::text),
  c.tenant_id,
  c.id,
  c.contact_id,
  m.twilio_message_sid,
  case m.role
    when 'assistant' then 'assistant'
    when 'user' then 'user'
    when 'system' then 'system'
    when 'tool' then 'tool'
    when 'operator' then 'operator'
    else 'system'
  end,
  m.content,
  jsonb_strip_nulls(jsonb_build_object(
    'source_message_id', m.id,
    'intent', m.intent,
    'entities', m.entities,
    'message_index', m.message_index,
    'embedding_model', m.embedding_model,
    'embedding_present', m.embedding is not null
  )),
  m.created_at,
  m.created_at
from src_platform_conversaflow.messages m
join conversaflow.conversations c
  on c.id = legacy.stable_uuid('conversaflow:conversation:' || m.conversation_id::text)
on conflict (id) do nothing;

insert into conversaflow.conversation_turns (
  id,
  tenant_id,
  conversation_id,
  status,
  request_id,
  started_at,
  completed_at,
  metadata,
  created_at
)
select
  legacy.stable_uuid('conversaflow:turn:' || t.id::text),
  c.tenant_id,
  c.id,
  case t.status
    when 'completed' then 'completed'
    when 'processing' then 'processing'
    when 'superseded' then 'superseded'
    when 'cancelled' then 'failed'
    else 'failed'
  end,
  null,
  t.first_message_at,
  coalesce(t.processed_at, t.released_at, t.superseded_at),
  jsonb_strip_nulls(jsonb_build_object(
    'source_turn_id', t.id,
    'source_customer_id', t.customer_id,
    'source_business_id', t.business_id,
    'source_status', t.status,
    'source_message_ids', to_jsonb(t.source_message_ids),
    'merged_user_text', t.merged_user_text,
    'integrity_decision', t.integrity_decision,
    'integrity_reason', t.integrity_reason,
    'base_state_version', t.base_state_version,
    'last_message_at', t.last_message_at,
    'hold_until', t.hold_until,
    'released_at', t.released_at,
    'processed_at', t.processed_at,
    'superseded_at', t.superseded_at,
    'extracted_intent', t.extracted_intent,
    'reconciled_action', t.reconciled_action,
    'assistant_message_id', t.assistant_message_id
  )),
  t.created_at
from src_platform_conversaflow.conversation_turns t
join conversaflow.conversations c
  on c.id = legacy.stable_uuid('conversaflow:conversation:' || t.conversation_id::text)
on conflict (id) do nothing;

insert into conversaflow.memory_items (
  id,
  tenant_id,
  contact_id,
  conversation_id,
  memory_type,
  content,
  attributes,
  embedding_model,
  created_at,
  updated_at
)
select
  legacy.stable_uuid('conversaflow:customer_preferences:' || cp.customer_id::text),
  cm.tenant_id,
  cm.contact_id,
  null,
  'customer_preferences',
  'Imported ConversaFlow customer preferences',
  jsonb_strip_nulls(jsonb_build_object(
    'source_customer_id', cp.customer_id,
    'favorite_services', to_jsonb(cp.favorite_services),
    'usual_modifications', cp.usual_modifications,
    'total_transactions', cp.total_transactions,
    'avg_transaction_value', cp.avg_transaction_value,
    'last_transaction_at', cp.last_transaction_at,
    'facts', cp.facts
  )),
  null,
  cp.updated_at,
  cp.updated_at
from src_platform_conversaflow.customer_preferences cp
join legacy.contact_mappings cm
  on cm.source_product = 'conversaflow'
 and cm.source_schema = 'conversaflow'
 and cm.source_table = 'customers'
 and cm.source_id = cp.customer_id::text
on conflict (id) do nothing;

insert into conversaflow.products (
  id,
  tenant_id,
  source_product_id,
  name,
  price_cents,
  category,
  available,
  zettle_uuid,
  description,
  variants,
  metadata,
  synced_at,
  created_at,
  updated_at
)
select
  legacy.stable_uuid('conversaflow:product:' || p.id::text),
  tm.tenant_id,
  p.id::text,
  p.name,
  round(p.price * 100)::integer,
  p.category,
  coalesce(p.available, true),
  p.zettle_uuid,
  p.description,
  coalesce(p.variants, '{}'::jsonb),
  jsonb_strip_nulls(jsonb_build_object(
    'source_business_id', p.business_id,
    'source_price', p.price,
    'name_embedding_present', p.name_embedding is not null,
    'embedding_not_copied_reason', case when p.name_embedding is not null then 'target product table intentionally omits vector embeddings in this local transition slice' end
  )),
  p.synced_at,
  coalesce(p.synced_at, now()),
  coalesce(p.synced_at, now())
from src_platform_conversaflow.products p
join legacy.tenant_mappings tm
  on tm.source_product = 'conversaflow'
 and tm.source_schema = 'conversaflow'
 and tm.source_table = 'businesses'
 and tm.source_id = p.business_id::text
on conflict (id) do nothing;

insert into conversaflow.workflow_jobs (
  id,
  tenant_id,
  conversation_id,
  order_id,
  job_type,
  aggregate_type,
  aggregate_id,
  payload,
  state,
  priority,
  max_attempts,
  attempt_count,
  next_run_at,
  locked_at,
  locked_by,
  completed_at,
  error,
  created_at
)
select
  legacy.stable_uuid('conversaflow:job:' || j.id::text),
  tm.tenant_id,
  conv.id,
  ord.id,
  j.job_type,
  case j.aggregate_type
    when 'customer' then 'contact'
    else j.aggregate_type
  end,
  coalesce(
    conv.id,
    msg.id,
    contact_map.contact_id,
    ord.id,
    case when j.aggregate_type = 'business' then tm.tenant_id end
  ),
  coalesce(j.payload, '{}'::jsonb),
  case j.state
    when 'completed' then 'completed'
    when 'failed' then 'failed'
    when 'dead' then 'dead'
    else 'dead'
  end,
  coalesce(j.priority, 0),
  coalesce(j.max_attempts, 3),
  coalesce(j.attempt_count, 0),
  coalesce(j.next_run_at, j.created_at, now()),
  j.locked_at,
  j.locked_by,
  j.completed_at,
  j.error,
  j.created_at
from src_platform_conversaflow.jobs j
join legacy.tenant_mappings tm
  on tm.source_product = 'conversaflow'
 and tm.source_schema = 'conversaflow'
 and tm.source_table = 'businesses'
 and tm.source_id = j.business_id::text
left join conversaflow.conversations conv
  on j.aggregate_type = 'conversation'
 and conv.id = legacy.stable_uuid('conversaflow:conversation:' || j.aggregate_id::text)
left join conversaflow.messages msg
  on j.aggregate_type = 'message'
 and msg.id = legacy.stable_uuid('conversaflow:message:' || j.aggregate_id::text)
left join legacy.contact_mappings contact_map
  on j.aggregate_type = 'customer'
 and contact_map.source_product = 'conversaflow'
 and contact_map.source_schema = 'conversaflow'
 and contact_map.source_table = 'customers'
 and contact_map.source_id = j.aggregate_id::text
left join commerce.orders ord
  on j.aggregate_type = 'transaction'
 and ord.id = legacy.stable_uuid('conversaflow:order:' || j.aggregate_id::text)
on conflict (id) do nothing;

insert into conversaflow.job_attempts (
  id,
  tenant_id,
  job_id,
  attempt,
  started_at,
  finished_at,
  outcome,
  error,
  metadata
)
select
  legacy.stable_uuid('conversaflow:job_attempt:' || ja.id::text),
  j.tenant_id,
  j.id,
  ja.attempt,
  ja.started_at,
  ja.finished_at,
  case ja.outcome
    when 'running' then 'running'
    when 'success' then 'success'
    when 'error' then 'error'
    when 'timeout' then 'timeout'
    else 'error'
  end,
  ja.error,
  coalesce(ja.metadata, '{}'::jsonb) || jsonb_build_object('source_attempt_id', ja.id)
from src_platform_conversaflow.job_attempts ja
join conversaflow.workflow_jobs j
  on j.id = legacy.stable_uuid('conversaflow:job:' || ja.job_id::text)
on conflict (id) do nothing;

insert into conversaflow.outbox (
  id,
  tenant_id,
  job_id,
  conversation_id,
  order_id,
  kind,
  idempotency_key,
  payload,
  state,
  attempts,
  max_attempts,
  next_run_at,
  delivered_at,
  error,
  created_at
)
select
  legacy.stable_uuid('conversaflow:outbox:' || o.id::text),
  tm.tenant_id,
  j.id,
  conv.id,
  ord.id,
  o.kind,
  o.idempotency_key,
  coalesce(o.payload, '{}'::jsonb),
  case o.state
    when 'delivered' then 'delivered'
    when 'dead' then 'dead'
    when 'failed' then 'failed'
    else 'dead'
  end,
  coalesce(o.attempts, 0),
  coalesce(o.max_attempts, 5),
  coalesce(o.next_run_at, o.created_at, now()),
  o.delivered_at,
  o.error,
  o.created_at
from src_platform_conversaflow.outbox o
join legacy.tenant_mappings tm
  on tm.source_product = 'conversaflow'
 and tm.source_schema = 'conversaflow'
 and tm.source_table = 'businesses'
 and tm.source_id = o.business_id::text
left join conversaflow.workflow_jobs j
  on j.id = legacy.stable_uuid('conversaflow:job:' || o.job_id::text)
left join conversaflow.conversations conv
  on conv.id = legacy.stable_uuid('conversaflow:conversation:' || o.aggregate_id::text)
left join commerce.orders ord
  on ord.id = legacy.stable_uuid('conversaflow:order:' || o.aggregate_id::text)
on conflict (id) do nothing;

insert into platform.external_refs (
  tenant_id,
  product_key,
  external_schema,
  external_table,
  external_id,
  metadata
)
select c.tenant_id, 'conversaflow', 'conversaflow', 'conversations', src.id::text, jsonb_build_object('target_table', 'conversaflow.conversations')
from src_platform_conversaflow.conversations src
join conversaflow.conversations c on c.id = legacy.stable_uuid('conversaflow:conversation:' || src.id::text)
on conflict (product_key, external_schema, external_table, external_id) do nothing;

insert into platform.external_refs (
  tenant_id,
  product_key,
  external_schema,
  external_table,
  external_id,
  metadata
)
select m.tenant_id, 'conversaflow', 'conversaflow', 'messages', src.id::text, jsonb_build_object('target_table', 'conversaflow.messages')
from src_platform_conversaflow.messages src
join conversaflow.messages m on m.id = legacy.stable_uuid('conversaflow:message:' || src.id::text)
on conflict (product_key, external_schema, external_table, external_id) do nothing;

insert into platform.external_refs (
  tenant_id,
  product_key,
  external_schema,
  external_table,
  external_id,
  metadata
)
select t.tenant_id, 'conversaflow', 'conversaflow', 'conversation_turns', src.id::text, jsonb_build_object('target_table', 'conversaflow.conversation_turns')
from src_platform_conversaflow.conversation_turns src
join conversaflow.conversation_turns t on t.id = legacy.stable_uuid('conversaflow:turn:' || src.id::text)
on conflict (product_key, external_schema, external_table, external_id) do nothing;

insert into platform.external_refs (
  tenant_id,
  product_key,
  external_schema,
  external_table,
  external_id,
  metadata
)
select p.tenant_id, 'conversaflow', 'conversaflow', 'products', src.id::text, jsonb_build_object('target_table', 'conversaflow.products')
from src_platform_conversaflow.products src
join conversaflow.products p on p.id = legacy.stable_uuid('conversaflow:product:' || src.id::text)
on conflict (product_key, external_schema, external_table, external_id) do nothing;

insert into platform.external_refs (
  tenant_id,
  product_key,
  external_schema,
  external_table,
  external_id,
  metadata
)
select j.tenant_id, 'conversaflow', 'conversaflow', 'jobs', src.id::text, jsonb_build_object('target_table', 'conversaflow.workflow_jobs')
from src_platform_conversaflow.jobs src
join conversaflow.workflow_jobs j on j.id = legacy.stable_uuid('conversaflow:job:' || src.id::text)
on conflict (product_key, external_schema, external_table, external_id) do nothing;

insert into platform.external_refs (
  tenant_id,
  product_key,
  external_schema,
  external_table,
  external_id,
  metadata
)
select o.tenant_id, 'conversaflow', 'conversaflow', 'outbox', src.id::text, jsonb_build_object('target_table', 'conversaflow.outbox')
from src_platform_conversaflow.outbox src
join conversaflow.outbox o on o.id = legacy.stable_uuid('conversaflow:outbox:' || src.id::text)
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
  tm.tenant_id,
  'conversaflow',
  'info',
  case dq.finding_key
    when 'conversaflow_contact_synthetic_eval' then 'conversaflow_conversation_synthetic_eval_excluded'
    else 'conversaflow_conversation_unknown_contact_excluded'
  end,
  'conversaflow',
  'conversations',
  c.id::text,
  jsonb_build_object(
    'source_customer_id', c.customer_id,
    'reason', 'conversation excluded from production-facing import because source customer was not production-verified'
  ),
  'open'
from src_platform_conversaflow.conversations c
join legacy.tenant_mappings tm
  on tm.source_product = 'conversaflow'
 and tm.source_schema = 'conversaflow'
 and tm.source_table = 'businesses'
 and tm.source_id = c.business_id::text
join observability.data_quality_findings dq
  on dq.product_key = 'conversaflow'
 and dq.subject_schema = 'conversaflow'
 and dq.subject_table = 'customers'
 and dq.subject_id = c.customer_id::text
 and dq.finding_key in ('conversaflow_contact_synthetic_eval', 'conversaflow_contact_unknown')
where not exists (
  select 1
  from observability.data_quality_findings existing
  where existing.product_key = 'conversaflow'
    and existing.subject_schema = 'conversaflow'
    and existing.subject_table = 'conversations'
    and existing.subject_id = c.id::text
    and existing.finding_key in (
      'conversaflow_conversation_synthetic_eval_excluded',
      'conversaflow_conversation_unknown_contact_excluded'
    )
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
  tm.tenant_id,
  'conversaflow',
  'warning',
  'conversaflow_customer_preferences_unmapped_contact_excluded',
  'conversaflow',
  'customer_preferences',
  cp.customer_id::text,
  jsonb_build_object('reason', 'customer preference excluded because customer has no production-verified contact mapping'),
  'open'
from src_platform_conversaflow.customer_preferences cp
join src_platform_conversaflow.customers c on c.id = cp.customer_id
join legacy.tenant_mappings tm
  on tm.source_product = 'conversaflow'
 and tm.source_schema = 'conversaflow'
 and tm.source_table = 'businesses'
 and tm.source_id = c.business_id::text
left join legacy.contact_mappings cm
  on cm.source_product = 'conversaflow'
 and cm.source_schema = 'conversaflow'
 and cm.source_table = 'customers'
 and cm.source_id = cp.customer_id::text
where cm.contact_id is null
  and not exists (
    select 1
    from observability.data_quality_findings existing
    where existing.product_key = 'conversaflow'
      and existing.finding_key = 'conversaflow_customer_preferences_unmapped_contact_excluded'
      and existing.subject_schema = 'conversaflow'
      and existing.subject_table = 'customer_preferences'
      and existing.subject_id = cp.customer_id::text
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
  j.tenant_id,
  'conversaflow',
  'info',
  'conversaflow_job_attempt_running_source_archived',
  'conversaflow',
  'job_attempts',
  ja.id::text,
  jsonb_build_object('source_job_id', ja.job_id, 'reason', 'source attempt outcome was running while parent source job was terminal; imported as historical evidence only'),
  'open'
from src_platform_conversaflow.job_attempts ja
join conversaflow.workflow_jobs j
  on j.id = legacy.stable_uuid('conversaflow:job:' || ja.job_id::text)
where ja.outcome = 'running'
  and not exists (
    select 1
    from observability.data_quality_findings existing
    where existing.product_key = 'conversaflow'
      and existing.finding_key = 'conversaflow_job_attempt_running_source_archived'
      and existing.subject_schema = 'conversaflow'
      and existing.subject_table = 'job_attempts'
      and existing.subject_id = ja.id::text
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
  tm.tenant_id,
  'conversaflow',
  'info',
  'conversaflow_product_embeddings_not_copied',
  'conversaflow',
  'products',
  null,
  jsonb_build_object('source_rows', count(*), 'reason', 'local transition product table preserves product facts but does not copy vector embeddings'),
  'open'
from src_platform_conversaflow.products p
join legacy.tenant_mappings tm
  on tm.source_product = 'conversaflow'
 and tm.source_schema = 'conversaflow'
 and tm.source_table = 'businesses'
 and tm.source_id = p.business_id::text
where p.name_embedding is not null
  and not exists (
    select 1
    from observability.data_quality_findings existing
    where existing.tenant_id = tm.tenant_id
      and existing.product_key = 'conversaflow'
      and existing.finding_key = 'conversaflow_product_embeddings_not_copied'
      and existing.subject_schema = 'conversaflow'
      and existing.subject_table = 'products'
      and existing.subject_id is null
  )
group by tm.tenant_id;
