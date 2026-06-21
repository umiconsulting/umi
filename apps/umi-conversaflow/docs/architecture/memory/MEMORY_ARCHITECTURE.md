# 3-Tier Memory Architecture — ConversaFlow WhatsApp Bot

## Overview

Migrated the bot from a single `conversation_history JSONB` column (last 10 turns only) to a full 3-tier memory system with normalized message storage, pgvector semantic search, and structured customer fact extraction.

**Date implemented:** 2026-02-19
**Last updated:** 2026-04-06
**Supabase project:** `xbudknbimkgjjgohnjgp`
**Bot function:** `whatsapp-handler` (v13)
**Voyage AI model:** `voyage-4-lite` (1024 dimensions · 200M free tokens)
**Embedding backfill:** 156/156 messages (re-backfilled with voyage-4-lite)

---

## Architecture

```
TIER 1 — Working Memory (sync, injected into every prompt)
  ├── Last 8 messages from messages table
  ├── Rolling summary in conversations.summary (older turns compressed)
  └── Customer facts in customer_preferences.facts JSONB

TIER 2 — Semantic Search (sync query, activates after 4 turns)
  ├── pgvector HNSW index on messages.embedding vector(1024)
  ├── Voyage AI voyage-4-lite embeddings generated ASYNC after each turn
  ├── search_customer_messages() SQL function for customer-scoped retrieval
  └── search_similar_messages() SQL function as conversation-scoped fallback

TIER 3 — Structured Facts (async after each turn)
  └── Claude Haiku call to merge new turns into customer_preferences.facts
```

### Conversation boundaries vs this doc’s “tiers”

This file describes **three tiers of prompt memory** (working context, semantic retrieval, extracted facts). That is **orthogonal** to how we segment **time, tasks, orders, and customer identity**.

**Canonical spec — five layers (thread, visit, task, transaction, relationship):**  
[conversation-and-session-layers.md](../conversation-and-session-layers.md)

Tier 2 semantic search is customer-scoped when `search_customer_messages()` is available: it searches embedded user messages across all conversations for the same customer and business, while excluding the latest active-thread messages already present in recent context. The older `search_similar_messages()` conversation-scoped RPC remains the fallback. First-class **visit** rows are still not implemented yet; see the layers doc for the target model and gaps.

### Request flow

| Step | Timing |
|---|---|
| `insertMessage(user)` | **Sync** — before Claude |
| `buildWorkingMemory()` — last 8 msgs + facts + summary + optional semantic search | **Sync** — before Claude |
| Claude API call (with enriched system prompt) | **Sync** |
| `insertMessage(assistant)` | **Sync** — after Claude |
| Update `conversation_history` JSONB (backward compat) | **Sync** — after Claude |
| ← **TwiML response returned to Twilio** → | |
| `generateEmbeddings([userMsg, assistantMsg])` via Voyage AI — **single batched call** | Async (`waitUntil`) |
| `generateSummary()` if turn count > 8 | Async (`waitUntil`) |
| `extractCustomerFacts()` → upsert `customer_preferences.facts` | Async (`waitUntil`) |

---

## Database Migrations

### Migration 1 — `install_pgvector`
```sql
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
```

### Migration 2 — `upgrade_messages_table`
```sql
ALTER TABLE public.messages ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.messages RENAME COLUMN sender TO role;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS embedding extensions.vector(1024);
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS message_index INTEGER;
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON public.messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_embedding_hnsw ON public.messages
  USING hnsw (embedding extensions.vector_cosine_ops) WITH (m = 16, ef_construction = 64);
```

### Migration 3 — `upgrade_conversations_table`
```sql
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS history_migrated BOOLEAN NOT NULL DEFAULT FALSE;
```

### Migration 4 — `upgrade_customer_preferences`
```sql
ALTER TABLE public.customer_preferences
  ADD COLUMN IF NOT EXISTS facts JSONB NOT NULL DEFAULT '{}'::jsonb;
```

### Migration 5 — `backfill_messages` (idempotent data migration)
```sql
DO $$ DECLARE conv RECORD; msg JSONB; idx INTEGER;
BEGIN
  FOR conv IN SELECT id, conversation_history FROM public.conversations
    WHERE history_migrated = FALSE AND jsonb_array_length(conversation_history) > 0
  LOOP
    idx := 0;
    FOR msg IN SELECT * FROM jsonb_array_elements(conv.conversation_history) LOOP
      INSERT INTO public.messages (id, conversation_id, role, content, created_at, message_index, entities)
      VALUES (gen_random_uuid(), conv.id, msg->>'role', msg->>'content',
              COALESCE((msg->>'timestamp')::timestamptz, now()), idx, '{}'::jsonb)
      ON CONFLICT DO NOTHING;
      idx := idx + 1;
    END LOOP;
    UPDATE public.conversations SET history_migrated = TRUE WHERE id = conv.id;
  END LOOP;
END; $$;
```
Backfilled 154 messages from 4 live conversations.

### Migration 6 — `search_similar_messages_function`
```sql
CREATE OR REPLACE FUNCTION public.search_similar_messages(
  p_conversation_id UUID, p_embedding extensions.vector(1024),
  p_limit INTEGER DEFAULT 5, p_exclude_recent INTEGER DEFAULT 8
) RETURNS TABLE(id UUID, role TEXT, content TEXT, created_at TIMESTAMPTZ, similarity FLOAT)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT m.id, m.role, m.content, m.created_at,
         1 - (m.embedding <=> p_embedding) AS similarity
  FROM public.messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.embedding IS NOT NULL
    AND m.created_at < (
      SELECT created_at FROM public.messages WHERE conversation_id = p_conversation_id
      ORDER BY created_at DESC LIMIT 1 OFFSET p_exclude_recent - 1
    )
  ORDER BY m.embedding <=> p_embedding LIMIT p_limit;
$$;
```

---

## Files Created / Modified

### Phase 1 — Initial 3-tier memory system

| File | Action | Description |
|---|---|---|
| `supabase/functions/_shared/memory.ts` | **Created** | Core memory module |
| `supabase/functions/whatsapp-handler/index.ts` | **Modified** | 3-tier integration |
| `supabase/functions/whatsapp-handler/context.ts` | **Modified** | Returns `messageCount` |
| `supabase/functions/whatsapp-handler/prompts.ts` | **Modified** | Injects memory sections |
| `supabase/functions/embed-backfill/index.ts` | **Created** | One-off backfill tool |
| `app/conversations/[id]/page.tsx` | **Modified** | Messages table + Summary card |
| `app/customers/[id]/page.tsx` | **Modified** | Learned Preferences card |

### Phase 2 — Voyage AI free tier optimisation + dashboard

| File | Action | Description |
|---|---|---|
| `supabase/functions/_shared/memory.ts` | **Modified** | `voyage-3` → `voyage-4-lite`, added `generateEmbeddings` batch fn, threshold 20→10 |
| `supabase/functions/whatsapp-handler/index.ts` | **Modified** | Uses `generateEmbeddings` batch call (1 API call instead of 2) |
| `supabase/functions/embed-backfill/index.ts` | **Modified** | Single batch API call for all 50 messages; added `deno.json` |
| `supabase/functions/embed-backfill/deno.json` | **Created** | Import map for `@supabase/supabase-js` (was missing, caused deploy error) |
| `app/components/Sidebar.tsx` | **Modified** | Added Memory, Security, Integrations nav items |
| `app/page.tsx` | **Modified** | Added embedding coverage metric + alert banners |
| `app/memory/page.tsx` | **Created** | 3-tier memory health dashboard |
| `app/security/page.tsx` | **Created** | Security events log |
| `app/integrations/page.tsx` | **Created** | All integration health (Voyage, Zettle, WhatsApp, Claude) |
| `app/conversations/[id]/page.tsx` | **Modified** | Memory Context panel, per-message embedding badge |

---

## `_shared/memory.ts`

The core module. All functions are safe to call in fire-and-forget context — they never throw.

### Types

```typescript
interface CustomerFacts {
  preferences: string[]       // things the customer likes
  dislikes: string[]          // things they dislike
  typical_order: string | null
  allergies: string[]
  notes: string | null
}

interface WorkingMemory {
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  summary: string | null
  facts: CustomerFacts | null
  semanticContext: Array<{ role: string; content: string; similarity: number }> | null
}
```

### `generateEmbeddings(texts, voyageApiKey, inputType?)` ← primary function
- POSTs to `https://api.voyageai.com/v1/embeddings` with `input: texts[]`
- Model: `voyage-4-lite` (200M free tokens on tier 1)
- Sorts results by `index` before returning to preserve input order
- Returns `number[][] | null` — **never throws**

### `generateEmbedding(text, voyageApiKey, inputType?)` ← single-item wrapper
- Delegates to `generateEmbeddings([text])` and returns `result[0]`
- Used for the query embedding in semantic search
- Returns `number[] | null`

### `insertMessage(conversationId, role, content, supabase)`
- Inserts a row into `public.messages` with `embedding = NULL`
- Returns the new UUID or `null` on failure

### `updateMessageEmbedding(messageId, embedding, supabase)`
- Updates `messages.embedding` after async generation
- Silent on failure

### `buildWorkingMemory(conversationId, customerId, currentMessage, supabase, voyageKey, totalMsgCount)`
Runs 3–4 queries in parallel:
1. Last 8 messages (`ORDER BY created_at DESC LIMIT 8`, reversed to chronological)
2. `customer_preferences.facts` for this customer
3. `conversations.summary`
4. Semantic search via `search_customer_messages` RPC — **only when `totalMsgCount > 4` and `voyageKey` is set**. Falls back to `search_similar_messages` if the customer-scoped RPC is unavailable.

Returns `WorkingMemory`.

### `extractCustomerFacts(recentMessages, existingFacts, anthropic)`
- Claude Haiku call, max 256 tokens
- Merges new conversation turns into existing facts JSON
- Returns `CustomerFacts | null` — `null` on parse failure, existing facts left untouched

### `generateSummary(olderMessages, existingSummary, anthropic)`
- Claude Haiku call, max 300 tokens
- Incorporates previous summary if present (rolling compression)
- Returns `string | null`

---

## `whatsapp-handler/context.ts` — Changes

`getOrCreateConversation` now returns `ConversationContext` instead of `Conversation`:

```typescript
interface ConversationContext {
  conversation: Conversation
  messageCount: number        // count from messages table, avoids second round-trip
}
```

The `messageCount` drives:
- Whether to activate Tier 2 semantic search (`> 10`)
- Whether to generate a rolling summary (`> 8`)

---

## `whatsapp-handler/prompts.ts` — Changes

`PROMPT_VERSION` bumped to `v2.0.0`.

`buildSystemPrompt` now accepts `workingMemory?: WorkingMemory` and injects up to three new sections above the rules block:

```
## CUSTOMER FACTS
- Preferences: leche de coco, frappe
- Typical order: CH Frappe con Coco
- Allergies: lactosa

## CONVERSATION HISTORY SUMMARY
The customer asked about the Americano and ordered a CH Caliente...

## RELEVANT PAST CONTEXT
[user]: ¿tienen algo sin lactosa?
[assistant]: Sí, tenemos opciones con leche de coco, almendra, soya y avena...
```

- `## CUSTOMER FACTS` — only shown when `facts` has at least one non-empty field
- `## CONVERSATION HISTORY SUMMARY` — only shown when `summary` is non-null
- `## RELEVANT PAST CONTEXT` — only shown when Tier 2 is active and returns results

---

## `whatsapp-handler/index.ts` — Changes

### Before Claude (sync)
```typescript
const userMsgId = await insertMessage(conversation.id, 'user', message, supabase)

const workingMemory = await buildWorkingMemory(
  conversation.id, customer.id, message, supabase,
  Deno.env.get('VOYAGE_API_KEY'), messageCount
)

// messages array built from workingMemory.recentMessages instead of JSONB slice
const messages = [...workingMemory.recentMessages, { role: 'user', content: message }]

const systemPrompt = buildSystemPrompt({ customerName, currentState, workingMemory })
```

### After Claude, before TwiML (sync)
```typescript
const assistantMsgId = await insertMessage(conversation.id, 'assistant', finalResponse, supabase)
// JSONB history still updated for backward compat
```

### After TwiML returned (async, `waitUntil`)
```typescript
// Tier 2: both messages embedded in a single Voyage AI API call
const embeddings = await generateEmbeddings([message, finalResponse], voyageKey, 'document')
const [userEmb, assistantEmb] = embeddings ?? [null, null]
await Promise.all([
  userMsgId && userEmb ? updateMessageEmbedding(userMsgId, userEmb, supabase) : Promise.resolve(),
  assistantMsgId && assistantEmb ? updateMessageEmbedding(assistantMsgId, assistantEmb, supabase) : Promise.resolve(),
])

// Tier 1: rolling summary (when > 8 messages)
const newSummary = await generateSummary(olderMsgs, conversation.summary, anthropic)
await supabase.from('conversations').update({ summary: newSummary }).eq('id', conversation.id)

// Tier 3: customer facts
const newFacts = await extractCustomerFacts(workingMemory.recentMessages, workingMemory.facts, anthropic)
await supabase.from('customer_preferences').upsert(
  { customer_id: customer.id, facts: newFacts },
  { onConflict: 'customer_id' }
)
```

---

## `embed-backfill` Edge Function

Backfills embeddings on messages with `embedding = NULL`. Sends the entire 50-message batch to Voyage AI in a single API call, then persists all embeddings in parallel.

**Endpoint:** `POST /functions/v1/embed-backfill`
**Auth:** Requires `Authorization: Bearer <anon-key>` (verify_jwt: true)

> Note: use the anon JWT (`eyJ...`), not the CLI access token (`sbp_...`).

**Response:**
```json
{
  "processed": 50,
  "succeeded": 50,
  "failed": 0,
  "remaining": "none"
}
```

Run repeatedly until `remaining` is `"none"`.

**Invoke command:**
```bash
# Retrieve your anon key from: supabase --project-ref xbudknbimkgjjgohnjgp status
TOKEN="<your-anon-key>"
curl -X POST https://xbudknbimkgjjgohnjgp.supabase.co/functions/v1/embed-backfill \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

**Re-backfill procedure** (required when switching embedding models):
```sql
-- 1. Null out existing embeddings
UPDATE public.messages SET embedding = NULL WHERE embedding IS NOT NULL;
```
Then invoke the backfill function until `remaining` is `"none"`.

---

## Voyage AI — Free Tier Notes

| Model | Free tokens | Dimensions | Context |
|---|---|---|---|
| `voyage-4-lite` | **200M** | 256 / 512 / **1024** / 2048 | 32K |
| `voyage-4` | 200M | 256 / 512 / 1024 / 2048 | 32K |
| `voyage-4-large` | 200M | 256 / 512 / 1024 / 2048 | 32K |
| `voyage-3` *(old)* | **0** | 1024 | 32K |

**Why we use `voyage-4-lite`:** fastest latency, 200M free tokens, cross-compatible with other voyage-4 models.

**Token budget estimate:** ~100 tokens/turn (user + assistant) → ~2M turns on free tier.

**Key facts:**
- `voyage-3` had zero free tokens — all previous embeddings were billed or silently failing
- voyage-4 series are cross-compatible with each other but NOT with voyage-3
- `output_dimension` defaults to 1024 and does not need to be sent explicitly

---

## Dashboard — Phase 2 Additions

### Overview (`/`)

- 6 metric cards in 2 rows (was 4)
- Added: **Embedding coverage** (`voyage-4-lite` %) and **Security events (24h)**
- Red alert banner if any messages are missing embeddings (links to `/memory`)
- Yellow alert banner if prompt injection attempts detected in last 24h (links to `/security`)

### Memory (`/memory`) — NEW

Three labelled sections, one per tier:

**Tier 2 — Embeddings:**
- Coverage %, missing count, semantic search active conversation count, model info

**Tier 1 — Working Memory:**
- Conversations with summary, rolling window size, trigger threshold, model

**Tier 3 — Customer Facts:**
- Customers with facts %, extraction model, fields extracted, trigger

Two tables:
- **Memory depth per conversation** — message count, Tier 1 active (summary), Tier 2 active (>10 msgs)
- **Messages missing embeddings** — with link to conversation, role, content preview, timestamp

### Security (`/security`) — NEW

- 4 metric cards: events 24h, unique phones 7d, injection attempts 7d, rate limit hits 24h
- Event type breakdown panel (color-coded by severity)
- Full event table: event type, phone, input text, details, timestamp

### Integrations (`/integrations`) — NEW

Four service cards with colored left-border (green = healthy, red/yellow = issue):

- **Voyage AI** — embedding coverage, missing count, last embedding timestamp, semantic search threshold
- **Zettle** — product count, available count, OAuth token validity + expiry date, last sync
- **WhatsApp/Twilio** — messages 24h/7d, success rate, avg handler latency, last message
- **Claude/Anthropic** — AI turns 24h/7d, cost 24h/7d, avg Claude latency, models in use

### Conversation detail (`/conversations/[id]`)

- **Memory Context panel** (new, above the chat):
  - Tier 1: summary active? (green/grey)
  - Tier 2: semantic active? shows `X / 10 messages` progress when not yet active
  - Tier 3: facts extracted? (green/grey)
  - Embeddings: `X / Y` with red highlight if any missing
  - Rolling summary rendered inline when present
  - Customer facts (likes, allergies, typical order) rendered inline when present
- Each chat message bubble now shows a `◎ embedded` / `◎ missing` micro-badge

---

## Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `VOYAGE_API_KEY` | Supabase secret | Voyage AI embeddings |
| `ANTHROPIC_API_KEY` | Supabase secret (pre-existing) | Claude API |
| `SUPABASE_URL` | Supabase secret (pre-existing) | Database access |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase secret (pre-existing) | Database access |

Set the Voyage key:
```bash
SUPABASE_ACCESS_TOKEN=<token> supabase secrets set VOYAGE_API_KEY=<key> \
  --project-ref xbudknbimkgjjgohnjgp
```

---

## Deployment

```bash
cd /Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow

# Deploy whatsapp-handler (includes _shared/memory.ts automatically)
SUPABASE_ACCESS_TOKEN=<token> supabase functions deploy whatsapp-handler \
  --project-ref xbudknbimkgjjgohnjgp --no-verify-jwt

# Deploy embed-backfill
SUPABASE_ACCESS_TOKEN=<token> supabase functions deploy embed-backfill \
  --project-ref xbudknbimkgjjgohnjgp
```

The CLI bundles the entire `supabase/functions/` directory, so `_shared/` modules are included automatically.

The MCP `deploy_edge_function` tool does **not** support `../` relative paths in the `files` array — always use the CLI for this project.

---

## Verification Checklist

After a WhatsApp test message:

- [ ] Row appears in `messages` with `embedding = NULL` immediately
- [ ] After `waitUntil` completes: `embedding` is populated (check with `SELECT COUNT(embedding) FROM messages`)
- [ ] After 8+ turns: `conversations.summary` is non-null
- [ ] After conversation: `customer_preferences.facts` has extracted preferences
- [ ] After 10+ turns: `search_similar_messages` RPC returns results (visible in edge function logs)
- [ ] Dashboard `/memory` shows 100% embedding coverage
- [ ] Dashboard `/conversations/[id]` Memory Context panel shows correct tier status
- [ ] Dashboard `/conversations/[id]` shows messages from `messages` table (not JSONB)
- [ ] Dashboard `/customers/[id]` shows Learned Preferences card with real data
- [ ] Dashboard `/integrations` shows Voyage AI as green/healthy

```sql
-- Quick verification query
SELECT
  (SELECT COUNT(*) FROM public.messages) AS total_messages,
  (SELECT COUNT(embedding) FROM public.messages) AS with_embedding,
  (SELECT COUNT(*) FROM public.conversations WHERE summary IS NOT NULL) AS with_summary,
  (SELECT COUNT(*) FROM public.customer_preferences WHERE facts != '{}'::jsonb) AS with_facts;
```

---

## Follow-up Tasks

- [ ] Implement **visit / session** rows per [conversation-and-session-layers.md](../conversation-and-session-layers.md) (L2); wire metrics and optional retrieval scope to `session_id` or equivalent
- [ ] Remove `conversation_history` JSONB writes from `index.ts` once dashboard migration is confirmed stable
- [ ] Add RLS policies to `messages` and `customer_preferences` tables (pre-existing issue across all tables)
- [ ] Consider moving `embed-backfill` to a scheduled job for any messages that miss embedding due to Voyage outage
- [ ] Fix `search_products` tool — 4-retry loop observed for simple queries like "less sweet options"; product names in DB don't match natural language queries

---

## Umi Cash — Competitive Landscape Research

*Researched 2026-02-19. Covers closed-loop digital gift cards and loyalty wallets for SMB cafés/restaurants, with Mexico/LATAM focus.*

### The Gold Standard: Starbucks Architecture

The most studied closed-loop wallet in the world. The core insight: **payment instrument = loyalty instrument = wallet**. One unified stored-value account. Every transaction is simultaneously a payment AND a loyalty event — no separate scan, no staff friction.

| Decision | What they did | Why it worked |
|---|---|---|
| Payment medium | 2D barcode (NOT NFC) | Reused existing POS scanners — zero hardware cost at 6,800 stores |
| Value model | Prepaid stored-value | Customers load money upfront → Starbucks holds float ($1.5B+ at peak) |
| Rewards | Stars earned at payment, automatically | No separate loyalty scan — 34.3M active members |
| Mobile Order & Pay (2014) | Pre-order + pay from app | 24% of US transactions by Q4 2020 |
| Data | 100% of transactions owned | Unmatched personalization, no Visa/MC intermediary |

### Platform-by-Platform Breakdown

| Platform | Model | Gift Card | Unified Wallet | Mexico Ready | Key Lesson |
|---|---|---|---|---|---|
| **Starbucks** | Closed-loop SV + loyalty | Internal | Yes | Yes | The blueprint — pay + earn in one action |
| **Square** | Closed-loop SV | Yes (free eGift) | No | Limited | Best SMB onboarding: 10 min, self-serve, Apple Wallet toggle |
| **Toast** | Restaurant POS + open gift API | Yes ($50/mo) | No | No | Gift card = API webhook layer separate from POS |
| **Paytronix** | Enterprise SaaS | Yes | Yes | No | Unified loyalty+gift → 47% guest enrollment rate |
| **Yiftee** | Mastercard prepaid community | Community only | No | No | Zero merchant friction — piggybacks on Mastercard rails |
| **Kangaroo** | White-label loyalty | No | No | Limited | White-label app available top tier; REST API v3 / OAuth 2.0 |
| **Stamp Me** | Punch card | No | No | Limited | $43/mo, no hardware — but shared consumer app, not merchant-branded |
| **LevelUp** (defunct) | QR payment + loyalty | No | No | No | Died: 2-sided network problem + no float model |
| **Belly** (defunct) | iPad loyalty | No | No | No | Died: proprietary hardware dependency at counter |
| **Spin by OXXO** | Super app / wallet | Indirectly | Yes | Dominant | Mexico's Starbucks — 13.1M users, 63.2M monthly txns, Premia points |
| **Fivestars/SumUp** | Payment-linked loyalty | No | No | Yes (SumUp MX) | Auto-earn on every SumUp POS swipe — closest SMB model in Mexico |
| **Loyallyst** | HoReCa loyalty SaaS | No | No | No (Ukraine) | Wallet-first (Apple/Google Wallet), no app download; €25–55/location/mo |

### Toast Gift Card API — Technical Pattern

Toast runs an **open webhook-based gift card API**. Every gift card transaction at any Toast terminal sends a REST HTTP request to the configured third-party provider endpoint. The `Toast-Transaction-Type` header identifies the transaction type:

- `GIFTCARD_REDEEM` — deduct from balance
- `GIFTCARD_REVERSE` — roll back
- `GIFTCARD_ACTIVATE` — activate new card
- `GIFTCARD_BALANCE_INQUIRY` — check balance before tender

Card identity can be: swipe track data, manual entry, 1D/2D barcode scan, or PIN. Response must include the wallet state after the transaction (new balance, success/failure). **This is the architecture Umi Cash should expose for future POS integrations.**

### Paytronix — Key Technical Patterns

Most sophisticated restaurant gift card API. Key POS integration flow:
1. POS calls `loadMap.json` on initialization → gets wallet/tender configuration for location (cached)
2. On transaction: `balanceInquiry` → `redeem` (response includes post-transaction wallet state)
3. On error: `reverse` (supports both `pxTransactionId` + `externalTransactionId` for idempotent reversal)

Card identity supports: card number, track data, phone number, barcode, Apple NFC VAS payload, Google NFC VAS payload, account token. The dual transaction ID pattern (internal + external) is critical for handling network failures gracefully — Umi Cash ledger should adopt this.

### Mexico / LATAM Landscape

**Gap confirmed:** No white-label, closed-loop stored-value + loyalty SaaS exists for independent Mexican cafés/restaurants.

| Platform | Type | Relevance |
|---|---|---|
| **Spin by OXXO + Spin Premia** | Super app, FEMSA | Dominant — 13.1M users, convenience retail. NOT a competitor for indie cafés. |
| **SumUp + Fivestars** | Payment-linked loyalty | Active in MX. Points on SumUp swipe. No gift cards. Closest SMB model. |
| **Yollty** | Digital stamp card | Mexican stamp app (similar to Stamp Me). No stored value. |
| **Clip loyalty** | POS-locked points | Only works if café uses Clip as POS. No gift cards. |
| **PAYBACK / Soriana** | Coalition retail | B2B/enterprise. Not relevant for indie restaurants. |
| **Up Sí Vale / Pluxee** | Employee benefits | B2B despensa/meal vouchers. Not consumer-facing loyalty. |
| **Mercado Pago / Puntos** | Open-loop wallet | Cashback on Mercado Libre transactions. Not a restaurant gift card solution. |

**Mexico loyalty market:** Projected $2.75B+ by 2030. FEMSA/OXXO anchors the mass market. Independent SMBs are underserved.

### 8 Principles: What Winners Do That Others Don't

**1. Payment = Loyalty = Wallet (The Starbucks Principle)**
When the stored-value balance is simultaneously the payment method AND the loyalty accumulation vehicle, every transaction triggers both in one server-side event. No separate scan. Losers (Belly, Square Loyalty) require two actions at checkout — pay, then separately scan for loyalty.

**2. Float as a Business Model**
Prepaid stored-value wallets hold customer money before it is spent. Starbucks held $1.5B+ in float. Breakage (unredeemed balances) = additional revenue recognized under ASC 606 / IFRS 15. Industry breakage rate: 5–20%. Platforms that use loyalty points only have zero float.

**3. Barcode/QR at POS — Not App-to-App**
The redemption mechanism must be compatible with whatever the merchant already has. Starbucks reused existing 2D scanners. Works on every smartphone. No NFC required. For Mexico SMBs: phone camera QR scan = universal, zero hardware cost.

**4. Apple Wallet / Google Wallet as Primary Distribution**
`.pkpass` file format → "Add to Apple Wallet" in gift card email → balance auto-updates via APNS push when balance changes. The balance lives server-side; the pass is only a token (QR/barcode encoding the unique card ID). Purchase → WhatsApp link → Wallet pass = viral gifting with zero app download requirement.

**5. API-First Single Centralized Ledger**
One stored-value ledger. Every channel (in-store QR, WhatsApp gift, online top-up, POS integration) hits the same ledger. A transaction at any channel updates the same balance. Siloed ledgers (separate POS balance vs. online balance) destroy customer trust immediately.

**6. Zero Hardware Dependency**
Belly died from the iPad dependency. Stamp Me's NFC pod adds cost. Winners: use existing hardware (Starbucks barcode scanners, Yiftee Mastercard terminals) or the merchant's own phone camera. For Umi Cash: merchant app on merchant's existing device = zero hardware investment required.

**7. Breakage is Revenue — Design Reporting Around It**
Unredeemed gift card balances above statistically expected redemption = recognized revenue under accounting standards. Restaurant gift card breakage: 5–20%. Merchant dashboard should surface breakage as a metric from day one. This is a key part of the business case for merchants (gift cards = immediate cash, breakage = bonus revenue).

**8. Self-Serve Onboarding in < 10 Minutes**
Square proved this is achievable: toggle in a dashboard, no sales call, no hardware, merchant live by morning. For Mexican SMB cafés: must work on a phone at 9pm. No integration required in Phase 1 — merchant app + camera QR scan is the POS "integration."

### Recommended Umi Cash Architecture

```
Phase 1 — Core (Zero POS Integration Required)
├─ Stored-value ledger (Supabase, append-only, SELECT FOR UPDATE)
├─ Dual transaction IDs: internal UUID + merchant-provided external ID (idempotent)
├─ WhatsApp gift link → hosted purchase page → eGift card issued
├─ Apple Wallet .pkpass generation (Deno edge function)
├─ Google Wallet pass generation (Google Wallet API)
├─ Merchant app: camera QR scan → verify + deduct via API
├─ Balance top-up: Clip / Conekta / Stripe MX + SPEI transfer
└─ Merchant dashboard: sales, redemptions, balance report, breakage %

Phase 2 — Loyalty Layer
├─ Points ("monedas") auto-earned on every stored-value transaction (server-side trigger)
├─ Configurable earn rate + reward catalog per merchant
└─ Tier upgrades (lifetime spend threshold → bonus earn rate)

Phase 3 — POS Integration
├─ Toast-style webhook endpoint (any POS that calls it becomes compatible)
├─ Native integrations: Loyverse, Clip, SumUp
└─ Automatic loyalty trigger on POS-verified purchases (no separate scan)
```

**Key regulatory note (Mexico):** Banxico's IFPE (Institución de Fondos de Pago Electrónico) license is required to hold/transfer stored value at scale. Phase 1 can operate under merchant-holds-their-own-funds model (Umi = tech provider, merchant = card issuer). IFPE required only when Umi centrally pools cross-merchant funds. Confirmed by Mexican legal analysis: closed-loop stored value per merchant = NOT regulated as fintech under current framework.

**The moat:** WhatsApp-native distribution + Apple/Google Wallet passes + zero hardware + built specifically for Mexico. Spin/OXXO has OXXO locations. Umi Cash has every independent café.
