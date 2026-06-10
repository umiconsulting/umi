# Dashboard Customer, Conversations, and Embedding Insights Plan

Date: 2026-05-24

## Decision

Move owner-facing WhatsApp conversations, customer memory visibility, Voyage AI embedding health, and customer/product usage insights from `apps/umi-logs` into `apps/umi-dashboard`.

Do not move ConversaFlow runtime ownership into Dashboard. Dashboard should present the owner/admin experience; `apps/umi-conversaflow` remains the owner of WhatsApp ingress, messages, jobs, memory extraction, embeddings, and operational truth. `apps/umi-logs` remains an internal observability/debugging app, not the merchant-facing customer platform.

The owner UX should make `Customers` a first-class sidebar tab. A customer profile becomes the place where an owner sees product usage across Umi modules:

- identity and contact details
- Cash loyalty and wallet usage, when Cash is active
- ConversaFlow WhatsApp conversations, when a WhatsApp identity exists
- orders and KDS activity tied to the customer
- extracted customer facts and preferences
- operational notes, issues, and follow-up opportunities

The unifying datapoint for the first version is normalized phone number. The durable target is `platform.contacts` plus `platform.contact_identities`, where phone, WhatsApp, email, wallet pass, and product-local IDs can all point to one tenant-scoped customer profile.

## Why This Direction

Documented facts from Umi:

- `apps/umi-dashboard` already owns the owner dashboard shell and live-data UI.
- `apps/umi-logs` owns trace/log browsing and consumes ConversaFlow data, but does not own backend truth.
- `apps/umi-conversaflow` owns WhatsApp runtime, messages, jobs, memory, embeddings, and cross-channel normalization.
- The local PostgreSQL target already has `platform.contacts`, `platform.contact_identities`, `commerce.orders`, `cash.loyalty_accounts`, `conversaflow.conversations`, `conversaflow.messages`, `conversaflow.memory_items`, and `observability.*`.
- Dashboard had a basic `Conversations` screen and tenant-aware conversation API route before this migration; the owner route now redirects into Customers.
- Logs has richer customer, conversation, memory, integration, and embedding health screens that can be adapted for owner-facing Dashboard use.

Source-backed tradeoffs:

- WhatsApp case studies show the strongest business results when WhatsApp is integrated with CRM, lifecycle, orders, and support rather than treated as a separate inbox.
- Dashboard research supports role-specific, drill-down dashboards: owners need summary signals first, then detail on demand.
- Identity-resolution research supports starting deterministic when a strong identifier exists, then adding explainable merge candidates for messy cases.
- Vector-search documentation supports storing/querying embeddings in PostgreSQL/pgvector, but embedding generation should stay asynchronous because it depends on external model calls and failure handling.

Umi-specific inference:

- The Dashboard customer page should not be a copy of the Logs conversation debugger. It should be an owner-facing customer 360: "Who is this customer, what have they done, what is happening now, and what action should I take?"
- Logs-only views such as raw trace assembly, edge function internals, and detailed AI turn diagnostics should stay behind an Observability/debug route or remain in `umi-logs`.
- Voyage AI should surface to owners as memory/search health and customer context quality, not as raw embedding vectors.

## Online Research Summary

Business cases:

- WhatsApp Business success stories show 92 results across goals like engagement, sales, support, and ROI. The official page positions WhatsApp Business Platform as a way to scale engagement, accelerate sales, and improve support outcomes.
- Magalu built an AI-enabled end-to-end shopping experience in WhatsApp and reported 3x higher conversion than its usual app/site, high NPS, and integrated discovery, decision, payment, and post-sale updates.
- Domino's Pizza Indonesia combined CRM and lifecycle marketing with WhatsApp campaigns and reported a 72% sales increase, 6.3x ROI, and weekly WhatsApp engagement.
- Vessi used WhatsApp Flows plus marketing, utility, and service messages for the full customer journey, reporting lower cost per conversation and improved conversion.
- Capitec Bank used WhatsApp for conversational support, reporting improved first-contact resolution and the ability to support growth without major staffing changes.
- Shopify and Toast owner/admin patterns both point toward customer profiles that combine identity, orders, notes/timeline, loyalty/guest data, and segmentation/reporting.

Academic and primary research:

- Mobile chat servitization research frames WhatsApp conversations as a customer-journey touchpoint, not just a message log.
- WhatsApp Business HCI research warns that professionalized WhatsApp tooling can become too complex or costly for small businesses; Umi should keep owner UX simple and action-oriented.
- Dashboard research describes dashboards as decision-support systems that summarize multiple sources and provide drill-downs when needed.
- Identity-resolution research distinguishes exact/rule-based matching from probabilistic or ML matching; exact normalized phone is appropriate for phase 1, while merge candidates and explainability are needed later.
- Customer 360 entity matching research emphasizes explainability when deciding that multiple records represent the same person.

Technical sources:

- Voyage AI recommends using `input_type: "document"` for stored content and `input_type: "query"` for retrieval queries.
- Supabase and pgvector docs support storing vectors in Postgres, using vector columns, and generating embeddings asynchronously through jobs/functions.
- WhatsApp Business Platform pricing and category docs distinguish marketing, utility, authentication, and service messages; Dashboard should show category/cost health where useful, but message category policy remains ConversaFlow/backend-owned.

Sources:

- https://whatsappbusiness.com/resources/success-stories/
- https://whatsappbusiness.com/resources/success-stories/magalu/
- https://whatsappbusiness.com/resources/success-stories/dominos-pizza-indonesia/
- https://whatsappbusiness.com/resources/success-stories/vessi/
- https://whatsappbusiness.com/resources/success-stories/capitec-bank/
- https://help.shopify.com/en/manual/customers
- https://help.shopify.com/en/manual/shopify-admin/productivity-tools/timeline
- https://support.toasttab.com/en/article/Access-Your-Guest-Data-with-the-Guest-Report
- https://support.toasttab.com/article/Getting-Started-with-Analytics-and-Reports
- https://www.sciencedirect.com/science/article/pii/S175427312000133X
- https://arxiv.org/abs/2502.10913
- https://arxiv.org/abs/2404.16124
- https://www.sciencedirect.com/science/article/abs/pii/S1467089511000443
- https://link.springer.com/article/10.1186/s13388-015-0021-0
- https://arxiv.org/abs/2212.00342
- https://docs.voyageai.com/docs/embeddings
- https://docs.voyageai.com/reference/embeddings-api-1
- https://supabase.com/docs/guides/ai
- https://supabase.com/docs/guides/ai/vector-columns
- https://supabase.com/docs/guides/ai/automatic-embeddings
- https://whatsappbusiness.com/products/platform-pricing/

## Current Umi Table Map

### Canonical Customer Layer

Owner: platform schema.

Relevant tables:

- `platform.contacts`: tenant-scoped customer/guest profile.
- `platform.contact_identities`: phone, email, WhatsApp, wallet pass, or external identifiers for a contact.
- `platform.external_refs`: product-local source references.
- `platform.contact_merge_candidates`: future explainable merge-review queue.

Use in Dashboard:

- Customer list should read from `platform.contacts` once the local PostgreSQL target becomes the production model.
- Search should hit display name, normalized phone, email, and product-local identifiers.
- Phone number should be normalized once and displayed consistently.

### Cash Usage Layer

Owner: `apps/umi-cash` for product behavior; target schema is `cash`.

Relevant tables:

- `cash.loyalty_accounts`
- `cash.loyalty_cards`
- `cash.visit_events`
- `cash.wallet_transactions`
- `cash.reward_configs`
- `cash.reward_redemptions`
- `cash.gift_cards`
- `cash.passes`

Use in Dashboard:

- Show as a product usage tab inside customer detail only when Cash is active for the tenant.
- Surface owner-level facts: balance, total visits, pending rewards, last visit, reward progress, wallet top-ups, redemptions.

### ConversaFlow Usage Layer

Owner: `apps/umi-conversaflow`.

Relevant tables:

- `conversaflow.channels`
- `conversaflow.channel_accounts`
- `conversaflow.conversations`
- `conversaflow.messages`
- `conversaflow.conversation_turns`
- `conversaflow.tool_calls`
- `conversaflow.conversation_outcomes`
- `conversaflow.memory_items`
- current live/Supabase compatibility tables: `conversaflow.customers`, `conversaflow.customer_preferences`, `conversaflow.ai_turn_logs`, `conversaflow.messages.embedding`

Use in Dashboard:

- Customer profile should show WhatsApp status only when `platform.contact_identities` has a WhatsApp identity or a normalized phone match to ConversaFlow.
- Conversation list should be customer-first: active conversation, latest message, outcome, order link, issue state.
- Conversation detail should show readable thread, order context, summary, learned preferences, and handoff/action controls.

### Commerce and KDS Usage Layer

Owners: commerce target schema for order facts, ConversaFlow for current order write model, KDS schema for kitchen projections.

Relevant tables:

- `commerce.orders`
- `commerce.order_items`
- `commerce.order_events`
- `kds.tickets`
- `kds.ticket_items`
- `kds.ticket_events`

Use in Dashboard:

- Customer detail should link orders by `contact_id` or normalized phone fallback.
- KDS data should appear as kitchen status and fulfillment history, not as a separate customer source of truth.

### Logs, Health, and Insights Layer

Owner: observability schema; UI split between Dashboard owner health and Logs internal debugging.

Relevant tables:

- `observability.audit_events`
- `observability.runtime_logs`
- `observability.pipeline_traces`
- `observability.integration_checks`
- `observability.data_quality_findings`
- current logs app surfaces: edge function logs, AI turn logs, security logs, integration health, memory health.

Use in Dashboard:

- Owner-facing: "WhatsApp healthy", "embedding coverage", "messages missing memory", "customer data quality issues", "failed sends", "cost today/month", "action needed".
- Internal-only: raw traces, request IDs, full tool-call payloads, edge function parser details, prompt-injection/debug tables.

## Owner UX Model

Design direction: dense, calm, operational. This should feel like a restaurant owner control room, not a marketing dashboard. Avoid decorative hero sections. Use compact tables, tabs, drawers, state badges, and timeline views.

### Sidebar

Recommended owner nav:

```txt
OPERATIONS
  Overview
  Orders
  Customers
  Devices
  Staff & Access

GROWTH
  Loyalty
  Gift Cards

CONFIGURATION
  Hours & Availability
  Products & Billing
  Settings

INTERNAL / gated
  Observability
```

Change from current state:

- Rename `Miembros` to `Customers` as the primary customer tab.
- Keep Cash-specific "members" semantics inside a Cash/Loyalty subtab.
- Keep WhatsApp conversations inside Customers, not as a primary sidebar tab.

Recommended first version:

- Sidebar tab: `Customers`
- Customer detail tabs: `Overview`, `WhatsApp`, `Orders`, `Loyalty`, `Wallet`, `Notes`, `Data`
- Legacy `/conversations` links redirect to `Customers` filtered for WhatsApp.

### Customers List

Purpose: answer "who are my customers and who needs attention?"

Columns:

- Customer: name, normalized phone, identity badges
- Status: new, active, repeat, inactive, needs review
- Last touch: last WhatsApp message, order, visit, or wallet event
- Products: WhatsApp, KDS/order, Cash, Gift Card badges
- Value: visits, orders, wallet balance, total spend when available
- Memory: facts learned, embedding/search health, unresolved preference conflicts
- Action: open profile

Filters:

- Has WhatsApp conversation
- Active WhatsApp conversation
- Cash member
- Ordered in last 30 days
- No activity in 30/60/90 days
- Missing phone identity
- Duplicate/merge candidate
- Needs follow-up

Owner-friendly metrics above the list:

- total customers
- WhatsApp customers
- repeat customers
- customers with loyalty
- customers needing attention

### Customer Profile

Header:

- display name
- normalized phone
- product badges: WhatsApp, Cash, KDS/orders, Gift Cards
- "last seen" and "customer since"
- quick actions: message, add note, merge/review, export

Overview tab:

- timeline of important events across products
- last order, last conversation, last visit, last wallet event
- customer facts: likes, dislikes, allergies, typical order, notes
- suggested owner action: "follow up", "review duplicate", "reward eligible", "failed WhatsApp send"

WhatsApp tab:

- current/open conversation, if any
- conversation history list
- readable message thread
- conversation summary
- outcome/order links
- handoff/status controls
- memory quality panel: summary present, facts present, embeddings coverage

Orders tab:

- order history from `commerce.orders` or current ConversaFlow transaction/KDS projection during transition
- item frequency
- average order value
- fulfillment issues/cancellations

Loyalty / Wallet tab:

- only available if Cash product is active
- loyalty card, visits, rewards, wallet balance, top-ups, redemptions, gift cards

Notes tab:

- owner/staff internal notes
- future: `observability.audit_events` or a dedicated `platform.contact_notes` table

Data tab:

- identity sources and confidence
- normalized phone
- product-local references
- merge candidates
- data-quality findings

### Customer WhatsApp View

Purpose: triage live WhatsApp operations from inside the customer profile and Customers WhatsApp filter.

Rows:

- customer name/phone
- open/pending/closed status
- latest message
- intent/outcome
- linked order
- memory state
- failed send or stuck job badge
- assigned owner/staff, later

Detail:

- owner-readable thread first
- customer profile side rail
- order/KDS state side rail
- no raw trace payloads or internal diagnostics in the owner surface

### Customer Signals View

Purpose: give owners useful patterns without forcing them to inspect logs.

Initial insight groups:

- Customer growth: new, repeat, inactive, returning after inactivity.
- WhatsApp funnel: new conversations, order-producing conversations, abandoned conversations, failed sends.
- Product demand: most referenced products, most ordered products, unavailable product requests.
- Memory health: customers with facts, missing embeddings, low retrieval quality, stale summaries.
- Operations: KDS delays, cancellations, outbox failures, integration warnings.
- Revenue and loyalty: average order value, wallet top-ups, reward redemptions, best customers.

Avoid:

- raw token tables by default
- raw embedding vectors
- raw trace logs in owner views
- "AI magic" phrasing without action or business implication

## Reusable Skills

Use these workspace skills during implementation:

- `customer-identity-resolution`: phone identity normalization, customer overlap reports, `platform.contacts` / `platform.contact_identities`, merge candidates, and data-quality checks.
- `dashboard-customer-ux-validation`: Customers sidebar tab, customer profile tabs, timeline, conversation detail, Insights UX, entitlement gating, and desktop/mobile layout validation.
- `owner-insights-migration`: moving Logs customer, conversation, memory, Voyage AI, WhatsApp, and integration health surfaces into owner-facing Dashboard views while keeping raw diagnostics internal.

## Mini Tasks and Plans

### Task 1: UX IA and Navigation Prototype

Owner: `apps/umi-dashboard`

Goal: make `Customers` the owner-facing customer hub.

Plan:

1. Rename or replace the current `members` sidebar item with `Customers`.
2. Keep Cash-specific loyalty screens available through product entitlement, but not as the canonical customer entrypoint.
3. Add customer profile route/state with tabs: Overview, WhatsApp, Orders, Loyalty, Wallet, Notes, Data.
4. Move current Conversations behavior into the customer profile WhatsApp tab and Customers WhatsApp filter.
5. Validate desktop and mobile density: no text overlap, no card-in-card nesting, compact action controls.

Acceptance:

- Owner can start from Customers and reach product usage without knowing which product owns the data.
- Conversation details are reachable from Customers.
- Cash-inactive tenants do not see loyalty/wallet tabs as active workflows.

### Task 2: Customer Contract API

Owner: `apps/umi-dashboard` API layer consuming platform/product schemas.

Goal: define a tenant-first customer API before UI expansion.

Target routes:

```txt
GET /api/tenants/:tenantId/customers
GET /api/tenants/:tenantId/customers/:contactId
GET /api/tenants/:tenantId/customers/:contactId/timeline
GET /api/tenants/:tenantId/customers/:contactId/conversations
GET /api/tenants/:tenantId/customers/:contactId/orders
GET /api/tenants/:tenantId/customers/:contactId/cash
GET /api/tenants/:tenantId/customers/:contactId/identity
```

Transition fallback:

- If canonical `platform.contacts` is unavailable in a given environment, adapt current Cash `customers` and ConversaFlow `customers` using normalized phone.
- Keep slug routes as compatibility wrappers, same pattern as current dashboard.

Acceptance:

- API returns one customer envelope with product sections.
- Product sections include `available`, `source`, `lastUpdatedAt`, and `dataQuality` fields.
- Phone matching is explicit and normalized.

### Task 3: Phone Identity Normalization

Owner: `apps/umi-conversaflow` for runtime normalization; root migration docs/local SQL for platform target.

Goal: make phone number matching reliable enough for customer 360.

Plan:

1. Define a shared normalization rule: strip non-digits, preserve country code, store E.164-style display when known.
2. Backfill `platform.contact_identities` with `identity_type = 'phone'` and `identity_type = 'whatsapp'`.
3. Keep `(tenant_id, identity_type, normalized_value)` unique for verified identities.
4. Create merge candidates instead of auto-merging ambiguous numbers.
5. Add data-quality findings for missing, malformed, or conflicting phone numbers.

Acceptance:

- A WhatsApp conversation and a Cash loyalty profile with the same normalized phone resolve to the same owner-facing customer.
- Ambiguous matches are visible in Data tab, not silently merged.

### Task 4: Move Logs Customer Views Into Dashboard

Owner: `apps/umi-dashboard` for UI; `apps/umi-logs` remains debug-only.

Goal: adapt useful Logs screens into owner-friendly Dashboard screens.

Move/adapt:

- Logs Customers list -> Dashboard Customers list.
- Logs Customer detail -> Dashboard Customer profile.
- Logs Conversation detail -> Dashboard WhatsApp tab / conversation route.
- Logs Memory Health -> Customers header metrics and customer profile Data/Notes tabs.
- Logs Integrations > Voyage/WhatsApp health -> Customers signals or Settings > Integrations.

Do not move by default:

- raw edge trace browser
- request-level trace assembler
- full AI turn internals
- security/prompt-injection forensic views

Acceptance:

- Dashboard shows owner-facing memory and integration health.
- Logs still works for debugging raw traces.
- No owner screen requires service-role secrets in the browser.

### Task 5: Voyage AI Embedding Health and Memory UX

Owner: `apps/umi-conversaflow` for embedding generation/retrieval; `apps/umi-dashboard` for visibility.

Goal: show whether customer memory is usable.

Owner-facing metrics:

- embedding coverage by message/customer/conversation
- missing embeddings count
- last embedding generated
- conversations where semantic memory is active
- customers with structured facts
- retrieval quality trend when available

Backend rules:

- Keep embedding generation async.
- Store model name and dimensions.
- Use `input_type = 'document'` for stored messages/memory objects and `input_type = 'query'` for search queries.
- Prefer memory objects over raw messages for durable customer memory as the product matures.

Acceptance:

- Owner sees "Memory healthy / needs attention" without seeing vectors.
- Admin can identify missing embeddings and stale memory.
- Backend remains the only writer of memory/embedding state.

### Task 6: Customer Timeline and Insights

Owner: `apps/umi-dashboard` for presentation; product schemas for source events.

Goal: provide a unified customer timeline.

Timeline event sources:

- `conversaflow.messages`: WhatsApp messages.
- `conversaflow.conversation_outcomes`: outcomes and order links.
- `commerce.orders` and `commerce.order_events`: orders and status changes.
- `cash.visit_events`, `cash.wallet_transactions`, `cash.reward_redemptions`: loyalty/wallet activity.
- `observability.data_quality_findings`: data issues.
- future `platform.contact_notes`: owner/staff notes.

Acceptance:

- Owner can answer "what happened with this customer?" without switching products.
- Events are grouped by day and have product icons/badges.
- Internal/system-only events are collapsed or hidden by default.

### Task 7: Customer Signals Summary

Owner: `apps/umi-dashboard`

Goal: show business-friendly customer/conversation/order signals inside Customers, without a separate Insights sidebar tab.

Plan:

1. Add customer header metrics for customer growth, repeat behavior, WhatsApp conversion, product demand, memory health, and operational warnings.
2. Use links from each insight to the exact customer/conversation/order list behind it.
3. Keep metrics tied to owner actions: follow up, fix integration, review duplicate, promote product, adjust hours/menu.
4. Add date range and location filters after the first useful version works.

Acceptance:

- Every insight drills down to rows.
- No metric is a dead-end vanity number.
- Owners can scan the page in under a minute and know what to do next.

### Task 8: Production Single Database Cutover

Owner: root migration docs plus owning product repos.

Goal: align production with the local PostgreSQL model.

Plan:

1. Use local PostgreSQL scripts as the target contract, not as production migrations directly.
2. Promote `platform.contacts` and `contact_identities` as canonical customer identity.
3. Backfill Cash, ConversaFlow, orders, KDS, and observability into product schemas.
4. Preserve external refs for old product IDs.
5. Make Dashboard consume tenant-first APIs from the single production database.
6. Keep Supabase/legacy compatibility only as transition support.

Acceptance:

- One tenant/customer identity model powers Dashboard.
- Product write ownership remains separate by schema/repo.
- Dashboard no longer has to guess between Cash customers and ConversaFlow customers.

## Suggested Phasing

### Phase 0: Verify Data Shape

Duration: 1-2 days.

Outputs:

- table inventory query
- phone-normalization sample report
- customer overlap report: Cash-only, WhatsApp-only, both, missing phone
- logs screen inventory: keep, move, retire
- use `customer-identity-resolution` for overlap reports and phone identity data-quality checks

### Phase 1: Design-First Dashboard Prototype

Duration: 2-4 days.

Outputs:

- Customers list UI
- Customer profile shell with tabs
- WhatsApp tab with mocked or current API data
- customer signal metrics with real placeholders
- use `dashboard-customer-ux-validation` for Customers tab and profile design validation

### Phase 2: Tenant-First Customer API

Duration: 3-5 days.

Outputs:

- customer list endpoint
- customer detail endpoint
- timeline endpoint
- product section availability flags
- compatibility wrapper for current slug routes

### Phase 3: WhatsApp and Memory Migration

Duration: 4-7 days.

Outputs:

- migrated conversation detail UX
- owner-facing memory health panel
- Voyage embedding health view
- active conversation triage inside Customers
- use `owner-insights-migration` for moving Conversations, Memory Health, Voyage AI, and integration health from Logs to Dashboard

### Phase 4: Product Usage Links

Duration: 4-7 days.

Outputs:

- orders tab
- loyalty/wallet tab
- gift card links
- KDS fulfillment history links

### Phase 5: Production Database Alignment

Duration: depends on migration readiness.

Outputs:

- production migration checklist
- backfill validation
- data-quality findings workflow
- read-path switch for Dashboard
- use `customer-identity-resolution` before production single-database cutover

## Verification Queries

Use these locally once connected to the local platform database.

Customer identity coverage:

```sql
select
  count(*) as contacts,
  count(*) filter (where phone is not null and phone <> '') as contacts_with_phone
from platform.contacts;

select
  identity_type,
  verification_status,
  count(*) as rows
from platform.contact_identities
group by identity_type, verification_status
order by identity_type, verification_status;
```

Product overlap by phone:

```sql
with phones as (
  select
    c.tenant_id,
    ci.normalized_value,
    bool_or(ci.identity_type = 'whatsapp') as has_whatsapp,
    bool_or(cash_account.id is not null) as has_cash
  from platform.contacts c
  join platform.contact_identities ci on ci.contact_id = c.id
  left join cash.loyalty_accounts cash_account on cash_account.contact_id = c.id
  where ci.identity_type in ('phone', 'whatsapp')
    and ci.normalized_value is not null
  group by c.tenant_id, ci.normalized_value
)
select
  count(*) filter (where has_whatsapp and has_cash) as whatsapp_and_cash,
  count(*) filter (where has_whatsapp and not has_cash) as whatsapp_only,
  count(*) filter (where has_cash and not has_whatsapp) as cash_only
from phones;
```

Conversation linkage:

```sql
select
  count(*) as conversations,
  count(*) filter (where contact_id is not null) as linked_to_contact,
  count(*) filter (where contact_id is null) as missing_contact
from conversaflow.conversations;
```

Memory and embedding health:

```sql
select
  embedding_model,
  count(*) as memories
from conversaflow.memory_items
group by embedding_model
order by memories desc;

select
  status,
  severity,
  count(*) as findings
from observability.data_quality_findings
group by status, severity
order by status, severity;
```

## Risks and Guardrails

- Phone number is a strong first key for WhatsApp and Cash, but it is not a universal identity solution. Some customers share phones, change phones, or enter malformed numbers.
- Do not silently merge ambiguous contacts. Use `contact_merge_candidates`.
- Do not show raw embeddings or raw traces to owners. They need health, quality, and action.
- Do not let Dashboard write operational WhatsApp truth. Writes should go through ConversaFlow-owned APIs/jobs.
- Do not make Cash tabs visible as active workflows when Cash is not enabled for the tenant.
- Keep sensitive logs and service-role access out of browser-delivered Dashboard code.
- Keep internal evaluation/synthetic traces out of production owner insights.

## Open Questions

- Do owners need to reply manually from Dashboard in phase 1, or only inspect and triage WhatsApp conversations?
- Should internal staff notes live in `platform.contact_notes`, `observability.audit_events`, or a product-specific notes table?
- What minimum metrics define "customer value" before Cash is active: order count, conversation outcomes, total order spend, or visit count?
- What is the production cutoff date for replacing Cash/ConversaFlow product-local customer reads with `platform.contacts`?

## Implementation Status

2026-05-26 Dashboard slice:

- `apps/umi-dashboard` now exposes tenant-first customer APIs backed by `platform.contacts` with legacy phone fallback.
- The primary sidebar has `Customers`; top-level `Conversations` is removed and legacy `/conversations/*` redirects to `/customers?filter=whatsapp`.
- Customer profile tabs include Overview, WhatsApp, Orders, Loyalty, Notes, and Data. WhatsApp conversations live inside the customer profile.
- Customer header metrics surface customer, WhatsApp, memory, and identity review counts without raw traces, vectors, or service-role diagnostics.
- Build and browser validation passed on desktop and mobile local Dashboard profiles.

## Recommended Next Move

Start with Phase 0 and Phase 1 together:

1. Generate the customer overlap report by normalized phone.
2. Build the Dashboard Customers tab and customer profile shell using current APIs.
3. Adapt the Logs customer/conversation/memory UI into owner-facing Dashboard language.
4. Only after the UX proves useful, harden the tenant-first customer API and production data contracts.

This keeps momentum on the owner experience while preserving the backend ownership rules that matter for the single production database transition.
