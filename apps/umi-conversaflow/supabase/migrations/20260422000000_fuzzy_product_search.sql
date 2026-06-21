-- Enable pg_trgm for character-level fuzzy matching (c→k, typos, phonetic variants).
-- Placed in extensions schema per Supabase convention.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- GIN index on normalised product names so trigram lookups don't full-scan.
-- 136 products makes this optional today, but zero cost to add.
CREATE INDEX IF NOT EXISTS products_name_trgm_idx
  ON conversaflow.products USING gin (lower(name) extensions.gin_trgm_ops);

-- Replace search_products_text: adds a fuzzy tier via word_similarity so that
-- queries like "horchata cafe" match "Horchata Kafe" (1-char substitution c→k).
-- word_similarity(query, name) > 0.4 anchors the query string as a phrase
-- against the product name, which handles single-token misspellings cleanly
-- while avoiding false positives from full-string similarity on short tokens.
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
SET search_path = conversaflow, extensions
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
    AND p.available   = TRUE
    AND n.q IS NOT NULL
    AND (
      p.name                              ILIKE '%' || n.q || '%'
      OR coalesce(p.description, '')      ILIKE '%' || n.q || '%'
      OR coalesce(p.category,    '')      ILIKE '%' || n.q || '%'
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(coalesce(p.variants, '[]'::jsonb)) AS v
        WHERE coalesce(v->>'name', '')    ILIKE '%' || n.q || '%'
      )
      -- Fuzzy tier: word_similarity checks whether the query phrase appears as a
      -- near-match substring inside the product name (threshold 0.4 ≈ 1-char edit).
      OR word_similarity(lower(n.q), lower(p.name)) > 0.4
    )
  ORDER BY
    CASE
      WHEN lower(p.name) = lower(n.q)                        THEN 0
      WHEN lower(p.name) LIKE lower(n.q) || '%'              THEN 1
      WHEN lower(p.name) LIKE '%' || lower(n.q) || '%'       THEN 2
      WHEN word_similarity(lower(n.q), lower(p.name)) > 0.4  THEN 3
      ELSE 4
    END,
    word_similarity(lower(n.q), lower(p.name)) DESC,
    p.name ASC
  LIMIT greatest(coalesce(p_limit, 10), 1);
$$;
