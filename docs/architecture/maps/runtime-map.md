# Runtime Map

This map summarizes execution chains. Code and migrations remain the source of truth.

## ConversaFlow WhatsApp and job pipeline

1. `supabase/functions/whatsapp-handler/` receives Twilio ingress.
2. The handler validates request/security, records inbound/message state, and inserts workflow jobs.
3. `supabase/functions/job-worker/` claims jobs and dispatches processors.
4. `turn.integrity` coalesces trailing user messages into durable turns.
5. `turn.process` builds working memory, prompts the model, runs tools, writes assistant messages, writes outbox rows, records traces, and schedules background memory work.
6. The worker drains outbox rows and delivers external side effects with retry/dead-letter behavior.

## ConversaFlow memory and prompts

- Runtime prompts live with code under `supabase/functions/whatsapp-handler/`.
- Memory shaping lives in shared and processor modules.
- Memory is context, not operational truth.

## KDS execution

1. KDS reads backend-owned projections from schema `kds`.
2. KDS mutations go through backend command functions.
3. ConversaFlow remains the source of order truth.
4. KDS renders and optimistically updates local UI state while respecting backend transitions.

## Cash execution

1. Cash web/API behavior uses its Next.js/Vercel runtime.
2. Prisma defines Cash-owned data models.
3. Vercel cron routes run scheduled Cash workflows.
4. Wallet/pass behavior stays local to Cash unless a cross-product contract is explicitly introduced.

## Logs execution

1. Logs reads ConversaFlow trace/log tables through configured Supabase credentials.
2. Parser code assembles trace trees for UI display.
3. Logs does not own the underlying operational truth or trace schema.

## Dashboard execution

The dashboard reads live data through its server/API layer while leaving product data ownership in ConversaFlow, KDS, and Cash. Its visible functions, screens, and flows are the behavior contract for future production hardening.
