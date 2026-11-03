-- 041 · Las dos funciones del ciclo de la previsualización de canje.
--
-- POR QUÉ ES UNA MIGRACIÓN Y NO BASTA EL DDL. `40_loyalty_earn_preview_lifecycle.sql`
-- las define, pero un archivo del DDL numerado sólo llega a una base NUEVA:
-- `00_run.sh` aplica esa lista al construir el esquema desde cero, y una base que ya
-- existe no lo ve nunca. El camino de cobro llama a
-- `merchant.replace_loyalty_earn_preview`. Medido el 2026-10-14 sobre una copia de
-- producción con 001–040 aplicadas: la función no estaba, así que el cobro con valor
-- de cliente habría caído en `function … does not exist`. Esta migración lleva el
-- mismo contenido a las bases que ya están en pie; el DDL sigue siendo lo que recibe
-- una base nueva.
--
-- El razonamiento de las dos funciones —por qué reemplazar y por qué renovar— está
-- escrito junto a su definición, en `40_loyalty_earn_preview_lifecycle.sql`.
--
-- Re-ejecutable: `create or replace` y `grant` idempotentes.
set search_path = merchant, umi, runtime, extensions, pg_catalog;

create or replace function merchant.replace_loyalty_earn_preview(
  p_merchant_id uuid,
  p_location_id uuid,
  p_cart_id uuid,
  p_customer_id uuid,
  p_account_id uuid,
  p_checkout_version integer,
  p_customer_attachment_version integer,
  p_loyalty_program_id uuid,
  p_loyalty_policy_version text,
  p_loyalty_policy_fingerprint text,
  p_checkout_fingerprint text,
  p_preview_fingerprint text,
  p_input_fingerprint text,
  p_gross_eligible_minor_units bigint,
  p_excluded_minor_units bigint,
  p_final_eligible_minor_units bigint,
  p_expected_points bigint,
  p_earn_status text,
  p_explanation_codes text[],
  p_effective_rules jsonb,
  p_business_date date,
  p_expires_at timestamptz
) returns void
language plpgsql security definer
set search_path = pg_catalog, merchant, umi as $$
declare
  v_old uuid;
begin
  -- The row this version already has, if any. `for update` so two tills asking at
  -- once serialise on it instead of racing to replace it.
  select p.id into v_old
    from merchant.loyalty_earn_preview p
   where p.merchant_id = p_merchant_id
     and p.cart_id = p_cart_id
     and p.checkout_version = p_checkout_version
     and p.customer_id = p_customer_id
     and p.loyalty_policy_version = p_loyalty_policy_version
   for update;

  if v_old is not null then
    -- A preview a COMMITTED sale already points at is not ours to remove: the
    -- snapshot that consumed it references this row (`on delete restrict`), and a
    -- version that has been committed takes no further previews. Leave it, and let
    -- the insert below answer with the row that is already there.
    if not exists (
      select 1 from merchant.loyalty_sale_policy_snapshot s where s.earn_preview_id = v_old
    ) then
      perform merchant.with_append_only_writable(
        'merchant.loyalty_earn_preview',
        format('delete from merchant.loyalty_earn_preview where id = %L::uuid', v_old)
      );
      v_old := null;
    end if;
  end if;

  -- The same computation asked for twice in a row is the same row: the insert's
  -- own conflict target keeps it that way.
  insert into merchant.loyalty_earn_preview(
    merchant_id, location_id, cart_id, customer_id, account_id, checkout_version,
    customer_attachment_version, loyalty_program_id, loyalty_policy_version,
    loyalty_policy_fingerprint, checkout_fingerprint, preview_fingerprint, input_fingerprint,
    gross_eligible_minor_units, excluded_minor_units, final_eligible_minor_units,
    expected_points, earn_status, explanation_codes, effective_rules, business_date, expires_at)
  values(
    p_merchant_id, p_location_id, p_cart_id, p_customer_id, p_account_id, p_checkout_version,
    p_customer_attachment_version, p_loyalty_program_id, p_loyalty_policy_version,
    p_loyalty_policy_fingerprint, p_checkout_fingerprint, p_preview_fingerprint, p_input_fingerprint,
    p_gross_eligible_minor_units, p_excluded_minor_units, p_final_eligible_minor_units,
    p_expected_points, p_earn_status, p_explanation_codes, p_effective_rules, p_business_date,
    p_expires_at)
  on conflict (merchant_id, preview_fingerprint) do nothing;
end $$;

create or replace function merchant.renew_loyalty_earn_preview(
  p_merchant_id uuid,
  p_location_id uuid,
  p_cart_id uuid,
  p_customer_id uuid,
  p_checkout_version integer,
  p_checkout_fingerprint text,
  p_preview_fingerprint text,
  p_window_seconds integer
) returns timestamptz
language plpgsql security definer
set search_path = pg_catalog, merchant, umi as $$
declare
  v_id uuid;
  v_expires timestamptz;
  v_window timestamptz;
begin
  if p_window_seconds is null or p_window_seconds <= 0 then
    raise exception 'RENEWAL_WINDOW_INVALID';
  end if;

  select p.id, p.expires_at into v_id, v_expires
    from merchant.loyalty_earn_preview p
   where p.merchant_id = p_merchant_id
     and p.location_id = p_location_id
     and p.cart_id = p_cart_id
     and p.customer_id = p_customer_id
     and p.checkout_version = p_checkout_version
     and p.checkout_fingerprint = p_checkout_fingerprint
     and p.preview_fingerprint = p_preview_fingerprint
   for update;

  -- No such preview: the command names half a pair that was never written. The
  -- closeout refuses it on its own terms, and this function is not a way to
  -- invent one.
  if v_id is null then
    return null;
  end if;

  -- Still fresh: leave it be, so a renewal never shortens a live window and the
  -- row's own `created_at` keeps meaning "when this was computed".
  if v_expires > clock_timestamp() then
    return v_expires;
  end if;

  -- The window cannot outlive the loyalty policy the preview was computed under.
  v_window := least(
    clock_timestamp() + make_interval(secs => p_window_seconds),
    coalesce(
      (select pr.policy_expires_at from merchant.loyalty_program pr
        where pr.merchant_id = p_merchant_id),
      clock_timestamp() + make_interval(secs => p_window_seconds)
    )
  );

  perform merchant.with_append_only_writable(
    'merchant.loyalty_earn_preview',
    format(
      'update merchant.loyalty_earn_preview set expires_at = to_timestamp(%s) where id = %L::uuid',
      extract(epoch from v_window),
      v_id
    )
  );
  return v_window;
end $$;

-- The till's own role asks for both: the refresh when it re-previews, the renewal
-- when it charges with the preview it already holds.
grant execute on function merchant.replace_loyalty_earn_preview(
  uuid, uuid, uuid, uuid, uuid, integer, integer, uuid, text, text, text, text, text,
  bigint, bigint, bigint, bigint, text, text[], jsonb, date, timestamptz
) to api, worker;

grant execute on function merchant.renew_loyalty_earn_preview(
  uuid, uuid, uuid, uuid, integer, text, text, integer
) to api, worker;
