-- Gate 3C: physical registers, cashier shifts, and immutable cash facts.

insert into umi.permission (key, description)
values
  ('cash.register.use', 'Use an assigned physical register'),
  ('cash.shift.open', 'Open a cash shift'),
  ('cash.shift.suspend', 'Suspend an active cash shift'),
  ('cash.shift.resume', 'Resume an authorized cash shift'),
  ('cash.shift.handoff', 'Transfer cash shift responsibility'),
  ('cash.movement.paid_in', 'Record a paid-in cash movement'),
  ('cash.movement.paid_out', 'Record a paid-out cash movement'),
  ('cash.movement.safe_drop', 'Record a safe-drop cash movement'),
  ('cash.drawer.no_sale', 'Request a no-sale drawer event'),
  ('cash.count.submit', 'Submit a blind cash count'),
  ('cash.count.recount', 'Request a new blind count'),
  ('cash.variance.approve', 'Approve a cash variance'),
  ('cash.reconcile', 'Reconcile a cash shift'),
  ('cash.shift.close', 'Close a reconciled cash shift'),
  ('cash.shift.read', 'Read an authorized cash shift')
on conflict (key) do update set description=excluded.description;

insert into umi.role_permission (role_id, permission_id)
select r.id,p.id
from umi.role r
cross join umi.permission p
where not r.is_platform
  and r.key in ('owner','admin','manager','supervisor','cashier','staff')
  and p.key in (
    'cash.register.use','cash.shift.open','cash.shift.suspend','cash.shift.resume',
    'cash.movement.paid_in','cash.movement.paid_out','cash.movement.safe_drop',
    'cash.count.submit','cash.reconcile','cash.shift.close','cash.shift.read'
  )
on conflict do nothing;

insert into umi.role_permission (role_id, permission_id)
select r.id,p.id
from umi.role r
cross join umi.permission p
where not r.is_platform
  and r.key in ('owner','admin','manager','supervisor')
  and p.key in (
    'cash.shift.handoff','cash.drawer.no_sale','cash.count.recount',
    'cash.variance.approve'
  )
on conflict do nothing;

create table merchant.physical_register (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  display_name text not null check (length(display_name) between 1 and 80),
  public_reference text not null check (length(public_reference) between 1 and 80),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  assignment_policy text not null default 'device_required'
    check (assignment_policy in ('device_required','operator_selects')),
  assigned_device_id uuid references merchant.device(id) on delete restrict,
  allowed_device_classes text[] not null default '{pos_terminal}',
  status text not null default 'available' check (status in (
    'available','assigned','in_use','suspended','counting',
    'reconciliation_required','blocked','archived'
  )),
  current_shift_id uuid,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique(merchant_id,location_id,public_reference)
);

create table merchant.cash_shift_policy (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  version text not null,
  cash_shift_required boolean not null default true,
  register_assignment_required boolean not null default true,
  one_shift_per_operator boolean not null default true,
  one_shift_per_register boolean not null default true,
  opening_float_required boolean not null default true,
  maximum_opening_float bigint not null default 0
    check (maximum_opening_float between 0 and 9007199254740991),
  allowed_movement_types text[] not null default '{}',
  movement_approval_threshold bigint not null default 0
    check (movement_approval_threshold between 0 and 9007199254740991),
  count_method text not null default 'total_only'
    check (count_method in ('total_only','denomination_or_total')),
  blind_count_required boolean not null default true,
  handoff_allowed boolean not null default false,
  handoff_count_required boolean not null default true,
  variance_tolerance bigint not null default 0
    check (variance_tolerance between 0 and 9007199254740991),
  close_approval_threshold bigint not null default 0
    check (close_approval_threshold between 0 and 9007199254740991),
  no_sale_drawer_allowed boolean not null default false,
  offline_cash_shift_allowed boolean not null default false,
  denominations jsonb not null default '[]'::jsonb,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  unique(merchant_id,location_id)
);

create table merchant.cash_shift (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  register_id uuid not null references merchant.physical_register(id) on delete restrict,
  -- The terminal that OPENED the shift. Identity, and `tg_closed_cash_shift_immutable`
  -- keeps it that way: it names the device that took responsibility for the drawer.
  device_id uuid not null references merchant.device(id) on delete restrict,
  device_credential_version integer not null check (device_credential_version > 0),
  -- The terminal that HOLDS the shift right now, which is a different question and a
  -- moving one. Equal to the opening device until something takes the identity away —
  -- a rotated credential, a replaced tablet, or a web POS whose browser storage was
  -- cleared, which mints a brand new device out of the same physical register. Every
  -- cash operation matches against these two, so the shift follows the drawer instead
  -- of dying with a browser profile. Each move is written to
  -- `merchant.cash_shift_custody_event`.
  holding_device_id uuid not null references merchant.device(id) on delete restrict,
  holding_device_credential_version integer not null
    check (holding_device_credential_version > 0),
  opening_operator_id uuid not null references umi.user(id) on delete restrict,
  responsible_operator_id uuid not null references umi.user(id) on delete restrict,
  operator_session_id uuid not null references runtime.operator_session(id) on delete restrict,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  business_date date not null,
  status text not null check (status in (
    'opening','open','suspended','handoff_pending','counting',
    'reconciliation_required','closing','closed','blocked','recovered'
  )),
  opening_command_id uuid not null,
  opening_float_minor_units bigint not null
    check (opening_float_minor_units between 0 and 9007199254740991),
  opening_denominations jsonb not null default '[]'::jsonb,
  opening_note text check (length(opening_note) <= 160 and opening_note !~ '[<>]'),
  ledger_sequence bigint not null default 0 check (ledger_sequence >= 0),
  version integer not null default 1 check (version > 0),
  opened_at timestamptz not null default now(),
  suspended_at timestamptz,
  closed_at timestamptz,
  unique(merchant_id,opening_command_id)
);

-- `recovered` sits with `closed` and `blocked` on purpose. A shift a manager has
-- recovered is finished: the drawer was counted and the register handed back. Leaving
-- it out of these two predicates was what made recovery impossible to express — the
-- register stayed held by a shift nobody could close, and the operator could never
-- open another one.
create unique index cash_shift_one_unresolved_register
  on merchant.cash_shift(merchant_id,register_id)
  where status not in ('closed','blocked','recovered');
create unique index cash_shift_one_active_operator
  on merchant.cash_shift(merchant_id,responsible_operator_id)
  where status in ('opening','open','suspended','handoff_pending','counting',
                   'reconciliation_required','closing');

alter table merchant.physical_register
  add constraint physical_register_current_shift_fk
  foreign key (current_shift_id) references merchant.cash_shift(id)
  deferrable initially deferred;

create table merchant.cash_ledger_entry (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  register_id uuid not null references merchant.physical_register(id) on delete restrict,
  shift_id uuid not null references merchant.cash_shift(id) on delete restrict,
  sequence bigint not null check (sequence > 0),
  entry_type text not null check (entry_type in (
    'opening_float','cash_sale','paid_in','paid_out','safe_drop',
    'drawer_correction','handoff_transfer','count_observation',
    'variance_resolution','close_adjustment'
  )),
  amount_minor_units bigint not null
    check (amount_minor_units between 0 and 9007199254740991),
  cash_received_minor_units bigint not null default 0
    check (cash_received_minor_units between 0 and 9007199254740991),
  change_given_minor_units bigint not null default 0
    check (change_given_minor_units between 0 and cash_received_minor_units),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  command_id uuid not null,
  sale_id uuid references merchant.pos_committed_sale(id) on delete restrict,
  tender_fact_id uuid references merchant.pos_tender_fact(id) on delete restrict,
  movement_id uuid,
  business_date date not null,
  public_data jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique(shift_id,sequence),
  unique(merchant_id,command_id,entry_type),
  unique(tender_fact_id)
);

create table merchant.cash_movement (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  register_id uuid not null references merchant.physical_register(id) on delete restrict,
  shift_id uuid not null references merchant.cash_shift(id) on delete restrict,
  ledger_entry_id uuid not null unique references merchant.cash_ledger_entry(id) on delete restrict,
  movement_type text not null check (movement_type in (
    'paid_in','paid_out','safe_drop','drawer_correction'
  )),
  amount_minor_units bigint not null check (amount_minor_units between 1 and 9007199254740991),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  reason_code text not null check (reason_code ~ '^[a-z0-9_.-]{1,80}$'),
  note text check (length(note) <= 160 and note !~ '[<>]'),
  operator_id uuid not null references umi.user(id) on delete restrict,
  approval_id uuid references runtime.elevation_grant(id) on delete restrict,
  command_id uuid not null,
  committed_at timestamptz not null default now(),
  unique(merchant_id,command_id)
);
alter table merchant.cash_ledger_entry
  add constraint cash_ledger_movement_fk
  foreign key (movement_id) references merchant.cash_movement(id)
  deferrable initially deferred;

create table merchant.cash_shift_handoff (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  shift_id uuid not null references merchant.cash_shift(id) on delete restrict,
  outgoing_operator_id uuid not null references umi.user(id) on delete restrict,
  incoming_operator_id uuid not null references umi.user(id) on delete restrict,
  expected_cash_snapshot jsonb not null,
  ledger_sequence bigint not null check (ledger_sequence >= 0),
  command_id uuid not null,
  completed_at timestamptz not null default now(),
  unique(merchant_id,command_id)
);

create table merchant.cash_count_attempt (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  register_id uuid not null references merchant.physical_register(id) on delete restrict,
  shift_id uuid not null references merchant.cash_shift(id) on delete restrict,
  attempt_number integer not null check (attempt_number between 1 and 10),
  state text not null check (state in (
    'submitted','variance_calculated','recount_required','approval_required','resolved'
  )),
  counted_minor_units bigint not null check (counted_minor_units between 0 and 9007199254740991),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  denominations jsonb not null default '[]'::jsonb,
  operator_id uuid not null references umi.user(id) on delete restrict,
  ledger_sequence bigint not null check (ledger_sequence >= 0),
  note text check (length(note) <= 160 and note !~ '[<>]'),
  command_id uuid not null,
  submitted_at timestamptz not null default now(),
  unique(shift_id,attempt_number),
  unique(merchant_id,command_id)
);

create table merchant.cash_variance_resolution (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  shift_id uuid not null references merchant.cash_shift(id) on delete restrict,
  count_attempt_id uuid not null references merchant.cash_count_attempt(id) on delete restrict,
  reason text not null check (reason in (
    'no_variance','counting_error','change_error','unrecorded_paid_in',
    'unrecorded_paid_out','missing_safe_drop','cash_handling_error',
    'unknown_operational_difference','other_approved_reason'
  )),
  note text check (length(note) <= 160 and note !~ '[<>]'),
  approval_id uuid references runtime.elevation_grant(id) on delete restrict,
  ledger_sequence bigint not null check (ledger_sequence >= 0),
  command_id uuid not null,
  resolved_at timestamptz not null default now(),
  unique(count_attempt_id),
  unique(merchant_id,command_id)
);

create table merchant.cash_reconciliation (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  shift_id uuid not null references merchant.cash_shift(id) on delete restrict,
  count_attempt_id uuid not null references merchant.cash_count_attempt(id) on delete restrict,
  resolution_id uuid references merchant.cash_variance_resolution(id) on delete restrict,
  expected_minor_units bigint not null,
  counted_minor_units bigint not null check (counted_minor_units >= 0),
  variance_minor_units bigint not null,
  tolerance_minor_units bigint not null check (tolerance_minor_units >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  outcome text not null check (outcome in (
    'balanced','within_tolerance','approved_variance','recount_required',
    'approval_required','posting_pending','ambiguous_cash_effect','blocked','support_required'
  )),
  ledger_sequence bigint not null check (ledger_sequence >= 0),
  command_id uuid not null,
  reconciled_at timestamptz not null default now(),
  unique(shift_id),
  unique(merchant_id,command_id)
);

create table merchant.cash_shift_close (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  register_id uuid not null references merchant.physical_register(id) on delete restrict,
  shift_id uuid not null unique references merchant.cash_shift(id) on delete restrict,
  reconciliation_id uuid not null unique references merchant.cash_reconciliation(id) on delete restrict,
  summary jsonb not null,
  command_id uuid not null,
  closed_at timestamptz not null default now(),
  unique(merchant_id,command_id)
);

create table merchant.no_sale_drawer_event (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  register_id uuid not null references merchant.physical_register(id) on delete restrict,
  shift_id uuid not null references merchant.cash_shift(id) on delete restrict,
  operator_id uuid not null references umi.user(id) on delete restrict,
  reason_code text not null check (reason_code ~ '^[a-z0-9_.-]{1,80}$'),
  approval_id uuid references runtime.elevation_grant(id) on delete restrict,
  command_id uuid not null,
  status text not null default 'requested' check (status='requested'),
  requested_at timestamptz not null default now(),
  unique(merchant_id,command_id)
);

alter table merchant.pos_checkout_draft add column cash_shift_id uuid
  references merchant.cash_shift(id) on delete restrict;
alter table merchant.pos_committed_sale add column cash_shift_id uuid
  references merchant.cash_shift(id) on delete restrict;

create function merchant.cash_denominations_valid(
  lines jsonb,
  declared_total bigint,
  declared_currency text
)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(lines)='array'
    and not exists (
      select 1
      from jsonb_array_elements(lines) line
      where (line#>>'{denomination,currency}') is distinct from declared_currency
         or (line#>>'{lineTotal,currency}') is distinct from declared_currency
         or (line->>'quantity')::bigint < 0
         or (line#>>'{denomination,minorUnits}')::bigint <= 0
         or (line#>>'{lineTotal,minorUnits}')::bigint
              <> (line#>>'{denomination,minorUnits}')::bigint
                 * (line->>'quantity')::bigint
    )
    and (
      jsonb_array_length(lines)=0
      or declared_total=(
        select coalesce(sum((line#>>'{lineTotal,minorUnits}')::bigint),0)
        from jsonb_array_elements(lines) line
      )
    )
    and not exists (
      select 1
      from jsonb_array_elements(lines) line
      group by line#>>'{denomination,currency}',line#>>'{denomination,minorUnits}'
      having count(*)>1
    );
$$;

create function merchant.tg_cash_shift_scope()
returns trigger language plpgsql as $$
declare
  register_row merchant.physical_register%rowtype;
  device_business uuid;
  device_location uuid;
  device_version integer;
  device_state text;
  session_business uuid;
  session_location uuid;
  session_device uuid;
  session_operator uuid;
begin
  select * into register_row
  from merchant.physical_register
  where id=new.register_id for update;
  select merchant_id,location_id,credential_version,status
    into device_business,device_location,device_version,device_state
  from merchant.device where id=new.device_id;
  select merchant_id,location_id,device_id,user_id
    into session_business,session_location,session_device,session_operator
  from runtime.operator_session where id=new.operator_session_id;
  if register_row.id is null
     or register_row.merchant_id<>new.merchant_id
     or register_row.location_id<>new.location_id
     or register_row.currency<>new.currency
     or not register_row.active
     or register_row.status not in ('available','assigned')
     or (
       register_row.assignment_policy='device_required'
       and register_row.assigned_device_id is distinct from new.device_id
     )
     or device_business<>new.merchant_id
     or device_location<>new.location_id
     or device_version<>new.device_credential_version
     or device_state<>'active'
     -- A shift always opens on the terminal that opened it. Custody moves later,
     -- through an audited update, never through the opening row.
     or new.holding_device_id<>new.device_id
     or new.holding_device_credential_version<>new.device_credential_version
     or session_business<>new.merchant_id
     or session_location<>new.location_id
     or session_device<>new.device_id
     or session_operator<>new.opening_operator_id
     or not merchant.cash_denominations_valid(
       new.opening_denominations,
       new.opening_float_minor_units,
       new.currency
     ) then
    raise exception 'cash shift scope or opening float is invalid';
  end if;
  return new;
end $$;
create trigger cash_shift_scope before insert on merchant.cash_shift
  for each row execute function merchant.tg_cash_shift_scope();

create function merchant.tg_cash_fact_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'cash fact is immutable';
end $$;

create trigger cash_ledger_immutable before update or delete on merchant.cash_ledger_entry
  for each row execute function merchant.tg_cash_fact_immutable();
create trigger cash_movement_immutable before update or delete on merchant.cash_movement
  for each row execute function merchant.tg_cash_fact_immutable();
create trigger cash_handoff_immutable before update or delete on merchant.cash_shift_handoff
  for each row execute function merchant.tg_cash_fact_immutable();
create trigger cash_count_immutable before update or delete on merchant.cash_count_attempt
  for each row execute function merchant.tg_cash_fact_immutable();
create trigger cash_variance_immutable before update or delete on merchant.cash_variance_resolution
  for each row execute function merchant.tg_cash_fact_immutable();
create trigger cash_reconciliation_immutable before update or delete on merchant.cash_reconciliation
  for each row execute function merchant.tg_cash_fact_immutable();
create trigger cash_close_immutable before update or delete on merchant.cash_shift_close
  for each row execute function merchant.tg_cash_fact_immutable();
create trigger no_sale_drawer_immutable before update or delete on merchant.no_sale_drawer_event
  for each row execute function merchant.tg_cash_fact_immutable();

create function merchant.tg_closed_cash_shift_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then
    raise exception 'cash shift deletion is prohibited';
  end if;
  if old.status='closed' then
    raise exception 'closed cash shift is immutable';
  end if;
  if new.merchant_id<>old.merchant_id or new.location_id<>old.location_id
     or new.register_id<>old.register_id or new.device_id<>old.device_id
     or new.device_credential_version<>old.device_credential_version
     or new.opening_operator_id<>old.opening_operator_id
     or new.opening_command_id<>old.opening_command_id
     or new.currency<>old.currency or new.business_date<>old.business_date
     or new.opening_float_minor_units<>old.opening_float_minor_units
     or new.opening_denominations<>old.opening_denominations then
    raise exception 'cash shift identity is immutable';
  end if;
  return new;
end $$;
create trigger cash_shift_identity_immutable before update or delete on merchant.cash_shift
  for each row execute function merchant.tg_closed_cash_shift_immutable();

create function merchant.tg_cash_ledger_open_shift()
returns trigger language plpgsql as $$
declare
  shift_row merchant.cash_shift%rowtype;
begin
  select * into shift_row from merchant.cash_shift where id=new.shift_id for update;
  if shift_row.id is null
     or shift_row.status<>'open'
     or shift_row.merchant_id<>new.merchant_id
     or shift_row.location_id<>new.location_id
     or shift_row.register_id<>new.register_id
     or shift_row.currency<>new.currency
     or shift_row.business_date<>new.business_date
     or new.sequence<>shift_row.ledger_sequence+1 then
    raise exception 'cash ledger posting requires an eligible unresolved shift';
  end if;
  return new;
end $$;
create trigger cash_ledger_open_shift before insert on merchant.cash_ledger_entry
  for each row execute function merchant.tg_cash_ledger_open_shift();

create function merchant.tg_cash_count_guard()
returns trigger language plpgsql as $$
declare shift_row merchant.cash_shift%rowtype;
begin
  select * into shift_row from merchant.cash_shift where id=new.shift_id for update;
  if shift_row.id is null
     or shift_row.merchant_id<>new.merchant_id
     or shift_row.location_id<>new.location_id
     or shift_row.register_id<>new.register_id
     or shift_row.currency<>new.currency
     or shift_row.ledger_sequence<>new.ledger_sequence
     or shift_row.status not in ('open','suspended','reconciliation_required')
     or not merchant.cash_denominations_valid(
       new.denominations,
       new.counted_minor_units,
       new.currency
     ) then
    raise exception 'cash count scope or ledger sequence is stale';
  end if;
  return new;
end $$;
create trigger cash_count_guard before insert on merchant.cash_count_attempt
  for each row execute function merchant.tg_cash_count_guard();

create function merchant.tg_cash_reconciliation_guard()
returns trigger language plpgsql as $$
declare
  shift_sequence bigint;
  shift_status text;
  count_shift uuid;
  count_sequence bigint;
  count_amount bigint;
begin
  select ledger_sequence,status into shift_sequence,shift_status
  from merchant.cash_shift where id=new.shift_id for update;
  select shift_id,ledger_sequence,counted_minor_units
    into count_shift,count_sequence,count_amount
  from merchant.cash_count_attempt where id=new.count_attempt_id;
  if shift_status<>'reconciliation_required'
     or shift_sequence<>new.ledger_sequence
     or count_shift<>new.shift_id
     or count_sequence<>new.ledger_sequence
     or count_amount<>new.counted_minor_units
     or new.variance_minor_units<>new.counted_minor_units-new.expected_minor_units then
    raise exception 'cash reconciliation is not bound to the fixed count';
  end if;
  return new;
end $$;
create trigger cash_reconciliation_guard before insert on merchant.cash_reconciliation
  for each row execute function merchant.tg_cash_reconciliation_guard();

-- WHO IS HOLDING THE DRAWER, and every time that changed.
--
-- `cash_shift` names one device and one operator session, and every cash operation
-- matches against them. That is the right lock while a terminal keeps its identity,
-- and the wrong one the moment it loses it: a web POS is one browser profile on one
-- origin, so clearing site data mints a new device and strands the open shift on an
-- identity that can never authenticate again. The register stays `in_use` for ever
-- and the money in it can never be counted out.
--
-- So the device is rebindable, and every rebinding lands here. Two ways in:
--   `device_adoption`  the same operator returns on another terminal and takes back
--                      their own shift. No elevation: they already own it.
--   `manager_recovery` the operator cannot return at all. A manager counts the drawer
--                      and closes the shift to `recovered` under their own name.
-- The row keeps both sides of the swap, so the chain of custody reads end to end.
create table merchant.cash_shift_custody_event (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  register_id uuid not null references merchant.physical_register(id) on delete restrict,
  shift_id uuid not null references merchant.cash_shift(id) on delete restrict,
  event_type text not null check (event_type in ('device_adoption','manager_recovery')),
  previous_holding_device_id uuid not null references merchant.device(id) on delete restrict,
  previous_holding_credential_version integer not null
    check (previous_holding_credential_version > 0),
  previous_operator_session_id uuid not null
    references runtime.operator_session(id) on delete restrict,
  new_holding_device_id uuid references merchant.device(id) on delete restrict,
  new_holding_credential_version integer check (new_holding_credential_version > 0),
  new_operator_session_id uuid references runtime.operator_session(id) on delete restrict,
  acting_operator_id uuid not null references umi."user"(id) on delete restrict,
  responsible_operator_id uuid not null references umi."user"(id) on delete restrict,
  shift_status_before text not null check (length(shift_status_before) between 1 and 40),
  shift_status_after text not null check (length(shift_status_after) between 1 and 40),
  expected_cash_minor_units bigint
    check (expected_cash_minor_units between 0 and 9007199254740991),
  counted_cash_minor_units bigint
    check (counted_cash_minor_units between 0 and 9007199254740991),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  reason_code text not null check (reason_code ~ '^[a-z0-9_.-]{1,80}$'),
  note text check (length(note) <= 160 and note !~ '[<>]'),
  approval_id uuid references runtime.elevation_grant(id) on delete restrict,
  command_id uuid not null,
  ledger_sequence bigint not null check (ledger_sequence >= 0),
  occurred_at timestamptz not null default now(),
  unique(merchant_id,command_id),
  constraint cash_custody_shape check (
    case event_type
      when 'device_adoption' then
        new_holding_device_id is not null
        and new_holding_credential_version is not null
        and new_operator_session_id is not null
        and counted_cash_minor_units is null
      when 'manager_recovery' then
        counted_cash_minor_units is not null
        and expected_cash_minor_units is not null
      else false
    end
  )
);
create index cash_shift_custody_shift_idx
  on merchant.cash_shift_custody_event(merchant_id,shift_id,occurred_at);

create function merchant.tg_cash_close_guard()
returns trigger language plpgsql as $$
declare
  shift_status text;
  shift_sequence bigint;
  reconciliation_shift uuid;
  reconciliation_sequence bigint;
begin
  select status,ledger_sequence into shift_status,shift_sequence
  from merchant.cash_shift where id=new.shift_id for update;
  select shift_id,ledger_sequence into reconciliation_shift,reconciliation_sequence
  from merchant.cash_reconciliation where id=new.reconciliation_id;
  if shift_status<>'closing'
     or reconciliation_shift<>new.shift_id
     or reconciliation_sequence<>shift_sequence then
    raise exception 'cash close requires the current reconciliation';
  end if;
  return new;
end $$;
create trigger cash_close_guard before insert on merchant.cash_shift_close
  for each row execute function merchant.tg_cash_close_guard();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'physical_register','cash_shift_policy','cash_shift','cash_ledger_entry',
    'cash_movement','cash_shift_handoff','cash_count_attempt',
    'cash_variance_resolution','cash_reconciliation','cash_shift_close',
    'no_sale_drawer_event','cash_shift_custody_event'
  ] loop
    execute format('alter table merchant.%I enable row level security',table_name);
    execute format('alter table merchant.%I force row level security',table_name);
    execute format(
      'create policy merchant_location_isolation on merchant.%I
       using (merchant_id=umi.current_merchant() and location_id=umi.current_location())
       with check (merchant_id=umi.current_merchant() and location_id=umi.current_location())',
      table_name
    );
    execute format('revoke all on merchant.%I from public,readonly',table_name);
  end loop;
end $$;

grant select on merchant.physical_register,merchant.cash_shift_policy,merchant.cash_shift,
  merchant.cash_ledger_entry,merchant.cash_movement,merchant.cash_shift_handoff,
  merchant.cash_count_attempt,merchant.cash_variance_resolution,merchant.cash_reconciliation,
  merchant.cash_shift_close,merchant.no_sale_drawer_event,
  merchant.cash_shift_custody_event to api,worker;
grant insert,update on merchant.physical_register,merchant.cash_shift to api,worker;
grant insert on merchant.cash_ledger_entry,merchant.cash_movement,merchant.cash_shift_handoff,
  merchant.cash_count_attempt,merchant.cash_variance_resolution,merchant.cash_reconciliation,
  merchant.cash_shift_close,merchant.no_sale_drawer_event,
  merchant.cash_shift_custody_event to api,worker;

comment on table merchant.cash_ledger_entry is
  'Append-only physical cash authority. Expected cash is reproduced from these ordered facts.';
comment on table merchant.cash_count_attempt is
  'Immutable blind-count observations. Counted cash never replaces expected cash.';
comment on table merchant.cash_shift_close is
  'One immutable close result for one fully reconciled cash shift.';
comment on table merchant.cash_shift_custody_event is
  'Every rebinding of a cash shift to a different terminal or a recovering manager.';
