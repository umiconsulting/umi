-- Customer-scoped semantic message memory search.
--
-- The original search_similar_messages RPC is conversation-scoped. That is
-- useful for a long WhatsApp thread, but customer memory needs to follow the
-- customer across visits/conversations. This function searches all messages
-- for the same customer and business, while still excluding the most recent
-- messages from the active conversation so recent context is not duplicated.

CREATE OR REPLACE FUNCTION conversaflow.search_customer_messages(
  p_customer_id              UUID,
  p_business_id              UUID,
  p_current_conversation_id  UUID,
  p_embedding                TEXT,
  p_limit                    INTEGER DEFAULT 5,
  p_exclude_recent           INTEGER DEFAULT 8,
  p_roles                    TEXT[] DEFAULT ARRAY['user']
)
RETURNS TABLE(
  id              UUID,
  conversation_id UUID,
  role            TEXT,
  content         TEXT,
  created_at      TIMESTAMPTZ,
  similarity      FLOAT
)
LANGUAGE sql
STABLE
SET search_path = conversaflow, extensions
AS $$
  WITH recent_excluded AS (
    SELECT id
    FROM conversaflow.messages
    WHERE conversation_id = p_current_conversation_id
    ORDER BY created_at DESC
    LIMIT p_exclude_recent
  )
  SELECT
    m.id,
    m.conversation_id,
    m.role,
    m.content,
    m.created_at,
    1 - (m.embedding <=> p_embedding::extensions.vector) AS similarity
  FROM conversaflow.messages m
  INNER JOIN conversaflow.conversations c
    ON c.id = m.conversation_id
  WHERE c.customer_id = p_customer_id
    AND c.business_id = p_business_id
    AND m.embedding IS NOT NULL
    AND m.id NOT IN (SELECT id FROM recent_excluded)
    AND (p_roles IS NULL OR m.role = ANY(p_roles))
    AND length(trim(m.content)) >= 8
  ORDER BY m.embedding <=> p_embedding::extensions.vector ASC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION conversaflow.search_customer_messages(
  UUID,
  UUID,
  UUID,
  TEXT,
  INTEGER,
  INTEGER,
  TEXT[]
) IS
'Customer-scoped semantic memory search for conversational recall. Uses Voyage/pgvector message embeddings across all conversations for the same customer and business.';

GRANT EXECUTE ON FUNCTION conversaflow.search_customer_messages(
  UUID,
  UUID,
  UUID,
  TEXT,
  INTEGER,
  INTEGER,
  TEXT[]
) TO service_role;
