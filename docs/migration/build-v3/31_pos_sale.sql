-- Gate 3A: cashier sale lifecycle. Checkout remains the financial authority.
insert into umi.permission (key, description)
values
  ('sale.lifecycle', 'Manage the location-scoped POS sale lifecycle'),
  ('sale.resume.any', 'Resume a suspended sale from another operator')
on conflict (key) do update set description=excluded.description;

insert into umi.role_permission (role_id, permission_id)
select r.id, p.id
from umi.role r
cross join umi.permission p
where not r.is_platform
  and r.key in ('owner','admin','manager','supervisor','cashier','staff')
  and p.key='sale.lifecycle'
on conflict do nothing;

insert into umi.role_permission (role_id, permission_id)
select r.id, p.id
from umi.role r
cross join umi.permission p
where not r.is_platform
  and r.key in ('owner','admin','manager','supervisor')
  and p.key='sale.resume.any'
on conflict do nothing;

alter table merchant.pos_cart
  add column lifecycle_state text not null default 'building_cart'
    check (lifecycle_state in (
      'building_cart','suspended','ready_for_checkout','committed','cancelled','recovered'
    )),
  add column display_label text check (
    display_label is null or (length(display_label) <= 120 and display_label !~ '[<>]')
  ),
  add column original_operator_session_id uuid references runtime.operator_session(id),
  add column original_operator_user_id uuid references umi.user(id),
  add column operator_user_id uuid references umi.user(id),
  add column customer_id uuid references merchant.customer(id),
  add column suspended_at timestamptz,
  add column cancelled_at timestamptz,
  add column cancellation_reason text check (
    cancellation_reason is null or (
      length(cancellation_reason) between 1 and 160 and cancellation_reason !~ '[<>]'
    )
  );

update merchant.pos_cart
set lifecycle_state=case status
    when 'prepared' then 'ready_for_checkout'
    when 'committed' then 'committed'
    when 'abandoned' then 'cancelled'
    else 'building_cart'
  end,
  original_operator_session_id=operator_session_id,
  original_operator_user_id=operator_session.user_id,
  operator_user_id=operator_session.user_id
from runtime.operator_session operator_session
where operator_session.id=pos_cart.operator_session_id;

alter table merchant.pos_cart
  alter column original_operator_session_id set not null,
  alter column original_operator_user_id set not null,
  alter column operator_user_id set not null;

drop index merchant.pos_cart_active_operator_uidx;
create unique index pos_cart_active_operator_uidx
  on merchant.pos_cart(merchant_id,location_id,operator_user_id)
  where lifecycle_state in (
    'building_cart','ready_for_checkout','recovered'
  );
create index pos_cart_lifecycle_history_idx
  on merchant.pos_cart(merchant_id,location_id,lifecycle_state,updated_at desc,id);
create index pos_cart_customer_idx
  on merchant.pos_cart(merchant_id,customer_id)
  where customer_id is not null;

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
    or (old.lifecycle_state='suspended' and new.lifecycle_state='recovered')
  ) then
    raise exception 'invalid sale lifecycle transition';
  end if;
  return new;
end $$;

create trigger pos_cart_lifecycle_guard
before update on merchant.pos_cart
for each row execute function merchant.pos_cart_lifecycle_guard();

comment on column merchant.pos_cart.lifecycle_state is
  'Gate 3A lifecycle state. Payment and receipt authority remain in checkout tables.';
comment on column merchant.pos_cart.customer_id is
  'Optional customer attachment only. Loyalty and customer editing remain out of scope.';
comment on column merchant.pos_cart.operator_user_id is
  'Current editor identity. This prevents a second active sale after a new operator session.';
