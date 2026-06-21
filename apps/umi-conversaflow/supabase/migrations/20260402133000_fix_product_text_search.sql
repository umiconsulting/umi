-- Fix product text search for menu queries with spaces and JSON variant names.
-- The old client-side PostgREST .or(...) filter was malformed for variants and
-- could fail parsing on multi-word input such as "horchata cafe".

CREATE OR REPLACE FUNCTION public.search_products_text(
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
SET search_path = public
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
  FROM public.products p
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
