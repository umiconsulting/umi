create schema if not exists observability;

create table observability.audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references platform.tenants(id),
  actor_user_id uuid references platform.users(id),
  actor_staff_member_id uuid references platform.staff_members(id),
  action text not null,
  subject_schema text,
  subject_table text,
  subject_id text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index observability_audit_events_tenant_time_idx
  on observability.audit_events (tenant_id, occurred_at desc);

create table observability.runtime_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references platform.tenants(id),
  product_key text,
  source text not null,
  level text not null check (level in ('debug', 'info', 'warn', 'error')),
  message text not null,
  context jsonb not null default '{}'::jsonb,
  request_id text,
  occurred_at timestamptz not null default now()
);

create index observability_runtime_logs_source_time_idx
  on observability.runtime_logs (source, occurred_at desc);

create table observability.pipeline_traces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references platform.tenants(id),
  product_key text,
  trace_id text not null,
  conversation_id uuid,
  order_id uuid,
  stage text not null,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  error text,
  occurred_at timestamptz not null default now()
);

create index observability_pipeline_traces_trace_idx
  on observability.pipeline_traces (trace_id, occurred_at);

create index observability_pipeline_traces_tenant_time_idx
  on observability.pipeline_traces (tenant_id, occurred_at desc);

create table observability.evaluation_traces (
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

create index observability_evaluation_traces_tenant_time_idx
  on observability.evaluation_traces (tenant_id, occurred_at desc);

create index observability_evaluation_traces_source_conversation_idx
  on observability.evaluation_traces (source_conversation_id, occurred_at desc);

create table observability.integration_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references platform.tenants(id),
  product_key text,
  integration_key text not null,
  status text not null check (status in ('pass', 'warn', 'fail', 'unknown')),
  checked_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb
);

create index observability_integration_checks_key_time_idx
  on observability.integration_checks (integration_key, checked_at desc);

create table observability.data_quality_findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references platform.tenants(id),
  product_key text,
  severity text not null check (severity in ('info', 'warning', 'error', 'critical')),
  finding_key text not null,
  subject_schema text,
  subject_table text,
  subject_id text,
  detail jsonb not null default '{}'::jsonb,
  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'resolved', 'archived')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index observability_quality_findings_tenant_status_idx
  on observability.data_quality_findings (tenant_id, status, severity, created_at desc);

grant select on all tables in schema observability to umi_app, umi_worker, umi_readonly;
