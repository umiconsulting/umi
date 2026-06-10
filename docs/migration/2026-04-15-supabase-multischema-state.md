# Supabase Multi-Schema State — 2026-04-15

Status: historical. Retained as an April 2026 state snapshot; superseded as an implementation driver by `docs/migration/2026-06-09-workspace-integration-implementation-plan.md` and its wrapped 05-23 checklist.

## Summary

This workspace was restructured under the `Umi/` root and the shared Supabase database was expanded from a `public`-only application layout to a multi-schema layout.

Created schemas:

- `conversaflow`
- `kds`
- `umi_cash`
- `platform`

ConversaFlow production data was left intact in `public` as a compatibility surface.

## Schema status (verified 2026-04-15)

| Schema | State |
|---|---|
| `conversaflow` | **Complete** — all 21 tables copied from `public`, row counts verified |
| `public` | Still present as compatibility surface; no destructive changes |
| `umi_cash` | **Complete** — fully re-synced from live umi-cash project; all 11 data tables match live row counts |
| `kds` | **Live** — migration applied 2026-04-16; 23 tickets, items, and events backfilled from `conversaflow.transactions`; incremental trigger active |
| `platform` | Empty — reserved for future master data |

## Verified production preservation

- `public.transactions`: 23 rows (unchanged)
- `conversaflow.transactions`: 23 rows (matches source)

## `conversaflow` schema — tables present

All 21 tables copied from `public`:
ai_turn_logs, business_config_changes, businesses, conversation_outcomes, conversation_turns, conversations, customer_preferences, customers, daily_summaries, dashboard_users, edge_function_logs, inbound_events, job_attempts, jobs, messages, outbox, products, security_logs, transaction_status_events, transactions, zettle_oauth_tokens

## `umi_cash` schema — row counts (verified 2026-04-15)

Full re-sync from live umi-cash project (`rrkzhisnadfrgnhntkiz`). All counts match live.

| Table | Live | umi_cash | Match |
|---|---|---|---|
| `Tenant` | 3 | 3 | ✅ |
| `Location` | 3 | 3 | ✅ |
| `User` | 64 | 64 | ✅ |
| `LoyaltyCard` | 59 | 59 | ✅ |
| `Visit` | 31 | 31 | ✅ |
| `Transaction` | 3 | 3 | ✅ |
| `RewardConfig` | 14 | 14 | ✅ |
| `RewardRedemption` | 0 | 0 | ✅ |
| `GiftCard` | 1 | 1 | ✅ |
| `OtpVerification` | 13 | 13 | ✅ |
| `ApplePushToken` | 49 | 49 | ✅ |
| `Session` | 132 | 0 | intentional — ephemeral, will be created fresh on cutover |

## DDL changes applied during re-sync

- `User`: added `birthDate`, `device`, `os`, `phoneVerifiedAt`
- `Tenant`: added `topupEnabled`, `promoDays`, `promoEndsAt`, `promoStartsAt`, `timezone`, `businessHours`
- Created `OtpVerification` table (was entirely missing)
- Dropped stale unique constraints `User_tenantId_phone_key` and `User_tenantId_email_key` (live DB allows duplicate phones per tenant)

## Notes

- Live DB uses `timestamp without time zone`; `umi_cash` uses `timestamp with time zone`; timestamps inserted as-is (treated as UTC).
- Sessions intentionally not migrated — ephemeral auth tokens that will be recreated on first login after cutover.
- `platform` schema exists but is intentionally empty at this point.
- `kds` schema is now live as of 2026-04-16 and is exposed in the Supabase PostgREST config (`db_schema`, `db_extra_search_path`). The `anon` Postgres role has `USAGE` on the schema and `EXECUTE` on the three public RPCs.

## Remaining steps

1. Point `umi-cash` runtime/env to shared Postgres using `schema=umi_cash`; deprecate separate project (`rrkzhisnadfrgnhntkiz`)
2. Point ConversaFlow backend clients at `conversaflow` schema
3. ~~Apply the new KDS projection migration~~ — **done 2026-04-16**
4. ~~Validate live row counts and sampled ticket payloads in `kds`~~ — **done 2026-04-16**
5. ~~Validate the iPad app against the implemented snapshot, event, and transition contracts~~ — **done 2026-04-16**
