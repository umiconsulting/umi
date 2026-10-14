\set ON_ERROR_STOP on
-- Ensayo del folio diario (migración 038) sobre una copia aislada de producción.
-- Todo el fixture es sintético y la transacción termina en ROLLBACK:
-- la copia de ensayo queda intacta.
--
-- Usa ONCA y su zona/corte reales (America/Mazatlan, 04:00, definidos por 039).
-- El número visible lo asigna el trigger zz_pos_cart_daily_account_number, y el
-- business_date lo deriva pos_cart_business_date desde created_at, así que los
-- días se simulan moviendo created_at.
--
-- Nota de modelo: pos_cart_active_operator_uidx permite UNA sola cuenta activa
-- por (comercio, sucursal, operador). Por eso el fixture usa tres operadores
-- sintéticos y cierra cada cuenta antes de reutilizar a su operador. La cuenta
-- del caso 5 se deja abierta a propósito.

begin;

do $$
declare
  v_merchant uuid;
  v_location uuid;
  v_role uuid;
  v_user uuid;
  v_session uuid;
  v_staff uuid;
  v_device uuid;
  v_new_op uuid;
  v_op uuid[];
  v_cart uuid;
  v_number bigint;
  v_day date;
  v_state text;
  i int;
begin
  select id into strict v_merchant from merchant.merchant where handle = 'onca';
  select id into strict v_location
    from merchant.location
   where merchant_id = v_merchant and status = 'active'
   order by created_at
   limit 1;
  select id into v_role from umi.role where key = 'cashier';
  if v_role is null then
    select id into v_role from umi.role order by key limit 1;
  end if;

  insert into merchant.device (merchant_id, location_id, name, kind)
  values (v_merchant, v_location, 'Ensayo folio (sintético)', 'pos_terminal')
  returning id into v_device;

  -- Tres operadores sintéticos: usuario, sesión durable, persona y sesión de operador.
  for i in 1..3 loop
    insert into umi."user" (full_name, status)
    values ('Ensayos Umi (sintético) ' || i, 'active')
    returning id into v_user;

    insert into runtime.session (merchant_id, principal_type, principal_id, token_hash)
    values (v_merchant, 'user', v_user,
            encode(extensions.digest('ensayo-folio-2026-10-14-' || i, 'sha256'), 'hex'))
    returning id into v_session;

    insert into merchant.staff (merchant_id, location_id, name, role_id, status, user_id)
    values (v_merchant, v_location, 'Ensayos Umi (sintético) ' || i, v_role, 'active', v_user)
    returning id into v_staff;

    insert into runtime.operator_session
      (durable_session_id, user_id, staff_id, device_id, merchant_id, location_id, expires_at)
    values (v_session, v_user, v_staff, v_device, v_merchant, v_location,
            now() + interval '2 hours')
    returning id into v_new_op;
    v_op[i] := v_new_op;
  end loop;

  -- 1 y 2: dos cuentas del mismo día toman 001 y 002.
  insert into merchant.pos_cart
    (merchant_id, location_id, operator_session_id, original_operator_session_id,
     original_operator_user_id, operator_user_id, created_at)
  values (v_merchant, v_location, v_op[1], v_op[1],
          (select user_id from runtime.operator_session where id = v_op[1]),
          (select user_id from runtime.operator_session where id = v_op[1]),
          '2099-03-01 12:00:00-07'::timestamptz)
  returning id, daily_account_number, business_date into v_cart, v_number, v_day;
  if v_day <> date '2099-03-01' or v_number <> 1 then
    raise exception 'cuenta 1 del día: obtuve %/%, esperaba 2099-03-01/1', v_day, v_number;
  end if;
  update merchant.pos_cart
     set lifecycle_state = 'committed', status = 'committed'
   where id = v_cart;

  insert into merchant.pos_cart
    (merchant_id, location_id, operator_session_id, original_operator_session_id,
     original_operator_user_id, operator_user_id, created_at)
  values (v_merchant, v_location, v_op[2], v_op[2],
          (select user_id from runtime.operator_session where id = v_op[2]),
          (select user_id from runtime.operator_session where id = v_op[2]),
          '2099-03-01 13:00:00-07'::timestamptz)
  returning id, daily_account_number into v_cart, v_number;
  if v_number <> 2 then
    raise exception 'cuenta 2 del día: obtuve %, esperaba 2', v_number;
  end if;
  update merchant.pos_cart
     set lifecycle_state = 'committed', status = 'committed'
   where id = v_cart;

  -- 3: antes del corte de las 04:00 el día operativo sigue siendo el anterior.
  insert into merchant.pos_cart
    (merchant_id, location_id, operator_session_id, original_operator_session_id,
     original_operator_user_id, operator_user_id, created_at)
  values (v_merchant, v_location, v_op[3], v_op[3],
          (select user_id from runtime.operator_session where id = v_op[3]),
          (select user_id from runtime.operator_session where id = v_op[3]),
          '2099-03-02 02:00:00-07'::timestamptz)
  returning id, daily_account_number, business_date into v_cart, v_number, v_day;
  if v_day <> date '2099-03-01' or v_number <> 3 then
    raise exception 'antes del corte: obtuve %/%, esperaba 2099-03-01/3', v_day, v_number;
  end if;
  update merchant.pos_cart
     set lifecycle_state = 'committed', status = 'committed'
   where id = v_cart;

  -- 4: pasado el corte, el día nuevo reinicia en 001.
  insert into merchant.pos_cart
    (merchant_id, location_id, operator_session_id, original_operator_session_id,
     original_operator_user_id, operator_user_id, created_at)
  values (v_merchant, v_location, v_op[1], v_op[1],
          (select user_id from runtime.operator_session where id = v_op[1]),
          (select user_id from runtime.operator_session where id = v_op[1]),
          '2099-03-02 05:00:00-07'::timestamptz)
  returning id, daily_account_number, business_date into v_cart, v_number, v_day;
  if v_day <> date '2099-03-02' or v_number <> 1 then
    raise exception 'día nuevo: obtuve %/%, esperaba 2099-03-02/1', v_day, v_number;
  end if;
  update merchant.pos_cart
     set lifecycle_state = 'committed', status = 'committed'
   where id = v_cart;

  -- 5: una cuenta que queda ABIERTA al cambiar el día operativo.
  insert into merchant.pos_cart
    (merchant_id, location_id, operator_session_id, original_operator_session_id,
     original_operator_user_id, operator_user_id, created_at)
  values (v_merchant, v_location, v_op[2], v_op[2],
          (select user_id from runtime.operator_session where id = v_op[2]),
          (select user_id from runtime.operator_session where id = v_op[2]),
          '2099-03-02 06:00:00-07'::timestamptz)
  returning id, daily_account_number into v_cart, v_number;
  if v_number <> 2 then
    raise exception 'cuenta abierta del día 2: obtuve %, esperaba 2', v_number;
  end if;

  insert into merchant.pos_cart
    (merchant_id, location_id, operator_session_id, original_operator_session_id,
     original_operator_user_id, operator_user_id, created_at)
  values (v_merchant, v_location, v_op[3], v_op[3],
          (select user_id from runtime.operator_session where id = v_op[3]),
          (select user_id from runtime.operator_session where id = v_op[3]),
          '2099-03-03 06:00:00-07'::timestamptz)
  returning id, daily_account_number, business_date into v_cart, v_number, v_day;
  if v_day <> date '2099-03-03' or v_number <> 1 then
    raise exception 'día siguiente con cuenta abierta: obtuve %/%, esperaba 2099-03-03/1',
      v_day, v_number;
  end if;
  update merchant.pos_cart
     set lifecycle_state = 'committed', status = 'committed'
   where id = v_cart;

  -- La cuenta abierta del día anterior conserva su folio y su estado.
  select daily_account_number, lifecycle_state into v_number, v_state
    from merchant.pos_cart
   where merchant_id = v_merchant
     and location_id = v_location
     and business_date = date '2099-03-02'
     and operator_user_id = (select user_id from runtime.operator_session where id = v_op[2]);
  if v_number <> 2 or v_state <> 'building_cart' then
    raise exception 'la cuenta abierta cambió: número % estado %', v_number, v_state;
  end if;

  -- 6: el contador pasa de 999 a 1000 sin cortar el folio.
  insert into merchant.pos_account_counter
    (merchant_id, location_id, business_date, last_number)
  values (v_merchant, v_location, date '2099-03-04', 999)
  on conflict (merchant_id, location_id, business_date)
  do update set last_number = 999, updated_at = now();

  insert into merchant.pos_cart
    (merchant_id, location_id, operator_session_id, original_operator_session_id,
     original_operator_user_id, operator_user_id, created_at)
  values (v_merchant, v_location, v_op[1], v_op[1],
          (select user_id from runtime.operator_session where id = v_op[1]),
          (select user_id from runtime.operator_session where id = v_op[1]),
          '2099-03-04 06:00:00-07'::timestamptz)
  returning daily_account_number into v_number;
  if v_number <> 1000 then
    raise exception 'después de 999: obtuve %, esperaba 1000', v_number;
  end if;

  raise notice 'PASS folio diario: 001/002, corte 04:00, día nuevo en 001, cuenta abierta intacta, 999 -> 1000';
end $$;

rollback;
