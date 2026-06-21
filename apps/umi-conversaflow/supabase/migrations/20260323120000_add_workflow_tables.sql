-- Step 1 of ConversaFlow architecture migration: add workflow tables.
-- Pure additive — no existing code references these tables. Zero behavior change.
-- See docs/architecture/ARCHITECTURE_TARGET.md §1 for full specification.

-- ============================================================================
-- 1. inbound_events — Canonical record of every external event
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.inbound_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID        NOT NULL REFERENCES businesses(id),
  source          TEXT        NOT NULL,
  source_event_id TEXT,
  event_type      TEXT        NOT NULL,
  payload_hash    TEXT,
  payload         JSONB       NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'accepted'
                  CHECK (status IN ('accepted', 'processing', 'completed', 'failed', 'duplicate')),
  request_id      UUID        NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  error           TEXT,

  CONSTRAINT uq_inbound_source_event UNIQUE (source, source_event_id)
);

CREATE INDEX IF NOT EXISTS inbound_events_status_idx
  ON public.inbound_events (status)
  WHERE status IN ('accepted', 'processing');

CREATE INDEX IF NOT EXISTS inbound_events_business_received_idx
  ON public.inbound_events (business_id, received_at DESC);

COMMENT ON TABLE public.inbound_events IS
'Canonical record of every external event (Twilio webhook, Slack action, cron tick, etc.). UNIQUE(source, source_event_id) provides idempotency — Twilio retries with the same MessageSid are rejected at insert.';

COMMENT ON COLUMN public.inbound_events.source IS
'Event origin: ''twilio'', ''slack'', ''admin'', ''cron''.';

COMMENT ON COLUMN public.inbound_events.source_event_id IS
'Provider-specific unique ID (e.g. Twilio MessageSid, Slack event_id). NULL for cron-originated events.';

COMMENT ON COLUMN public.inbound_events.event_type IS
'Semantic event type: ''whatsapp_message'', ''slack_action'', ''slack_event'', ''slack_shortcut''.';

COMMENT ON COLUMN public.inbound_events.payload_hash IS
'SHA-256 of the raw inbound payload, for deduplication of events without a natural source_event_id.';

COMMENT ON COLUMN public.inbound_events.payload IS
'Normalized payload (never raw provider format). Sensitive fields (e.g. auth tokens) must be stripped before insert.';

COMMENT ON COLUMN public.inbound_events.status IS
'Event lifecycle: accepted → processing → completed/failed. ''duplicate'' for idempotency rejections.';

COMMENT ON COLUMN public.inbound_events.request_id IS
'Correlation ID assigned at ingress, shared across all logs, jobs, and outbox rows for this request.';

-- ============================================================================
-- 2. jobs — Durable work queue
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.jobs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_event_id UUID        REFERENCES public.inbound_events(id),
  business_id      UUID        NOT NULL REFERENCES businesses(id),
  job_type         TEXT        NOT NULL,
  aggregate_type   TEXT,
  aggregate_id     UUID,
  payload          JSONB       NOT NULL DEFAULT '{}',
  state            TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (state IN ('pending', 'claimed', 'running', 'completed', 'failed', 'dead')),
  priority         SMALLINT    NOT NULL DEFAULT 0,
  max_attempts     SMALLINT    NOT NULL DEFAULT 3,
  attempt_count    SMALLINT    NOT NULL DEFAULT 0,
  next_run_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at        TIMESTAMPTZ,
  locked_by        TEXT,
  completed_at     TIMESTAMPTZ,
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_job_event_type UNIQUE (inbound_event_id, job_type)
);

-- Claim query index: WHERE state = 'pending' ORDER BY priority DESC, next_run_at ASC.
-- The query also filters next_run_at <= now(), but that is a runtime condition —
-- now() in a partial index predicate is evaluated at DML time, not query time,
-- so rows with future next_run_at (retry backoff) would never enter the index.
CREATE INDEX IF NOT EXISTS jobs_claimable_idx
  ON public.jobs (priority DESC, next_run_at ASC)
  WHERE state = 'pending';

-- Stale lock detection: WHERE state = 'claimed' AND locked_at < now() - interval '2 minutes'.
CREATE INDEX IF NOT EXISTS jobs_locked_idx
  ON public.jobs (locked_at)
  WHERE state = 'claimed';

-- Aggregate lookup: "is there already a running job for this conversation/order?"
CREATE INDEX IF NOT EXISTS jobs_aggregate_idx
  ON public.jobs (aggregate_type, aggregate_id);

-- Business + created_at for dashboard queries.
CREATE INDEX IF NOT EXISTS jobs_business_created_idx
  ON public.jobs (business_id, created_at DESC);

COMMENT ON TABLE public.jobs IS
'Durable work queue. Jobs are created by ingress handlers or parent jobs. Claimed via FOR UPDATE SKIP LOCKED by the job-worker. States: pending → claimed → running → completed/failed/dead.';

COMMENT ON COLUMN public.jobs.inbound_event_id IS
'The inbound event that triggered this job. NULL for cron-originated or child jobs spawned by another job.';

COMMENT ON COLUMN public.jobs.job_type IS
'Job type identifier matching a processor function. E.g. ''conversation.process'', ''message.embed'', ''order.create''. See docs/architecture/ARCHITECTURE_TARGET.md §3 for full catalog.';

COMMENT ON COLUMN public.jobs.aggregate_type IS
'Domain aggregate this job operates on: ''conversation'', ''transaction'', ''business'', ''customer'', ''message''.';

COMMENT ON COLUMN public.jobs.aggregate_id IS
'Primary key of the aggregate (conversation_id, order_id, business_id, etc.). Used to detect concurrent jobs on the same aggregate.';

COMMENT ON COLUMN public.jobs.state IS
'Job lifecycle state. ''dead'' means all retry attempts exhausted — requires operator review.';

COMMENT ON COLUMN public.jobs.priority IS
'Higher value = claimed sooner. 0 = normal priority. Use sparingly to avoid priority inversion.';

COMMENT ON COLUMN public.jobs.locked_by IS
'Worker instance UUID that claimed this job. Used for stale lock detection — if locked_at is >2 minutes old and state is ''claimed'', the job is reset to ''pending''.';

-- ============================================================================
-- 3. job_attempts — Execution history per attempt
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.job_attempts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  attempt     SMALLINT    NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  outcome     TEXT        NOT NULL DEFAULT 'running'
              CHECK (outcome IN ('running', 'success', 'error', 'timeout')),
  error       TEXT,
  metadata    JSONB,

  CONSTRAINT uq_job_attempt UNIQUE (job_id, attempt)
);

COMMENT ON TABLE public.job_attempts IS
'Per-attempt execution record for jobs. ON DELETE CASCADE from jobs — when a job is removed, its attempt history is cleaned up. UNIQUE(job_id, attempt) prevents duplicate attempt numbers.';

COMMENT ON COLUMN public.job_attempts.attempt IS
'1-based attempt number. First attempt is 1, first retry is 2, etc.';

COMMENT ON COLUMN public.job_attempts.outcome IS
'Attempt result: ''running'' (in progress), ''success'', ''error'' (processor threw), ''timeout'' (exceeded time limit).';

COMMENT ON COLUMN public.job_attempts.metadata IS
'Processor-specific execution metadata. E.g. {tokens_used, latency_ms, model, cache_hit} for LLM jobs.';

-- ============================================================================
-- 4. outbox — Durable side-effect delivery queue
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.outbox (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID        REFERENCES public.jobs(id) ON DELETE SET NULL,
  business_id     UUID        NOT NULL REFERENCES businesses(id),
  kind            TEXT        NOT NULL,
  aggregate_id    UUID,
  idempotency_key TEXT        NOT NULL,
  payload         JSONB       NOT NULL,
  state           TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (state IN ('pending', 'delivering', 'delivered', 'failed', 'dead')),
  attempts        SMALLINT    NOT NULL DEFAULT 0,
  max_attempts    SMALLINT    NOT NULL DEFAULT 5,
  next_run_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at    TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_outbox_idempotency UNIQUE (idempotency_key)
);

-- Delivery claim index: WHERE state = 'pending' ORDER BY next_run_at ASC.
-- Same reasoning as jobs_claimable_idx — runtime next_run_at <= now() filter
-- is not in the partial index predicate.
CREATE INDEX IF NOT EXISTS outbox_deliverable_idx
  ON public.outbox (next_run_at ASC)
  WHERE state = 'pending';

-- Lookup outbox rows produced by a specific job (debugging / dashboard).
CREATE INDEX IF NOT EXISTS outbox_job_idx
  ON public.outbox (job_id)
  WHERE job_id IS NOT NULL;

-- Business + created_at for dashboard queries.
CREATE INDEX IF NOT EXISTS outbox_business_created_idx
  ON public.outbox (business_id, created_at DESC);

COMMENT ON TABLE public.outbox IS
'Durable side-effect delivery queue. Job processors write outbox rows for external calls (Twilio, Slack, Voyage, etc.). The outbox dispatcher claims and delivers them with retry and idempotency. UNIQUE(idempotency_key) prevents duplicate deliveries on job retry.';

COMMENT ON COLUMN public.outbox.job_id IS
'The job that produced this side effect. ON DELETE SET NULL — outbox rows survive job cleanup for delivery tracking. NULL for outbox rows not tied to a specific job.';

COMMENT ON COLUMN public.outbox.kind IS
'Delivery adapter identifier. E.g. ''twilio.reply'', ''slack.new_order'', ''voyage.embed''. See docs/architecture/ARCHITECTURE_TARGET.md §4 for full catalog.';

COMMENT ON COLUMN public.outbox.aggregate_id IS
'Domain object this side effect relates to (order_id, conversation_id, etc.). For debugging and dashboard filtering.';

COMMENT ON COLUMN public.outbox.idempotency_key IS
'Globally unique key for deduplication. Pattern: ''{kind}:{domain_id}'' e.g. ''twilio_reply:{message_id}'', ''slack_order:{order_id}''. Prevents duplicate delivery if a job retries and re-inserts the same outbox row.';

COMMENT ON COLUMN public.outbox.state IS
'Delivery lifecycle: pending → delivering → delivered/failed. ''dead'' means max_attempts exhausted — requires operator review.';
