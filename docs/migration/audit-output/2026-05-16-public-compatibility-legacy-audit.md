# Public Compatibility Legacy Audit - 2026-05-16

## Context

`public` is the legacy ConversaFlow schema. It was the original runtime schema before active ConversaFlow data moved into schema `conversaflow`.

This audit treats `src_platform_public.*` as historical compatibility data and `src_platform_conversaflow.*` as the current source of truth.

No import was executed in this audit.

## Files

- `2026-05-16-public-compat-row-delta.csv`
- `2026-05-16-public-compat-public-only-rows.csv`

## Table Coverage

Overlapping legacy/current tables:

```txt
businesses
customers
conversations
messages
transactions
jobs
job_attempts
outbox
```

Current-only ConversaFlow tables with no `public` counterpart in the local FDW source:

```txt
conversation_turns
customer_preferences
eval_traces
pipeline_traces
products
transaction_status_events
```

## Row Delta Summary

```txt
businesses: public 1, conversaflow 1, public-only 0
customers: public 10, conversaflow 536, public-only 0
conversations: public 10, conversaflow 535, public-only 0
transactions: public 23, conversaflow 50, public-only 0
messages: public 859, conversaflow 3958, public-only 12
jobs: public 382, conversaflow 3357, public-only 30
job_attempts: public 382, conversaflow 3362, public-only 30
outbox: public 97, conversaflow 401, public-only 6
```

There are no public-only canonical customers, conversations, transactions, or businesses.

Public-only rows exist only in runtime/history tables:

```txt
messages: 12
jobs: 30
job_attempts: 30
outbox: 6
```

## Public-Only Runtime Classification

All public-only runtime rows trace back to a synthetic/evaluation conversation.

Public-only messages:

```txt
12 rows
1 conversation
6 user messages with Twilio SID
6 assistant messages
conversation class: synthetic_eval
```

Public-only jobs:

```txt
30 rows
28 completed
2 pending
all synthetic_eval context
```

Public-only job attempts:

```txt
30 rows
30 success
28 attempts belong to public-only jobs
2 attempts belong to jobs that also exist in conversaflow
```

Public-only outbox:

```txt
6 rows
6 delivered twilio.reply
all synthetic_eval context
```

## Common Row Differences

Common IDs with differing row hash:

```txt
businesses: 1
conversations: 3
jobs: 2
```

Interpretation:

- `businesses`: same id/name/type/open_times; `config` differs. Current `conversaflow.businesses` should win.
- `conversations`: current `conversaflow.conversations` has newer state/version/last-message data. Current schema should win.
- `jobs`: both are completed; current `conversaflow.jobs` has later completion timestamps. Current schema should win.

## Recommendation

Do not import public-only rows into production-facing product tables.

Reason:

- Public-only data is runtime/history only.
- It belongs to synthetic/evaluation context.
- Two public-only jobs are still `pending`, so importing them as live jobs would create replay risk.
- Public-only messages/outbox are tied to synthetic workflow/pipeline test data, not production customer history.

Recommended handling for Phase 4F:

1. Record the public-only row set in `legacy.public_compat_imports` as `evaluation_archive`.
2. If preserving the row payload is required, store it in an explicit evaluation/archive path, not production ConversaFlow tables.
3. Mark any pending public-only jobs as `do_not_replay`.
4. Keep `conversaflow.*` as the source of truth for common rows.

## Decision

Phase 4F should be an audit/archive step, not a production data import.
