# ConversaFlow Functions Agent Contract

This file is the agent-agnostic operating contract for `apps/umi-conversaflow`.

Read with:

- [../../../AGENTS.md](/Users/juanlopez1/Documents/Repositories/Umi/AGENTS.md:1)

## Repository identity

This repository owns shared Supabase edge/backend logic for ConversaFlow and Umi platform contracts.

## Multi-tenant architecture

- This platform serves multiple businesses across different cities and timezones.
- Every piece of logic must be tenant-aware.
- Never hardcode business-specific values such as timezone, address, hours, phone numbers, currency, language, Slack channels, or equivalent settings.
- Never use fallback constants for values that vary per business. If a value should come from `businesses.config`, fail explicitly rather than silently borrowing another tenant's default.
- All business config lives in the `businesses` table via `config` JSONB and `open_times` JSONB.
- When adding a new feature, ask whether the value changes per business. If yes, it belongs in business-configured data, not in a constant.

## Deployment

Edge/jobs runtime must set **`DB_SCHEMA=conversaflow`** (see `_shared/supabase.ts`). Hosted projects cannot define custom secrets whose names start with `SUPABASE_`; legacy local env `SUPABASE_DB_SCHEMA` is still read as a fallback.

Use `supabase functions deploy` with:

- project ref `xbudknbimkgjjgohnjgp`
- `--no-verify-jwt`
- `--workdir /Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow`
- `--use-api`

## Project structure

- `docs/` owns canonical ConversaFlow backend, integration, memory, and research documentation
- `config/` owns non-secret configuration artifacts such as Slack manifests and tenant config contracts
- `scripts/diagnostics/` owns manual diagnostics and tracing helpers
- `.agents/` and `.context/` own internal procedure/support layers for this repo
- `supabase/functions/_shared/` owns shared utilities such as logger, Supabase client, workflow, memory, and adapters
- `supabase/functions/whatsapp-handler/` owns Twilio webhook ingress and enqueues jobs
- `supabase/functions/job-worker/` owns job execution and outbox delivery (including Slack notifications via outbox dispatchers)
- Interactive kitchen and order operations use the native KDS client (`apps/umi-kds`) against this backend; there is no `slack-actions` Edge Function

## Key patterns

- Use the job queue architecture: ingress handlers insert jobs, `job-worker` claims and processes them, writes outbox rows, then delivers side effects.
- Do not process LLM calls inline in ingress handlers.
- Route external API side effects through the outbox table for durability and retry.
- After inserting jobs, use `triggerJobWorker()` as fire-and-forget wake-up for prompt execution.
- Keep shared normalization and projection logic close to this backend when it owns the write model.

## Agent workflow rule

- Treat this file as the neutral contract for repo-wide backend rules.
- Keep `CLAUDE.md` aligned as an adapter, not a separate architecture source.
