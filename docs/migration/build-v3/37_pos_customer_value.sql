-- Gate 3F: merchant customer identity, immutable loyalty, and stored value.
-- Core value effects share the authoritative checkout and refund transaction.

begin;

alter table merchant.pos_cart
  add constraint pos_cart_merchant_id_uk unique (merchant_id,id);
alter table merchant.pos_tender_fact
  drop constraint pos_tender_fact_tender_type_check,
  add constraint pos_tender_fact_tender_type_check
    check (tender_type in ('cash','manual_terminal','wallet','gift_card'));
alter table merchant.pos_payment_attempt
  drop constraint pos_payment_attempt_method_check,
  add constraint pos_payment_attempt_method_check
    check (method in ('cash','external_terminal','stored_value','gift_card'));
alter table merchant.pos_tender_compensation
  drop constraint pos_tender_compensation_tender_type_check,
  add constraint pos_tender_compensation_tender_type_check
    check (tender_type in ('cash','manual_terminal','wallet','gift_card'));

alter table merchant.customer
  add column public_reference text,
  add column status text not null default 'active'
    check (status in ('active','inactive','archived','merged','restricted','anonymized')),
  add column preferred_language text check (preferred_language in ('en','es')),
  add column privacy_state jsonb not null default '{"dataMinimized":true,"contactVisibility":"limited","version":1}'::jsonb,
  add column version integer not null default 1 check (version > 0),
  add column archived_at timestamptz,
  add constraint customer_merchant_id_uk unique (merchant_id,id);
update merchant.customer set public_reference='CUS-'||id::text where public_reference is null;
update merchant.customer set status='inactive' where loyalty_status='inactive';
alter table merchant.customer alter column public_reference set not null;
create unique index customer_public_reference_uidx
  on merchant.customer(merchant_id,public_reference);

-- ── Schema union with build-v3 (merge of architectureUMIposIntegration-v2) ───────────
-- `public_reference` is NOT NULL on four build-v3 tables this file extends (customer,
-- loyalty_reward, loyalty_card, loyalty_gift_card). The one-time UPDATE above backfills
-- the rows that exist at migration time; it says nothing about the next row. build-v3's
-- own writers — the Cash register, the dashboard, the backfill — predate this column
-- and do not set it, so without a default every one of their inserts would fail on a
-- column they never heard of. The reference is derived from the row's own id, exactly
-- as the backfill derives it, so a row gets the same reference whichever path made it.
create or replace function merchant.default_public_reference() returns trigger
language plpgsql set search_path=pg_catalog,merchant as $$
begin
  new.public_reference:=coalesce(new.public_reference,TG_ARGV[0]||new.id::text);
  return new;
end $$;
create trigger customer_public_reference
  before insert on merchant.customer
  for each row execute function merchant.default_public_reference('CUS-');
create index customer_name_search_idx
  on merchant.customer(merchant_id,lower(coalesce(name,'')));

alter table merchant.contact
  add column contact_type text check (contact_type in ('email','phone','other_approved')),
  add column verification_status text not null default 'unverified'
    check (verification_status in (
      'unverified','pending','verified','invalid','suppressed','provider_unavailable'
    )),
  add column version integer not null default 1 check (version > 0),
  add constraint contact_merchant_id_uk unique (merchant_id,id),
  add constraint contact_customer_scope_fk foreign key (merchant_id,customer_id)
    references merchant.customer(merchant_id,id) on delete cascade;
update merchant.contact c set contact_type=case
  when exists(select 1 from umi.channel_type ch where ch.id=c.channel_id and ch.key='email')
    then 'email'
  when exists(select 1 from umi.channel_type ch where ch.id=c.channel_id and ch.key in ('phone','sms','whatsapp'))
    then 'phone'
  else 'other_approved' end;
alter table merchant.contact alter column contact_type set not null;
create index contact_exact_search_idx on merchant.contact(merchant_id,contact_type,normalized_value);
-- Schema union with build-v3: `contact_type` is derived from the channel, exactly as
-- the one-time UPDATE above derives it, for every row build-v3's writers insert without
-- it (the register, the bot's identity resolver, the backfill). Same rule, one place.
create or replace function merchant.default_contact_type() returns trigger
language plpgsql set search_path=pg_catalog,merchant,umi as $$
begin
  if new.contact_type is null then
    select case
             when ch.key='email' then 'email'
             when ch.key in ('phone','sms','whatsapp') then 'phone'
             else 'other_approved' end
      into new.contact_type
      from umi.channel_type ch where ch.id=new.channel_id;
    new.contact_type:=coalesce(new.contact_type,'other_approved');
  end if;
  return new;
end $$;
create trigger contact_default_type
  before insert on merchant.contact
  for each row execute function merchant.default_contact_type();

create table merchant.customer_consent_history (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  customer_id uuid not null,
  consent_type text not null check (consent_type in (
    'receipt_delivery','marketing_email','marketing_sms','loyalty_enrollment',
    'profiling_foundation','terms_acceptance_foundation'
  )),
  status text not null check (status in ('not_requested','granted','denied','revoked','expired')),
  source text not null check (source in ('pos_operator','customer_self_service','migration')),
  policy_version text not null check (length(policy_version) between 1 and 80),
  evidence_reference text check (length(evidence_reference)<=120),
  actor_user_id uuid references umi.user(id) on delete set null,
  command_id uuid not null,
  occurred_at timestamptz not null default clock_timestamp(),
  granted_at timestamptz,
  revoked_at timestamptz,
  foreign key (merchant_id,customer_id)
    references merchant.customer(merchant_id,id) on delete restrict,
  unique (merchant_id,command_id,consent_type)
);
create trigger customer_consent_history_append_only
  before update or delete on merchant.customer_consent_history
  for each row execute function merchant.tg_append_only();

create or replace function merchant.append_customer_consent(
  p_merchant_id uuid,p_customer_id uuid,p_consent_type text,p_status text,
  p_policy_version text,p_actor_user_id uuid,p_command_id uuid
) returns table(
  id uuid,consent_type text,status text,granted_at timestamptz,revoked_at timestamptz,
  source text,policy_version text
) language plpgsql security definer set search_path=pg_catalog,merchant,umi as $$
begin
  perform merchant.assert_customer_value_write_scope(p_merchant_id,null);
  return query insert into merchant.customer_consent_history(
    merchant_id,customer_id,consent_type,status,source,policy_version,actor_user_id,
    command_id,granted_at,revoked_at
  ) values (
    p_merchant_id,p_customer_id,p_consent_type,p_status,'pos_operator',p_policy_version,
    p_actor_user_id,p_command_id,case when p_status='granted' then clock_timestamp() end,null
  ) returning customer_consent_history.id,customer_consent_history.consent_type,
    customer_consent_history.status,customer_consent_history.granted_at,
    customer_consent_history.revoked_at,customer_consent_history.source,
    customer_consent_history.policy_version;
end $$;

create table merchant.customer_consent_current (
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  customer_id uuid not null,
  consent_type text not null,
  history_id uuid not null references merchant.customer_consent_history(id) on delete restrict,
  status text not null check (status in ('not_requested','granted','denied','revoked','expired')),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (merchant_id,customer_id,consent_type),
  foreign key (merchant_id,customer_id)
    references merchant.customer(merchant_id,id) on delete restrict
);

create table merchant.customer_merge_mapping (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  source_customer_id uuid not null,
  target_customer_id uuid not null,
  status text not null check (status in ('preview','value_reconciliation_required','committed')),
  command_id uuid not null,
  command_fingerprint text not null check (command_fingerprint ~ '^[a-f0-9]{64}$'),
  approval_id uuid references runtime.elevation_grant(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  committed_at timestamptz,
  foreign key (merchant_id,source_customer_id)
    references merchant.customer(merchant_id,id) on delete restrict,
  foreign key (merchant_id,target_customer_id)
    references merchant.customer(merchant_id,id) on delete restrict,
  unique (merchant_id,command_id),
  check (source_customer_id<>target_customer_id)
);
comment on table merchant.customer_merge_mapping is
  'A profile merge keeps source history. Value accounts require explicit reconciliation. The most restrictive consent wins.';

alter table merchant.loyalty_program
  add column program_reference text not null default 'default',
  add column enabled boolean not null default false,
  add column points_per_money_unit integer not null default 0 check (points_per_money_unit>=0),
  add column money_unit_minor_units integer not null default 100 check (money_unit_minor_units>0),
  add column points_rounding text not null default 'floor' check (points_rounding in ('floor','half_up')),
  add column earn_timing text not null default 'pending' check (earn_timing in ('immediate','pending')),
  add column redemption_minimum integer not null default 0 check (redemption_minimum>=0),
  add column redemption_maximum integer not null default 0 check (redemption_maximum>=0),
  add column policy_version text not null default 'pilot-deny-v1',
  add column policy_fingerprint text not null default repeat('0',64)
    check (policy_fingerprint ~ '^[a-f0-9]{64}$'),
  add column policy_expires_at timestamptz not null default '2099-01-01T00:00:00Z';

create table merchant.loyalty_points_account (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  customer_id uuid not null,
  program_reference text not null default 'default',
  public_reference text not null check (public_reference ~ '^[A-Za-z0-9._:-]{1,80}$'),
  status text not null default 'active' check (status in (
    'active','suspended','closed','merge_reconciliation_required','restricted'
  )),
  points_scale smallint not null default 0 check (points_scale=0),
  ledger_sequence bigint not null default 0 check (ledger_sequence>=0),
  projection_version integer not null default 1 check (projection_version>0),
  version integer not null default 1 check (version>0),
  enrolled_at timestamptz not null default clock_timestamp(),
  suspended_reason text check (length(suspended_reason)<=160),
  foreign key (merchant_id,customer_id)
    references merchant.customer(merchant_id,id) on delete restrict,
  unique (merchant_id,id),
  unique (merchant_id,customer_id,program_reference),
  unique (merchant_id,public_reference)
);

create table merchant.loyalty_points_ledger (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  customer_id uuid not null,
  account_id uuid not null,
  sequence bigint not null check (sequence>0),
  entry_type text not null check (entry_type in (
    'points_earn_pending','points_earn_committed','points_earn_cancelled','points_earn_reversed','points_authorized',
    'points_released','points_redeemed','points_reversed','points_expired_foundation',
    'manual_points_adjustment'
  )),
  direction text not null check (direction in ('credit','debit','hold','release')),
  points bigint not null check (points>0 and points<=9007199254740991),
  source_aggregate_type text not null check (length(source_aggregate_type) between 1 and 80),
  source_aggregate_id uuid not null,
  sale_id uuid,
  refund_id uuid,
  reward_id uuid,
  authorization_id uuid,
  operator_id uuid references umi.user(id) on delete restrict,
  device_id uuid references merchant.device(id) on delete restrict,
  command_id uuid not null,
  idempotency_key uuid not null,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  business_date date not null,
  occurred_at timestamptz not null default clock_timestamp(),
  audit_reference text,
  foreign key (merchant_id,customer_id)
    references merchant.customer(merchant_id,id) on delete restrict,
  foreign key (merchant_id,account_id)
    references merchant.loyalty_points_account(merchant_id,id) on delete restrict,
  foreign key (merchant_id,sale_id)
    references merchant.pos_committed_sale(merchant_id,id) on delete restrict,
  unique (merchant_id,account_id,sequence),
  unique (merchant_id,idempotency_key,account_id,entry_type,source_aggregate_id)
);
create index loyalty_points_source_idx
  on merchant.loyalty_points_ledger(merchant_id,source_aggregate_type,source_aggregate_id);
create trigger loyalty_points_ledger_append_only
  before update or delete on merchant.loyalty_points_ledger
  for each row execute function merchant.tg_append_only();
comment on table merchant.loyalty_points_ledger is
  'Append-only loyalty facts. The balance projection is rebuildable from these facts.';

create table merchant.loyalty_points_balance (
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  customer_id uuid not null,
  account_id uuid not null,
  pending bigint not null default 0 check (pending>=0),
  available bigint not null default 0 check (available>=0),
  authorized bigint not null default 0 check (authorized>=0),
  redeemed bigint not null default 0 check (redeemed>=0),
  reversed bigint not null default 0 check (reversed>=0),
  expired bigint not null default 0 check (expired>=0),
  adjusted bigint not null default 0,
  ledger_sequence bigint not null default 0 check (ledger_sequence>=0),
  projection_version integer not null default 1 check (projection_version>0),
  calculated_at timestamptz not null default clock_timestamp(),
  primary key (account_id),
  foreign key (merchant_id,customer_id)
    references merchant.customer(merchant_id,id) on delete restrict,
  foreign key (merchant_id,account_id)
    references merchant.loyalty_points_account(merchant_id,id) on delete restrict
);

alter table merchant.loyalty_reward
  add column public_reference text,
  add column points_cost integer not null default 0 check (points_cost>=0),
  add column reward_type text not null default 'operational_benefit_foundation'
    check (reward_type in (
      'fixed_discount','percentage_discount','free_eligible_item','points_to_value',
      'operational_benefit_foundation'
    )),
  add column valid_from timestamptz not null default clock_timestamp(),
  add column valid_until timestamptz,
  add column eligibility_policy jsonb not null default '{}'::jsonb,
  add column combinability_policy text not null default 'exclusive'
    check (combinability_policy in ('exclusive','explicit_stack')),
  add column version integer not null default 1 check (version>0),
  add constraint loyalty_reward_merchant_id_uk unique (merchant_id,id);
update merchant.loyalty_reward set public_reference='REW-'||id::text where public_reference is null;
alter table merchant.loyalty_reward alter column public_reference set not null;
create unique index loyalty_reward_reference_uidx
  on merchant.loyalty_reward(merchant_id,public_reference);
create trigger loyalty_reward_public_reference
  before insert on merchant.loyalty_reward
  for each row execute function merchant.default_public_reference('REW-');

alter table merchant.loyalty_card
  add column public_reference text,
  add column currency char(3) not null default 'MXN' check (currency ~ '^[A-Z]{3}$'),
  add column ledger_sequence bigint not null default 0 check (ledger_sequence>=0),
  add column projection_version integer not null default 1 check (projection_version>0),
  add column version integer not null default 1 check (version>0),
  add constraint loyalty_card_merchant_id_uk unique (merchant_id,id),
  add constraint loyalty_card_customer_scope_fk foreign key (merchant_id,customer_id)
    references merchant.customer(merchant_id,id) on delete restrict;
update merchant.loyalty_card set public_reference='WAL-'||id::text where public_reference is null;
alter table merchant.loyalty_card alter column public_reference set not null;
create unique index loyalty_card_reference_uidx
  on merchant.loyalty_card(merchant_id,public_reference);
create trigger loyalty_card_public_reference
  before insert on merchant.loyalty_card
  for each row execute function merchant.default_public_reference('WAL-');

alter table merchant.loyalty_stored_value_ledger disable trigger stored_value_ledger_append_only;
alter table merchant.loyalty_stored_value_ledger
  drop constraint loyalty_stored_value_ledger_reason_check,
  add column sequence bigint,
  add column entry_type text,
  add column amount_minor_units bigint check (amount_minor_units>=0 and amount_minor_units<=9007199254740991),
  add column currency char(3) not null default 'MXN' check (currency ~ '^[A-Z]{3}$'),
  add column direction text check (direction in ('credit','debit','hold','release')),
  add column authorization_id uuid,
  add column refund_id uuid,
  add column command_id uuid,
  add column fingerprint text,
  add column operator_id uuid references umi.user(id) on delete restrict,
  add column device_id uuid references merchant.device(id) on delete restrict,
  add column business_date date,
  add column source_type text,
  add column source_id text,
  add column description text,
  add constraint loyalty_stored_value_reason_check check (reason in (
    'migration_initial_balance','topup','purchase','adjustment','gift_card_redeem','refund',
    'issued','loaded','authorized','authorization_released','redeemed','refunded','reversed',
    'adjustment_increase','adjustment_decrease'
  ));
with ranked as (
  select id,row_number() over(partition by merchant_id,card_id order by occurred_at,id) sequence
  from merchant.loyalty_stored_value_ledger
) update merchant.loyalty_stored_value_ledger l set
  sequence=r.sequence,
  entry_type=case when delta>=0 then 'loaded' else 'redeemed' end,
  amount_minor_units=abs(delta),
  direction=case when delta>=0 then 'credit' else 'debit' end,
  command_id=case
    when l.idempotency_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then l.idempotency_key::uuid
    else md5(coalesce(l.idempotency_key,l.id::text))::uuid end,
  fingerprint=encode(extensions.digest(l.id::text,'sha256'),'hex'),
  business_date=l.occurred_at::date
from ranked r where r.id=l.id;
alter table merchant.loyalty_stored_value_ledger
  alter column sequence set not null,
  alter column entry_type set not null,
  alter column amount_minor_units set not null,
  alter column direction set not null,
  alter column command_id set not null,
  alter column fingerprint set not null,
  alter column business_date set not null,
  add constraint stored_value_sequence_uk unique (merchant_id,card_id,sequence),
  add constraint stored_value_command_type_uk unique (merchant_id,command_id,card_id,entry_type),
  add constraint stored_value_fingerprint_ck check (fingerprint ~ '^[a-f0-9]{64}$');
alter table merchant.loyalty_stored_value_ledger enable trigger stored_value_ledger_append_only;

create or replace function merchant.prepare_stored_value_fact() returns trigger
language plpgsql set search_path=pg_catalog,merchant,extensions as $$
declare v_next bigint;
begin
  perform 1 from merchant.loyalty_card where id=new.card_id and merchant_id=new.merchant_id for update;
  if not found then raise exception 'STORED_VALUE_ACCOUNT_SCOPE'; end if;
  select coalesce(max(sequence),0)+1 into v_next from merchant.loyalty_stored_value_ledger
    where merchant_id=new.merchant_id and card_id=new.card_id;
  new.sequence:=v_next;
  new.entry_type:=coalesce(new.entry_type,case
    when new.reason in ('purchase','redeem','redeemed') or new.delta<0 then 'redeemed'
    when new.reason in ('refund','refunded') then 'refunded'
    when new.reason in ('migration_initial_balance','issued') then 'issued'
    else 'loaded' end);
  new.amount_minor_units:=coalesce(new.amount_minor_units,abs(new.delta));
  new.direction:=coalesce(new.direction,case when new.delta>=0 then 'credit' else 'debit' end);
  new.command_id:=coalesce(new.command_id,md5(coalesce(new.idempotency_key,new.id::text))::uuid);
  new.fingerprint:=coalesce(new.fingerprint,encode(extensions.digest(new.command_id::text,'sha256'),'hex'));
  new.business_date:=coalesce(new.business_date,new.occurred_at::date,current_date);
  update merchant.loyalty_card set ledger_sequence=v_next,projection_version=projection_version+1,
    version=version+1 where id=new.card_id;
  return new;
end $$;
create trigger loyalty_stored_value_prepare
  before insert on merchant.loyalty_stored_value_ledger
  for each row execute function merchant.prepare_stored_value_fact();

create table merchant.loyalty_stored_value_balance (
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  card_id uuid primary key,
  customer_id uuid not null,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  issued bigint not null default 0 check (issued>=0),
  loaded bigint not null default 0 check (loaded>=0),
  available bigint not null default 0 check (available>=0),
  authorized bigint not null default 0 check (authorized>=0),
  redeemed bigint not null default 0 check (redeemed>=0),
  refunded bigint not null default 0 check (refunded>=0),
  reversed bigint not null default 0 check (reversed>=0),
  adjusted bigint not null default 0,
  ledger_sequence bigint not null default 0 check (ledger_sequence>=0),
  projection_version integer not null default 1 check (projection_version>0),
  calculated_at timestamptz not null default clock_timestamp(),
  foreign key (merchant_id,card_id)
    references merchant.loyalty_card(merchant_id,id) on delete restrict,
  foreign key (merchant_id,customer_id)
    references merchant.customer(merchant_id,id) on delete restrict
);

insert into merchant.loyalty_stored_value_balance(
  merchant_id,card_id,customer_id,currency,issued,loaded,available,redeemed,refunded,
  reversed,adjusted,ledger_sequence
)
select c.merchant_id,c.id,c.customer_id,c.currency,
  coalesce(sum(l.amount_minor_units) filter(where l.entry_type='issued'),0),
  coalesce(sum(l.amount_minor_units) filter(where l.entry_type='loaded'),0),
  coalesce(sum(l.delta),0),
  coalesce(sum(l.amount_minor_units) filter(where l.entry_type='redeemed'),0),
  coalesce(sum(l.amount_minor_units) filter(where l.entry_type='refunded'),0),
  coalesce(sum(l.amount_minor_units) filter(where l.entry_type='reversed'),0),
  coalesce(sum(case when l.entry_type='adjustment_increase' then l.amount_minor_units
    when l.entry_type='adjustment_decrease' then -l.amount_minor_units else 0 end),0),
  coalesce(max(l.sequence),0)
from merchant.loyalty_card c left join merchant.loyalty_stored_value_ledger l on l.card_id=c.id
group by c.id;

-- ── Schema union with build-v3 (merge of architectureUMIposIntegration-v2) ───────────
-- build-v3 (#127/#128) already reshaped this table: no clear `code` column, `code_hash`
-- bytea NOT NULL, `masked_code` CHECKed, sender/recipient/redeemed columns, a composite
-- staff FK, UNIQUE (merchant_id, id) and UNIQUE (merchant_id, code_hash). That model is
-- the authority; this block is ADDITIVE on top of it. The original migration here
-- rewrote a plaintext `code` into a digest and swapped a status CHECK — both against
-- columns build-v3 never had. Those statements are gone, not disabled.
alter table merchant.loyalty_gift_card
  add column public_reference text,
  -- POS lifecycle. build-v3 cards are born active; POS may issue 'inactive' (sale-funded).
  add column status text not null default 'active' check (status in (
    'created','inactive','active','suspended','depleted','expired','closed','restricted','redeemed','void'
  )),
  add column currency char(3) not null default 'MXN' check (currency ~ '^[A-Z]{3}$'),
  add column ledger_sequence bigint not null default 0 check (ledger_sequence>=0),
  add column projection_version integer not null default 1 check (projection_version>0),
  add column version integer not null default 1 check (version>0),
  add column activated_at timestamptz,
  add column suspended_at timestamptz,
  add column closed_at timestamptz,
  add column customer_id uuid,
  add constraint gift_card_customer_scope_fk foreign key (merchant_id,customer_id)
    references merchant.customer(merchant_id,id) on delete restrict;
update merchant.loyalty_gift_card set public_reference='GFT-'||id::text
  where public_reference is null;
alter table merchant.loyalty_gift_card alter column public_reference set not null;
-- (merchant_id, code_hash) is already UNIQUE on build-v3; only the reference index is new.
create unique index loyalty_gift_card_reference_uidx
  on merchant.loyalty_gift_card(merchant_id,public_reference);

-- No code-hashing trigger. There is no `code` column to hash: the writer computes
-- `code_hash` and `masked_code` itself, exactly as the Cash register does
-- (cash-write.repository.ts). Only `public_reference` defaults, like the other three.
create trigger loyalty_gift_card_public_reference
  before insert on merchant.loyalty_gift_card
  for each row execute function merchant.default_public_reference('GFT-');

alter table merchant.loyalty_gift_card_ledger disable trigger gift_card_ledger_append_only;
alter table merchant.loyalty_gift_card_ledger
  drop constraint loyalty_gift_card_ledger_reason_check,
  add column sequence bigint,
  add column entry_type text,
  add column amount_minor_units bigint check (amount_minor_units>=0 and amount_minor_units<=9007199254740991),
  add column currency char(3) not null default 'MXN' check (currency ~ '^[A-Z]{3}$'),
  add column direction text check (direction in ('credit','debit','hold','release')),
  add column authorization_id uuid,
  add column sale_id uuid,
  add column refund_id uuid,
  add column command_id uuid,
  -- build-v3's ledger already carries idempotency_key (NOT NULL, UNIQUE per merchant),
  -- source_type and source_id; they are not re-added here.
  add column fingerprint text,
  add column operator_id uuid references umi.user(id) on delete restrict,
  add column device_id uuid references merchant.device(id) on delete restrict,
  add column business_date date,
  -- Superset of build-v3's list. `gift_card_redeem` is the frozen source's legacy writer
  -- value and MUST survive: the final replay writes it (20_merchant.sql, ledger comment).
  add constraint gift_card_ledger_reason_check check (reason in (
    'issue','redeem','gift_card_redeem','adjustment','migration_initial_load','load','expire',
    'issued','loaded','authorized','authorization_released','redeemed','refunded','reversed',
    'adjustment_increase','adjustment_decrease'
  ));
with ranked as (
  select id,row_number() over(partition by merchant_id,gift_card_id order by occurred_at,id) sequence
  from merchant.loyalty_gift_card_ledger
) update merchant.loyalty_gift_card_ledger l set
  sequence=r.sequence,
  entry_type=case when delta>=0 then 'issued' else 'redeemed' end,
  amount_minor_units=abs(delta),
  direction=case when delta>=0 then 'credit' else 'debit' end,
  command_id=l.id,
  idempotency_key=coalesce(l.idempotency_key,l.id::text),
  fingerprint=encode(extensions.digest(l.id::text,'sha256'),'hex'),
  business_date=l.occurred_at::date
from ranked r where r.id=l.id;
alter table merchant.loyalty_gift_card_ledger
  alter column sequence set not null,
  alter column entry_type set not null,
  alter column amount_minor_units set not null,
  alter column direction set not null,
  alter column command_id set not null,
  alter column idempotency_key set not null,
  alter column fingerprint set not null,
  alter column business_date set not null,
  add constraint gift_card_sequence_uk unique (merchant_id,gift_card_id,sequence),
  add constraint gift_card_command_type_uk unique (merchant_id,command_id,gift_card_id,entry_type),
  add constraint gift_card_fingerprint_ck check (fingerprint ~ '^[a-f0-9]{64}$');
alter table merchant.loyalty_gift_card_ledger enable trigger gift_card_ledger_append_only;

create or replace function merchant.prepare_gift_card_fact() returns trigger
language plpgsql set search_path=pg_catalog,merchant,extensions as $$
declare v_next bigint;
begin
  perform 1 from merchant.loyalty_gift_card where id=new.gift_card_id and merchant_id=new.merchant_id for update;
  if not found then raise exception 'GIFT_CARD_ACCOUNT_SCOPE'; end if;
  select coalesce(max(sequence),0)+1 into v_next from merchant.loyalty_gift_card_ledger
    where merchant_id=new.merchant_id and gift_card_id=new.gift_card_id;
  new.sequence:=v_next;
  new.entry_type:=coalesce(new.entry_type,case
    when new.reason in ('redeem','redeemed') or new.delta<0 then 'redeemed'
    when new.reason in ('refund','refunded') then 'refunded'
    when new.reason in ('issue','load','issued') then 'issued'
    else 'loaded' end);
  new.amount_minor_units:=coalesce(new.amount_minor_units,abs(new.delta));
  new.direction:=coalesce(new.direction,case when new.delta>=0 then 'credit' else 'debit' end);
  new.idempotency_key:=coalesce(new.idempotency_key,new.id::text);
  new.command_id:=coalesce(new.command_id,md5(new.idempotency_key)::uuid);
  new.fingerprint:=coalesce(new.fingerprint,encode(extensions.digest(new.command_id::text,'sha256'),'hex'));
  new.business_date:=coalesce(new.business_date,new.occurred_at::date,current_date);
  update merchant.loyalty_gift_card set ledger_sequence=v_next,
    projection_version=projection_version+1,version=version+1 where id=new.gift_card_id;
  return new;
end $$;
create trigger loyalty_gift_card_ledger_prepare
  before insert on merchant.loyalty_gift_card_ledger
  for each row execute function merchant.prepare_gift_card_fact();

create or replace function merchant.assert_customer_value_write_scope(
  p_merchant_id uuid,p_device_id uuid default null
) returns void language plpgsql security definer set search_path=pg_catalog,umi as $$
declare v_api boolean; v_scoped_role boolean;
begin
  v_api:=current_setting('role',true)='api' or (
    not coalesce((select rolsuper from pg_roles where rolname=session_user),false)
    and pg_has_role(session_user,'api','USAGE')
  );
  v_scoped_role:=v_api or current_setting('role',true)='worker' or (
    not coalesce((select rolsuper from pg_roles where rolname=session_user),false)
    and pg_has_role(session_user,'worker','USAGE')
  );
  if v_scoped_role and umi.current_merchant() is null
  then raise exception 'CUSTOMER_VALUE_CONTEXT_REQUIRED'; end if;
  if umi.current_merchant() is not null
     and p_merchant_id is distinct from umi.current_merchant()
  then raise exception 'CUSTOMER_VALUE_MERCHANT_SCOPE'; end if;
  if v_api and p_device_id is not null and umi.current_device() is null
  then raise exception 'CUSTOMER_VALUE_DEVICE_CONTEXT_REQUIRED'; end if;
  if umi.current_device() is not null and p_device_id is not null
     and p_device_id is distinct from umi.current_device()
  then raise exception 'CUSTOMER_VALUE_DEVICE_SCOPE'; end if;
end $$;

create or replace function merchant.append_stored_value_fact(
  p_merchant_id uuid,p_card_id uuid,p_fact jsonb
) returns uuid language plpgsql security definer
set search_path=pg_catalog,merchant,umi as $$
declare v_id uuid; v_fingerprint text;
begin
  perform merchant.assert_customer_value_write_scope(
    p_merchant_id,nullif(p_fact->>'deviceId','')::uuid
  );
  insert into merchant.loyalty_stored_value_ledger(
    merchant_id,card_id,staff_id,delta,amount_minor_units,reason,external_ref,idempotency_key,order_id,
    occurred_at,entry_type,currency,direction,authorization_id,refund_id,command_id,
    fingerprint,operator_id,device_id,business_date,source_type,source_id,description
  ) values (
    p_merchant_id,p_card_id,nullif(p_fact->>'staffId','')::uuid,(p_fact->>'delta')::bigint,
    coalesce((p_fact->>'amountMinorUnits')::bigint,abs((p_fact->>'delta')::bigint)),
    p_fact->>'reason',nullif(p_fact->>'externalRef',''),p_fact->>'idempotencyKey',
    nullif(p_fact->>'orderId','')::uuid,
    coalesce(nullif(p_fact->>'occurredAt','')::timestamptz,clock_timestamp()),
    p_fact->>'entryType',coalesce(p_fact->>'currency','MXN'),p_fact->>'direction',
    nullif(p_fact->>'authorizationId','')::uuid,nullif(p_fact->>'refundId','')::uuid,
    nullif(p_fact->>'commandId','')::uuid,p_fact->>'fingerprint',
    nullif(p_fact->>'operatorId','')::uuid,nullif(p_fact->>'deviceId','')::uuid,
    nullif(p_fact->>'businessDate','')::date,p_fact->>'sourceType',p_fact->>'sourceId',
    nullif(p_fact->>'description','')
  ) returning id into v_id;
  return v_id;
exception when unique_violation then
  select id,fingerprint into v_id,v_fingerprint
    from merchant.loyalty_stored_value_ledger
    where merchant_id=p_merchant_id and card_id=p_card_id
      and (idempotency_key=p_fact->>'idempotencyKey'
        or command_id=nullif(p_fact->>'commandId','')::uuid)
    order by created_at desc limit 1;
  if v_id is null or (p_fact ? 'fingerprint' and v_fingerprint<>p_fact->>'fingerprint')
  then raise exception 'IDEMPOTENCY_FINGERPRINT_CONFLICT'; end if;
  return v_id;
end $$;

create or replace function merchant.append_gift_card_fact(
  p_merchant_id uuid,p_gift_card_id uuid,p_fact jsonb
) returns uuid language plpgsql security definer
set search_path=pg_catalog,merchant,umi as $$
declare v_id uuid; v_fingerprint text;
begin
  perform merchant.assert_customer_value_write_scope(
    p_merchant_id,nullif(p_fact->>'deviceId','')::uuid
  );
  insert into merchant.loyalty_gift_card_ledger(
    merchant_id,gift_card_id,delta,amount_minor_units,reason,occurred_at,entry_type,
    currency,direction,authorization_id,sale_id,refund_id,command_id,idempotency_key,
    fingerprint,operator_id,device_id,business_date,source_type,source_id
  ) values (
    p_merchant_id,p_gift_card_id,(p_fact->>'delta')::bigint,
    coalesce((p_fact->>'amountMinorUnits')::bigint,abs((p_fact->>'delta')::bigint)),p_fact->>'reason',
    coalesce(nullif(p_fact->>'occurredAt','')::timestamptz,clock_timestamp()),
    p_fact->>'entryType',coalesce(p_fact->>'currency','MXN'),p_fact->>'direction',
    nullif(p_fact->>'authorizationId','')::uuid,nullif(p_fact->>'saleId','')::uuid,
    nullif(p_fact->>'refundId','')::uuid,nullif(p_fact->>'commandId','')::uuid,
    p_fact->>'idempotencyKey',p_fact->>'fingerprint',
    nullif(p_fact->>'operatorId','')::uuid,nullif(p_fact->>'deviceId','')::uuid,
    nullif(p_fact->>'businessDate','')::date,p_fact->>'sourceType',p_fact->>'sourceId'
  ) returning id into v_id;
  return v_id;
exception when unique_violation then
  select id,fingerprint into v_id,v_fingerprint
    from merchant.loyalty_gift_card_ledger
    where merchant_id=p_merchant_id and gift_card_id=p_gift_card_id
      and (idempotency_key=p_fact->>'idempotencyKey'
        or command_id=nullif(p_fact->>'commandId','')::uuid)
    order by occurred_at desc limit 1;
  if v_id is null or (p_fact ? 'fingerprint' and v_fingerprint<>p_fact->>'fingerprint')
  then raise exception 'IDEMPOTENCY_FINGERPRINT_CONFLICT'; end if;
  return v_id;
end $$;

create table merchant.loyalty_gift_card_balance (
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  gift_card_id uuid primary key,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  available bigint not null default 0 check (available>=0),
  authorized bigint not null default 0 check (authorized>=0),
  redeemed bigint not null default 0 check (redeemed>=0),
  refunded bigint not null default 0 check (refunded>=0),
  ledger_sequence bigint not null default 0 check (ledger_sequence>=0),
  projection_version integer not null default 1 check (projection_version>0),
  calculated_at timestamptz not null default clock_timestamp(),
  foreign key (merchant_id,gift_card_id)
    references merchant.loyalty_gift_card(merchant_id,id) on delete restrict
);

insert into merchant.loyalty_gift_card_balance(
  merchant_id,gift_card_id,currency,available,redeemed,refunded,ledger_sequence
)
select g.merchant_id,g.id,g.currency,coalesce(sum(l.delta),0),
  coalesce(sum(l.amount_minor_units) filter(where l.entry_type='redeemed'),0),
  coalesce(sum(l.amount_minor_units) filter(where l.entry_type='refunded'),0),
  coalesce(max(l.sequence),0)
from merchant.loyalty_gift_card g left join merchant.loyalty_gift_card_ledger l on l.gift_card_id=g.id
group by g.id;

create or replace function merchant.project_customer_value_fact() returns trigger
language plpgsql set search_path=pg_catalog,merchant as $$
begin
  if tg_table_name='loyalty_stored_value_ledger' then
    if new.delta<0 and not exists(
      select 1 from merchant.loyalty_stored_value_balance where card_id=new.card_id
    ) then raise exception 'STORED_VALUE_PROJECTION_MISSING'; end if;
    insert into merchant.loyalty_stored_value_balance(
      merchant_id,card_id,customer_id,currency,available,ledger_sequence
    ) select new.merchant_id,new.card_id,c.customer_id,new.currency,greatest(new.delta,0),new.sequence
      from merchant.loyalty_card c where c.id=new.card_id
    on conflict(card_id) do update set
      available=merchant.loyalty_stored_value_balance.available+case
        when new.entry_type='authorized' then -new.amount_minor_units
        when new.entry_type='authorization_released' then new.amount_minor_units
        when new.entry_type='redeemed' and new.authorization_id is not null then 0
        else new.delta end,
      authorized=merchant.loyalty_stored_value_balance.authorized+case
        when new.entry_type='authorized' then new.amount_minor_units
        when new.entry_type in ('authorization_released','redeemed') and new.authorization_id is not null
          then -new.amount_minor_units else 0 end,
      issued=merchant.loyalty_stored_value_balance.issued+case when new.entry_type='issued' then new.amount_minor_units else 0 end,
      loaded=merchant.loyalty_stored_value_balance.loaded+case when new.entry_type='loaded' then new.amount_minor_units else 0 end,
      redeemed=merchant.loyalty_stored_value_balance.redeemed+case when new.entry_type='redeemed' then new.amount_minor_units else 0 end,
      refunded=merchant.loyalty_stored_value_balance.refunded+case when new.entry_type='refunded' then new.amount_minor_units else 0 end,
      reversed=merchant.loyalty_stored_value_balance.reversed+case when new.entry_type='reversed' then new.amount_minor_units else 0 end,
      adjusted=merchant.loyalty_stored_value_balance.adjusted+case when new.entry_type='adjustment_increase' then new.amount_minor_units when new.entry_type='adjustment_decrease' then -new.amount_minor_units else 0 end,
      ledger_sequence=new.sequence,projection_version=merchant.loyalty_stored_value_balance.projection_version+1,
      calculated_at=clock_timestamp();
  else
    if new.delta<0 and not exists(
      select 1 from merchant.loyalty_gift_card_balance where gift_card_id=new.gift_card_id
    ) then raise exception 'GIFT_CARD_PROJECTION_MISSING'; end if;
    insert into merchant.loyalty_gift_card_balance(
      merchant_id,gift_card_id,currency,available,ledger_sequence
    ) values(new.merchant_id,new.gift_card_id,new.currency,greatest(new.delta,0),new.sequence)
    on conflict(gift_card_id) do update set
      available=merchant.loyalty_gift_card_balance.available+case
        when new.entry_type='authorized' then -new.amount_minor_units
        when new.entry_type='authorization_released' then new.amount_minor_units
        when new.entry_type='redeemed' and new.authorization_id is not null then 0
        else new.delta end,
      authorized=merchant.loyalty_gift_card_balance.authorized+case
        when new.entry_type='authorized' then new.amount_minor_units
        when new.entry_type in ('authorization_released','redeemed') and new.authorization_id is not null
          then -new.amount_minor_units else 0 end,
      redeemed=merchant.loyalty_gift_card_balance.redeemed+case when new.entry_type='redeemed' then new.amount_minor_units else 0 end,
      refunded=merchant.loyalty_gift_card_balance.refunded+case when new.entry_type='refunded' then new.amount_minor_units else 0 end,
      ledger_sequence=new.sequence,projection_version=merchant.loyalty_gift_card_balance.projection_version+1,
      calculated_at=clock_timestamp();
  end if;
  return new;
end $$;
create trigger loyalty_stored_value_project after insert on merchant.loyalty_stored_value_ledger
  for each row execute function merchant.project_customer_value_fact();
create trigger loyalty_gift_card_project after insert on merchant.loyalty_gift_card_ledger
  for each row execute function merchant.project_customer_value_fact();

create table merchant.customer_value_authorization (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  account_type text not null check (account_type in ('loyalty_reward','wallet','gift_card')),
  account_id uuid not null,
  customer_id uuid,
  reward_id uuid,
  sale_id uuid not null,
  checkout_version integer not null check (checkout_version>0),
  points bigint check (points is null or points>0),
  benefit_minor_units bigint check (benefit_minor_units is null or benefit_minor_units>0),
  amount_minor_units bigint check (amount_minor_units is null or amount_minor_units>0),
  currency char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  checkout_fingerprint text not null check (checkout_fingerprint ~ '^[a-f0-9]{64}$'),
  policy_version text not null check (length(policy_version) between 1 and 80),
  reward_version integer,
  command_id uuid not null,
  idempotency_key uuid not null,
  command_fingerprint text not null check (command_fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('authorized','committed','released','expired','declined','conflict','reversed')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  committed_at timestamptz,
  released_at timestamptz,
  correlation_id text not null,
  foreign key (merchant_id,customer_id)
    references merchant.customer(merchant_id,id) on delete restrict,
  foreign key (merchant_id,reward_id)
    references merchant.loyalty_reward(merchant_id,id) on delete restrict,
  foreign key (merchant_id,sale_id)
    references merchant.pos_cart(merchant_id,id) on delete restrict,
  unique (merchant_id,command_id),
  unique (merchant_id,idempotency_key),
  check (
    (account_type='loyalty_reward' and points is not null and benefit_minor_units is not null
      and amount_minor_units is null and reward_id is not null) or
    (account_type in ('wallet','gift_card') and amount_minor_units is not null
      and points is null and benefit_minor_units is null)
  )
);
create unique index customer_value_active_allocation_uidx
  on merchant.customer_value_authorization(merchant_id,account_type,account_id,sale_id)
  where status='authorized';
create index customer_value_authorization_expiry_idx
  on merchant.customer_value_authorization(merchant_id,location_id,expires_at)
  where status='authorized';

create or replace function merchant.append_loyalty_points(
  p_merchant_id uuid,p_customer_id uuid,p_account_id uuid,p_entry_type text,
  p_direction text,p_points bigint,p_source_type text,p_source_id uuid,p_sale_id uuid,
  p_refund_id uuid,p_reward_id uuid,p_authorization_id uuid,p_operator_id uuid,p_device_id uuid,
  p_command_id uuid,p_idempotency_key uuid,p_fingerprint text,p_business_date date
) returns uuid
language plpgsql security definer set search_path=pg_catalog,merchant,umi as $$
declare v_sequence bigint; v_id uuid; v_available bigint; v_authorized bigint;
begin
  perform merchant.assert_customer_value_write_scope(p_merchant_id,p_device_id);
  if p_points<=0 then raise exception 'LOYALTY_POINTS_INVALID'; end if;
  select ledger_sequence+1 into v_sequence from merchant.loyalty_points_account
   where id=p_account_id and merchant_id=p_merchant_id and customer_id=p_customer_id
     and status='active' for update;
  if not found then raise exception 'LOYALTY_ACCOUNT_UNAVAILABLE'; end if;
  insert into merchant.loyalty_points_balance(merchant_id,customer_id,account_id)
    values(p_merchant_id,p_customer_id,p_account_id) on conflict(account_id) do nothing;
  select available,authorized into v_available,v_authorized
    from merchant.loyalty_points_balance where account_id=p_account_id for update;
  if p_entry_type in ('points_authorized','manual_points_adjustment') and p_direction in ('hold','debit')
     and v_available<p_points then raise exception 'LOYALTY_INSUFFICIENT_POINTS'; end if;
  if p_direction='release' and v_authorized<p_points then raise exception 'LOYALTY_RELEASE_EXCEEDS_AUTHORIZATION'; end if;
  insert into merchant.loyalty_points_ledger(
    merchant_id,customer_id,account_id,sequence,entry_type,direction,points,
    source_aggregate_type,source_aggregate_id,sale_id,refund_id,reward_id,authorization_id,
    operator_id,device_id,command_id,idempotency_key,fingerprint,business_date
  ) values (
    p_merchant_id,p_customer_id,p_account_id,v_sequence,p_entry_type,p_direction,p_points,
    p_source_type,p_source_id,p_sale_id,p_refund_id,p_reward_id,p_authorization_id,
    p_operator_id,p_device_id,p_command_id,p_idempotency_key,p_fingerprint,p_business_date
  ) returning id into v_id;
  update merchant.loyalty_points_balance set
    pending=pending+case when p_entry_type='points_earn_pending' then p_points when p_entry_type='points_earn_cancelled' then -p_points else 0 end,
    available=available+case
      when p_entry_type in ('points_earn_pending','points_earn_cancelled') then 0
      when p_entry_type='points_redeemed' and p_authorization_id is not null then 0
      when p_direction='credit' then p_points when p_direction in ('debit','hold') then -p_points
      when p_direction='release' then p_points else 0 end,
    authorized=authorized+case
      when p_entry_type='points_earn_pending' then 0
      when p_direction='hold' then p_points
      when p_direction in ('release','debit') and p_authorization_id is not null then -p_points else 0 end,
    redeemed=redeemed+case when p_entry_type='points_redeemed' then p_points else 0 end,
    reversed=reversed+case when p_entry_type='points_reversed' then p_points else 0 end,
    adjusted=adjusted+case when p_entry_type='manual_points_adjustment' and p_direction='credit' then p_points when p_entry_type='manual_points_adjustment' then -p_points else 0 end,
    ledger_sequence=v_sequence,projection_version=projection_version+1,calculated_at=clock_timestamp()
  where account_id=p_account_id;
  update merchant.loyalty_points_account set ledger_sequence=v_sequence,
    projection_version=projection_version+1,version=version+1 where id=p_account_id;
  return v_id;
end $$;

create or replace function merchant.commit_customer_value(
  p_merchant_id uuid,p_location_id uuid,p_cart_id uuid,p_sale_id uuid,p_order_id uuid,
  p_customer_id uuid,p_command_id uuid,p_idempotency_key uuid,p_checkout_fingerprint text,
  p_business_date date,p_operator_id uuid,p_device_id uuid,p_selection jsonb
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,merchant,umi as $$
declare v_account merchant.loyalty_points_account%rowtype; v_policy merchant.loyalty_program%rowtype;
  v_points bigint:=0; v_auth record; v_total bigint; v_currency text; v_entry uuid;
  v_ledger record; v_balance record; v_benefit bigint; v_remaining bigint; v_committed_at timestamptz;
  v_result jsonb:='{"earn":null,"reward":null,"storedValue":[]}'::jsonb;
begin
  perform merchant.assert_customer_value_write_scope(p_merchant_id,p_device_id);
  if p_customer_id is null then return v_result; end if;
  perform 1 from merchant.customer where id=p_customer_id and merchant_id=p_merchant_id
    and status='active' and merged_into_id is null for update;
  if not found then raise exception 'CUSTOMER_MERCHANT_SCOPE'; end if;
  select r.grand_total,r.currency into v_total,v_currency from merchant.pos_committed_sale s
    join merchant.receipt_snapshot r on r.id=s.receipt_snapshot_id
   where s.id=p_sale_id and s.merchant_id=p_merchant_id and s.location_id=p_location_id;
  select * into v_account from merchant.loyalty_points_account
    where merchant_id=p_merchant_id and customer_id=p_customer_id and status='active'
    order by id limit 1 for update;
  select * into v_policy from merchant.loyalty_program where merchant_id=p_merchant_id;
  if v_account.id is not null and v_policy.enabled and v_policy.policy_expires_at>clock_timestamp() then
    v_points:=case when v_policy.points_rounding='half_up'
      then (v_total*v_policy.points_per_money_unit+v_policy.money_unit_minor_units/2)/v_policy.money_unit_minor_units
      else (v_total*v_policy.points_per_money_unit)/v_policy.money_unit_minor_units end;
    if v_points>0 then
      v_entry:=merchant.append_loyalty_points(p_merchant_id,p_customer_id,v_account.id,
        case when v_policy.earn_timing='pending' then 'points_earn_pending' else 'points_earn_committed' end,
        case when v_policy.earn_timing='pending' then 'hold' else 'credit' end,
        v_points,'pos_sale',p_sale_id,p_sale_id,null,null,null,p_operator_id,p_device_id,
        p_command_id,p_idempotency_key,p_checkout_fingerprint,p_business_date);
      select * into v_ledger from merchant.loyalty_points_ledger where id=v_entry;
      select * into v_balance from merchant.loyalty_points_balance where account_id=v_account.id;
      v_result:=jsonb_set(v_result,'{earn}',jsonb_build_object(
        'ledgerEntry',jsonb_build_object('id',v_ledger.id,'accountId',v_ledger.account_id,
          'customerId',v_ledger.customer_id,'sequence',v_ledger.sequence,
          'type',v_ledger.entry_type,'points',v_ledger.points,'direction',v_ledger.direction,
          'saleId',v_ledger.sale_id,'refundId',v_ledger.refund_id,'rewardId',v_ledger.reward_id,
          'commandId',v_ledger.command_id,'businessDate',v_ledger.business_date,
          'occurredAt',v_ledger.occurred_at),
        'balance',jsonb_build_object('accountId',v_account.id,
          'earned',v_balance.available+v_balance.redeemed,'pending',v_balance.pending,
          'available',v_balance.available,'authorized',v_balance.authorized,
          'redeemed',v_balance.redeemed,'reversed',v_balance.reversed,
          'expired',v_balance.expired,'adjusted',v_balance.adjusted,
          'ledgerSequence',v_balance.ledger_sequence,
          'projectionVersion',v_balance.projection_version,'calculatedAt',v_balance.calculated_at),
        'policyVersion',v_policy.policy_version));
    end if;
  end if;
  if p_selection ? 'rewardAuthorizationId' and nullif(p_selection->>'rewardAuthorizationId','') is not null then
    select * into v_auth from merchant.customer_value_authorization
     where id=(p_selection->>'rewardAuthorizationId')::uuid and merchant_id=p_merchant_id
       and location_id=p_location_id and customer_id=p_customer_id and account_type='loyalty_reward'
       and status='authorized' and expires_at>clock_timestamp()
       and checkout_fingerprint=p_checkout_fingerprint for update;
    if not found then raise exception 'REWARD_AUTHORIZATION_EXPIRED'; end if;
    v_entry:=merchant.append_loyalty_points(p_merchant_id,p_customer_id,v_auth.account_id,
      'points_redeemed','debit',v_auth.points,'reward_authorization',v_auth.id,p_sale_id,null,
      v_auth.reward_id,v_auth.id,p_operator_id,p_device_id,p_command_id,p_idempotency_key,
      p_checkout_fingerprint,p_business_date);
    update merchant.customer_value_authorization set status='committed',committed_at=clock_timestamp()
      where id=v_auth.id;
    v_benefit:=v_auth.benefit_minor_units;
    select committed_at into v_committed_at from merchant.customer_value_authorization where id=v_auth.id;
    v_result:=jsonb_set(v_result,'{reward}',jsonb_build_object(
      'authorizationId',v_auth.id,'ledgerEntryId',v_entry,'points',v_auth.points,
      'benefit',jsonb_build_object('minorUnits',v_benefit,'currency',v_currency),
      'committedAt',v_committed_at));
  end if;
  for v_auth in select a.* from merchant.customer_value_authorization a
    where a.id=any(array(select jsonb_array_elements_text(coalesce(p_selection->'storedValueAuthorizationIds','[]'::jsonb))::uuid))
      and a.merchant_id=p_merchant_id and a.location_id=p_location_id and a.status='authorized'
      and a.expires_at>clock_timestamp() and a.checkout_fingerprint=p_checkout_fingerprint
    order by a.account_type,a.account_id for update
  loop
    if v_auth.currency<>v_currency then raise exception 'STORED_VALUE_CURRENCY_MISMATCH'; end if;
    if v_auth.account_type='wallet' then
      perform 1 from merchant.loyalty_card c where c.id=v_auth.account_id
        and c.merchant_id=p_merchant_id and c.status='active' for update;
      if not found then raise exception 'STORED_VALUE_ACCOUNT_UNAVAILABLE'; end if;
      insert into merchant.loyalty_stored_value_ledger(
        merchant_id,card_id,delta,reason,idempotency_key,order_id,occurred_at,sequence,
        entry_type,currency,direction,authorization_id,command_id,fingerprint,operator_id,
        device_id,business_date,source_type,source_id
      ) values (p_merchant_id,v_auth.account_id,-v_auth.amount_minor_units,'redeemed',
        p_idempotency_key::text,p_order_id,clock_timestamp(),null,'redeemed',
        v_auth.currency,'debit',v_auth.id,p_command_id,p_checkout_fingerprint,p_operator_id,
        p_device_id,p_business_date,'pos_sale',p_sale_id::text)
        returning id into v_entry;
      select available into v_remaining from merchant.loyalty_stored_value_balance
        where card_id=v_auth.account_id;
    else
      perform 1 from merchant.loyalty_gift_card g where g.id=v_auth.account_id
        and g.merchant_id=p_merchant_id and g.status='active' for update;
      if not found then raise exception 'GIFT_CARD_INACTIVE'; end if;
      insert into merchant.loyalty_gift_card_ledger(
        merchant_id,gift_card_id,delta,reason,occurred_at,sequence,entry_type,currency,direction,
        authorization_id,sale_id,command_id,idempotency_key,fingerprint,operator_id,device_id,
        business_date,source_type,source_id
      ) values (p_merchant_id,v_auth.account_id,-v_auth.amount_minor_units,'redeemed',clock_timestamp(),
        null,'redeemed',v_auth.currency,'debit',v_auth.id,p_sale_id,p_command_id,
        p_idempotency_key::text,p_checkout_fingerprint,p_operator_id,p_device_id,p_business_date,
        'pos_sale',p_sale_id::text) returning id into v_entry;
      select available into v_remaining from merchant.loyalty_gift_card_balance
        where gift_card_id=v_auth.account_id;
    end if;
    update merchant.customer_value_authorization set status='committed',committed_at=clock_timestamp()
      where id=v_auth.id;
    select committed_at into v_committed_at from merchant.customer_value_authorization where id=v_auth.id;
    v_result:=jsonb_set(v_result,'{storedValue}',(v_result->'storedValue')||
      jsonb_build_array(jsonb_build_object(
        'authorization',jsonb_build_object('id',v_auth.id,'accountType',v_auth.account_type,
          'accountId',v_auth.account_id,'customerId',v_auth.customer_id,'currency',v_auth.currency,
          'saleId',v_auth.sale_id,'checkoutVersion',v_auth.checkout_version,
          'amountMinorUnits',v_auth.amount_minor_units,'fingerprint',v_auth.command_fingerprint,
          'status','committed','remainingBalanceMinorUnits',v_remaining,
          'createdAt',v_auth.created_at,'expiresAt',v_auth.expires_at,
          'correlationId',v_auth.correlation_id),
        'ledgerEntryId',v_entry,'committedAt',v_committed_at)));
  end loop;
  return v_result;
end $$;

create or replace function merchant.reverse_customer_value(
  p_merchant_id uuid,p_location_id uuid,p_sale_id uuid,p_exception_id uuid,
  p_command_id uuid,p_idempotency_key uuid,p_fingerprint text,p_business_date date,
  p_operator_id uuid,p_device_id uuid
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,merchant,umi as $$
declare r record; v_prior bigint; v_target bigint; v_delta bigint;
  v_sale_total bigint; v_refunded_total bigint;
  v_result jsonb:='{"points":0,"storedValue":0}'::jsonb;
begin
  perform merchant.assert_customer_value_write_scope(p_merchant_id,p_device_id);
  perform 1 from merchant.pos_committed_sale
    where id=p_sale_id and merchant_id=p_merchant_id and location_id=p_location_id
    for update;
  if not found then raise exception 'VALUE_REVERSAL_EXCEEDS_ORIGINAL'; end if;
  select receipt.grand_total,coalesce(sum(exception.total_minor_units),0)
    into v_sale_total,v_refunded_total
    from merchant.pos_committed_sale sale
    join merchant.receipt_snapshot receipt on receipt.id=sale.receipt_snapshot_id
    left join merchant.pos_sale_exception exception on exception.sale_id=sale.id
   where sale.id=p_sale_id and sale.merchant_id=p_merchant_id and sale.location_id=p_location_id
   group by receipt.grand_total;
  if v_sale_total is null or v_sale_total<=0 or v_refunded_total>v_sale_total then
    raise exception 'VALUE_REVERSAL_EXCEEDS_ORIGINAL';
  end if;
  for r in select l.* from merchant.loyalty_points_ledger l
    where l.merchant_id=p_merchant_id and l.sale_id=p_sale_id
      and l.entry_type in ('points_earn_pending','points_earn_committed','points_redeemed')
    order by l.account_id,l.sequence for update
  loop
    v_target:=floor((r.points::numeric*v_refunded_total::numeric)/v_sale_total::numeric)::bigint;
    select coalesce(sum(points),0) into v_prior from merchant.loyalty_points_ledger
     where account_id=r.account_id and refund_id is not null and source_aggregate_id=p_sale_id
       and entry_type=case when r.entry_type='points_redeemed' then 'points_reversed'
         when r.entry_type='points_earn_pending' then 'points_earn_cancelled'
         else 'points_earn_reversed' end;
    v_delta:=v_target-v_prior;
    if v_delta<0 or v_target>r.points then raise exception 'VALUE_REVERSAL_EXCEEDS_ORIGINAL'; end if;
    if v_delta>0 then
      perform merchant.append_loyalty_points(p_merchant_id,r.customer_id,r.account_id,
        case when r.entry_type='points_redeemed' then 'points_reversed'
          when r.entry_type='points_earn_pending' then 'points_earn_cancelled'
          else 'points_earn_reversed' end,
        case when r.entry_type='points_redeemed' then 'credit' else 'debit' end,
        v_delta,'pos_sale',p_sale_id,p_sale_id,p_exception_id,r.reward_id,null,
        p_operator_id,p_device_id,p_command_id,p_idempotency_key,p_fingerprint,p_business_date);
      v_result:=jsonb_set(v_result,'{points}',to_jsonb((v_result->>'points')::bigint+v_delta));
    end if;
  end loop;
  -- Use original debits. Current policy cannot change a historical reversal.
  for r in select l.* from merchant.loyalty_stored_value_ledger l
    where l.merchant_id=p_merchant_id and l.order_id=(select order_id from merchant.pos_committed_sale where id=p_sale_id)
      and l.entry_type='redeemed' order by l.card_id,l.sequence for update
  loop
    v_target:=floor((abs(r.delta)::numeric*v_refunded_total::numeric)/v_sale_total::numeric)::bigint;
    select coalesce(sum(delta),0) into v_prior from merchant.loyalty_stored_value_ledger
      where card_id=r.card_id and source_type='pos_exception' and entry_type='refunded'
        and source_id in (select id::text from merchant.pos_sale_exception where sale_id=p_sale_id);
    v_delta:=v_target-v_prior;
    if v_delta<0 or v_target>abs(r.delta) then raise exception 'VALUE_REVERSAL_EXCEEDS_ORIGINAL'; end if;
    if v_delta>0 then
      insert into merchant.loyalty_stored_value_ledger(
        merchant_id,card_id,delta,reason,idempotency_key,order_id,entry_type,currency,
        direction,refund_id,command_id,fingerprint,operator_id,device_id,business_date,source_type,source_id
      ) values (p_merchant_id,r.card_id,v_delta,'refunded',p_idempotency_key::text,
        r.order_id,'refunded',r.currency,'credit',p_exception_id,p_command_id,
        p_fingerprint,p_operator_id,p_device_id,p_business_date,'pos_exception',p_exception_id::text);
      v_result:=jsonb_set(v_result,'{storedValue}',to_jsonb((v_result->>'storedValue')::bigint+v_delta));
    end if;
  end loop;
  for r in select l.* from merchant.loyalty_gift_card_ledger l
    where l.merchant_id=p_merchant_id and l.sale_id=p_sale_id and l.entry_type='redeemed'
    order by l.gift_card_id,l.sequence for update
  loop
    v_target:=floor((abs(r.delta)::numeric*v_refunded_total::numeric)/v_sale_total::numeric)::bigint;
    select coalesce(sum(delta),0) into v_prior from merchant.loyalty_gift_card_ledger
      where gift_card_id=r.gift_card_id and source_type='pos_exception' and entry_type='refunded'
        and source_id in (select id::text from merchant.pos_sale_exception where sale_id=p_sale_id);
    v_delta:=v_target-v_prior;
    if v_delta<0 or v_target>abs(r.delta) then raise exception 'VALUE_REVERSAL_EXCEEDS_ORIGINAL'; end if;
    if v_delta>0 then
      insert into merchant.loyalty_gift_card_ledger(
        merchant_id,gift_card_id,delta,reason,entry_type,currency,direction,refund_id,
        command_id,idempotency_key,fingerprint,operator_id,device_id,business_date,source_type,source_id
      ) values (p_merchant_id,r.gift_card_id,v_delta,'refunded','refunded',r.currency,'credit',
        p_exception_id,p_command_id,p_idempotency_key::text,p_fingerprint,p_operator_id,
        p_device_id,p_business_date,'pos_exception',p_exception_id::text);
      v_result:=jsonb_set(v_result,'{storedValue}',to_jsonb((v_result->>'storedValue')::bigint+v_delta));
    end if;
  end loop;
  return v_result;
end $$;

create or replace function merchant.validate_customer_merge_scope() returns trigger
language plpgsql set search_path=pg_catalog,merchant as $$
begin
  if not exists(select 1 from merchant.customer where id=new.source_customer_id and merchant_id=new.merchant_id)
     or not exists(select 1 from merchant.customer where id=new.target_customer_id and merchant_id=new.merchant_id)
  then raise exception 'CUSTOMER_MERCHANT_SCOPE'; end if;
  if exists(select 1 from merchant.loyalty_points_account where customer_id in (new.source_customer_id,new.target_customer_id))
     or exists(select 1 from merchant.loyalty_card where customer_id in (new.source_customer_id,new.target_customer_id))
  then
    new.status:='value_reconciliation_required';
    raise exception 'VALUE_RECONCILIATION_REQUIRED';
  end if;
  return new;
end $$;
create trigger customer_merge_scope
  before insert on merchant.customer_merge_mapping
  for each row execute function merchant.validate_customer_merge_scope();

revoke insert,update,delete on merchant.customer_consent_history,merchant.loyalty_points_ledger,
  merchant.loyalty_stored_value_ledger,merchant.loyalty_gift_card_ledger from api,worker;
grant select on merchant.customer_consent_history,merchant.loyalty_points_ledger,
  merchant.loyalty_stored_value_ledger,merchant.loyalty_gift_card_ledger to api,worker;
grant select,insert,update on merchant.customer_consent_current,merchant.customer_merge_mapping,
  merchant.loyalty_points_account,merchant.loyalty_points_balance,merchant.loyalty_stored_value_balance,
  merchant.loyalty_gift_card_balance,merchant.customer_value_authorization to api,worker;
grant execute on function merchant.append_loyalty_points(uuid,uuid,uuid,text,text,bigint,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,date),
  merchant.commit_customer_value(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,date,uuid,uuid,jsonb),
  merchant.reverse_customer_value(uuid,uuid,uuid,uuid,uuid,uuid,text,date,uuid,uuid),
  merchant.append_customer_consent(uuid,uuid,text,text,text,uuid,uuid),
  merchant.append_stored_value_fact(uuid,uuid,jsonb),
  merchant.append_gift_card_fact(uuid,uuid,jsonb)
  to api,worker;
revoke all on function merchant.append_loyalty_points(uuid,uuid,uuid,text,text,bigint,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,date),
  merchant.commit_customer_value(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,date,uuid,uuid,jsonb),
  merchant.reverse_customer_value(uuid,uuid,uuid,uuid,uuid,uuid,text,date,uuid,uuid),
  merchant.append_customer_consent(uuid,uuid,text,text,text,uuid,uuid),
  merchant.append_stored_value_fact(uuid,uuid,jsonb),
  merchant.append_gift_card_fact(uuid,uuid,jsonb),
  merchant.assert_customer_value_write_scope(uuid,uuid)
  from public;

do $$
declare t text;
begin
  foreach t in array array[
    'customer_consent_history','customer_consent_current','customer_merge_mapping',
    'loyalty_points_account','loyalty_points_ledger','loyalty_points_balance',
    'loyalty_stored_value_balance','loyalty_gift_card_balance',
    'customer_value_authorization'
  ] loop
    execute format('alter table merchant.%I enable row level security',t);
    execute format('alter table merchant.%I force row level security',t);
    execute format(
      'create policy %I on merchant.%I using (merchant_id=umi.current_merchant()) with check (merchant_id=umi.current_merchant())',
      t||'_scope',t
    );
  end loop;
end $$;
create policy customer_value_location_scope on merchant.customer_value_authorization
  as restrictive using (location_id = umi.current_location())
  with check (location_id = umi.current_location());

comment on table merchant.loyalty_stored_value_ledger is
  'Append-only wallet facts. A mutable balance is never the authority.';
comment on table merchant.loyalty_gift_card_ledger is
  'Append-only gift-card facts. Codes use a hash for lookup.';

commit;
