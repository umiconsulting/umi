-- Gate 3F follow-up: the earn preview of a checkout version can be REFRESHED and RENEWED.
set search_path = merchant, umi, runtime, extensions, pg_catalog;

/*
 * WHY THIS EXISTS.
 *
 * A checkout version holds ONE earn preview row — `loyalty_earn_preview` is unique
 * on (merchant, cart, checkout version, customer, policy version) and the row is
 * append-only — and the closeout ASSERTS that row before it commits anything
 * (`merchant.assert_loyalty_earn_preview`): it must match the command's customer,
 * checkout version, checkout fingerprint and preview fingerprint, and it must not
 * have expired.
 *
 * One row per version, one deterministic fingerprint, one fixed window: that
 * shape left two ways to strand a sale on the till, both measured on the iMin
 * D3-504 on 2026-10-11.
 *
 *  1. THE WINDOW. The preview the API writes is `ON CONFLICT … DO NOTHING`, so
 *     asking again for the same version changes nothing and hands back the row
 *     that is already there — including an expired one. Every retry then
 *     re-previews, gets the same expired row, and is refused with
 *     `LOYALTY_PREVIEW_STALE`, for ever, on that checkout version. Measured:
 *     cart `fbab20bd…` version 12, preview expired 12:14:33, the retry at
 *     12:17:04 re-previewed and the commit was still refused. The operator's only
 *     way out was to abandon the sale.
 *  2. THE ANGLE. The basis fingerprint the closeout compares against is computed
 *     OVER THE COMMAND — including its tender drafts. An operator who raises the
 *     cash received after the preview was taken (the customer hands over a 500
 *     note) changes that basis, and the row on file can no longer be replaced:
 *     the new computation has a different `preview_fingerprint`, so the insert
 *     misses its `(merchant_id, preview_fingerprint)` conflict target and lands
 *     on the five-column unique instead — a duplicate-key 500 (measured at
 *     12:07:05 the same night). Measured again at 13:37:44: the commit answered
 *     `LOYALTY_PREVIEW_STALE` and the till said only "No fue posible completar el
 *     cobro de forma segura."
 *
 * WHAT THIS ADDS.
 *
 * `merchant.replace_loyalty_earn_preview` writes the preview for a checkout
 * version by REPLACING the row that version already has: the newest computation
 * wins, with its own fingerprints, its own numbers and a fresh window. That is
 * the shape the five-column unique already expresses — one live preview per
 * version — and it is what makes a re-preview meaningful: the till can ask again
 * after a tender changes or a window closes, and the row it gets back is the one
 * its next command will name.
 *
 * `merchant.renew_loyalty_earn_preview` widens the window of the row a command
 * names, and only while that row is expired. It exists for the till that does NOT
 * ask again — the sheet that sat on its confirmation screen longer than the TTL
 * and then charges with the preview it already holds. Nothing about the row moves
 * but `expires_at`: same identity, same numbers, same `created_at`.
 *
 * Neither function can invent a pair: both are keyed on the exact cart version,
 * customer, policy, checkout fingerprint and preview fingerprint, and the closeout
 * still re-asserts all of them (and the account, the business date and the policy
 * version and fingerprint) before it commits. A cart that changed, another
 * customer or a re-issued policy are refused exactly as they were.
 *
 * THE APPEND-ONLY GUARD IS LIFTED FOR ONE STATEMENT AT A TIME, through the helper
 * that exists for exactly this (`merchant.with_append_only_writable`,
 * `20_merchant.sql`), and both functions are `security definer` so the till's role
 * never needs `update` or `delete` on the table — `38_pos_customer_value_closeout.sql`
 * revoked those privileges on purpose, and that stays true. Every other write
 * path, including a plain `update`, is refused by the trigger as before.
 */
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
