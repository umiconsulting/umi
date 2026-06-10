# Excluded ConversaFlow Review - 2026-05-16

## Purpose

This folder contains the ConversaFlow customers and conversations that were excluded from production-facing `conversaflow` tables during local Phase 4D.

Excluded means:

- not imported into production-facing `conversaflow.conversations`
- not imported into production-facing `conversaflow.messages`
- not imported into production-facing `conversaflow.conversation_turns`

It does not mean deleted, fake, or permanently discarded.

## Files

- `2026-05-16-excluded-customers.csv`
  - one row per excluded customer
  - 443 rows including header
  - 443 `synthetic_eval`
- `2026-05-16-excluded-conversations.csv`
  - one row per excluded conversation
  - 442 rows including header
  - 442 `synthetic_eval`

## Classification

`synthetic_eval` means the source customer/conversation has explicit eval trace evidence in `conversaflow.eval_traces`.

The earlier `unknown_customer` bucket has been reclassified as `synthetic_eval` after operator review on 2026-05-16.

The evidence includes customer names such as:

- `V2 Synthetic Eval v2-edge-synth-*`
- `V2 Synthetic Eval smoke-*`
- `KDS E2E Test`

Rows without direct `eval_traces` still belong in the evaluation archive because they were created by workflow/pipeline synthetic evaluation runs.

Current evidence rule:

- production-verified: has Twilio message SID evidence
- synthetic/eval: has eval trace evidence, synthetic/eval name markers, or operator-confirmed workflow/pipeline test provenance

## Review Columns

Use these columns when reviewing:

- `review_context`: your explanation of what this row represents.
- `review_decision`: one of:
  - `import_production`
  - `keep_eval_archive`
  - `ignore_test`
  - `needs_more_review`

Recommended default:

- keep `synthetic_eval` in a clearly separated evaluation path.
- only mark `import_production` when you recognize the phone/conversation as real customer history.

## 4E Recommendation

For observability import, use separate classes:

- `production`
- `evaluation`

Evaluation traces should go through a clearly marked evaluation path, not normal production analytics.
