\set ON_ERROR_STOP on
-- Run against umi_local after migration 038. This test requires the ONCA fixture.
-- Every inserted account and counter change is rolled back.
begin;

do $$
declare
  v_source merchant.pos_cart%rowtype;
  v_other_location uuid;
  v_number bigint;
  v_day date;
begin
  select c.* into strict v_source
    from merchant.pos_cart c
    join merchant.merchant m on m.id = c.merchant_id
   where m.handle = 'onca'
   limit 1;

  select id into strict v_other_location
    from merchant.location
   where merchant_id = v_source.merchant_id
     and id <> v_source.location_id
   limit 1;

  insert into merchant.pos_cart
    (merchant_id, location_id, operator_session_id,
     original_operator_session_id, original_operator_user_id, operator_user_id,
     status, lifecycle_state, created_at)
  values
    (v_source.merchant_id, v_source.location_id, v_source.operator_session_id,
     v_source.original_operator_session_id, v_source.original_operator_user_id,
     v_source.operator_user_id, 'abandoned', 'cancelled',
     '2099-03-01 12:00:00-07'::timestamptz)
  returning business_date, daily_account_number into v_day, v_number;
  if v_day <> '2099-03-01'::date or v_number <> 1 then
    raise exception 'first account of day: got % / %, expected 2099-03-01 / 1',
      v_day, v_number;
  end if;

  insert into merchant.pos_cart
    (merchant_id, location_id, operator_session_id,
     original_operator_session_id, original_operator_user_id, operator_user_id,
     status, lifecycle_state, created_at)
  values
    (v_source.merchant_id, v_source.location_id, v_source.operator_session_id,
     v_source.original_operator_session_id, v_source.original_operator_user_id,
     v_source.operator_user_id, 'abandoned', 'cancelled',
     '2099-03-01 12:01:00-07'::timestamptz)
  returning business_date, daily_account_number into v_day, v_number;
  if v_day <> '2099-03-01'::date or v_number <> 2 then
    raise exception 'second account of day: got % / %, expected 2099-03-01 / 2',
      v_day, v_number;
  end if;

  -- A second location of the same merchant has its own daily counter.
  insert into merchant.pos_cart
    (merchant_id, location_id, operator_session_id,
     original_operator_session_id, original_operator_user_id, operator_user_id,
     status, lifecycle_state, created_at)
  values
    (v_source.merchant_id, v_other_location, v_source.operator_session_id,
     v_source.original_operator_session_id, v_source.original_operator_user_id,
     v_source.operator_user_id, 'abandoned', 'cancelled',
     '2099-03-01 12:02:00-07'::timestamptz)
  returning business_date, daily_account_number into v_day, v_number;
  if v_day <> '2099-03-01'::date or v_number <> 1 then
    raise exception 'other location: got % / %, expected 2099-03-01 / 1',
      v_day, v_number;
  end if;

  -- The business day starts at 04:00 local time for this merchant.
  insert into merchant.pos_cart
    (merchant_id, location_id, operator_session_id,
     original_operator_session_id, original_operator_user_id, operator_user_id,
     status, lifecycle_state, created_at)
  values
    (v_source.merchant_id, v_source.location_id, v_source.operator_session_id,
     v_source.original_operator_session_id, v_source.original_operator_user_id,
     v_source.operator_user_id, 'abandoned', 'cancelled',
     '2099-03-02 03:59:59-07'::timestamptz)
  returning business_date, daily_account_number into v_day, v_number;
  if v_day <> '2099-03-01'::date or v_number <> 3 then
    raise exception 'before the day boundary: got % / %, expected 2099-03-01 / 3',
      v_day, v_number;
  end if;

  insert into merchant.pos_cart
    (merchant_id, location_id, operator_session_id,
     original_operator_session_id, original_operator_user_id, operator_user_id,
     status, lifecycle_state, created_at)
  values
    (v_source.merchant_id, v_source.location_id, v_source.operator_session_id,
     v_source.original_operator_session_id, v_source.original_operator_user_id,
     v_source.operator_user_id, 'abandoned', 'cancelled',
     '2099-03-02 04:00:00-07'::timestamptz)
  returning business_date, daily_account_number into v_day, v_number;
  if v_day <> '2099-03-02'::date or v_number <> 1 then
    raise exception 'new business day: got % / %, expected 2099-03-02 / 1',
      v_day, v_number;
  end if;

  insert into merchant.pos_account_counter
    (merchant_id, location_id, business_date, last_number)
  values (v_source.merchant_id, v_source.location_id, '2099-03-03', 998);

  insert into merchant.pos_cart
    (merchant_id, location_id, operator_session_id,
     original_operator_session_id, original_operator_user_id, operator_user_id,
     status, lifecycle_state, created_at)
  values
    (v_source.merchant_id, v_source.location_id, v_source.operator_session_id,
     v_source.original_operator_session_id, v_source.original_operator_user_id,
     v_source.operator_user_id, 'abandoned', 'cancelled',
     '2099-03-03 12:00:00-07'::timestamptz)
  returning business_date, daily_account_number into v_day, v_number;
  if v_number <> 999 then
    raise exception 'number before 1000: got %, expected 999', v_number;
  end if;

  insert into merchant.pos_cart
    (merchant_id, location_id, operator_session_id,
     original_operator_session_id, original_operator_user_id, operator_user_id,
     status, lifecycle_state, created_at)
  values
    (v_source.merchant_id, v_source.location_id, v_source.operator_session_id,
     v_source.original_operator_session_id, v_source.original_operator_user_id,
     v_source.operator_user_id, 'abandoned', 'cancelled',
     '2099-03-03 12:01:00-07'::timestamptz)
  returning business_date, daily_account_number into v_day, v_number;
  if v_number <> 1000 then
    raise exception 'number after 999: got %, expected 1000', v_number;
  end if;

  raise notice 'PASS: 001/002, location scope, 04:00 boundary, next day 001, 999/1000';
end $$;

rollback;
