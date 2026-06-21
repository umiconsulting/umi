-- ── Product name embeddings + semantic search ────────────────────────────────
-- Adds:
--   • products.name_embedding  extensions.vector(1024)
--   • HNSW index on name_embedding
--   • Trigger that nulls name_embedding when name/category/variants change
--   • search_products_by_embedding() RPC
--   • Initial product.embed backfill job for the existing business

-- 1. Column
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS name_embedding extensions.vector(1024);

-- 2. HNSW index (same params as messages)
CREATE INDEX IF NOT EXISTS products_name_embedding_idx
  ON public.products
  USING hnsw (name_embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 3. Trigger function: null out embedding when searchable fields change
CREATE OR REPLACE FUNCTION public.products_invalidate_embedding()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.name     IS DISTINCT FROM OLD.name)
  OR (NEW.category IS DISTINCT FROM OLD.category)
  OR (NEW.variants IS DISTINCT FROM OLD.variants)
  THEN
    NEW.name_embedding := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER products_embedding_invalidate
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.products_invalidate_embedding();

-- 4. RPC: semantic product search
CREATE OR REPLACE FUNCTION public.search_products_by_embedding(
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
SET search_path = public, extensions
AS $$
  SELECT
    p.id,
    p.name,
    p.price,
    p.description,
    p.category,
    p.variants,
    1 - (p.name_embedding <=> p_embedding) AS similarity
  FROM public.products p
  WHERE p.business_id    = p_business_id
    AND p.available      = TRUE
    AND p.name_embedding IS NOT NULL
    AND 1 - (p.name_embedding <=> p_embedding) >= p_threshold
  ORDER BY p.name_embedding <=> p_embedding
  LIMIT p_limit;
$$;

-- 5. Seed the initial backfill job (auto-runs once job-worker is deployed)
--    No inbound_event_id → NULL, which never conflicts on the unique constraint.
INSERT INTO public.jobs (business_id, job_type, aggregate_type, aggregate_id, payload, state, priority)
VALUES (
  'ef9005a2-efe1-45bf-9da0-313b5902d9b4',
  'product.embed',
  'business',
  'ef9005a2-efe1-45bf-9da0-313b5902d9b4',
  '{"batch_size": 100, "business_id": "ef9005a2-efe1-45bf-9da0-313b5902d9b4"}'::jsonb,
  'pending',
  0
);
