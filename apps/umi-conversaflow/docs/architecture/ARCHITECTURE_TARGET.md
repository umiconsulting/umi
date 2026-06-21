# ConversaFlow — Target Architecture Specification

> **Update (2026-04):** The `slack-actions` Edge Function was removed; interactive kitchen and order operations use the native KDS app (`apps/umi-kds`) against the backend. Sections that still name `slack-actions` describe the prior implementation and need a pass to reflect the new split.

> Concrete schema, runtime topology, handler contracts, and state machines.
> Companion to the system identity document. This is the buildable spec.

---

## 1. Target Schema

### 1.1 `inbound_events` — Canonical record of every external event

```sql
CREATE TABLE inbound_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses(id),
  source          TEXT NOT NULL,                -- 'twilio', 'slack', 'admin', 'cron'
  source_event_id TEXT,                         -- MessageSid, Slack event_id, etc.
  event_type      TEXT NOT NULL,                -- 'whatsapp_message', 'slack_action', 'slack_event', 'slack_shortcut'
  payload_hash    TEXT,                         -- SHA-256 of raw payload (dedup)
  payload         JSONB NOT NULL,               -- Normalized payload (never raw provider format)
  status          TEXT NOT NULL DEFAULT 'accepted',  -- 'accepted', 'processing', 'completed', 'failed', 'duplicate'
  request_id      UUID NOT NULL,                -- Correlation ID (assigned at ingress)
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  error           TEXT,

  CONSTRAINT uq_inbound_source_event UNIQUE (source, source_event_id)
);

CREATE INDEX idx_inbound_events_status ON inbound_events(status) WHERE status IN ('accepted', 'processing');
CREATE INDEX idx_inbound_events_business ON inbound_events(business_id, received_at DESC);
```

**Idempotency**: `UNIQUE(source, source_event_id)` — Twilio retries with the same MessageSid are rejected at insert. Slack event IDs likewise.

### 1.2 `jobs` — Durable work queue

```sql
CREATE TYPE job_state AS ENUM ('pending', 'claimed', 'running', 'completed', 'failed', 'dead');

CREATE TABLE jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_event_id UUID REFERENCES inbound_events(id),  -- NULL for cron-originated jobs
  business_id     UUID NOT NULL REFERENCES businesses(id),
  job_type        TEXT NOT NULL,                -- see §3 Job Type Catalog
  aggregate_type  TEXT,                         -- 'conversation', 'transaction', 'business'
  aggregate_id    UUID,                         -- conversation_id, order_id, business_id
  payload         JSONB NOT NULL DEFAULT '{}',  -- Job-specific input
  state           job_state NOT NULL DEFAULT 'pending',
  priority        SMALLINT NOT NULL DEFAULT 0,  -- Higher = sooner. 0 = normal
  max_attempts    SMALLINT NOT NULL DEFAULT 3,
  attempt_count   SMALLINT NOT NULL DEFAULT 0,
  next_run_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at       TIMESTAMPTZ,
  locked_by       TEXT,                         -- Worker instance ID
  completed_at    TIMESTAMPTZ,
  error           TEXT,                         -- Last error message
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Deterministic dedup: same event + same job type = same job
  CONSTRAINT uq_job_event_type UNIQUE (inbound_event_id, job_type)
);

CREATE INDEX idx_jobs_claimable ON jobs(priority DESC, next_run_at ASC)
  WHERE state = 'pending' AND next_run_at <= now();
CREATE INDEX idx_jobs_locked ON jobs(locked_at) WHERE state = 'claimed';
CREATE INDEX idx_jobs_aggregate ON jobs(aggregate_type, aggregate_id);
```

### 1.3 `job_attempts` — Execution history per attempt

```sql
CREATE TABLE job_attempts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt     SMALLINT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  outcome     TEXT NOT NULL DEFAULT 'running',  -- 'running', 'success', 'error', 'timeout'
  error       TEXT,
  metadata    JSONB,                            -- Tokens used, latency breakdown, etc.

  CONSTRAINT uq_job_attempt UNIQUE (job_id, attempt)
);
```

### 1.4 `outbox` — Durable side-effect delivery

```sql
CREATE TYPE outbox_state AS ENUM ('pending', 'delivering', 'delivered', 'failed', 'dead');

CREATE TABLE outbox (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID REFERENCES jobs(id),       -- Which job produced this effect
  business_id     UUID NOT NULL REFERENCES businesses(id),
  kind            TEXT NOT NULL,                   -- see §4 Outbox Kind Catalog
  aggregate_id    UUID,                            -- order_id, conversation_id, etc.
  idempotency_key TEXT NOT NULL,                   -- e.g. 'twilio_reply:{message_id}', 'slack_order:{order_id}'
  payload         JSONB NOT NULL,                  -- Adapter-specific delivery payload
  state           outbox_state NOT NULL DEFAULT 'pending',
  attempts        SMALLINT NOT NULL DEFAULT 0,
  max_attempts    SMALLINT NOT NULL DEFAULT 5,
  next_run_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at    TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_outbox_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX idx_outbox_deliverable ON outbox(next_run_at ASC)
  WHERE state = 'pending' AND next_run_at <= now();
```

**Idempotency**: `UNIQUE(idempotency_key)` — if the same side effect is produced twice (job retry), the second insert is a no-op.

---

## 2. Runtime Topology

```
                    ┌──────────────────────────────────────────────────┐
                    │                   Postgres                       │
                    │  domain tables │ workflow tables │ log tables     │
                    └──────▲────────────────▲────────────────▲─────────┘
                           │                │                │
              ┌────────────┼────────────────┼────────────────┼──────────┐
              │            │                │                │          │
     ┌────────┴───────┐  ┌┴────────────┐  ┌┴────────────┐  │  ┌───────┴──────┐
     │ whatsapp-      │  │ slack-       │  │ job-worker   │  │  │ Next.js      │
     │ handler        │  │ actions      │  │ (new)        │  │  │ Dashboard    │
     │ (thin ingress) │  │ (thin ingrss)│  │              │  │  │              │
     └───────┬────────┘  └┬────────────┘  └┬─────────────┘  │  └──────────────┘
             │             │               │                 │
             │             │               │                 │
     Twilio webhooks  Slack webhooks   Claims jobs      outbox-dispatcher
                                       Runs processors   (inside worker)
                                       Writes outbox     Delivers to:
                                                          → Twilio
                                                          → Slack
                                                          → Voyage
                                                          → Anthropic
```

### 2.1 Edge Functions (Ingress)

Two existing functions, narrowed in responsibility:

| Function | Keeps | Loses |
|----------|-------|-------|
| `whatsapp-handler` | Signature validation, payload parse, idempotency insert, fast-path TwiML ack, enqueue job | LLM calls, tool loop, memory assembly, embedding, summary, fact extraction, Slack posting |
| `slack-actions` | Signature validation, payload parse, idempotency insert, enqueue job, fast modal open (views.open must happen <3s) | Order DB update, Twilio message send, order status update, App Home publish, pinned summary |

### 2.2 Job Worker

One new edge function **or** a long-running Deno process. At current scale, a **scheduled edge function** (`job-worker`) invoked every 5–10 seconds via `pg_cron` or Supabase cron is sufficient.

The worker:
1. Claims pending jobs with `SELECT ... FOR UPDATE SKIP LOCKED`
2. Executes the job processor for the claimed job type
3. Records attempt outcome
4. Writes outbox rows for any external side effects
5. Transitions the job to completed or failed

### 2.3 Outbox Dispatcher

Runs inside the same worker process (separate loop or after job processing). It:
1. Claims pending outbox rows
2. Calls the appropriate adapter (Twilio, Slack, Voyage, etc.)
3. Marks rows as delivered or failed
4. Retries with exponential backoff

---

## 3. Job Type Catalog

Every job type maps to a processor function. This is the complete list derived from current inline work:

| `job_type` | Source | Aggregate | What It Does | Current Location |
|------------|--------|-----------|-------------|------------------|
| `conversation.process` | whatsapp-handler | conversation | Build working memory → LLM tool loop → produce reply | `index.ts:343–541` |
| `conversation.fast_reply` | whatsapp-handler | conversation | Location/hours/info fast-path (no LLM) | `index.ts:200–341` |
| `message.embed` | conversation.process | message | Generate Voyage embeddings for user+assistant pair | `index.ts:642`, `memory.ts:embedMessagePair` |
| `conversation.summarize` | conversation.process | conversation | Rolling summary via Haiku for conversations >8 messages | `index.ts:645–667` |
| `customer.extract_facts` | conversation.process | customer | Extract preferences/dislikes/allergies via Haiku | `index.ts:669–685` |
| `order.create` | conversation.process | transaction | Insert transaction + write Slack outbox | `tools.ts:363–429` |
| `order.cancel` | conversation.process OR slack-actions | transaction | Cancel order + write Slack + Twilio outbox | `tools.ts:543–609`, `slack-actions:447–487` |
| `order.partial_cancel` | slack-actions | transaction | Mark items cancelled, recalc total, write outbox | `slack-actions:490–551` |
| `order.status_change` | slack-actions | transaction | Update status + write Slack + Twilio outbox | `slack-actions:317–369` |
| `slack.publish_app_home` | slack-actions | business | Rebuild and publish App Home tab | `slack-actions:110–120` |
| `slack.refresh_pinned` | order.* jobs | business | Refresh daily summary pinned message | `slack.ts:refreshPinnedSummary` |
| `business.update_config` | slack-actions | business | Save config + audit row + derive timezone | `slack-actions:403–435` |
| `zettle.sync` | cron | business | Sync products from Zettle POS | `zettle-sync/index.ts` |
| `embed.backfill` | admin | business | Backfill embeddings for historical messages | `embed-backfill/index.ts` |

### 3.1 Job State Machine

```
                   ┌─────────┐
                   │ pending  │ ← created by ingress or parent job
                   └────┬────┘
                        │ worker claims (FOR UPDATE SKIP LOCKED)
                        ▼
                   ┌─────────┐
                   │ claimed  │ locked_at = now(), locked_by = worker_id
                   └────┬────┘
                        │ processor starts
                        ▼
                   ┌─────────┐
                   │ running  │ attempt row created
                   └────┬────┘
                       ╱ ╲
            success ╱     ╲ error
                  ╱         ╲
           ┌──────────┐  ┌─────────┐
           │completed  │  │  failed  │ attempt_count++
           └──────────┘  └────┬────┘
                              │ if attempt_count < max_attempts
                              │ next_run_at = now() + backoff(attempt_count)
                              ▼
                         ┌─────────┐
                         │ pending  │ (retry)
                         └─────────┘
                              │ if attempt_count >= max_attempts
                              ▼
                         ┌─────────┐
                         │  dead   │ → operator review in dashboard
                         └─────────┘
```

**Backoff formula**: `next_run_at = now() + (2^attempt_count * 1 second)`, capped at 5 minutes.

**Stale lock detection**: If `locked_at` is older than 2 minutes and state is `claimed`, the worker resets the job to `pending`. This handles worker crashes.

### 3.2 Job Claim Query

```sql
UPDATE jobs
SET    state = 'claimed',
       locked_at = now(),
       locked_by = $1  -- worker instance ID
WHERE  id = (
  SELECT id FROM jobs
  WHERE  state = 'pending'
  AND    next_run_at <= now()
  ORDER BY priority DESC, next_run_at ASC
  LIMIT  1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

---

## 4. Outbox Kind Catalog

| `kind` | `idempotency_key` pattern | Adapter | Payload shape |
|--------|---------------------------|---------|---------------|
| `twilio.reply` | `twilio_reply:{assistant_message_id}` | Twilio REST API | `{ to, from, body }` |
| `twilio.location_pin` | `twilio_location:{inbound_event_id}` | Twilio REST API | `{ to, from, body, persistent_action }` |
| `twilio.status_notification` | `twilio_status:{order_id}:{status}` | Twilio REST API | `{ to, from, body }` |
| `twilio.cancel_notification` | `twilio_cancel:{order_id}` | Twilio REST API | `{ to, from, body }` |
| `slack.new_order` | `slack_order:{order_id}` | Slack chat.postMessage | `{ channel, blocks, order_id }` |
| `slack.update_order` | `slack_update:{order_id}:{status}` | Slack chat.update | `{ channel, ts, blocks }` |
| `slack.app_home` | `slack_home:{user_id}:{business_id}:{timestamp_bucket}` | Slack views.publish | `{ user_id, view }` |
| `slack.pinned_summary` | `slack_pin:{business_id}:{date}` | Slack chat.update or postMessage | `{ channel, blocks }` |
| `voyage.embed` | `voyage_embed:{user_msg_id}:{assistant_msg_id}` | Voyage AI batch embed | `{ texts, model }` |

### 4.1 Outbox State Machine

```
           ┌─────────┐
           │ pending  │ ← written by job processor
           └────┬────┘
                │ dispatcher claims
                ▼
           ┌────────────┐
           │ delivering  │
           └────┬───────┘
               ╱ ╲
     success ╱     ╲ error
           ╱         ╲
    ┌───────────┐  ┌─────────┐
    │ delivered  │  │ failed  │ attempts++, next_run_at = backoff
    └───────────┘  └────┬────┘
                        │ if attempts >= max_attempts
                        ▼
                   ┌─────────┐
                   │  dead   │
                   └─────────┘
```

---

## 5. Handler Contracts After Refactor

### 5.1 `whatsapp-handler/index.ts` — Target Shape

```
Deno.serve(async (req) => {
  // 1. CORS preflight
  // 2. Parse body text
  // 3. Validate Twilio signature           ← KEEPS (sync, security)
  // 4. Extract phone, body, MessageSid     ← KEEPS (sync, parse)
  // 5. Security checks (length, rate, injection) ← KEEPS (sync, gate)
  // 6. Sanitize input                      ← KEEPS (sync)
  // 7. getOrCreateCustomer + getOrCreateConversation ← KEEPS (sync, needed for ack)
  // 8. Insert message with idempotency     ← KEEPS (sync, dedup)
  // 9. Insert inbound_event                ← NEW
  // 10. Insert job (conversation.process or conversation.fast_reply) ← NEW
  // 11. Return TwiML acknowledgment        ← KEEPS

  // For fast-path (location/hours/info):
  //   - Still detect intent synchronously
  //   - Still return TwiML with the answer
  //   - But embed/log work moves to the job
  //   - Job type: conversation.fast_reply

  // For LLM path:
  //   - Return empty TwiML immediately (or a "processing" TwiML)
  //   - LLM work happens in conversation.process job
  //   - Reply delivered via outbox → twilio.reply
})
```

**Critical design decision — TwiML reply model**:

The current system returns the assistant reply directly in the TwiML response body. This is the simplest model and avoids a separate Twilio REST API call.

Two options for the async transition:

**Option A: Keep synchronous reply for fast-paths, async for LLM**
- Location/hours/info → TwiML reply (no job needed for the reply itself, only for embed/log)
- LLM conversations → empty TwiML + outbox delivers reply via Twilio REST
- Pro: Fast-paths stay fast. No Twilio REST cost for simple queries.
- Con: Two reply paths.

**Option B: All replies through outbox**
- Every response goes via Twilio REST API (outbox).
- TwiML always returns empty `<Response/>`.
- Pro: Uniform model. Full delivery tracking.
- Con: Extra Twilio API call for every message. Slightly higher latency for fast-paths.

**Recommendation: Option A.** The fast-paths are <100ms today and represent ~40% of traffic. Making them async adds latency and API cost for no durability benefit (they don't fail). LLM replies should go through outbox because they take 2-8 seconds anyway, and the durability matters (LLM calls can fail mid-tool-loop).

### 5.2 `slack-actions/index.ts` — Target Shape

```
Deno.serve(async (req) => {
  // 1. Verify Slack signature              ← KEEPS
  // 2. Parse payload                       ← KEEPS
  // 3. Handle url_verification             ← KEEPS
  // 4. Insert inbound_event                ← NEW

  // For modal opens (cancel_prompt, partial_cancel, business_settings):
  //   - Still open modal synchronously (Slack 3s deadline)
  //   - No job needed — modal open is the entire side effect

  // For button actions (status transitions):
  //   - Insert job: order.status_change
  //   - Return 200 immediately
  //   - DB update + Slack update + Twilio notification happen in job

  // For view_submission:
  //   - Insert job: order.cancel / order.partial_cancel / business.update_config
  //   - Return response_action: clear immediately
  //   - Actual DB mutation + notifications happen in job

  // For events (app_home_opened):
  //   - Insert job: slack.publish_app_home
  //   - Return 200 immediately
})
```

**Exception**: `views.open` for modals MUST stay synchronous — Slack requires the modal to open within 3 seconds of the trigger_id being issued. The ingress handler calls `views.open` directly, then enqueues a job for any follow-up work.

### 5.3 Eliminated Functions

| Function | Disposition |
|----------|------------|
| `whatsapp-handler-secure` | DELETE — legacy duplicate |
| `order-status-webhook` | ABSORB into job-worker (it's already event-driven from DB) |
| `embed-backfill` | ABSORB — becomes a job type `embed.backfill` triggered by admin |
| `zettle-oauth-setup` | KEEP — one-time interactive setup, not a recurring job |
| `zettle-sync` | ABSORB — becomes a job type `zettle.sync` triggered by cron |

---

## 6. Job Processor Specifications

### 6.1 `conversation.process`

The main processor. This is the current `index.ts:343–687` extracted into a standalone function.

```typescript
interface ConversationProcessPayload {
  conversation_id: string
  customer_id: string
  business_id: string
  message: string           // Sanitized user message
  user_message_id: string   // Already inserted by ingress
  customer_name: string | null
  phone: string             // For outbox delivery
  request_id: string
}
```

**Steps**:
1. Build working memory (`buildWorkingMemory`)
2. Build system prompt (`buildSystemPrompt`)
3. Run Claude tool loop (max 5 iterations)
4. Hallucination guard (force tool call if needed)
5. Insert assistant message
6. Detect conversation state
7. Update conversation state
8. Write outbox: `twilio.reply` (the assistant response to customer)
9. Write outbox: `voyage.embed` (for user+assistant pair)
10. If order created → write outbox: `slack.new_order`
11. Enqueue child jobs:
    - `conversation.summarize` (if messageCount > 8)
    - `customer.extract_facts`
12. Log AI turn + edge function log
13. Return success

**Tool execution**: `executeTool` stays inside this processor. Order creation, cancellation, etc. are called synchronously within the tool loop. Their Slack/Twilio side effects move to outbox writes.

### 6.2 `conversation.fast_reply`

Handles location, hours, and business info fast-paths. Only needed for the fire-and-forget work (embed, log) — the TwiML reply was already returned by ingress.

```typescript
interface FastReplyPayload {
  conversation_id: string
  customer_id: string
  business_id: string
  user_message: string
  assistant_message: string
  user_message_id: string
  assistant_message_id: string
  response_type: 'location_pin' | 'business_hours' | 'business_info'
  request_id: string
}
```

**Steps**:
1. Update conversation state
2. Write outbox: `voyage.embed`
3. Log AI turn + edge function log
4. Return success

### 6.3 `order.status_change`

```typescript
interface OrderStatusChangePayload {
  order_id: string
  new_status: string         // 'in_progress' | 'ready' | 'completed'
  business_id: string
  slack_user_id: string      // Who clicked the button
  request_id: string
}
```

**Steps**:
1. Fetch order (with customer phone)
2. Update transaction status
3. Write outbox: `slack.update_order`
4. Write outbox: `twilio.status_notification` (if status has a WhatsApp message)
5. Enqueue: `slack.publish_app_home`
6. Enqueue: `slack.refresh_pinned`

### 6.4 `order.cancel` (from Slack staff)

```typescript
interface OrderCancelPayload {
  order_id: string
  business_id: string
  reason: string
  suggestion: string | null
  slack_user_id: string
  request_id: string
}
```

**Steps**:
1. Fetch order
2. Update transaction status + details
3. Write outbox: `slack.update_order`
4. Write outbox: `twilio.cancel_notification`
5. Enqueue: `slack.publish_app_home`
6. Enqueue: `slack.refresh_pinned`

### 6.5 `order.partial_cancel`

Same pattern as `order.cancel` but marks individual items and recalculates total.

### 6.6 `message.embed`

```typescript
interface MessageEmbedPayload {
  user_message_id: string
  assistant_message_id: string
  user_text: string
  assistant_text: string
  request_id: string
}
```

**Steps**:
1. Call Voyage AI batch embed
2. Update `messages.embedding` for both rows
3. Return success

### 6.7 `conversation.summarize`

```typescript
interface SummarizePayload {
  conversation_id: string
  request_id: string
}
```

**Steps**:
1. Fetch messages beyond recent-8 window (capped at 16)
2. Call Haiku to generate rolling summary
3. Update `conversations.summary`

### 6.8 `customer.extract_facts`

```typescript
interface ExtractFactsPayload {
  customer_id: string
  recent_messages: Array<{ role: string; content: string }>
  existing_facts: any
  request_id: string
}
```

**Steps**:
1. Call Haiku to extract facts
2. Upsert `customer_preferences.facts`

---

## 7. Worker Implementation

### 7.1 Scheduled Edge Function Approach

Create a new edge function `job-worker` invoked by Supabase cron:

```sql
-- Run every 10 seconds
SELECT cron.schedule(
  'process-jobs',
  '10 seconds',
  $$SELECT net.http_post(
    url := 'https://xbudknbimkgjjgohnjgp.supabase.co/functions/v1/job-worker',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    )
  )$$
);
```

**Alternative**: Use `pg_cron` to call a Postgres function directly that processes jobs. This avoids the edge function cold start but limits you to PL/pgSQL or pg_net for external calls. The edge function approach is more natural for calling Anthropic, Voyage, Twilio, and Slack APIs.

### 7.2 Worker Main Loop

```typescript
// job-worker/index.ts
Deno.serve(async (req) => {
  const workerId = crypto.randomUUID()
  const batchSize = 5  // Process up to 5 jobs per invocation
  let processed = 0

  // Phase 1: Process jobs
  for (let i = 0; i < batchSize; i++) {
    const job = await claimNextJob(supabase, workerId)
    if (!job) break
    await processJob(supabase, job, workerId)
    processed++
  }

  // Phase 2: Deliver outbox
  const delivered = await deliverOutbox(supabase, workerId, 10)

  // Phase 3: Reclaim stale locks (crash recovery)
  await reclaimStaleJobs(supabase)

  return new Response(JSON.stringify({ processed, delivered }))
})
```

### 7.3 Stale Lock Recovery

```sql
UPDATE jobs
SET    state = 'pending',
       locked_at = NULL,
       locked_by = NULL
WHERE  state = 'claimed'
AND    locked_at < now() - INTERVAL '2 minutes';
```

---

## 8. Adapter Module Structure

Adapters are thin wrappers called by the outbox dispatcher. Each adapter:
- Accepts a typed payload
- Makes exactly one external API call
- Returns success/failure
- Does not touch the database

```
_shared/
├── adapters/
│   ├── twilio.ts       -- sendMessage(to, from, body), sendLocationPin(...)
│   ├── slack.ts        -- postMessage(...), updateMessage(...), openModal(...), publishView(...)
│   ├── anthropic.ts    -- createMessage(...) — thin wrapper around SDK
│   ├── voyage.ts       -- embedBatch(texts, model) — raw HTTP call with retry
│   └── zettle.ts       -- fetchProducts(...), refreshToken(...)
```

The existing `_shared/slack.ts` (519 lines) mixes block-building with API calls. Split into:
- `_shared/slack-blocks.ts` — Pure functions that build Block Kit payloads (no I/O)
- `_shared/adapters/slack.ts` — API calls only

The existing `_shared/memory.ts` (123+ lines) mixes retrieval logic with API calls. Split into:
- `_shared/memory.ts` — Working memory assembly, summary logic (reads DB, no external calls)
- `_shared/adapters/voyage.ts` — Embedding API calls only

---

## 9. Migration Sequence

Incremental, each step deployable and reversible independently.

### Step 1: Add workflow tables (no behavior change)

```
Migration: 20260323_001_add_workflow_tables.sql
```

Creates `inbound_events`, `jobs`, `job_attempts`, `outbox` with all indexes. No existing code references them. Pure additive.

### Step 2: Record inbound events

Modify ingress handlers to insert an `inbound_events` row before enqueueing work.

**Purpose**: keep a canonical event audit trail and make job/outbox processing traceable from the original provider event.

**Rollback**: preserve existing rows and stop writing new inbound audit rows if needed.

### Step 3: Extract adapters

Split `_shared/slack.ts` → `slack-blocks.ts` + `adapters/slack.ts`.
Split `_shared/memory.ts` → `memory.ts` + `adapters/voyage.ts`.

**Purpose**: Code-only refactor. No behavior change. Required before processors can use clean adapters.

**Rollback**: Revert file split (single commit).

### Step 4: Move fire-and-forget work to jobs

The lowest-risk async work currently in `EdgeRuntime.waitUntil`:
- Embedding generation → `message.embed` job
- Summary generation → `conversation.summarize` job
- Fact extraction → `customer.extract_facts` job
- Edge function logging → `logEdgeFunction` (keep inline — it's a single DB insert)
- AI turn logging → `logAiTurn` (keep inline — it's a single DB insert)

`whatsapp-handler` inserts these jobs instead of calling `waitUntil`. The worker processes them.

**Purpose**: Move the least critical async work first. If the worker is slow, the only impact is delayed embeddings and summaries — conversation replies are unaffected.

**Rollback**: Revert to waitUntil calls. Jobs table may have unprocessed rows — harmless.

### Step 5: Deploy job-worker + outbox dispatcher

The new `job-worker` edge function + cron schedule. Initially only processes the Step 4 job types.

**Purpose**: Validate the worker loop, claim/lock/retry mechanics, and outbox delivery with low-stakes work.

### Step 6: Move Slack notifications to outbox

Order creation in `tools.ts` stops calling `postNewOrder` directly. Instead, it writes an outbox row `slack.new_order`. The outbox dispatcher delivers it.

Same for `updateOrderStatus`, `refreshPinnedSummary`, `publishAppHome`.

**Purpose**: Slack is the highest-volume external call. Moving it to outbox gives delivery tracking and retry.

### Step 7: Move Twilio notifications to outbox

Status change notifications (`sendWhatsAppMessage` in `slack-actions`) and cancel notifications move to outbox rows.

### Step 8: Move LLM conversation processing to job

The big one. `whatsapp-handler` stops running the Claude tool loop synchronously. Instead:
- Fast-paths still return TwiML directly
- LLM path inserts a `conversation.process` job and returns empty TwiML
- Worker runs the tool loop and delivers the reply via `twilio.reply` outbox

**Purpose**: The handler becomes truly thin. LLM failures no longer cause webhook timeouts.

**Rollback**: Revert handler to inline processing. The job table may have unprocessed conversation jobs — run them manually or let them expire.

### Step 9: Dashboard workflow views

Add dashboard pages for:
- Inbound event stream (real-time)
- Job queue (pending, running, failed, dead)
- Outbox delivery state
- Per-job attempt history

### Step 10: CI/CD + staging

- GitHub Actions workflow: lint, type-check, deploy
- Separate Supabase project for staging
- Separate Twilio sandbox number
- Separate Slack app

---

## 10. What Changes Per File

### Files Modified

| File | Change |
|------|--------|
| `whatsapp-handler/index.ts` | Remove LLM loop, memory assembly, waitUntil blocks. Add inbound_event + job insert. ~400 lines → ~120 lines |
| `whatsapp-handler/tools.ts` | Remove inline Slack calls from createOrder/cancelOrder. Return data only; outbox writes happen in processor. |
| `slack-actions/index.ts` | Remove inline DB mutations and Twilio calls from action handlers. Add inbound_event + job insert. ~558 lines → ~200 lines |
| `_shared/slack.ts` | Split into `slack-blocks.ts` (pure) + `adapters/slack.ts` (I/O) |
| `_shared/memory.ts` | Split into `memory.ts` (logic) + `adapters/voyage.ts` (I/O) |

### Files Created

| File | Purpose |
|------|---------|
| `job-worker/index.ts` | Worker main loop: claim jobs, process, deliver outbox |
| `job-worker/processors/*.ts` | One file per job type (conversation, order, embed, etc.) |
| `_shared/adapters/twilio.ts` | Twilio REST API adapter |
| `_shared/adapters/slack.ts` | Slack API adapter (extracted from slack.ts) |
| `_shared/adapters/voyage.ts` | Voyage embedding adapter (extracted from memory.ts) |
| `_shared/adapters/anthropic.ts` | Claude API adapter |
| `_shared/workflow.ts` | Job claim, outbox dispatch, retry logic |
| `_shared/slack-blocks.ts` | Block Kit builders (extracted from slack.ts) |
| `migrations/20260323_001_add_workflow_tables.sql` | Schema for inbound_events, jobs, job_attempts, outbox |

### Files Deleted

| File | Reason |
|------|--------|
| `whatsapp-handler-secure/` | Legacy duplicate, never deployed |
| `order-status-webhook/` | Absorbed into job-worker |
| `embed-backfill/` | Absorbed into job type `embed.backfill` |

---

## 11. Observability Additions

### 11.1 Dashboard Pages

| Page | Data Source | Purpose |
|------|------------|---------|
| `/workflow` | `inbound_events` | Real-time inbound event stream with status |
| `/jobs` | `jobs` + `job_attempts` | Queue depth, processing rate, failure rate, dead-letter review |
| `/outbox` | `outbox` | Delivery success rate, retry counts, adapter health |

### 11.2 Key Metrics

| Metric | Query | Alert Threshold |
|--------|-------|-----------------|
| Job queue depth | `SELECT count(*) FROM jobs WHERE state = 'pending'` | > 50 |
| Dead-letter count | `SELECT count(*) FROM jobs WHERE state = 'dead'` | > 0 |
| Outbox delivery lag | `SELECT max(age(now(), created_at)) FROM outbox WHERE state = 'pending'` | > 30 seconds |
| Failed outbox | `SELECT count(*) FROM outbox WHERE state = 'dead'` | > 0 |
| Worker invocation rate | Edge function logs for `job-worker` | < 1/min = worker stopped |
| p95 job processing time | `SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY finished_at - started_at) FROM job_attempts WHERE outcome = 'success'` | > 10 seconds |

---

## 12. Resolved Decisions

All architectural decisions finalized 2026-03-23:

1. **Worker runtime → Scheduled Edge Function (10s cron)**. Simpler to deploy within the existing Supabase stack — no external host needed. Cold start is acceptable given the 10s poll interval and low throughput. If latency becomes an issue, can migrate to a long-running process later.

2. **TwiML reply model → Hybrid (option c)**. Fast-path replies (location, hours, info) stay synchronous TwiML. LLM replies return `"Procesando tu mensaje..."` TwiML immediately, then deliver the real reply via Twilio REST API from the job worker. This avoids Twilio's 15s timeout while giving the customer instant feedback.

3. **Cron mechanism → pg_cron (if Pro plan), otherwise external cron**. pg_cron is the cleanest option — runs inside the database, no external dependency. If the Supabase plan doesn't support it, fall back to an external cron (GitHub Actions scheduled workflow or cron-job.org) hitting the job-worker edge function endpoint.

4. **Transaction boundaries → Single transaction (non-negotiable)**. The ingress handler inserts `inbound_event` + `job` in a single Postgres transaction for atomicity. An event without a job is an orphan; a job without an event has no audit trail. The extra round-trip cost is negligible.



me quedé en el step 7.
