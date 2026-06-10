# Trace Index

Traces are operational evidence and a future eval substrate.

## ConversaFlow traces

- Durable trace tables and related migrations live in `apps/umi-conversaflow/supabase/migrations/`.
- Trace-writing runtime paths live in ConversaFlow edge functions and processors.
- Trace inspection scripts live under ConversaFlow scripts and diagnostics.

## Logs dashboard

- Human-readable trace assembly and display live in `apps/umi-logs`.
- Logs consumes trace data; it does not own the trace schema.

## Future use

Traces can become:

- Regression datasets.
- Eval replay inputs.
- Memory audit evidence.
- Workflow debugging surfaces.
- Agent routing signals.

Do not turn raw traces into default context. Index, summarize, and load on demand.
