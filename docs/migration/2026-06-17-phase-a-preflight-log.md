# Phase A — Preflight Evidence Log (2026-06-17)

Execution log for the Phase A restore + baseline. Cluster: **Homebrew
`postgresql@18`, port 5233** (the migration home; the Docker `pos8_postgres_local`
on 5432 is the unrelated POS8 app stack).

## Dumps
| File | Source | Format | Status |
|---|---|---|---|
| `apps/umi-cash/cash_prod_20260617.dump` | direct `pg_dump` of Cash prod `rrkzhisnadfrgnhntkiz` | custom v1.16 | ✅ full data (2,252 data lines) |
| `apps/umi-cash/platform_prod_20260617.dump` | "converted" via CLI pooler → temp PG → re-dump | custom v1.16 | ❌ schema-only — data lost (102 data lines). **Superseded.** |
| `apps/umi-cash/platform_prod_20260617_full.dump` | raw `pg_dump` over Session pooler (IPv4) | custom v1.16, 7.5 MB | ✅ full data (18,347 data lines) |

## Cash — restored ✅ → `umi_cash_production_local_20260617` (public-only, clean, exit 0)

Row counts (fresh): User 352 · LoyaltyCard **344** · Visit 378 · ApplePushToken 308 ·
LifecycleEvent **170** · OtpVerification 167 · Session 154 · RewardConfig 16 ·
RewardRedemption 16 · Tenant 5 · Location 4 · Transaction 7 · GiftCard 1 ·
BirthdayReward 0 · _prisma_migrations 18.

### MONEY BASELINE (guardrail #3 reference — conservation must preserve these)
| Metric | Rows | Centavos |
|---|---|---|
| `LoyaltyCard.balanceCentavos` (wallet balances) | 344 | **95,000** |
| `Transaction.amountCentavos` net (+115,000 TOPUP / −20,101 PURCHASE) | 7 | 94,899 |
| `GiftCard.amountCentavos` | 1 | 10,000 |

→ Migration must conserve **95,000 centavos across 344 cards** into
`loyalty.points_ledger` (reason `migration_initial_balance`) and `loyalty.balances`.

## Inventory findings (feed §10.1 "every source table accounted for")
- **Data grew since May:** LoyaltyCard 208 (May doc) → **344** today. Confirms why
  guardrail #3 demands a fresh dump; any plan numbers from May are stale.
- **`public."LifecycleEvent"` (170 rows)** is NOT in the movement map or the FDW
  import list (`020_…fdw.sql`). Must be explicitly mapped or documented-as-dropped.
- Fresh `conversaflow` has ~26 tables, `kds` ~7 — more than the FDW import covers.

## Platform — restored ✅ → `umi_platform_production_local_20260617` (from `_full.dump`)

Pre-created `extensions` schema + `vector`/`pg_trgm`/`pgcrypto`/`uuid-ossp` (the
embedding columns/indexes are `extensions.vector`). Restore loaded data; 24
errors were all expected — RLS policies referencing helper functions in
`public`/`auth`/`commerce` (schemas intentionally not dumped). Data is unaffected.

Counts: platform.people **15** · users 1 · tenants 4 · tenant_memberships 1 ·
contact_identities 12 · conversaflow.businesses 1 · customers **11** ·
conversations 11 · messages **1,322** · memory_items 0 · kds.tickets 49.

**Sanity on customers 536 (May) → 11 (today):** confirmed it's the synthetic-data
cleanup, not a truncated dump — referential check is clean (0 orphan messages; the
11 conversations referenced by messages exactly match the 11 present). Dump is
internally consistent and complete.

## Done this pass
- ✅ Cash restored + money baseline captured (95,000¢ / 344 cards).
- ✅ Platform re-dumped **with data** (Session pooler) + restored + verified consistent.
- ✅ `020_local_source_fdw.sql` repointed to port **5233** + dated names `20260617`.
- ⏳ Next: stand up the working/unified DB (DDL build 001–050 + FDW 020 against the
  fresh sources), then run preflight uniqueness + `_migration.preflight_counts` (plan §4).

---

## Fresh Cash re-dump (2026-06-18) — supersedes the 0617 Cash source

The 0617 Cash dump *file* was no longer on disk (only the local restore remained).
Took a new read-only dump straight from live Cash prod `rrkzhisnadfrgnhntkiz`
(`.env.local` `DATABASE_URL`, Session pooler — **not** the stale
`xbudknbimkgjjgohnjgp …?schema=umi_cash` copy).

- **Dump:** `pg_dump -n public -Fc` → `apps/umi-cash/cash_prod_20260618.dump`
  (190 KB, 15 table-data entries). Restored clean (exit 0; only the benign
  "schema public already exists") → **`umi_cash_production_local_20260618`**.
- **FDW:** `020_local_source_fdw.sql` Cash server repointed to `_20260618`
  (4 refs); platform server left at `_20260617` (6 refs).

### Row deltas vs 0617 — all growth is zero-balance
| Table | 0617 | 0618 | Δ |
|---|---|---|---|
| LoyaltyCard | 344 | 348 | +4 |
| User | 352 | 356 | +4 |
| Visit | 378 | 385 | +7 |
| LifecycleEvent | 170 | 170 | — |

### MONEY BASELINE — unchanged (conservation target holds)
| Metric | Rows | Centavos |
|---|---|---|
| `LoyaltyCard.balanceCentavos` (4 cards carry balance) | 348 | **95,000** |
| `Transaction.amountCentavos` net (+115,000 TOPUP / −20,101 PURCHASE) | 7 | 94,899 |
| `GiftCard.amountCentavos` | 1 | 10,000 |

→ Phase C conservation gate target stays **95,000¢ across 344→348 cards**. The 4
new cards / 4 users / 7 visits since 0617 are all zero-balance.

> **Note on "final":** we are in Phase A (preflight), not cutover. This 0618 dump
> is the **working canonical Cash source**. Guardrail #3 still requires one more
> fresh <24h dump **immediately before the actual cutover** — that is the true
> final source for the Phase C / K conservation re-run.

### `public."LifecycleEvent"` — characterized (disposition pending)
Cash lifecycle-nudge log (`id`, `cardId`→`LoyaltyCard`, `journey`, `sentAt`,
`body`). 170 sends across 147 cards, 2026-05-17 → 06-13: `welcome_no_visit` 71 ·
`winback_14` 46 · `winback_30` 42 · `winback_60` 7 · `streak_6w` 2 · `streak_3w` 2.

**Not exhaust — it is the campaign's at-most-once idempotency ledger.**
`apps/umi-cash/src/lib/lifecycle.ts` enforces `UNIQUE(cardId, journey)` and uses
*insert-first* dedup: the cron inserts the `LifecycleEvent` and treats a `P2002`
unique-violation as "already sent → skip." The row's existence is the send guard
(`reward_expiring_${year}` is year-suffixed so it re-nudges annually — journey is
the intended dedup grain).

**Consequence:** if the lifecycle cron is ported to the new platform and this
table is **dropped**, every migrated card reads as never-messaged → the guard is
empty → **mass re-send** (71 second-welcomes, all winbacks re-nudged). So drop is
*not* a clean no-op.

**Disposition rule:**
- Lifecycle feature **ported** → **migrate the `(card→person/account, journey,
  sentAt)` dedup keys** into the new automation's send-guard (`body` optional, for
  customer-360). Add to the movement map + FDW import (currently in neither).
- Feature **retired / rebuilt without historical dedup** → document-as-dropped.

**Blocking question:** is the Cash lifecycle-messaging cron being carried into the
new platform? **Decision: ⏳ pending owner.**
