-- =============================================================================
-- 14_tenant_comms.sql  (canonical rebuild v2 — schema `tenant`, RLS domain)
--
-- The messaging domain: durable customer threads, the messages in them, and the
-- tenant's RAG knowledge base. Transformed from the old `comms.*` schema
-- (build/13_comms.sql) into the 4-schema model:
--   * conversation is now a DURABLE THREAD ONLY — the live cart/CAS state
--     (draft_cart, state_version, current_state, pending_clarification,
--     conversation_history, state_data, ...) is MOVED OUT to
--     runtime.conversation_state (authored in 16_runtime.sql).
--   * message keeps its Twilio SID dedup index (external-ref idempotency).
--   * knowledge_document / knowledge_chunk kept (RAG grounding + embeddings).
--   * DROPPED: comms.memory_items (dead), comms.tool_calls (→ OTel),
--     comms.daily_summaries (→ observability/drop), comms.conversation_turns
--     (→ runtime.conversation_turn). comms.customer_preferences is re-homed as
--     tenant.customer_note in 11_tenant_core.sql (not here).
--
-- Composite tenant isolation (kernel contract): PK (tenant_id, id); FKs into
-- sibling tenant tables are inline composite (tenant_id, <fk>) -> (tenant_id, id).
-- RLS policies are NOT authored here — 90_rls.sql enables/forces + policies.
--
-- Sources: build/13_comms.sql (comms.conversations/messages/knowledge_*).
-- Depends on: 00_foundation.sql, 11_tenant_core.sql (tenant.tenant, tenant.customer,
--             tenant.branch), extensions.vector / extensions.pg_trgm.
-- Target: PostgreSQL 18. Idempotent + re-runnable.
-- =============================================================================

begin;

set search_path = tenant, public, extensions;

-- ===========================================================================
-- tenant.conversation  <- comms.conversations  (DURABLE THREAD ONLY)
--   A customer thread. person_id -> customer_id (composite FK -> tenant.customer).
--   order_id kept as a SOFT ref (no FK; survives order deletion).
--   The live conversational/CAS state columns (current_state, conversation_history,
--   state_data, draft_cart, pending_clarification, state_version,
--   draft_cart_version, history_migrated) are MOVED OUT to
--   runtime.conversation_state — they are worker-managed machinery, not durable
--   business facts. summary + last_message_at stay (durable thread attributes).
-- ===========================================================================
create table if not exists tenant.conversation (
  id              uuid not null default gen_random_uuid(),
  tenant_id       uuid not null references tenant.tenant(id) on delete cascade,
  customer_id     uuid,                                   -- nullable: unresolved thread
  order_id        uuid,                                   -- SOFT ref (no FK)
  status          text not null default 'active',
  summary         text,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  metadata        jsonb not null default '{}'::jsonb,
  primary key (tenant_id, id),
  foreign key (tenant_id, customer_id)
    references tenant.customer (tenant_id, id) on delete set null (customer_id)
);

create index if not exists tenant_conversation_customer_status_idx
  on tenant.conversation (tenant_id, customer_id, status);
create index if not exists tenant_conversation_lastmsg_idx
  on tenant.conversation (tenant_id, last_message_at desc);

-- ===========================================================================
-- tenant.message  <- comms.messages
--   What was said. role -> sender; content -> body; embedding -> body_embedding
--   (manifest naming). Twilio SID dedup index kept (globally-unique external ref,
--   idempotent inbound gate). Composite FK -> tenant.conversation. tenant_id is
--   denormalized off the owning conversation so per-tenant semantic search needs
--   no join.
-- ===========================================================================
create table if not exists tenant.message (
  id                 uuid not null default gen_random_uuid(),
  tenant_id          uuid not null references tenant.tenant(id) on delete cascade,
  conversation_id    uuid not null,
  sender             text not null                         -- was comms.messages.role
    check (sender in ('user', 'assistant', 'system', 'tool')),
  body               text,                                -- was content (GDPR nullable)
  intent             text,
  entities           jsonb not null default '{}'::jsonb,
  message_index      integer,
  twilio_message_sid text,
  body_embedding     extensions.vector(1024),             -- was embedding (byte-identical)
  embedding_model    text,
  created_at         timestamptz not null default now(),
  metadata           jsonb not null default '{}'::jsonb,
  primary key (tenant_id, id),
  foreign key (tenant_id, conversation_id)
    references tenant.conversation (tenant_id, id) on delete cascade
);

create index if not exists tenant_message_conversation_created_idx
  on tenant.message (conversation_id, created_at);
create index if not exists tenant_message_tenant_conversation_idx
  on tenant.message (tenant_id, conversation_id, created_at);
-- idempotent inbound gate (globally-unique Twilio SID, partial).
create unique index if not exists tenant_message_twilio_sid_uidx
  on tenant.message (twilio_message_sid) where twilio_message_sid is not null;
-- semantic search (HNSW cosine).
create index if not exists tenant_message_body_embedding_idx
  on tenant.message using hnsw (body_embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ===========================================================================
-- tenant.knowledge_document  <- comms.knowledge_documents
--   Tenant-provided RAG grounding: FAQ, policies, menu notes. location_id ->
--   branch_id (composite FK -> tenant.branch; optional per-branch grounding).
-- ===========================================================================
create table if not exists tenant.knowledge_document (
  id         uuid not null default gen_random_uuid(),
  tenant_id  uuid not null references tenant.tenant(id) on delete cascade,
  branch_id  uuid,                                        -- optional per-branch grounding
  title      text not null,
  doc_type   text not null default 'note'
    check (doc_type in ('faq', 'policy', 'menu', 'note', 'other')),
  source_uri text,
  body       text,
  status     text not null default 'active'
    check (status in ('active', 'archived')),
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, branch_id)
    references tenant.branch (tenant_id, id) on delete set null (branch_id)
);

create index if not exists tenant_knowledge_document_type_idx
  on tenant.knowledge_document (tenant_id, doc_type, status);

-- ===========================================================================
-- tenant.knowledge_chunk  <- comms.knowledge_chunks
--   Chunked text + pgvector embeddings for RAG retrieval. document_id composite
--   FK -> tenant.knowledge_document. HNSW cosine index on the embedding.
-- ===========================================================================
create table if not exists tenant.knowledge_chunk (
  id              uuid not null default gen_random_uuid(),
  tenant_id       uuid not null references tenant.tenant(id) on delete cascade,
  document_id     uuid not null,
  chunk_index     integer not null default 0,
  content         text not null,
  embedding       extensions.vector(1024),
  embedding_model text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, document_id, chunk_index),
  foreign key (tenant_id, document_id)
    references tenant.knowledge_document (tenant_id, id) on delete cascade
);

create index if not exists tenant_knowledge_chunk_document_idx
  on tenant.knowledge_chunk (tenant_id, document_id, chunk_index);
create index if not exists tenant_knowledge_chunk_embedding_idx
  on tenant.knowledge_chunk using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ===========================================================================
-- GRANTS
--   tenant is the RLS domain. Domain files grant DML to umi_worker (+ readonly
--   select). umi_app gets its row-scoped DML from 90_rls.sql after RLS is
--   ENABLE+FORCE'd. No secret columns live in these tables.
-- ===========================================================================
grant select on
    tenant.conversation, tenant.message,
    tenant.knowledge_document, tenant.knowledge_chunk
  to umi_worker, umi_readonly;
grant insert, update, delete on
    tenant.conversation, tenant.message,
    tenant.knowledge_document, tenant.knowledge_chunk
  to umi_worker;

commit;

-- =============================================================================
-- TENANT-COMMS CONTRACT (for 90_rls + backfill authors)
--   RLS tenant tables (tenant_id NOT NULL, PK (tenant_id,id) -> 90_rls loop):
--     conversation, message, knowledge_document, knowledge_chunk.
--   FK topology (composite, within tenant):
--     conversation.(tenant_id, customer_id)   -> tenant.customer
--     message.(tenant_id, conversation_id)     -> tenant.conversation
--     knowledge_document.(tenant_id, branch_id)-> tenant.branch
--     knowledge_chunk.(tenant_id, document_id) -> tenant.knowledge_document
--   SOFT refs (uuid, no FK): conversation.order_id (-> tenant.order).
--   MOVED OUT to runtime.conversation_state (16): current_state,
--     conversation_history, state_data, draft_cart, pending_clarification,
--     state_version, draft_cart_version, history_migrated.
--   DROPPED: memory_items, tool_calls, daily_summaries, conversation_turns.
-- =============================================================================
