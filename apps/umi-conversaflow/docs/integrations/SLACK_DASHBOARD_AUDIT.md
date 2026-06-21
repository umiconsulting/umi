# Slack Dashboard Audit

## Scope kept

This dashboard should cover only the gaps that are visible from Slack operations and not already handled by `apps/umi-logs`.

Included:
- order routing coverage into Slack via `transactions.slack_message_ts`
- current queue state from `transactions.status`
- stale pending work based on order age
- cancellation and partial-cancellation patterns from `transactions.details`
- order complexity proxies such as pickup, gift note, and customer note

Excluded because already covered elsewhere:
- edge function health and failures
- AI cost and latency
- Twilio delivery state
- conversation, memory, and security telemetry

## Current schema can support

- orders created today / last 7 days
- open backlog by status
- count of orders that did not reach Slack
- attention queue ordered by age
- partial cancellations by cancelled items in `details.items`

## Current schema cannot support cleanly

- accept latency, prep latency, ready-to-complete latency
- which Slack user acted on an order
- which channel or thread handled the order
- whether a Slack post was acknowledged vs merely created
- structured cancellation reason analytics

## Implementation direction

Ship a first dashboard in `apps/umi-logs/app/slack/page.tsx` using existing transaction data, then add explicit Slack event logging if phase-two operational metrics are needed.
