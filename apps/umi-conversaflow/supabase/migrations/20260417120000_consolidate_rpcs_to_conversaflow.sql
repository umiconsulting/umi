-- Move operational tables and search RPCs from public to conversaflow schema.
-- All runtime code now runs under DB_SCHEMA=conversaflow (Edge secret); public is
-- no longer the active schema for ConversaFlow.

-- ─── pipeline_traces ────────────────────────────────────────────────────────
-- Mirror of public.pipeline_traces for the conversaflow runtime. The edge
-- function logger now inserts here directly (no .schema('public') override).

CREATE TABLE IF NOT EXISTS conversaflow.pipeline_traces (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id        TEXT        NOT NULL,
  conversation_id UUID,
  turn_id         UUID,
  business_id     TEXT,
  stage           TEXT        NOT NULL,
  event           TEXT        NOT NULL,
  detail          JSONB,
  error           TEXT,
  ts              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_traces_trace_id_idx
  ON conversaflow.pipeline_traces (trace_id);

CREATE INDEX IF NOT EXISTS pipeline_traces_conversation_ts_idx
  ON conversaflow.pipeline_traces (conversation_id, ts DESC)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pipeline_traces_turn_id_idx
  ON conversaflow.pipeline_traces (turn_id)
  WHERE turn_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pipeline_traces_failures_idx
  ON conversaflow.pipeline_traces (ts DESC)
  WHERE event IN ('failed', 'dead');

-- ─── search_products_text ───────────────────────────────────────────────────
-- Text-based product search. Replaces public.search_products_text; operates
-- on conversaflow.products so the conversaflow client hits the right schema.

CREATE OR REPLACE FUNCTION conversaflow.search_products_text(
  p_business_id UUID,
  p_query       TEXT,
  p_limit       INTEGER DEFAULT 10
)
RETURNS TABLE(
  id          UUID,
  name        TEXT,
  price       NUMERIC,
  description TEXT,
  category    TEXT,
  variants    JSONB
)
LANGUAGE sql
STABLE
SET search_path = conversaflow
AS $$
  WITH normalized AS (
    SELECT nullif(trim(p_query), '') AS q
  )
  SELECT
    p.id,
    p.name,
    p.price,
    p.description,
    p.category,
    p.variants
  FROM conversaflow.products p
  CROSS JOIN normalized n
  WHERE p.business_id = p_business_id
    AND p.available = TRUE
    AND n.q IS NOT NULL
    AND (
      p.name ILIKE '%' || n.q || '%'
      OR coalesce(p.description, '') ILIKE '%' || n.q || '%'
      OR coalesce(p.category, '') ILIKE '%' || n.q || '%'
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(coalesce(p.variants, '[]'::jsonb)) AS variant
        WHERE coalesce(variant->>'name', '') ILIKE '%' || n.q || '%'
      )
    )
  ORDER BY
    CASE
      WHEN lower(p.name) = lower(n.q) THEN 0
      WHEN lower(p.name) LIKE lower(n.q) || '%' THEN 1
      WHEN lower(p.name) LIKE '%' || lower(n.q) || '%' THEN 2
      ELSE 3
    END,
    p.name ASC
  LIMIT greatest(coalesce(p_limit, 10), 1);
$$;

-- ─── search_products_by_embedding ──────────────────────────────────────────
-- Semantic (vector) product search. Replaces public.search_products_by_embedding.

CREATE OR REPLACE FUNCTION conversaflow.search_products_by_embedding(
  p_business_id UUID,
  p_embedding   extensions.vector(1024),
  p_limit       INTEGER DEFAULT 5,
  p_threshold   FLOAT   DEFAULT 0.65
)
RETURNS TABLE(
  id          UUID,
  name        TEXT,
  price       NUMERIC,
  description TEXT,
  category    TEXT,
  variants    JSONB,
  similarity  FLOAT
)
LANGUAGE sql
STABLE
SET search_path = conversaflow, extensions
AS $$
  SELECT
    p.id,
    p.name,
    p.price,
    p.description,
    p.category,
    p.variants,
    1 - (p.name_embedding <=> p_embedding) AS similarity
  FROM conversaflow.products p
  WHERE p.business_id    = p_business_id
    AND p.available      = TRUE
    AND p.name_embedding IS NOT NULL
    AND 1 - (p.name_embedding <=> p_embedding) >= p_threshold
  ORDER BY p.name_embedding <=> p_embedding
  LIMIT p_limit;
$$;

-- ─── search_similar_messages ────────────────────────────────────────────────
-- Semantic message memory search used by the RAG working-memory builder.
-- Finds messages in a conversation by cosine similarity, excluding the most
-- recent p_exclude_recent messages to avoid trivial recency matches.

CREATE OR REPLACE FUNCTION conversaflow.search_similar_messages(
  p_conversation_id UUID,
  p_embedding       TEXT,
  p_limit           INTEGER DEFAULT 5,
  p_exclude_recent  INTEGER DEFAULT 8
)
RETURNS TABLE(
  id         UUID,
  role       TEXT,
  content    TEXT,
  similarity FLOAT
)
LANGUAGE sql
STABLE
SET search_path = conversaflow, extensions
AS $$
  WITH recent_excluded AS (
    SELECT id
    FROM conversaflow.messages
    WHERE conversation_id = p_conversation_id
    ORDER BY created_at DESC
    LIMIT p_exclude_recent
  )
  SELECT
    m.id,
    m.role,
    m.content,
    1 - (m.embedding <=> p_embedding::extensions.vector) AS similarity
  FROM conversaflow.messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.embedding IS NOT NULL
    AND m.id NOT IN (SELECT id FROM recent_excluded)
  ORDER BY m.embedding <=> p_embedding::extensions.vector ASC
  LIMIT p_limit;
$$;
