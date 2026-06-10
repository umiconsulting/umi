create table if not exists observability.evaluation_traces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references platform.tenants(id),
  product_key text,
  source_schema text not null,
  source_table text not null,
  source_id text not null,
  trace_id text,
  source_conversation_id text,
  source_turn_id text,
  conversation_id uuid,
  turn_id uuid,
  stage text,
  event text,
  evaluation_kind text not null default 'synthetic_eval',
  agreement boolean,
  detail jsonb not null default '{}'::jsonb,
  error text,
  occurred_at timestamptz not null default now(),
  unique (source_schema, source_table, source_id)
);

create index if not exists observability_evaluation_traces_tenant_time_idx
  on observability.evaluation_traces (tenant_id, occurred_at desc);

create index if not exists observability_evaluation_traces_source_conversation_idx
  on observability.evaluation_traces (source_conversation_id, occurred_at desc);

grant select on observability.evaluation_traces to umi_app, umi_worker, umi_readonly;

with classified_pipeline_traces as (
  select
    pt.*,
    case
      when prod_conversation.id is not null then 'production'
      when eval_finding.id is not null then 'evaluation'
      when pt.conversation_id is null then 'production_business_runtime'
      else 'unmapped'
    end as observability_class,
    prod_conversation.id as target_conversation_id,
    prod_turn.id as target_turn_id,
    coalesce(prod_conversation.tenant_id, ord.tenant_id, source_conversation_tm.tenant_id, tm.tenant_id) as tenant_id,
    ord.id as order_id
  from src_platform_conversaflow.pipeline_traces pt
  left join src_platform_conversaflow.conversations source_conversation
    on source_conversation.id = pt.conversation_id
  left join conversaflow.conversations prod_conversation
    on prod_conversation.id = legacy.stable_uuid('conversaflow:conversation:' || pt.conversation_id::text)
  left join conversaflow.conversation_turns prod_turn
    on prod_turn.id = legacy.stable_uuid('conversaflow:turn:' || pt.turn_id::text)
  left join observability.data_quality_findings eval_finding
    on eval_finding.product_key = 'conversaflow'
   and eval_finding.finding_key = 'conversaflow_conversation_synthetic_eval_excluded'
   and eval_finding.subject_schema = 'conversaflow'
   and eval_finding.subject_table = 'conversations'
   and eval_finding.subject_id = pt.conversation_id::text
  left join legacy.tenant_mappings tm
    on tm.source_product = 'conversaflow'
   and tm.source_schema = 'conversaflow'
   and tm.source_table = 'businesses'
   and tm.source_id = pt.business_id
  left join legacy.tenant_mappings source_conversation_tm
    on source_conversation_tm.source_product = 'conversaflow'
   and source_conversation_tm.source_schema = 'conversaflow'
   and source_conversation_tm.source_table = 'businesses'
   and source_conversation_tm.source_id = source_conversation.business_id::text
  left join commerce.orders ord
    on ord.id = legacy.stable_uuid('conversaflow:order:' || (pt.detail->>'source_transaction_id'))
)
insert into observability.pipeline_traces (
  id,
  tenant_id,
  product_key,
  trace_id,
  conversation_id,
  order_id,
  stage,
  event,
  detail,
  error,
  occurred_at
)
select
  legacy.stable_uuid('conversaflow:pipeline_trace:' || id::text),
  tenant_id,
  'conversaflow',
  trace_id,
  target_conversation_id,
  order_id,
  stage,
  event,
  coalesce(detail, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'observability_class', 'production',
    'runtime_scope', case when observability_class = 'production_business_runtime' then 'business_runtime' else 'conversation_runtime' end,
    'source_pipeline_trace_id', id,
    'source_conversation_id', conversation_id,
    'source_turn_id', turn_id,
    'target_turn_id', target_turn_id
  )),
  error,
  ts
from classified_pipeline_traces
where observability_class in ('production', 'production_business_runtime')
on conflict (id) do nothing;

with classified_pipeline_traces as (
  select
    pt.*,
    coalesce(prod_conversation.tenant_id, source_conversation_tm.tenant_id, tm.tenant_id) as tenant_id,
    prod_conversation.id as target_conversation_id,
    prod_turn.id as target_turn_id
  from src_platform_conversaflow.pipeline_traces pt
  left join src_platform_conversaflow.conversations source_conversation
    on source_conversation.id = pt.conversation_id
  join observability.data_quality_findings eval_finding
    on eval_finding.product_key = 'conversaflow'
   and eval_finding.finding_key = 'conversaflow_conversation_synthetic_eval_excluded'
   and eval_finding.subject_schema = 'conversaflow'
   and eval_finding.subject_table = 'conversations'
   and eval_finding.subject_id = pt.conversation_id::text
  left join legacy.tenant_mappings tm
    on tm.source_product = 'conversaflow'
   and tm.source_schema = 'conversaflow'
   and tm.source_table = 'businesses'
   and tm.source_id = pt.business_id
  left join legacy.tenant_mappings source_conversation_tm
    on source_conversation_tm.source_product = 'conversaflow'
   and source_conversation_tm.source_schema = 'conversaflow'
   and source_conversation_tm.source_table = 'businesses'
   and source_conversation_tm.source_id = source_conversation.business_id::text
  left join conversaflow.conversations prod_conversation
    on prod_conversation.id = legacy.stable_uuid('conversaflow:conversation:' || pt.conversation_id::text)
  left join conversaflow.conversation_turns prod_turn
    on prod_turn.id = legacy.stable_uuid('conversaflow:turn:' || pt.turn_id::text)
)
insert into observability.evaluation_traces (
  id,
  tenant_id,
  product_key,
  source_schema,
  source_table,
  source_id,
  trace_id,
  source_conversation_id,
  source_turn_id,
  conversation_id,
  turn_id,
  stage,
  event,
  evaluation_kind,
  agreement,
  detail,
  error,
  occurred_at
)
select
  legacy.stable_uuid('conversaflow:evaluation_pipeline_trace:' || id::text),
  tenant_id,
  'conversaflow',
  'conversaflow',
  'pipeline_traces',
  id::text,
  trace_id,
  conversation_id::text,
  turn_id::text,
  target_conversation_id,
  target_turn_id,
  stage,
  event,
  'synthetic_eval_pipeline',
  null,
  coalesce(detail, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'observability_class', 'evaluation',
    'source_pipeline_trace_id', id,
    'source_business_id', business_id
  )),
  error,
  ts
from classified_pipeline_traces
on conflict (source_schema, source_table, source_id) do nothing;

insert into observability.evaluation_traces (
  id,
  tenant_id,
  product_key,
  source_schema,
  source_table,
  source_id,
  trace_id,
  source_conversation_id,
  source_turn_id,
  conversation_id,
  turn_id,
  stage,
  event,
  evaluation_kind,
  agreement,
  detail,
  error,
  occurred_at
)
select
  legacy.stable_uuid('conversaflow:eval_trace:' || e.id::text),
  tm.tenant_id,
  'conversaflow',
  'conversaflow',
  'eval_traces',
  e.id::text,
  e.metadata->>'request_id',
  e.conversation_id::text,
  e.turn_id::text,
  prod_conversation.id,
  prod_turn.id,
  'eval_trace',
  coalesce(e.metadata->>'comparison_type', 'comparison'),
  'synthetic_eval_trace',
  e.agreement,
  jsonb_strip_nulls(jsonb_build_object(
    'observability_class', 'evaluation',
    'turn_sequence', e.turn_sequence,
    'authoritative_decision', e.authoritative_decision,
    'harness_decision', e.harness_decision,
    'metadata', e.metadata,
    'source_business_id', e.business_id
  )),
  null,
  e.created_at
from src_platform_conversaflow.eval_traces e
join legacy.tenant_mappings tm
  on tm.source_product = 'conversaflow'
 and tm.source_schema = 'conversaflow'
 and tm.source_table = 'businesses'
 and tm.source_id = e.business_id::text
left join conversaflow.conversations prod_conversation
  on prod_conversation.id = legacy.stable_uuid('conversaflow:conversation:' || e.conversation_id::text)
left join conversaflow.conversation_turns prod_turn
  on prod_turn.id = legacy.stable_uuid('conversaflow:turn:' || e.turn_id::text)
on conflict (source_schema, source_table, source_id) do nothing;

insert into platform.external_refs (
  tenant_id,
  product_key,
  external_schema,
  external_table,
  external_id,
  metadata
)
select
  tenant_id,
  'conversaflow',
  'conversaflow',
  'pipeline_traces',
  detail->>'source_pipeline_trace_id',
  jsonb_build_object('target_table', 'observability.pipeline_traces')
from observability.pipeline_traces
where product_key = 'conversaflow'
  and detail ? 'source_pipeline_trace_id'
on conflict (product_key, external_schema, external_table, external_id) do nothing;

insert into platform.external_refs (
  tenant_id,
  product_key,
  external_schema,
  external_table,
  external_id,
  metadata
)
select
  tenant_id,
  'conversaflow',
  source_schema,
  source_table,
  source_id,
  jsonb_build_object('target_table', 'observability.evaluation_traces')
from observability.evaluation_traces
where product_key = 'conversaflow'
on conflict (product_key, external_schema, external_table, external_id) do nothing;

insert into observability.integration_checks (
  id,
  tenant_id,
  product_key,
  integration_key,
  status,
  checked_at,
  detail
)
select
  legacy.stable_uuid('observability:integration_check:conversaflow:4e:' || tm.tenant_id::text),
  tm.tenant_id,
  'conversaflow',
  'phase_4e_observability_import',
  'pass',
  now(),
  jsonb_build_object(
    'production_pipeline_traces', (select count(*) from observability.pipeline_traces where product_key = 'conversaflow'),
    'evaluation_traces', (select count(*) from observability.evaluation_traces where product_key = 'conversaflow'),
    'eval_source_traces', (select count(*) from src_platform_conversaflow.eval_traces),
    'note', 'production and synthetic evaluation observability are separated'
  )
from legacy.tenant_mappings tm
where tm.source_product = 'conversaflow'
  and tm.source_schema = 'conversaflow'
  and tm.source_table = 'businesses'
on conflict (id) do nothing;

with pipeline_source as (
  select
    pt.id as source_id,
    coalesce(prod_conversation.tenant_id, ord.tenant_id, source_conversation_tm.tenant_id, tm.tenant_id) as tenant_id
  from src_platform_conversaflow.pipeline_traces pt
  left join src_platform_conversaflow.conversations source_conversation
    on source_conversation.id = pt.conversation_id
  left join conversaflow.conversations prod_conversation
    on prod_conversation.id = legacy.stable_uuid('conversaflow:conversation:' || pt.conversation_id::text)
  left join legacy.tenant_mappings tm
    on tm.source_product = 'conversaflow'
   and tm.source_schema = 'conversaflow'
   and tm.source_table = 'businesses'
   and tm.source_id = pt.business_id
  left join legacy.tenant_mappings source_conversation_tm
    on source_conversation_tm.source_product = 'conversaflow'
   and source_conversation_tm.source_schema = 'conversaflow'
   and source_conversation_tm.source_table = 'businesses'
   and source_conversation_tm.source_id = source_conversation.business_id::text
  left join commerce.orders ord
    on ord.id = legacy.stable_uuid('conversaflow:order:' || (pt.detail->>'source_transaction_id'))
)
update observability.pipeline_traces target
set tenant_id = pipeline_source.tenant_id
from pipeline_source
where target.product_key = 'conversaflow'
  and target.detail->>'source_pipeline_trace_id' = pipeline_source.source_id::text
  and target.tenant_id is null
  and pipeline_source.tenant_id is not null;

with pipeline_source as (
  select
    pt.id as source_id,
    coalesce(prod_conversation.tenant_id, source_conversation_tm.tenant_id, tm.tenant_id) as tenant_id
  from src_platform_conversaflow.pipeline_traces pt
  left join src_platform_conversaflow.conversations source_conversation
    on source_conversation.id = pt.conversation_id
  left join conversaflow.conversations prod_conversation
    on prod_conversation.id = legacy.stable_uuid('conversaflow:conversation:' || pt.conversation_id::text)
  left join legacy.tenant_mappings tm
    on tm.source_product = 'conversaflow'
   and tm.source_schema = 'conversaflow'
   and tm.source_table = 'businesses'
   and tm.source_id = pt.business_id
  left join legacy.tenant_mappings source_conversation_tm
    on source_conversation_tm.source_product = 'conversaflow'
   and source_conversation_tm.source_schema = 'conversaflow'
   and source_conversation_tm.source_table = 'businesses'
   and source_conversation_tm.source_id = source_conversation.business_id::text
)
update observability.evaluation_traces target
set tenant_id = pipeline_source.tenant_id
from pipeline_source
where target.product_key = 'conversaflow'
  and target.source_schema = 'conversaflow'
  and target.source_table = 'pipeline_traces'
  and target.source_id = pipeline_source.source_id::text
  and target.tenant_id is null
  and pipeline_source.tenant_id is not null;

update platform.external_refs er
set tenant_id = pt.tenant_id
from observability.pipeline_traces pt
where er.product_key = 'conversaflow'
  and er.external_schema = 'conversaflow'
  and er.external_table = 'pipeline_traces'
  and er.external_id = pt.detail->>'source_pipeline_trace_id'
  and er.tenant_id is null
  and pt.tenant_id is not null;

update platform.external_refs er
set tenant_id = et.tenant_id
from observability.evaluation_traces et
where er.product_key = 'conversaflow'
  and er.external_schema = et.source_schema
  and er.external_table = et.source_table
  and er.external_id = et.source_id
  and er.tenant_id is null
  and et.tenant_id is not null;
