\set ON_ERROR_STOP on
-- The ticket number a person reads.
--
-- `merchant.receipt_snapshot.receipt_number` held `POS-<uuid of the payment attempt>`: the
-- primary key of the money, printed on paper and shown to a customer. A UUID is the right
-- key and the wrong label — nobody reads it out, nobody types it without an error, it does
-- not sort, and it says nothing about the day, the branch or the till. The decision to give
-- the receipt its own short number, and to keep the UUID for the machine, is
-- `docs/architecture/2026-10-12-folio-visible-del-recibo-adr.md`.
--
-- This file adds the counter the label comes from and narrows the two unique constraints to
-- the scope the label actually has. It does NOT backfill: a receipt is an immutable frozen
-- fact, so receipts already issued keep the reference they were handed. Both shapes live in
-- the same text column, which is why no reader changes.
--
-- The ledger stays at `build-v3-79`, like every other file in this directory: the change is
-- additive and the compatibility anchor is the anchor.

-- ---------------------------------------------------------------------------
-- The counter. One row per merchant, location and business day.
--
-- A sequence cannot do this job, and the reason is in the PostgreSQL manual, not in taste:
-- `nextval` is not reclaimed when a transaction aborts, so "PostgreSQL sequence objects
-- cannot be used to obtain gapless sequences" — and one sequence has no way to reset per day.
-- A row does both. Gaps are expected here for the same reason: a sale rolled back after it
-- took a number burns it, and that is cheaper than a lock held across the whole checkout.
--
-- The day is the OPERATIONAL day, not midnight: the caller passes the business date the
-- ledger booked (`pos_cart.business_date`, or the open shift's when a shift pays the sale),
-- which is the same rule the receipt's own `business_date` follows.
-- ---------------------------------------------------------------------------
create table if not exists merchant.receipt_counter (
  merchant_id   uuid not null,
  location_id   uuid not null,
  business_date date not null,
  last_number   bigint not null default 0 check (last_number >= 0),
  updated_at    timestamptz not null default now(),
  primary key (merchant_id, location_id, business_date),
  foreign key (merchant_id, location_id)
    references merchant.location(merchant_id, id) on delete restrict
);

-- A table created after 90_rls.sql is NOT swept by its RLS loops, which walk the live
-- catalog. It declares its own scope, under the `<table>_scope` convention, and it is named
-- in the two exclude lists in 90_rls.sql so a re-apply does not add a second, weaker policy
-- beside this one.
alter table merchant.receipt_counter enable row level security;
alter table merchant.receipt_counter force  row level security;
drop policy if exists receipt_counter_scope on merchant.receipt_counter;
create policy receipt_counter_scope on merchant.receipt_counter
  using      (merchant_id = (select umi.current_merchant())
              and ((select umi.current_location()) is null
                   or location_id = (select umi.current_location())))
  with check (merchant_id = (select umi.current_merchant())
              and ((select umi.current_location()) is null
                   or location_id = (select umi.current_location())));

grant select, insert, update on merchant.receipt_counter to api;
grant select, insert, update on merchant.receipt_counter to worker;
grant select on merchant.receipt_counter to readonly;

comment on table merchant.receipt_counter is
  'The running ticket number per merchant, location and business day. An operational reference, not a fiscal one. Gaps are expected.';
comment on column merchant.receipt_counter.last_number is
  'The last number issued for this merchant, location and day. The next one is this plus one.';

-- ---------------------------------------------------------------------------
-- The unique constraint narrows to the scope of the label.
--
-- The old constraint claimed "a merchant never reuses a receipt number". With a per-day
-- counter that claim is false by design: ticket 0007 exists on every day of the week, and
-- two branches of one café both issue one on the same day. What replaces it is the claim
-- that is actually true: a receipt number is unique within its merchant, its location and
-- its business day. The UUID keeps global identity, so nothing needs the number to be unique
-- on its own — and nothing reads a receipt by the number alone: the sale search matches with
-- ILIKE (`pos-sale.repository.ts`), and the print path looks a receipt up by its id
-- (`pos-hardware.repository.ts`).
--
-- Dropped BY DEFINITION, not by name: both constraints were declared inline in
-- `20_merchant.sql` and `34_pos_exception.sql`, so their names belong to PostgreSQL, and a
-- name-based drop would find nothing and leave the old constraint in place beside the new
-- one.
-- ---------------------------------------------------------------------------
do $$
declare
  v_table text;
  v_name  text;
  v_new   text;
begin
  foreach v_table in array array['receipt_snapshot', 'pos_exception_receipt'] loop
    v_new := v_table || '_number_scope_uq';
    for v_name in
      select c.conname
        from pg_constraint c
       where c.conrelid = format('merchant.%I', v_table)::regclass
         and c.contype = 'u'
         and (select array_agg(a.attname::text order by a.attname::text)
                from unnest(c.conkey) k
                join pg_attribute a
                  on a.attrelid = c.conrelid and a.attnum = k)
             = array['merchant_id', 'receipt_number']::text[]
    loop
      execute format('alter table merchant.%I drop constraint %I', v_table, v_name);
      raise notice 'dropped % on merchant.%', v_name, v_table;
    end loop;

    if not exists (
      select 1 from pg_constraint c
       where c.conrelid = format('merchant.%I', v_table)::regclass
         and c.conname = v_new
    ) then
      execute format(
        'alter table merchant.%I add constraint %I unique '
        '(merchant_id, location_id, business_date, receipt_number)',
        v_table, v_new
      );
      raise notice 'added % on merchant.%', v_new, v_table;
    end if;
  end loop;
end $$;

comment on column merchant.receipt_snapshot.receipt_number is
  'The ticket number a person reads and says: digits from merchant.receipt_counter, four wide and growing past 9999. The UUID stays the primary key and lives in the printed barcode.';
comment on column merchant.pos_exception_receipt.receipt_number is
  'The ticket number of a refund or void receipt: the same counter under the EX- prefix, because a refund is another receipt.';
