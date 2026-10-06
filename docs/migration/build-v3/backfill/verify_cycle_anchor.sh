#!/usr/bin/env bash
# ============================================================================
# Verify the 79_cycle_anchor CARRY, which no gate can.
#
# The carry only runs when the legacy schemas exist (`core`/`loyalty`), and the CI
# gate builds a PRISTINE build-v3 database by design — so `gate` exercises the DDL
# and never the arithmetic that matters on the night. This script is that
# verification: three cards whose cached numbers the naive modulo does NOT
# reproduce, and an assertion that after 79 they do.
#
# It is self-contained and destructive ONLY to the scratch database it creates.
#
#   PGHOST=127.0.0.1 PGPORT=4003 PGUSER=postgres PGPASSWORD=... \
#     ./verify_cycle_anchor.sh [scratch_db]
#
# Exits non-zero on any mismatch, so it can be run before a cutover.
# ============================================================================
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB="${1:-umi_carry_check}"

echo "== rebuilding $DB from the pristine chain (00_run.sh) =="
dropdb --if-exists "$DB"
createdb "$DB"
bash "$DIR/00_run.sh" "$DB" >/dev/null

echo "== seeding a legacy twin: three cards, one of them an early cash-out =="
psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
create schema if not exists core;
create schema if not exists loyalty;
create table if not exists loyalty.cards (
  id uuid primary key, total_visits int, visits_this_cycle int, pending_rewards int);
create table if not exists loyalty.reward_redemptions (id uuid primary key, note text);

insert into merchant.merchant (id, name, handle)
values ('11111111-1111-4111-8111-111111111111', 'Carry Cafe', 'carrycafe');
insert into merchant.customer (id, merchant_id, name)
values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Ana');
-- A 7/9 ladder, so the carried threshold is the upper tier.
insert into merchant.loyalty_reward (merchant_id, name, type, kind, stamps_required, active)
values ('11111111-1111-4111-8111-111111111111', 'Capuccino', 'stamps_free_item', 'standard', 7, true),
       ('11111111-1111-4111-8111-111111111111', 'Latte rocas', 'stamps_free_item', 'upgrade', 9, true);

-- CC-1 · a clean cycle: 12 stamps, one banked reward.
insert into merchant.loyalty_card (id, merchant_id, customer_id, card_number)
values ('aaaaaaaa-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222', 'CC-1');
insert into merchant.loyalty_visit (merchant_id, card_id, stamps)
values ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-00000000000a', 12);
insert into loyalty.cards values ('aaaaaaaa-0000-4000-8000-00000000000a', 12, 3, 1);

-- CC-2 · the early cash-out: 7 stamps and the card torn off. The naive modulo reads
-- 7/9; the till read 0/9.
insert into merchant.loyalty_card (id, merchant_id, customer_id, card_number)
values ('bbbbbbbb-0000-4000-8000-00000000000b', '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222', 'CC-2');
insert into merchant.loyalty_visit (merchant_id, card_id, stamps)
values ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-0000-4000-8000-00000000000b', 7);
insert into merchant.loyalty_redemption (id, merchant_id, card_id, reason)
values ('db000000-0000-4000-8000-00000000000b', '11111111-1111-4111-8111-111111111111',
        'bbbbbbbb-0000-4000-8000-00000000000b', 'stamps');
insert into loyalty.cards values ('bbbbbbbb-0000-4000-8000-00000000000b', 7, 0, 0);
insert into loyalty.reward_redemptions values
  ('db000000-0000-4000-8000-00000000000b', 'Canje anticipado con 7/9 visitas');

-- CC-3 · 14 stamps under a cycle that was running to 7 when it moved: the cache says
-- 5/1 (one banked, one already handed over), which the naive modulo also gets right.
-- It is here so the test can tell "fixed" from "changed everything".
insert into merchant.loyalty_card (id, merchant_id, customer_id, card_number)
values ('cccccccc-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222', 'CC-3');
insert into merchant.loyalty_visit (merchant_id, card_id, stamps)
values ('11111111-1111-4111-8111-111111111111', 'cccccccc-0000-4000-8000-00000000000c', 14);
insert into loyalty.cards values ('cccccccc-0000-4000-8000-00000000000c', 14, 5, 1);
SQL

echo "== re-applying 79 so the carry sees the legacy twin =="
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/79_cycle_anchor.sql" >/dev/null 2>&1

echo "== the derived numbers must equal what the till was reading =="
RESULT=$(psql -X -q -d "$DB" -A -t -c "
  with d as (
    select c.card_number, l.visits_this_cycle as cache_v, l.pending_rewards as cache_p,
           coalesce((select sum(v.stamps) from merchant.loyalty_visit v
                      where v.card_id = c.id), 0)::int as total,
           c.cycle_anchor, c.rewards_earned,
           (select count(*) from merchant.loyalty_redemption r
             where r.card_id = c.id and r.reverted_at is null and not r.cycle_reset)::int as standing
      from merchant.loyalty_card c
      join loyalty.cards l on l.id = c.id
     where c.merchant_id = '11111111-1111-4111-8111-111111111111')
  select card_number || ' cache ' || cache_v || '/' || cache_p
      || ' -> derived ' || ((total - cycle_anchor) % 9) || '/' || (rewards_earned - standing)
      || (case when (total - cycle_anchor) % 9 = cache_v
                 and (rewards_earned - standing) = cache_p then '  ok' else '  MISMATCH' end)
    from d order by card_number;")

echo "$RESULT"
FAILED=$(echo "$RESULT" | grep -c MISMATCH || true)
if [ "$FAILED" -ne 0 ]; then
  echo "FAIL: $FAILED card(s) do not reproduce the till's numbers after the carry." >&2
  exit 1
fi
echo "OK: every card reproduces the till's numbers after the carry."
