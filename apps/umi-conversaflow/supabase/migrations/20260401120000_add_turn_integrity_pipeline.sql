ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS state_version BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS draft_cart_version BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS pending_clarification JSONB DEFAULT NULL;

CREATE TABLE IF NOT EXISTS public.conversation_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  status TEXT NOT NULL
    CHECK (status IN ('buffering', 'released', 'processing', 'completed', 'clarification_needed', 'superseded', 'cancelled')),
  source_message_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  merged_user_text TEXT NOT NULL,
  integrity_decision TEXT NOT NULL
    CHECK (integrity_decision IN ('hold', 'merge', 'clarify', 'replace', 'cancel', 'release')),
  integrity_reason TEXT NOT NULL,
  base_state_version BIGINT NOT NULL,
  first_message_at TIMESTAMPTZ NOT NULL,
  last_message_at TIMESTAMPTZ NOT NULL,
  hold_until TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  superseded_at TIMESTAMPTZ,
  extracted_intent JSONB,
  reconciled_action JSONB,
  assistant_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_turns_conversation_created_idx
  ON public.conversation_turns (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS conversation_turns_status_hold_idx
  ON public.conversation_turns (status, hold_until);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_turns_one_active_idx
  ON public.conversation_turns (conversation_id)
  WHERE status IN ('buffering', 'released', 'processing', 'clarification_needed');

CREATE OR REPLACE FUNCTION public.claim_next_job(p_worker_id TEXT)
RETURNS SETOF public.jobs
LANGUAGE sql
AS $$
  UPDATE public.jobs
  SET    state = 'claimed',
         locked_at = now(),
         locked_by = p_worker_id
  WHERE  id = (
    SELECT j.id
    FROM public.jobs j
    WHERE j.state = 'pending'
      AND j.next_run_at <= now()
      AND NOT EXISTS (
        SELECT 1
        FROM public.jobs active
        WHERE active.id <> j.id
          AND active.aggregate_type = j.aggregate_type
          AND active.aggregate_id = j.aggregate_id
          AND active.state IN ('claimed', 'running')
          AND j.aggregate_type = 'conversation'
      )
    ORDER BY j.priority DESC, j.next_run_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;
