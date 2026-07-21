export const meta = {
  name: 'umi-architecture-reconstruction',
  description:
    'Reconstruct the Umi business from a multi-product monorepo and derive a cost-minimizing, optionality-preserving architecture with ADRs',
  whenToUse:
    'Deep CTO-level reverse-engineering of the Umi platform: business reconstruction → domain model → requirements → industry comparison → tech selection, with adversarial assumption-challenge.',
  phases: [
    {
      title: 'Evidence',
      detail: 'Parallel readers extract structured evidence from every subsystem',
    },
    { title: 'Research', detail: 'Parallel web research on comparable architectures & patterns' },
    {
      title: 'Synthesis',
      detail: 'One agent per deliverable consumes full evidence+research bundle',
    },
    { title: 'Challenge', detail: 'Adversarial assumption-busting + completeness critic' },
    { title: 'Assemble', detail: 'Single writer assembles the master document to disk' },
  ],
};

// ---------------------------------------------------------------------------
// Shared grounding primer — established facts the orchestrator already verified.
// Every agent gets this so findings stay consistent. Agents must still VERIFY
// against the repo and may correct it; the primer is orientation, not gospel.
// ---------------------------------------------------------------------------
const PRIMER = `
UMI — GROUNDING PRIMER (verify against the repo; correct if wrong)

Identity: "Umi" (umiconsulting.co / "Umi Consultoría"). An AI-first, MULTI-TENANT
restaurant operations platform. Spanish-language, Mexico/LatAm market. Sold as a
SUITE of products activated à la carte; the public site runs a 3-minute
"diagnostic" quiz that routes a prospect to whichever product solves their
biggest bottleneck (pedidos/orders, cocina/kitchen, lealtad/loyalty,
visibilidad gerencial/owner-visibility, observabilidad). Land-and-expand motion.

Products (monorepo apps/*):
- umi-conversaflow: SHARED Supabase backend (Deno edge functions) — WhatsApp AI
  ordering/customer-experience agent, job-queue worker, transactional outbox,
  prompts, durable memory, RAG, cross-channel normalization. The operational core.
- umi-cash: Next.js + Prisma — loyalty, points, gift cards, stored-value wallet,
  Apple/Google Wallet passes, OTP. Has its OWN production Supabase DB
  (rrkzhisnadfrgnhntkiz) that is the untouchable real money source of truth.
- umi-kds: NATIVE iPad (Swift/Xcode) Kitchen Display System client. Reads a
  backend-owned kitchen projection; must NOT be source of truth for orders.
- umi-dashboard: Vite + Express(server.js) + Prisma — owner cockpit / live-data
  admin UI, RBAC, customer-360.
- umi-logs: Next.js — ConversaFlow operational logs & trace UI (observability).
- umi-landing-page: Next.js — public marketing + lead capture (grow domain).

Target data architecture (docs/architecture/platform-database-architecture.md):
A single Postgres with DOMAIN-NAMED schemas (names say what data IS, not which
product owns it): core (identity/tenancy), ops (orders/catalog/payments/channels),
comms (AI conversations/memory/knowledge/RAG), loyalty (points/wallet/passes,
append-only ledgers), device (hardware pairing/sessions), kitchen (station config),
queue (jobs/outbox/webhooks/idempotency, service_role only), observability
(traces/ai_runs/audit, service_role only), grow (Umi's own leads/subscriptions/
feature_flags, no tenant_id, service_role only).
Patterns: RLS tenant isolation; exactly THREE pg roles (umi_app RLS-enforced
request role, umi_worker BYPASSRLS background, umi_readonly analytics) — never a
role per tenant; composite tenant FKs (tenant_id,id); roles-as-edges identity
(core.people + contact_methods + users + tenant_memberships, NO type/role column);
append-only points_ledger (balance = SUM(delta), derived balances cache);
cross-product effects via queue.outbox_events (at-least-once, idempotent consumers);
KDS reads ops.order_items via a view, not a duplicate table.
Explicitly designed to host FUTURE verticals (POS, Gym, Time Clock, retail) on the
same core — "products come and go, domains are permanent."

Current migration state (2026-06): consolidating TWO live Supabase projects (the
Cash prod DB rrkzhisnadfrgnhntkiz + a platform DB xbudknbimkgjjgohnjgp) into ONE
canonical platform DB on Supabase (PG17). Cash app rewritten onto canonical schema
and cut over. Monorepo cutover gated by stoppers ST-1..ST-5. There is also a
local-postgres canonical DDL set (docs/migration/local-postgres/*.sql) — evidence
the team wants a portable, non-Supabase-locked schema.

Known external services seen in code/deps: Supabase (Postgres+Auth+Edge/Deno+
pgvector+Realtime+Cron), Twilio (WhatsApp ingress), Voyage AI (embeddings),
Anthropic (LLM), Resend + nodemailer (email), Stripe + Conekta (payments — Conekta
is Mexican), Zettle/PayPal (POS oauth), Apple/Google Wallet (passkit), Slack
(ops notifications), Vercel (Next.js hosting), Prisma (ORM).

REALITY CHECK to keep front-of-mind: the live tenant count appears VERY SMALL
(named tenants like "El Gran Ribera" and "Kalala Cafe"). The architecture is
designed for a 5-vertical multi-tenant platform but the business today is a
handful of restaurants. This gap (ambition vs current scale) must be surfaced,
not papered over.
`.trim();

const GOALS = `
ANALYSIS CONTRACT (apply to every conclusion):
- The objective is NOT to recommend trendy technology. It is to reconstruct the
  business, infer its long-term goals + implicit requirements, then derive the
  architecture that minimizes operational cost, vendor lock-in, and unnecessary
  complexity. CHALLENGE assumptions; do not accept them.
- Treat infrastructure as a long-term BUSINESS ASSET, not a basket of rented
  services. Prefer open standards, self-hostable components, and choices that
  preserve optionality. Introduce a managed service ONLY when it yields a clear,
  measurable advantage that outweighs its recurring financial + operational cost
  and its lock-in. When you do, state the advantage and the exit/migration path.
- Optimization priority order: (1) long-term maintainability, (2) business
  sustainability, (3) low recurring infra cost, (4) open standards, (5)
  self-hostability where reasonable, (6) PostgreSQL-first whenever appropriate,
  (7) AI-assisted dev workflows, (8) high observability, (9) strong security,
  (10) simplicity over novelty.
- Every technology recommendation MUST answer: why needed? why preferable? what
  alternatives? what trade-offs? what recurring cost? can it be self-hosted? does
  it create lock-in? what is the migration path if replaced later?
- Where you spot a choice driven by trend/resume/novelty rather than a measured
  business requirement, say so plainly and propose the simpler alternative.
- Distinguish IMPLEMENTED (in code) from PLANNED/ASPIRATIONAL (in docs). Code is
  one evidence source among several; the business includes unbuilt intent.
`.trim();

// ===========================================================================
// PHASE 1+2 — Evidence extraction (repo) and Industry research (web), concurrent.
// Single barrier: every synthesis deliverable needs the COMPLETE bundle.
// ===========================================================================

const EVIDENCE_TASKS = [
  {
    label: 'ev:business-gtm',
    prompt: `Extract BUSINESS & GO-TO-MARKET evidence. Read apps/umi-landing-page
(src/app/page.tsx and src/components/** — Hero, Logos, Services, Stats,
DiagnosticQuiz under src/components/diagnostic, Process, Testimonials,
ContactSection, Footer; any src/data or content files; lib for lead capture/email),
the grow-domain tables in docs/architecture/platform-database-architecture.md, and
any pricing/plan/subscription signals anywhere in the repo (grep "plan", "precio",
"subscription", "trial", "mensual").
Answer with evidence quotes/paths: What exact problem does Umi sell against? Who
is the buyer (restaurant owner? GM?) and who is the end-user? Why do they pay?
What is the differentiation/positioning (read the Spanish copy literally and
translate key claims)? What products are presented as live vs "coming"? What is
the lead-capture / sales funnel (diagnostic quiz options → which product)? Any
testimonials/logos implying current customers or scale? What revenue streams are
implied (per-product subscription? bundle? setup/consulting?).`,
  },
  {
    label: 'ev:conversaflow-runtime',
    prompt: `Extract CONVERSAFLOW BACKEND RUNTIME evidence — this is the
operational core. Read apps/umi-conversaflow/supabase/functions/** especially
_shared (supabase client, logger, workflow, memory, adapters), whatsapp-handler
(Twilio ingress), job-worker (index, processors/**, dispatchers/**), kds-command,
kds-board, kds-pairing, zettle-oauth-setup. Skim apps/umi-conversaflow/sql and
supabase/migrations for runtime tables. Read AGENTS.md / REPO_CONTEXT.md.
Answer: What is the end-to-end message flow (WhatsApp inbound → job → worker →
turn → tools → outbox → dispatch)? What TOOLS can the AI invoke (the action
surface)? Which LLM(s) and embedding model, called where, and is cost/usage
traced? How is durable memory + RAG implemented? How is multi-tenancy enforced in
the runtime (config per business, DB_SCHEMA)? What background/async work runs
(cron, job types, outbox consumers)? What does this tell us about message
throughput, latency, concurrency, and AI workload? Quote file paths.`,
  },
  {
    label: 'ev:cash-loyalty-wallet',
    prompt: `Extract CASH / LOYALTY / WALLET / PAYMENTS evidence. Read
apps/umi-cash: prisma/schema.prisma (all models + relations), key app routes/API
(loyalty earn/redeem, gift cards, wallet top-up, passes — passkit-generator,
Apple/Google Wallet), OTP/phone verification (libphonenumber, jose/jwt), payment
integrations (grep stripe, conekta, mercadopago, zettle). Also read
docs/migration/2026-06-18-umi-cash-rewrite-contract.md and the loyalty section of
platform-database-architecture.md.
Answer: What is the loyalty model (points vs visit-cycle vs stored value)? How is
financial integrity handled (ledgers, balances, idempotency, money in cents)?
What is the wallet-pass lifecycle (issue, update, push to device)? What payment
processors are integrated and for what (loyalty top-up? order payment?)? What PII
flows through here? What are the consistency/durability requirements? Note what is
IMPLEMENTED vs described only in the rewrite contract. Quote paths.`,
  },
  {
    label: 'ev:kds-device-kitchen',
    prompt: `Extract KDS / DEVICE / KITCHEN evidence. Read apps/umi-kds (Swift
Sources/** — networking layer, realtime/polling, models, auth/pairing, offline
handling; Info.plist; docs/). Read the kitchen + device sections of
platform-database-architecture.md, docs/architecture/2026-04-15-kds-schema-
normalization-spec.md, 2026-05-22-kds-pin-pairing-plan.md, 2026-05-23-kds-device-
revocation-implementation-plan.md, and the conversaflow kds-command/kds-board/
kds-pairing functions.
Answer: How does the iPad client get tickets (realtime subscription? polling a
projection? edge function)? How does device pairing + revocation work (PIN, JWT,
sessions, heartbeat)? What are the OFFLINE/availability requirements for a kitchen
screen (what happens when network drops mid-service)? What latency does a kitchen
display need? How is the device domain generalized beyond KDS (printers, kiosks,
gym check-in)? Quote paths and call out IMPLEMENTED vs PLANNED.`,
  },
  {
    label: 'ev:dashboard-rbac-owner',
    prompt: `Extract OWNER DASHBOARD / RBAC / ROLES evidence. Read
apps/umi-dashboard: server.js + api/** (the Express API surface), src/** React
views (what owners actually see/do: customers, customer-360, conversations,
insights, loyalty, orders, settings), auth + tenant membership handling, prisma.
Read docs/migration/2026-05-17-dashboard-tenant-membership-implementation-plan.md
and 2026-05-24-dashboard-customer-conversations-plan.md.
Answer: Enumerate USER ROLES and PERMISSIONS (owner/admin/staff/cashier/
superadmin) and how RBAC is enforced (membership_roles, where checks live). What
are the owner OPERATIONAL WORKFLOWS the dashboard supports? What cross-tenant
"superadmin" capability exists (Umi staff)? What data does the owner read across
schemas? What is the availability expectation for an admin cockpit vs the
customer-facing runtime? Quote paths; mark IMPLEMENTED vs PLANNED.`,
  },
  {
    label: 'ev:observability-logs',
    prompt: `Extract OBSERVABILITY / LOGS / AI-COST evidence. Read apps/umi-logs
(Next.js views: conversations, traces, memory, integration health, WhatsApp
health, Voyage embedding health, conversation triage) and the observability schema
in platform-database-architecture.md (ai_runs, tool_calls, pipeline_spans,
audit_log, security_events, edge_logs, data_quality_findings). Skim conversaflow
diagnostics/reports.
Answer: What is currently MEASURED in production (AI token cost per run? latency?
WhatsApp delivery health? embedding backfill health?)? What audit trail exists?
What does the team monitor and triage manually today? What does this reveal about
operational maturity, current pain points, and observability requirements? What
signals exist about current SCALE (volume of conversations/messages/runs)? Quote
paths.`,
  },
  {
    label: 'ev:data-layer-asbuilt',
    prompt: `Extract the AS-BUILT / AS-TARGETED DATA LAYER evidence. Read the
canonical DDL set docs/migration/local-postgres/*.sql (schemas, tables, RLS in
050_rls_tenant_isolation.sql, roles, ledgers, triggers, the 020 FDW source file),
docs/migration/2026-06-16-database-integrity-spec.md,
docs/migration/2026-06-18-curated-column-mapping.md (head + structure),
docs/migration/argument-against-type-column.md, and the canonical-schema-and-
identity reconciliation doc.
Answer: What does the REAL DDL implement vs the architecture prose (schemas
present, RLS policies, the three roles, composite FKs, append-only ledger
triggers, normalize_phone, SECURITY DEFINER RPCs)? Where does the as-built diverge
from the target spec? What integrity gates exist (financial conservation,
idempotency)? Is the schema genuinely Postgres-portable (works on vanilla PG, not
just Supabase) or does it depend on Supabase-isms (auth.users, exposed_schemas,
service_role, GUCs)? Quote paths and specifics.`,
  },
  {
    label: 'ev:strategy-roadmap',
    prompt: `Extract STRATEGIC INTENT, ROADMAP & PLANNED PRODUCTS evidence. Read
docs/migration/2026-06-09-workspace-integration-implementation-plan.md (the active
driver), docs/migration/2026-06-16-migration-plan.md (large — read the exec
summary, phase list, and any "future"/"vision"/"roadmap" sections; do NOT read all
137KB, sample structure + key sections), 2026-06-17-migration-stoppers-register.md,
2026-06-16-execution-runbook.md, AGENTS.md, WORKSPACE.md, docs/governance/**.
Answer: What is the explicit long-term vision and sequencing invariant (DB
consolidation → backend consolidation → monorepo)? What FUTURE products/verticals
are named (POS, Gym, Time Clock, retail, signage)? What planned-but-unbuilt
features appear? What operational constraints and governance rules bind the team
(push matrix, agent-safe boundaries, authority)? What are the current BLOCKERS
(stoppers ST-1..ST-5)? What does the team consider "done" vs "pending"? Quote
paths.`,
  },
  {
    label: 'ev:vendor-cost-lockin',
    prompt: `Extract the VENDOR / COST / LOCK-IN footprint. Across ALL apps grep
package.json deps, .env.example files, config, and code for every external
service. For EACH service found (Supabase, Vercel, Twilio, Voyage AI, Anthropic,
Resend, Stripe, Conekta, Zettle/PayPal, Apple/Google Wallet, Slack, Google APIs,
Prisma, any others), report: (a) what it is used for in Umi, (b) where (paths),
(c) its pricing MODEL (per-message, per-token, per-seat, per-project, usage), (d)
whether a credible SELF-HOSTED or open-standard alternative exists, (e) lock-in
severity (low/med/high) and WHY (proprietary APIs? data gravity? auth coupling?).
Be concrete. Also note which services are load-bearing vs nice-to-have. This feeds
the FinOps/cost analysis — be exhaustive and structured as a table-like list.`,
  },
  {
    label: 'ev:scale-deploy-reality',
    prompt: `Extract CURRENT SCALE & DEPLOYMENT REALITY — the gap between ambition
and today. Find: how many real TENANTS exist (grep tenant/business names, seeds,
configs — e.g. "El Gran Ribera", "Kalala", "Ribera"; count distinct). Current
DEPLOYMENT topology (Vercel projects per app, Supabase project refs, custom
domains like cash.umiconsulting.co, cron jobs, edge function deploys). Any traffic/
volume/row-count signals (audit-output/ schema dumps, validation row counts,
reports). The monorepo tooling state (pnpm-workspace.yaml, turbo.json — is it
actually used or inert?). Read docs/migration/2026-06-17-phase-a-preflight-log.md
and docs/migration/audit-output/ if present.
Answer plainly: how big is this business RIGHT NOW (tenants, locations, approx
volume)? What is actually deployed and where? How much of the "platform" is live
vs scaffolding? This is the reality anchor for right-sizing every recommendation.
Quote paths and real numbers where found.`,
  },
];

const RESEARCH_TASKS = [
  {
    label: 're:conversational-commerce',
    prompt: `Web research: ARCHITECTURE PATTERNS for conversational-commerce /
WhatsApp-ordering / AI customer-experience platforms (e.g. how companies build
LLM agents over WhatsApp Business API / Twilio, durable message processing, tool-
calling order capture, RAG over a business knowledge base, durable memory).
Extract RECURRING architectural patterns (not vendors): async ingress + job queue,
idempotent webhook handling, transactional outbox for side effects, per-tenant
prompt/config, conversation+memory data modeling, cost control on LLM/embeddings.
Cite primary sources (engineering blogs, docs, papers). Return patterns + the
trade-offs + when each applies to a SMALL multi-tenant platform.`,
  },
  {
    label: 're:pos-loyalty-wallet',
    prompt: `Web research: how successful POS / LOYALTY / DIGITAL-WALLET platforms
(Toast, Square, Lightspeed, Stamps/loyalty apps, Apple/Google Wallet pass issuers)
structure their systems. Focus on: append-only financial ledgers + derived
balances, idempotency for money movement, points/visit/stored-value modeling,
wallet pass update/push lifecycle, order lifecycle event modeling, offline-tolerant
kitchen/POS clients. Extract reusable PATTERNS and the data-integrity techniques.
Cite primary/engineering sources. Return patterns + trade-offs relevant to a
Postgres-first, self-hostable design.`,
  },
  {
    label: 're:multitenant-postgres-isolation',
    prompt: `Web research + primary sources: MULTI-TENANT data isolation strategies
in PostgreSQL — RLS (row-level security) vs schema-per-tenant vs database-per-
tenant vs shared-table-with-tenant_id. Cover: RLS performance characteristics &
pitfalls at scale, connection/role models (single app role + set_config GUC vs
role-per-tenant), composite-FK tenant guards, when to graduate from shared to
isolated, Citus/partitioning. Cite Postgres docs, Supabase/Crunchy/AWS engineering
writeups, and any academic/industry benchmarks. Return a decision framework keyed
to tenant count and growth, and the trade-offs. This validates Umi's RLS + 3-role
choice.`,
  },
  {
    label: 're:event-driven-outbox',
    prompt: `Web research + primary sources: EVENT-DRIVEN integration with the
TRANSACTIONAL OUTBOX pattern, idempotent consumers, at-least-once delivery, and
using POSTGRES AS A QUEUE (SELECT ... FOR UPDATE SKIP LOCKED, LISTEN/NOTIFY,
pg_cron, pgmq) vs dedicated brokers (Kafka/RabbitMQ/SQS). Also CDC options
(logical replication, Debezium) for analytics offload. Cite Chris Richardson /
microservices.io, Postgres docs, pgmq/River/Oban-style writeups, engineering blogs.
Return: when Postgres-as-queue is sufficient vs when a broker is justified, the
operational cost difference, and how this maps to a SMALL platform that wants to
avoid extra infra. Trade-offs explicit.`,
  },
  {
    label: 're:selfhost-vs-managed-ai',
    prompt: `Web research + primary sources on TWO themes. (1) SELF-HOSTING vs
managed for the Postgres-first stack: self-hosted Supabase vs managed Supabase vs
plain Postgres + PostgREST/Auth alternatives (Keycloak/Ory/Authentik), Vercel vs
self-hosted Next.js (Docker/Coolify/Kamal/Fly), object storage (S3/MinIO),
realtime alternatives. Capture the REAL operational cost of self-hosting
(backups, HA, upgrades, on-call) vs the lock-in cost of managed. (2) AI
infrastructure optionality: LLM gateways/abstraction (provider-agnostic routing),
self-hostable embeddings (vs Voyage), pgvector vs dedicated vector DBs, controlling
LLM spend. Cite primary docs/engineering sources. Return a decision framework
emphasizing OPTIONALITY and measurable advantage thresholds for choosing managed.`,
  },
];

phase('Evidence');
log(
  `Spawning ${EVIDENCE_TASKS.length} repo-evidence readers + ${RESEARCH_TASKS.length} industry-research agents concurrently`,
);

const allInputs = await parallel([
  ...EVIDENCE_TASKS.map(
    (t) => () =>
      agent(
        `${PRIMER}\n\n---\n\n${GOALS}\n\n---\n\nYOU ARE A REPO-EVIDENCE READER. ${t.prompt}\n\nReturn DENSE, well-structured markdown findings (use H3 headings + bullets, cite file paths). This is raw evidence for a downstream synthesis layer — be specific and quote real names/paths/numbers, not generalities. Flag explicitly where the repo CONTRADICTS the primer.`,
        { label: t.label, phase: 'Evidence' },
      ).then((text) => ({ kind: 'evidence', label: t.label, text })),
  ),
  ...RESEARCH_TASKS.map(
    (t) => () =>
      agent(
        `${GOALS}\n\n---\n\nYOU ARE AN INDUSTRY-RESEARCH AGENT for the Umi platform (context: ${PRIMER.slice(0, 900)}...). Use web search/fetch. ${t.prompt}\n\nReturn structured markdown: each PATTERN with (what it is, when to use, trade-offs, recurring cost / self-host implication) and CITATIONS (title + URL). Prefer primary sources. Be concrete and decision-oriented.`,
        { label: t.label, phase: 'Research' },
      ).then((text) => ({ kind: 'research', label: t.label, text })),
  ),
]).then((rs) => rs.filter(Boolean));

const evidence = allInputs.filter((r) => r.kind === 'evidence');
const research = allInputs.filter((r) => r.kind === 'research');
log(`Collected ${evidence.length} evidence blocks + ${research.length} research blocks`);

const EVIDENCE_BUNDLE = evidence
  .map((e) => `\n===== EVIDENCE [${e.label}] =====\n${e.text}`)
  .join('\n');
const RESEARCH_BUNDLE = research
  .map((r) => `\n===== RESEARCH [${r.label}] =====\n${r.text}`)
  .join('\n');
const BUNDLE = `${PRIMER}\n\n---\n\n=== REPO EVIDENCE BUNDLE ===\n${EVIDENCE_BUNDLE}\n\n=== INDUSTRY RESEARCH BUNDLE ===\n${RESEARCH_BUNDLE}`;

// ===========================================================================
// PHASE 3 — Synthesis: one agent per deliverable, each fed the full bundle.
// Barrier: the challenge phase reads ALL synthesized deliverables.
// ===========================================================================

const DELIVERABLES = [
  {
    key: 'business',
    title: '1. Business Reconstruction & Capability Map',
    prompt: `Produce Phase-1 BUSINESS RECONSTRUCTION + the CAPABILITY MAP.
Reconstruct the company from ALL evidence (not just code): the problem solved, who
pays and why, differentiation, revenue streams, products that EXIST vs PLANNED,
operational workflows, which workflows generate revenue vs cost. Then a CAPABILITY
MAP: the business capabilities Umi must deliver (e.g. customer messaging, order
capture, kitchen routing, loyalty/financial integrity, owner analytics, tenant
onboarding, billing, observability), grouped, each marked live/partial/planned.
Explicitly reconcile AMBITION vs CURRENT SCALE. Challenge any positioning that the
evidence doesn't support.`,
  },
  {
    key: 'domain',
    title: '2. Domain Model & Bounded Contexts',
    prompt: `Produce the Phase-2 DOMAIN MODEL. Core entities + relationships;
bounded contexts (core/ops/comms/loyalty/device/kitchen/queue/observability/grow)
with their data ownership and the connection law (FKs point down into core;
cross-context via outbox); lifecycle of key information (a person, an order, a
loyalty point, a conversation, a device, a lead); user roles + permissions;
external actors; the key operational workflows as entity interactions. Present
it crisply (entity tables + a textual context map). Note where the as-built data
layer diverges from the target. Critique any modeling that looks over-normalized
or premature for current scale.`,
  },
  {
    key: 'events',
    title: '3. Event Flows',
    prompt: `Produce the EVENT FLOWS deliverable. Document the principal end-to-end
flows as ordered event/step sequences with the schemas/tables touched and the
outbox events emitted/consumed. At minimum: (a) WhatsApp inbound → AI turn → order
placed → kitchen ticket → ready → completed → loyalty points awarded → wallet pass
/ push update; (b) loyalty redemption; (c) gift-card load/spend; (d) device pairing
+ revocation; (e) lead capture → tenant onboarding → subscription; (f) nightly
reconciliation / data-quality. Show the transactional-outbox + idempotent-consumer
mechanics explicitly. Use compact sequence-style notation. Flag at-least-once /
ordering / idempotency hazards.`,
  },
  {
    key: 'opsreq',
    title: '4. Operational Requirements',
    prompt: `Produce Phase-3 OPERATIONAL REQUIREMENTS, each as a concrete target
RIGHT-SIZED to the real current scale with a clear growth path (state assumptions;
give numbers/ranges). Cover: availability (per surface: customer WhatsApp runtime
vs kitchen display vs owner dashboard vs landing — they differ), latency, offline
(kitchen), concurrency, expected traffic, storage + document + message growth, AI
workload (tokens/run, runs/day), background processing, audit, disaster recovery,
backup strategy (RPO/RTO), observability, security, compliance/privacy (PII, GDPR-
style deletion, financial audit, Mexican context), cost constraints. Separate
TODAY's requirement from the AT-SCALE requirement. Reject gold-plating that current
scale doesn't justify.`,
  },
  {
    key: 'industry',
    title: '5. Industry Comparison',
    prompt: `Produce Phase-4 INDUSTRY COMPARISON. Compare reconstructed-Umi against
recurring architectural patterns from comparable categories (conversational
commerce, POS, loyalty/wallet, multi-tenant SaaS, event-driven systems, AI
copilots) using the RESEARCH BUNDLE. Do NOT recommend copying their tech; EXTRACT
the patterns Umi should adopt, adapt, or explicitly reject, each with the source-
backed rationale and the trade-off. Call out where Umi already aligns with a strong
pattern (outbox, append-only ledger, RLS) and where it diverges. Cite the research
sources inline.`,
  },
  {
    key: 'dataarch',
    title: '6. Data Architecture',
    prompt: `Produce the DATA ARCHITECTURE deliverable (Phase-5 data + storage +
search + vector + auth/z at the data layer). Detail: the canonical Postgres schema
strategy (domain schemas, tenancy model, RLS + 3-role design, composite FKs,
append-only ledgers, SECURITY DEFINER RPCs), and JUDGE it against the research
(is RLS+shared-table right for this tenant count? when graduate?). Cover storage
(blobs/passes/images), search + pgvector RAG, idempotency/queue tables, analytics
offload path (outbox→CDC→replica/warehouse), backups, and Postgres-portability
(can this run off Supabase on vanilla PG?). Recommend the simplest design that
meets requirements; flag anything over-built for current scale and give the
"grow into it" trigger. PostgreSQL-first.`,
  },
  {
    key: 'infra',
    title: '7. Infrastructure & Deployment Architecture',
    prompt: `Produce the INFRASTRUCTURE + DEPLOYMENT architecture (Phase-5/Phase-7).
Cover: compute/hosting for each app (Next.js apps, Express dashboard API, Deno edge
functions/job worker, the native iPad client distribution), runtime for the job
queue + outbox dispatch + cron, realtime delivery to KDS, networking, secrets,
CI/CD, environments (preview/staging/prod), the monorepo build (pnpm+turbo — is it
worth activating?), and developer workflow incl. AI-assisted dev. Give TWO clearly-
labeled topologies: (A) pragmatic managed (today, minimal ops) and (B) self-hosted/
optionality-preserving (portable target). For each component state the open-
standard/self-host alternative and the migration path. Emphasize treating infra as
a durable asset; managed only where measurably worth it.`,
  },
  {
    key: 'cost',
    title: '8. Cost Analysis (FinOps)',
    prompt: `Produce the COST ANALYSIS / FinOps deliverable. Using the vendor-cost
evidence, build a recurring-cost model at (a) TODAY's tiny scale and (b) a 50-
tenant scale. For each service give pricing model + estimated monthly cost +
primary cost driver (LLM tokens, WhatsApp messages, embeddings, Supabase compute/
egress, Vercel, etc.). Identify the cost drivers that scale with usage vs fixed.
Show where self-hosting flips from more-expensive (tiny scale, ops cost dominates)
to cheaper (at scale), with the rough crossover. Give concrete cost-control levers
(LLM caching/model tiering/cheaper models, embedding reuse, message batching,
Supabase→PG migration). Be numeric and honest about uncertainty. Conclude with a
recommended posture per scale stage.`,
  },
  {
    key: 'risk',
    title: '9. Risk Analysis',
    prompt: `Produce the RISK ANALYSIS. Enumerate risks across: security (the
already-flagged credential exposure / pending Supabase JWT + Twilio rotation, RLS-
bypass surface, the umi_app role discipline), financial integrity (loyalty/money
correctness, the live-Cash-DB migration with conservation gates), data (multi-
tenant isolation failure, the cross-tenant superadmin), vendor lock-in &
concentration (single Supabase project as SPOF, Twilio/WhatsApp dependency,
single-LLM-provider), operational (tiny team running a broad platform, monorepo
cutover stoppers, no clear DR), product/business (premature multi-vertical
generalization, very few tenants vs platform ambition), compliance (PII, Mexican
data context). For each: likelihood × impact, and a concrete mitigation. Rank top
risks. Be blunt.`,
  },
  {
    key: 'stack',
    title: '10. Recommended Technology Stack',
    prompt: `Produce the Phase-6 RECOMMENDED TECHNOLOGY STACK — only after the
requirements above justify each piece. For EVERY recommendation answer the full
gate: why needed, why preferable, alternatives, trade-offs, recurring cost, self-
hostable?, lock-in?, migration path if replaced. Cover: database, ORM/data-access
(Prisma is used in 2 apps with raw SQL elsewhere — reconcile), auth/z, storage,
search/vector, queue/scheduling, realtime, payments, email/notifications, AI
(LLM provider strategy + gateway + embeddings + RAG), hosting/runtime, CI/CD,
observability, IaC, dev workflow. Default to PostgreSQL-first, open standards,
self-hostable, simplicity over novelty; recommend managed ONLY with a stated,
measurable advantage and an exit path. Where the current stack is already right,
SAY SO and don't churn it. Present as a table + per-decision notes.`,
  },
  {
    key: 'roadmap',
    title: '11. Migration / Evolution Roadmap',
    prompt: `Produce the MIGRATION ROADMAP. Sequence the work respecting the team's
own invariant (DB consolidation → backend consolidation → monorepo) and current
stoppers, but right-sized and de-risked. Phased plan with: objective per phase,
concrete steps, exit criteria, rollback, and what to explicitly DEFER (anti-gold-
plating — e.g. don't build gym vertical or analytics warehouse now). Include the
near-term security must-dos (credential rotation/scrub) as phase 0. Show the
optionality-preserving moves (keep schema PG-portable, abstract the LLM provider,
keep outbox broker-agnostic) sequenced so they don't block shipping. Give a
realistic cadence for a very small team. End with the trigger conditions that
graduate Umi to the next architectural tier.`,
  },
  {
    key: 'adrs',
    title: '12. Architectural Decision Records (ADRs)',
    prompt: `Produce a set of ADRs (8-14) covering every MAJOR decision, in classic
ADR form: Title, Status, Context, Decision, Consequences, Alternatives considered,
Revisit-when trigger. Required ADRs at minimum: (1) single Postgres with domain-
named schemas; (2) shared-table multi-tenancy via RLS + 3 fixed pg roles (not
schema/db-per-tenant, not role-per-tenant); (3) roles-as-edges identity (no
type/role column); (4) append-only financial ledgers with derived balances; (5)
transactional outbox + Postgres-as-queue instead of a broker; (6) managed Supabase
now vs self-hostable Postgres-first target (optionality); (7) LLM provider
abstraction + cost controls; (8) KDS reads a projection/view, not source of truth;
(9) monorepo consolidation timing; (10) keep-or-replace Prisma. Each ADR must take
a clear position and name its revisit trigger. These are the load-bearing
justifications — make them sharp.`,
  },
];

phase('Synthesis');
log(
  `Synthesizing ${DELIVERABLES.length} deliverables, each grounded in the full evidence+research bundle`,
);

const sections = await parallel(
  DELIVERABLES.map(
    (d) => () =>
      agent(
        `${BUNDLE}\n\n---\n\n${GOALS}\n\n---\n\nYOU ARE A PRINCIPAL ARCHITECT writing ONE section of a CTO-level reconstruction-and-architecture report for Umi. Ground every claim in the EVIDENCE/RESEARCH bundle above; cite file paths (repo) and source URLs (research) where relevant. Distinguish IMPLEMENTED vs PLANNED. Challenge assumptions; prefer the simplest design that fits the REAL current scale with a clear growth path.\n\nWRITE THIS SECTION:\n${d.title}\n${d.prompt}\n\nOutput rules: return ONLY the markdown body for this section. Start at H2 ("## ${d.title}"). Use tables/bullets/sequence notation for density. No preamble, no closing meta-commentary, no "as an AI". Be decisive and specific — this is the final artifact.`,
        { label: `synth:${d.key}`, phase: 'Synthesis' },
      ).then((md) => ({ key: d.key, title: d.title, md })),
  ).map((p) => p),
).then((rs) => rs.filter(Boolean));

const SECTIONS_TEXT = sections.map((s) => s.md).join('\n\n');

// ===========================================================================
// PHASE 4 — Adversarial challenge + completeness critic. Reads all sections.
// ===========================================================================

const CHALLENGES = [
  {
    label: 'challenge:overengineering',
    prompt: `You are a SKEPTICAL principal engineer. The draft report is below.
Attack OVER-ENGINEERING and PREMATURE GENERALIZATION. The hardest question: a
9-schema, 5-vertical, outbox-driven, multi-role RLS platform built for a business
that today appears to run a handful of restaurants. Where is the architecture
solving for scale/verticals that don't exist yet? What could be radically simpler
NOW without foreclosing the future? Separate "genuinely cheap optionality worth
keeping" (e.g. domain schema names, append-only ledgers) from "speculative
complexity to defer" (e.g. gym/device generalization, CDC warehouse, broker).
Produce a punchy "Assumptions Challenged & Simplifications" subsection (H2) with
specific, actionable cuts and the ones to KEEP, each justified.`,
  },
  {
    label: 'challenge:lockin-trends',
    prompt: `You are a FinOps + optionality hawk. The draft report is below. Attack
VENDOR LOCK-IN, COST CONCENTRATION, and TREND-DRIVEN choices. Scrutinize: total
dependence on Supabase (auth.users coupling, exposed_schemas, service_role,
edge/Deno) as a single point of lock-in AND failure; Vercel hosting lock-in;
single-LLM-provider risk; "AI-first" framing where simpler logic would do; whether
"edge functions" buy anything here. For each, state the lock-in/cost, the open-
standard/self-host alternative, the measurable threshold at which switching pays
off, and the migration path. Produce a "Lock-in & Cost-Optionality Audit"
subsection (H2) — concrete, with a keep/replace/abstract verdict per dependency.`,
  },
  {
    label: 'challenge:completeness',
    prompt: `You are a COMPLETENESS CRITIC and consistency checker. The full draft
report is below. Identify: (a) gaps — any requirement, workflow, risk, or decision
the report failed to address; (b) internal CONTRADICTIONS between sections (e.g.
cost vs stack vs roadmap disagreeing on a vendor); (c) claims that are unverified
or look like hand-waving; (d) anything the brief asked for that is missing
(re-check: business reconstruction, capability map, domain model, event flows,
data/infra/deploy architecture, cost, risk, stack, roadmap, ADRs). Produce a
"Gaps, Contradictions & Open Questions" subsection (H2): a prioritized list, each
item naming the section and the fix. Be specific; this is the last quality gate.`,
  },
];

phase('Challenge');
const challenges = await parallel(
  CHALLENGES.map(
    (c) => () =>
      agent(
        `${PRIMER}\n\n---\n\n${GOALS}\n\n---\n\nDRAFT REPORT (all sections):\n\n${SECTIONS_TEXT}\n\n---\n\n${c.prompt}`,
        { label: c.label, phase: 'Challenge' },
      ).then((md) => ({ label: c.label, md })),
  ).map((p) => p),
).then((rs) => rs.filter(Boolean));

const CHALLENGE_TEXT = challenges.map((c) => c.md).join('\n\n');

// ===========================================================================
// PHASE 5 — Single assembler writes the master document to disk (one writer).
// ===========================================================================

phase('Assemble');
const ORDERED = sections.slice().sort((a, b) => parseInt(a.title) - parseInt(b.title));
const ASSEMBLED_BODY = ORDERED.map((s) => s.md).join('\n\n---\n\n');

const outPath =
  '/Users/juanlopez1/Documents/Repositories/Umi/docs/architecture/2026-06-21-umi-architecture-reconstruction.md';

const assemblerSummary = await agent(
  `You are the EDITOR assembling the final CTO-level report for Umi. You are given
(1) the ordered deliverable sections and (2) an adversarial challenge appendix.
Your job: WRITE ONE COMPLETE MARKDOWN FILE to disk using the Write tool at this
exact absolute path:

${outPath}

The file MUST contain, in order:
1. An H1 title: "# Umi — Business Reconstruction & Target Architecture" with a
   bold dated subtitle line (Date: 2026-06-21; Status: Reconstruction & target
   architecture; Author: architecture review).
2. A 1-page EXECUTIVE SUMMARY you author yourself: what Umi is, the single most
   important insight (ambition vs current scale), the 3-5 highest-leverage
   recommendations, and the top 3 risks. Crisp, decisive.
3. A TABLE OF CONTENTS linking the 12 sections + the challenge appendix.
4. The 12 SECTIONS, VERBATIM as provided below — do NOT rewrite, summarize, or
   shorten them. Concatenate them exactly, preserving their markdown. You may fix
   an obviously broken heading level or duplicate H2, nothing else.
5. An appendix "## 13. Adversarial Review — Challenges, Lock-in Audit & Gaps"
   containing the challenge text VERBATIM.
6. A short closing "## How to read this" note (2-3 sentences).

Do not invent new technical content. Your authored prose is limited to the
executive summary, TOC, and tiny transitions. Preserve all citations/paths.

After writing the file, RETURN (as your final message, not to the file): a tight
markdown executive briefing for the user containing — (a) the file path, (b) the
~120-word executive summary you wrote, (c) a bulleted list of the section titles,
(d) the single sharpest assumption-challenge and the single biggest risk. This
returned text is what the user reads first.

===== ORDERED SECTIONS (verbatim) =====
${ASSEMBLED_BODY}

===== CHALLENGE APPENDIX (verbatim) =====
${CHALLENGE_TEXT}
`,
  { label: 'assemble:write-report', phase: 'Assemble' },
);

return {
  outPath,
  sectionCount: sections.length,
  evidenceCount: evidence.length,
  researchCount: research.length,
  challengeCount: challenges.length,
  briefing: assemblerSummary,
};
