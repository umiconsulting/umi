\set ON_ERROR_STOP on
-- The visible account number starts at 001 for each merchant, location and business day.
-- Keep account_number as the global legacy reference. Existing accounts keep their
-- visible number; the first account on a later business day starts at 001.
--
-- PostgreSQL fires BEFORE triggers in name order. pos_cart_business_date derives the
-- operational date before zz_pos_cart_daily_account_number allocates its number.
-- The counter update and cart insert share one transaction. ON CONFLICT locks the
-- counter row and prevents two terminals from receiving the same number.
-- Apply this file with psql --single-transaction so the seed and trigger become
-- visible together. Historical rows remain unchanged and readers fall back to
-- account_number when daily_account_number is null.

lock table merchant.pos_cart in share row exclusive mode;

alter table merchant.pos_cart
  add column if not exists daily_account_number bigint;

create table if not exists merchant.pos_account_counter (
  merchant_id   uuid not null,
  location_id   uuid not null,
  business_date date not null,
  last_number   bigint not null default 0 check (last_number >= 0),
  updated_at    timestamptz not null default now(),
  primary key (merchant_id, location_id, business_date),
  foreign key (merchant_id, location_id)
    references merchant.location(merchant_id, id) on delete restrict
);

alter table merchant.pos_account_counter enable row level security;
alter table merchant.pos_account_counter force row level security;

-- 90_rls.sql may have run again before this forward migration. Remove its broad
-- policies so the counter has one policy with both merchant and location scope.
drop policy if exists merchant_isolation on merchant.pos_account_counter;
drop policy if exists location_narrowing on merchant.pos_account_counter;
drop policy if exists pos_account_counter_scope on merchant.pos_account_counter;
create policy pos_account_counter_scope on merchant.pos_account_counter
  using (merchant_id = (select umi.current_merchant())
         and ((select umi.current_location()) is null
              or location_id = (select umi.current_location())))
  with check (merchant_id = (select umi.current_merchant())
              and ((select umi.current_location()) is null
                   or location_id = (select umi.current_location())));

grant select, insert, update on merchant.pos_account_counter to api, worker;
grant select on merchant.pos_account_counter to readonly;

-- Preserve old folios without rewriting immutable carts. A re-run can meet rows
-- that another version already numbered. Never lower a counter below the
-- maximum number shown in that scope and day.
insert into merchant.pos_account_counter
  (merchant_id, location_id, business_date, last_number)
select merchant_id, location_id, business_date,
       max(coalesce(daily_account_number, account_number))
  from merchant.pos_cart
 group by merchant_id, location_id, business_date
on conflict (merchant_id, location_id, business_date)
do update set last_number = greatest(merchant.pos_account_counter.last_number,
                                    excluded.last_number),
              updated_at = now();

create unique index if not exists pos_cart_daily_account_number_uidx
  on merchant.pos_cart
    (merchant_id, location_id, business_date, daily_account_number)
  where daily_account_number is not null;

create or replace function merchant.tg_pos_cart_daily_account_number()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if new.business_date is null then
    raise exception 'daily account number requires business_date'
      using errcode = '23502';
  end if;

  insert into merchant.pos_account_counter
    (merchant_id, location_id, business_date, last_number)
  values (new.merchant_id, new.location_id, new.business_date, 1)
  on conflict (merchant_id, location_id, business_date)
  do update set last_number = merchant.pos_account_counter.last_number + 1,
                updated_at = now()
  returning last_number into new.daily_account_number;

  return new;
end $$;

drop trigger if exists zz_pos_cart_daily_account_number on merchant.pos_cart;
create trigger zz_pos_cart_daily_account_number
  before insert on merchant.pos_cart
  for each row execute function merchant.tg_pos_cart_daily_account_number();

comment on table merchant.pos_account_counter is
  'The account number per merchant, location and operational day. Existing numbers are retained.';
comment on column merchant.pos_cart.daily_account_number is
  'Visible account number in one merchant, location and operational day. Historical accounts use their former global number.';
