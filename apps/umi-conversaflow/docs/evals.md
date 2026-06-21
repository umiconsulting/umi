# ConversaFlow Evals

## Correctness surfaces

- Deno tests near runtime code.
- Mini-harness signoff for prompt/tool behavior.
- SQL audits for data correctness.
- Trace inspection for workflow behavior.
- Deployment checks for edge functions.

## Before runtime changes

- Identify the processor, handler, migration, or tool being changed.
- Run the narrowest local test/check available.
- Use mini-harness or trace diagnostics when prompts, tools, turns, outbox, or memory behavior changes.

## Human review required

- Schema migrations.
- Service-role scripts.
- Production-affecting repair scripts.
- Prompt changes that can affect live customer behavior.
