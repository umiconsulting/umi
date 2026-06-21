# ConversaFlow Repo Context

## Purpose

Shared Supabase backend, workflow jobs, outbox, prompts, memory, traces, schema contracts, and cross-channel normalization for Umi.

## Load first

1. `AGENTS.md`
2. `supabase/functions/job-worker/processors/index.ts`
3. Relevant processor under `supabase/functions/job-worker/processors/`
4. Relevant migration under `supabase/migrations/`
5. Relevant diagnostic/report index when investigating runtime behavior

## High-authority files

- `supabase/functions/`
- `supabase/migrations/`
- `sql/`
- `AGENTS.md`
- Current signoff reports

## Runtime chains

- WhatsApp ingress -> message/inbound record -> workflow job -> job worker -> turn integrity -> turn process -> tools/outbox -> dispatcher.
- KDS commands -> backend command function -> schema-qualified functions/projections -> job worker wakeup when needed.
- Memory and prompts live with runtime code; memory is context, not operational truth.

## Safe local cognition

- Repo-specific diagnostics, runbooks, signoff reports, and architecture notes belong here.
- Cross-product governance belongs at root.

## Avoid by default

- Local secrets.
- Historical reports unless linked from a latest index.
- Production-affecting scripts without human review.
