-- An operator can cancel a selected account from a prior business day without
-- claiming it as the active account. The API checks permission, payment state,
-- version, business date and audit within one command transaction.
create or replace function merchant.pos_cart_lifecycle_guard() returns trigger
language plpgsql
as $$
begin
  if new.original_operator_session_id is distinct from old.original_operator_session_id
     or new.original_operator_user_id is distinct from old.original_operator_user_id then
    raise exception 'sale origin is immutable';
  end if;
  if old.lifecycle_state in ('committed','cancelled') and new is distinct from old then
    raise exception 'terminal sale is immutable';
  end if;
  if not (
    new.lifecycle_state=old.lifecycle_state
    or (old.lifecycle_state='building_cart'
      and new.lifecycle_state in (
        'ready_for_checkout','suspended','cancelled','committed','recovered'
      ))
    or (old.lifecycle_state='ready_for_checkout'
      and new.lifecycle_state in (
        'building_cart','suspended','cancelled','committed','recovered'
      ))
    or (old.lifecycle_state='recovered'
      and new.lifecycle_state in (
        'building_cart','ready_for_checkout','suspended','cancelled','committed'
      ))
    or (old.lifecycle_state='suspended'
      and new.lifecycle_state in ('recovered','cancelled'))
  ) then
    raise exception 'invalid sale lifecycle transition';
  end if;
  return new;
end $$;
