-- Gate 5A operational wiring.
-- Administrative commands keep web provenance separate from POS provenance.

insert into umi.permission(key,description) values
  ('catalog.manage','Manage the merchant catalog from the Dashboard'),
  ('register.manage','Manage register configuration from the Dashboard')
on conflict(key) do update set description=excluded.description;
insert into umi.role_permission(role_id,permission_id)
select r.id,p.id from umi.role r cross join umi.permission p
 where r.key in ('owner','admin','manager') and p.key in ('catalog.manage','register.manage')
on conflict do nothing;

alter table merchant.pos_exception_preview
  add column administrative_command_id uuid
    references merchant.administrative_command(id) on delete restrict;
alter table merchant.pos_exception_preview alter column operator_session_id drop not null;
alter table merchant.pos_exception_preview alter column device_id drop not null;
alter table merchant.pos_exception_preview add constraint pos_exception_preview_context_ck check (
  (administrative_command_id is not null and operator_session_id is null and device_id is null)
  or
  (administrative_command_id is null and operator_session_id is not null and device_id is not null)
);

alter table merchant.pos_sale_exception
  add column administrative_command_id uuid
    references merchant.administrative_command(id) on delete restrict;
alter table merchant.pos_sale_exception alter column operator_session_id drop not null;
alter table merchant.pos_sale_exception alter column device_id drop not null;
alter table merchant.pos_sale_exception alter column device_credential_version drop not null;
alter table merchant.pos_sale_exception add constraint pos_sale_exception_context_ck check (
  (administrative_command_id is not null and operator_session_id is null
    and device_id is null and device_credential_version is null)
  or
  (administrative_command_id is null and operator_session_id is not null
    and device_id is not null and device_credential_version is not null)
);

alter table runtime.elevation_grant
  add column dashboard_session_id uuid
    references runtime.dashboard_session(id) on delete cascade;
alter table runtime.elevation_grant alter column session_id drop not null;
alter table runtime.elevation_grant add constraint elevation_grant_context_ck check (
  (session_id is not null and dashboard_session_id is null)
  or
  (session_id is null and dashboard_session_id is not null)
);
create index elevation_grant_dashboard_active_idx
  on runtime.elevation_grant(dashboard_session_id,merchant_id,permission_key,expires_at)
  where consumed_at is null and dashboard_session_id is not null;

alter table runtime.dashboard_session
  add column approval_failed_attempts smallint not null default 0
    check (approval_failed_attempts between 0 and 10),
  add column approval_locked_until timestamptz;

alter table merchant.pos_exception_preview enable row level security;
alter table merchant.pos_exception_preview force row level security;
alter table merchant.pos_sale_exception enable row level security;
alter table merchant.pos_sale_exception force row level security;

create function merchant.tg_dashboard_exception_context_immutable()
returns trigger language plpgsql as $$
begin
  if new.administrative_command_id is distinct from old.administrative_command_id then
    raise exception 'administrative command provenance is immutable';
  end if;
  return new;
end $$;
create trigger dashboard_exception_preview_context_immutable
  before update on merchant.pos_exception_preview
  for each row execute function merchant.tg_dashboard_exception_context_immutable();

alter table merchant.stock_ledger_entry alter column device_id drop not null;
alter table merchant.stock_ledger_entry alter column credential_version drop not null;
alter table merchant.stock_ledger_entry add constraint stock_ledger_command_context_ck check (
  (device_id is null and credential_version is null)
  or
  (device_id is not null and credential_version is not null)
);

alter table merchant.inventory_count
  add column administrative_command_id uuid
    references merchant.administrative_command(id) on delete restrict;
alter table merchant.inventory_count alter column operator_session_id drop not null;
alter table merchant.inventory_count alter column device_id drop not null;
alter table merchant.inventory_count add constraint inventory_count_command_context_ck check (
  (administrative_command_id is not null and operator_session_id is null and device_id is null)
  or
  (administrative_command_id is null and operator_session_id is not null and device_id is not null)
);

-- A remote command keeps its Dashboard actor and its assigned POS executor separate.
alter table merchant.hardware_command
  add column administrative_command_id uuid
    references merchant.administrative_command(id) on delete restrict;
alter table merchant.hardware_command alter column operator_session_id drop not null;
alter table merchant.hardware_command add constraint hardware_command_actor_context_ck check (
  (administrative_command_id is not null and operator_session_id is null)
  or
  (administrative_command_id is null and operator_session_id is not null)
);
create index hardware_command_remote_executor_idx
  on merchant.hardware_command(merchant_id,originating_pos_device_id,created_at,id)
  where administrative_command_id is not null;

-- Secure delivery binds a promotional issue to its Dashboard session.
alter table merchant.loyalty_gift_card alter column issuer_device_id drop not null;
alter table merchant.gift_card_secret_delivery alter column device_id drop not null;
alter table merchant.gift_card_secret_delivery
  add column dashboard_session_id uuid
    references runtime.dashboard_session(id) on delete restrict;
alter table merchant.gift_card_secret_delivery add constraint gift_card_delivery_context_ck check (
  (device_id is not null and dashboard_session_id is null)
  or
  (device_id is null and dashboard_session_id is not null)
);

create or replace function merchant.store_gift_card_secret_delivery(
  p_merchant_id uuid,p_location_id uuid,p_gift_card_id uuid,p_issuance_command_id uuid,
  p_token_hash bytea,p_ciphertext bytea,p_nonce bytea,p_auth_tag bytea,
  p_operator_id uuid,p_device_id uuid,p_expires_at timestamptz
) returns void language plpgsql security definer
set search_path=pg_catalog,merchant,runtime,umi as $$
declare v_dashboard_session uuid;
begin
  perform merchant.assert_customer_value_write_scope(p_merchant_id,p_device_id);
  if p_device_id is null then
    select dashboard_session_id into v_dashboard_session
      from merchant.administrative_command
     where merchant_id=p_merchant_id and command_id=p_issuance_command_id
       and actor_user_id=p_operator_id and operation='gift_card.promotional_issue';
    if v_dashboard_session is null then raise exception 'DASHBOARD_COMMAND_CONTEXT_REQUIRED'; end if;
  end if;
  insert into merchant.gift_card_secret_delivery(
    merchant_id,location_id,gift_card_id,issuance_command_id,token_hash,ciphertext,nonce,auth_tag,
    operator_id,device_id,dashboard_session_id,expires_at)
  values(p_merchant_id,p_location_id,p_gift_card_id,p_issuance_command_id,p_token_hash,p_ciphertext,
    p_nonce,p_auth_tag,p_operator_id,p_device_id,v_dashboard_session,p_expires_at);
end $$;

create or replace function merchant.reveal_gift_card_secret_delivery(
  p_merchant_id uuid,p_location_id uuid,p_token_hash bytea,p_operator_id uuid,
  p_device_id uuid,p_reveal_session_id uuid
) returns table(public_reference text,ciphertext bytea,nonce bytea,auth_tag bytea,expires_at timestamptz)
language plpgsql security definer set search_path=pg_catalog,merchant,runtime,umi as $$
declare v_dashboard_session uuid;
begin
  perform merchant.assert_customer_value_write_scope(p_merchant_id,p_device_id);
  if p_device_id is null then
    select dashboard_session_id into v_dashboard_session
      from merchant.administrative_command
     where merchant_id=p_merchant_id and command_id=p_reveal_session_id
       and actor_user_id=p_operator_id and operation='gift_card.reveal';
    if v_dashboard_session is null then raise exception 'DASHBOARD_COMMAND_CONTEXT_REQUIRED'; end if;
  end if;
  return query
    update merchant.gift_card_secret_delivery d set reveal_attempts=d.reveal_attempts+1,
      reveal_session_id=p_reveal_session_id,revealed_at=clock_timestamp()
    from merchant.loyalty_gift_card g
    where d.merchant_id=p_merchant_id and d.location_id=p_location_id
      and d.token_hash=p_token_hash and d.operator_id=p_operator_id
      and ((p_device_id is not null and d.device_id=p_device_id and d.dashboard_session_id is null)
        or (p_device_id is null and d.device_id is null and d.dashboard_session_id=v_dashboard_session))
      and d.gift_card_id=g.id and g.merchant_id=d.merchant_id and g.status='active'
      and (g.issuance_source<>'sale' or g.activated_by_sale_id is not null)
      and d.acknowledged_at is null and d.expires_at>clock_timestamp() and d.reveal_attempts<3
    returning g.public_reference,d.ciphertext,d.nonce,d.auth_tag,d.expires_at;
end $$;
