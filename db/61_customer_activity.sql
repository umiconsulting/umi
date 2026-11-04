-- ============================================================================
-- build-v3 · 61_customer_activity — Customers list performance
-- ----------------------------------------------------------------------------
-- The Customers list sorted by a COMPUTED `last_touch_at` — a MAX across six
-- lateral-derived timestamps. No index can serve that sort, so every page load
-- materialized every contact and sorted them: cost O(total contacts), not O(page).
--
-- This stores the recency key on the row, backfilled from the same MAX so the
-- existing order is preserved, then kept fresh by triggers on the activity
-- sources. The list orders by this indexed column and drops the sort lateral.
-- Runs AFTER 20_merchant (tables) and 60_triggers.
-- ============================================================================

alter table merchant.customer add column if not exists last_activity_at timestamptz;

-- Backfill from the historical signals (mirrors the retired last_touch_at).
update merchant.customer c
set last_activity_at = greatest(
  c.updated_at,
  c.created_at,
  (select max(m.occurred_at) from merchant.message m
     join merchant.conversation cv on cv.id = m.conversation_id
    where cv.customer_id = c.id and cv.merchant_id = c.merchant_id),
  (select max(o.created_at) from merchant.customer_order o
    where o.customer_id = c.id and o.merchant_id = c.merchant_id),
  (select max(f.updated_at) from merchant.customer_fact f
    where f.customer_id = c.id and f.merchant_id = c.merchant_id),
  (select max(lc.updated_at) from merchant.loyalty_card lc
    where lc.customer_id = c.id and lc.merchant_id = c.merchant_id)
);

-- New customers: activity starts at creation. Fill any row the greatest() left null.
alter table merchant.customer alter column last_activity_at set default now();
update merchant.customer
set last_activity_at = coalesce(last_activity_at, updated_at, created_at, now())
where last_activity_at is null;

-- The index that serves the list ORDER BY (and a future keyset cursor).
create index if not exists customer_merchant_last_activity_idx
  on merchant.customer (merchant_id, last_activity_at desc, id desc);

-- Trigram index for the list's name search (`name ILIKE '%term%'`). pg_trgm lives
-- in the `extensions` schema (see 00_foundation); qualify the opclass so it resolves
-- regardless of search_path.
create index if not exists customer_name_trgm_idx
  on merchant.customer using gin (name extensions.gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- Keep-fresh triggers. An activity happens "now", so the bump is now(). Message
-- recency arrives via the parent conversation (message has no customer_id).
-- ----------------------------------------------------------------------------
create or replace function merchant.tg_bump_customer_activity_by_conversation() returns trigger
  language plpgsql
  set search_path = pg_catalog as $$
begin
  update merchant.customer set last_activity_at = now()
   where id = (select customer_id from merchant.conversation where id = new.conversation_id);
  return new;
end $$;

create trigger message_bump_customer_activity
  after insert on merchant.message
  for each row execute function merchant.tg_bump_customer_activity_by_conversation();

create or replace function merchant.tg_bump_customer_activity() returns trigger
  language plpgsql
  set search_path = pg_catalog as $$
begin
  if new.customer_id is not null then
    update merchant.customer set last_activity_at = now() where id = new.customer_id;
  end if;
  return new;
end $$;

create trigger order_bump_customer_activity
  after insert on merchant.customer_order
  for each row execute function merchant.tg_bump_customer_activity();

create trigger fact_bump_customer_activity
  after insert on merchant.customer_fact
  for each row execute function merchant.tg_bump_customer_activity();
