create schema if not exists conversaflow;

create table conversaflow.channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  key text not null check (key in ('whatsapp', 'sms', 'slack', 'web', 'voice')),
  name text not null,
  status text not null default 'active'
    check (status in ('active', 'disabled', 'archived')),
  created_at timestamptz not null default now(),
  unique (tenant_id, key)
);

create table conversaflow.channel_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  location_id uuid references platform.locations(id),
  channel_id uuid not null references conversaflow.channels(id),
  provider text not null,
  provider_account_id text not null,
  address text,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'active'
    check (status in ('active', 'disabled', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_account_id)
);

create index conversaflow_channel_accounts_tenant_idx
  on conversaflow.channel_accounts (tenant_id, channel_id);

create table conversaflow.conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  location_id uuid references platform.locations(id),
  contact_id uuid references platform.contacts(id),
  channel_account_id uuid references conversaflow.channel_accounts(id),
  provider_thread_id text,
  status text not null default 'open'
    check (status in ('open', 'pending', 'closed', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index conversaflow_conversations_tenant_status_idx
  on conversaflow.conversations (tenant_id, status, updated_at desc);

create table conversaflow.messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  conversation_id uuid not null references conversaflow.conversations(id) on delete cascade,
  contact_id uuid references platform.contacts(id),
  provider_message_id text,
  role text not null check (role in ('user', 'assistant', 'system', 'tool', 'operator')),
  body text,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz,
  created_at timestamptz not null default now()
);

create index conversaflow_messages_conversation_idx
  on conversaflow.messages (conversation_id, created_at);

create table conversaflow.conversation_turns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  conversation_id uuid not null references conversaflow.conversations(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed', 'superseded')),
  request_id uuid,
  started_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index conversaflow_turns_conversation_idx
  on conversaflow.conversation_turns (conversation_id, created_at desc);

create table conversaflow.workflow_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  conversation_id uuid references conversaflow.conversations(id),
  order_id uuid references commerce.orders(id),
  job_type text not null,
  aggregate_type text,
  aggregate_id uuid,
  payload jsonb not null default '{}'::jsonb,
  state text not null default 'pending'
    check (state in ('pending', 'claimed', 'running', 'completed', 'failed', 'dead')),
  priority smallint not null default 0,
  max_attempts smallint not null default 3,
  attempt_count smallint not null default 0,
  next_run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create index conversaflow_workflow_jobs_claimable_idx
  on conversaflow.workflow_jobs (priority desc, next_run_at asc)
  where state = 'pending';

create table conversaflow.job_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  job_id uuid not null references conversaflow.workflow_jobs(id) on delete cascade,
  attempt smallint not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text not null default 'running'
    check (outcome in ('running', 'success', 'error', 'timeout')),
  error text,
  metadata jsonb not null default '{}'::jsonb,
  unique (job_id, attempt)
);

create table conversaflow.outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  job_id uuid references conversaflow.workflow_jobs(id) on delete set null,
  conversation_id uuid references conversaflow.conversations(id),
  order_id uuid references commerce.orders(id),
  kind text not null,
  idempotency_key text not null unique,
  payload jsonb not null,
  state text not null default 'pending'
    check (state in ('pending', 'delivering', 'delivered', 'failed', 'dead')),
  attempts smallint not null default 0,
  max_attempts smallint not null default 5,
  next_run_at timestamptz not null default now(),
  delivered_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create index conversaflow_outbox_deliverable_idx
  on conversaflow.outbox (next_run_at)
  where state = 'pending';

create table conversaflow.memory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  contact_id uuid references platform.contacts(id),
  conversation_id uuid references conversaflow.conversations(id),
  memory_type text not null,
  content text not null,
  attributes jsonb not null default '{}'::jsonb,
  embedding_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversaflow_memory_items_contact_idx
  on conversaflow.memory_items (tenant_id, contact_id, updated_at desc);

create table conversaflow.products (
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

create unique index conversaflow_products_tenant_zettle_uuid_idx
  on conversaflow.products (tenant_id, zettle_uuid)
  where zettle_uuid is not null;

create index conversaflow_products_tenant_category_idx
  on conversaflow.products (tenant_id, category, available);

create table conversaflow.tool_calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  conversation_id uuid references conversaflow.conversations(id),
  turn_id uuid references conversaflow.conversation_turns(id),
  tool_name text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  status text not null default 'started'
    check (status in ('started', 'succeeded', 'failed')),
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index conversaflow_tool_calls_turn_idx
  on conversaflow.tool_calls (turn_id, started_at);

create table conversaflow.conversation_outcomes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references platform.tenants(id),
  conversation_id uuid not null references conversaflow.conversations(id) on delete cascade,
  order_id uuid references commerce.orders(id),
  outcome_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

grant select on all tables in schema conversaflow to umi_app, umi_worker, umi_readonly;
