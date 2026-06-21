# ConversaFlow documentation

Index of canonical docs in this repository. Agent-specific prompts live under `.agents/`; internal architecture review drafts live under `docs/architecture/reviews/`.

Related repo slices:

- [../scripts/](../scripts/README.md) — diagnostics and manual trace helpers
- [../config/](../config/README.md) — non-secret configuration artifacts

## Architecture

| Document | Description |
|----------|-------------|
| [architecture/ARCHITECTURE_TARGET.md](./architecture/ARCHITECTURE_TARGET.md) | Target schema, jobs, ingress — buildable spec |
| [architecture/FRONTEND_ARCHITECTURE.md](./architecture/FRONTEND_ARCHITECTURE.md) | Frontend structure and conventions |
| [architecture/conversation-and-session-layers.md](./architecture/conversation-and-session-layers.md) | **Five-layer** model: thread, visit, task, transaction, customer |
| [architecture/memory/MEMORY_ARCHITECTURE.md](./architecture/memory/MEMORY_ARCHITECTURE.md) | 3-tier **prompt** memory (working, semantic, facts) for `whatsapp-handler` |
| [architecture/reviews/mini-harness-architecture.md](./architecture/reviews/mini-harness-architecture.md) | Canonical target architecture for the WhatsApp mini harness, deep tools, and customer memory |
| [architecture/reviews/mini-harness-implementation-plan.md](./architecture/reviews/mini-harness-implementation-plan.md) | Direct replacement plan and extensive test campaign for the new runtime |
| [architecture/reviews/](./architecture/reviews/) | Current architecture specs and implementation plans |

## Research

| Document | Description |
|----------|-------------|
| [research/EMBEDDINGS_CUSTOMER_MEMORY_RESEARCH.md](./research/EMBEDDINGS_CUSTOMER_MEMORY_RESEARCH.md) | Embeddings, customer memory, roadmap |

## Product & business

| Document | Description |
|----------|-------------|
| [product/KALALA_CAFE_BUSINESS_PROPOSAL.md](./product/KALALA_CAFE_BUSINESS_PROPOSAL.md) | Business proposal |
| [product/KALALA_CAFE_INTEGRATED_PLANS.md](./product/KALALA_CAFE_INTEGRATED_PLANS.md) | Integrated plans |

## Integrations

| Document | Description |
|----------|-------------|
| [integrations/SLACK_ADMIN_PLAN.md](./integrations/SLACK_ADMIN_PLAN.md) | Slack admin plan |
| [integrations/SLACK_DASHBOARD_AUDIT.md](./integrations/SLACK_DASHBOARD_AUDIT.md) | Slack dashboard audit |

## Related Apps

- `apps/umi-conversaflow` — Edge functions and Supabase migrations.
- `apps/umi-logs` — ConversaFlow ops and logs dashboard.
