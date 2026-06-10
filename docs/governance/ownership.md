# Ownership Model

Umi uses federated ownership. The root coordinates cognition; repos own runtime behavior.

## Root owns

- Workspace governance.
- Cross-product architecture and migration planning.
- Retrieval policy and workspace maps.
- Report, eval, trace, and memory indexes.
- Agent operating-system structure.

## ConversaFlow owns

- Shared Supabase backend behavior.
- Operational workflow jobs, queues, outbox, and durable side effects.
- Runtime prompts and tool orchestration for ConversaFlow.
- ConversaFlow memory implementation and trace writes.
- Schema-qualified migrations for backend-owned contracts and KDS projections.

## KDS owns

- Native iPad KDS client.
- KDS board presentation, client state, interactions, and app UX.
- Consumption of `kds` projections and backend command contracts.

## Cash owns

- Loyalty and wallet behavior.
- Cash Next.js/Vercel runtime.
- Cash Prisma schema and pass/cert integration surfaces.
- Cash scheduled jobs.

## Logs owns

- ConversaFlow logs and trace UI.
- Trace assembly for human operations views.
- Read-only consumption of operational observability data.

## Dashboard owns

- Umi owner dashboard app shell and live-data UI.
- Screen inventory, visible functions, and interaction flows that should carry forward into future production hardening.

## Boundary rule

Place changes where the current write model, runtime, or consumer already lives. Add a new shared boundary only when the existing owner fails on ownership, latency, deploy isolation, or operational simplicity.
