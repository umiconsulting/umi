-- ============================================================================
-- build-v3 backfill · DOMAIN: Conversations & messaging  (schema comms.*)
-- FINAL APPROVED (adversarial review). Source DB: umi_backfill_v3 (PGPORT=5233).
--
-- VERDICTS
--   comms.conversations       -> MAP  tenant.conversation
--   comms.messages            -> MAP  tenant.message (+ runtime.message_embedding)
--   comms.conversation_turns  -> DROP telemetry-to-OTel (per-turn FSM trace, 3401 rows)
--   comms.tool_calls          -> DROP telemetry-to-OTel (0 rows)
--   comms.knowledge_documents -> EMPTY (would MAP tenant.knowledge_document)
--   comms.knowledge_chunks    -> EMPTY (would MAP tenant.knowledge_chunk)
--   comms.memory_items        -> DROP  derived AI memory (0 rows; no table by design)
--   comms.customer_preferences-> DROP  derived-cache (LLM profile recomputable from retained
--                                 messages; numeric fields all 0/null; no honest target table)
--   comms.daily_summaries     -> DROP  derived-rollup (per-day Slack digest, ephemeral ids)
--
-- CHANNEL: every conversation is source_system=conversaflow (WhatsApp).
--   WhatsApp channel_type id = 4a5c8b36-342e-4f17-aa43-412f6a309e76  (verified in umi.channel_type)
-- ID CONTINUITY (verified): conversations.tenant_id ∈ tenant.business (0 miss);
--   conversations.person_id ∈ tenant.customer (0 miss, all 11 non-null).
-- ROLES (verified): only 'user'/'assistant' → CASE never yields NULL direction/sender.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) tenant.conversation  <- comms.conversations   (11 rows)
--    DROP columns: current_state/state_data/draft_cart/pending_clarification/
--      state_version/draft_cart_version (stale live-FSM machinery; runtime.conversation_state
--      is its home but year-old migrated state is not resumable),
--      conversation_history (duplicate of messages), summary (derived-cache LLM rollup,
--      recomputable from retained messages; 6 populated), history_migrated (migration flag),
--      order_id (0 populated; link would live on customer_order.conversation_id),
--      selected_location_id (0 populated; tenant.conversation has no branch column).
--    metadata.source_conversation_id -> external_ref (all 11 present).
--    outcome: no source signal in this domain -> null (set by the observability domain).
-- ---------------------------------------------------------------------------
insert into tenant.conversation
  (id, business_id, customer_id, channel_id, status, outcome,
   external_ref, started_at, last_message_at, created_at)
select
  c.id,
  c.tenant_id                                   as business_id,
  c.person_id                                   as customer_id,
  (select id from umi.channel_type where key='whatsapp') as channel_id,  -- all comms.conversations are WhatsApp; look up by key (UUIDs are random per build)
  case c.status when 'active' then 'open' else 'closed' end as status,
  null::text                                    as outcome,
  c.metadata->>'source_conversation_id'         as external_ref,
  c.created_at                                  as started_at,
  c.last_message_at,
  c.created_at
from comms.conversations c;

-- ---------------------------------------------------------------------------
-- 2) tenant.message  <- comms.messages   (1376 rows)
--    role -> direction + sender (user->inbound/customer, assistant->outbound/bot).
--    content -> body.  twilio_message_sid -> provider_message_id (616 non-null).
--    DROP: intent/entities (NLU telemetry-to-OTel), message_index (order recomputable
--      from occurred_at), metadata.source_message_id (migration lineage), tenant_id
--      (tenant.message is scoped via conversation, no business_id column),
--      embedding/embedding_model (-> runtime.message_embedding below).
--    delivery_status: no source signal -> null.
-- ---------------------------------------------------------------------------
insert into tenant.message
  (id, conversation_id, direction, sender, body,
   provider_message_id, delivery_status, occurred_at, created_at)
select
  m.id,
  m.conversation_id,
  case m.role when 'user' then 'inbound'  when 'assistant' then 'outbound' end as direction,
  case m.role when 'user' then 'customer' when 'assistant' then 'bot'      end as sender,
  m.content                     as body,
  m.twilio_message_sid          as provider_message_id,
  null::text                    as delivery_status,
  m.created_at                  as occurred_at,
  m.created_at
from comms.messages m
join comms.conversations c on c.id = m.conversation_id;   -- FK safety (0 orphans)

-- ---------------------------------------------------------------------------
-- 3) runtime.message_embedding  <- comms.messages (embedding present)   (1342 rows)
--    The vector's honest home (semantic index, read at query time for RAG — passes the
--    read-back test). Carried rather than dropped only to avoid re-embedding 1342 messages.
--    CORRECTION vs draft: default model label is 'voyage-4-lite' (the actual source model:
--    1338 rows voyage-4-lite + 4 NULL), NOT 'voyage-3' — labelling provenance honestly.
-- ---------------------------------------------------------------------------
insert into runtime.message_embedding (message_id, embedding, model, created_at)
select m.id, m.embedding, coalesce(m.embedding_model, 'voyage-4-lite'), m.created_at
from comms.messages m
where m.embedding is not null;

-- ============================================================================
-- RECONCILE (run AFTER backfill)
-- ============================================================================
-- select (select count(*) from comms.conversations) as src_conv,
--        (select count(*) from tenant.conversation)  as dst_conv;                 -- 11 = 11
-- select (select count(*) from comms.messages) as src_msg,
--        (select count(*) from tenant.message)  as dst_msg;                       -- 1376 = 1376
-- select (select count(*) from comms.messages where embedding is not null) as src_emb,
--        (select count(*) from runtime.message_embedding) as dst_emb;             -- 1342 = 1342
-- select direction, sender, count(*) from tenant.message group by 1,2;            -- inbound/customer, outbound/bot
-- select count(*) filter (where provider_message_id is not null) from tenant.message;  -- 616
-- select count(*) filter (where external_ref is not null) from tenant.conversation;    -- 11
