# ConversaFlow Retrieval

## Load order

1. `AGENTS.md`
2. `REPO_CONTEXT.md`
3. The narrowest runtime folder for the task.
4. Relevant migrations or SQL.
5. Relevant test/eval/report/diagnostic surface.

## High-authority runtime surfaces

- `supabase/functions/whatsapp-handler/`
- `supabase/functions/job-worker/`
- `supabase/functions/_shared/`
- `supabase/migrations/`
- `sql/`

## Load on demand

- `reports/`
- `scripts/diagnostics/`
- historical architecture docs

## Exclude by default

- `.env*`
- `.mcp.json`
- local settings
- generated outputs
- old trace exports
