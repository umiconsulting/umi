# Logs Repo Context

## Purpose

ConversaFlow operational logs and trace dashboard UI.

## Load first

1. `AGENTS.md`
2. `lib/supabase.ts`
3. `lib/parsers/traceAssembler.ts`
4. `types/trace.ts`
5. Relevant Next.js page/component

## High-authority files

- Trace parser code.
- Trace types.
- Supabase client configuration.
- App UI code.
- `AGENTS.md`

## Runtime boundary

Logs consumes operational data from ConversaFlow. Schema, trace-writing, workflow, memory, and prompt changes belong in ConversaFlow.

## Sensitive surfaces

- `.env*`
- service-role keys
- deployment env config

Do not print secret values.

## Avoid by default

- Default scaffold README as architecture source.
- Build output.
- Local env files.
