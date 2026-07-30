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

create table tenant.physical_register (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete restrict,
  branch_id uuid not null references tenant.branch(id) on delete restrict,
  display_name text not null check (length(display_name) between 1 and 80),
  public_reference text not null check (length(public_reference) between 1 and 80),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  assignment_policy text not null default 'device_required'
    check (assignment_policy in ('device_required','operator_selects')),
  assigned_device_id uuid references tenant.device(id) on delete restrict,
  allowed_device_classes text[] not null default '{pos_terminal}',
  status text not null default 'available' check (status in (
    'available','assigned','in_use','suspended','counting',
    'reconciliation_required','blocked','archived'
  )),
  current_shift_id uuid,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique(business_id,branch_id,public_reference)
);

create table tenant.cash_shift_policy (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete restrict,
  branch_id uuid not null references tenant.branch(id) on delete restrict,
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
  unique(business_id,branch_id)
);

create table tenant.cash_shift (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete restrict,
  branch_id uuid not null references tenant.branch(id) on delete restrict,
  register_id uuid not null references tenant.physical_register(id) on delete restrict,
  device_id uuid not null references tenant.device(id) on delete restrict,
  device_credential_version integer not null check (device_credential_version > 0),
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
  unique(business_id,opening_command_id)
);

create unique index cash_shift_one_unresolved_register
  on tenant.cash_shift(business_id,register_id)
  where status not in ('closed','blocked');
create unique index cash_shift_one_active_operator
  on tenant.cash_shift(business_id,responsible_operator_id)
  where status in ('opening','open','suspended','handoff_pending','counting',
                   'reconciliation_required','closing','recovered');

alter table tenant.physical_register
  add constraint physical_register_current_shift_fk
  foreign key (current_shift_id) references tenant.cash_shift(id)
  deferrable initially deferred;

create table tenant.cash_ledger_entry (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete restrict,
  branch_id uuid not null references tenant.branch(id) on delete restrict,
  register_id uuid not null references tenant.physical_register(id) on delete restrict,
  shift_id uuid not null references tenant.cash_shift(id) on delete restrict,
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
  sale_id uuid references tenant.pos_committed_sale(id) on delete restrict,
  tender_fact_id uuid references tenant.pos_tender_fact(id) on delete restrict,
  movement_id uuid,
  business_date date not null,
  public_data jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique(shift_id,sequence),
  unique(business_id,command_id,entry_type),
  unique(tender_fact_id)
);

create table tenant.cash_movement (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete restrict,
  branch_id uuid not null references tenant.branch(id) on delete restrict,
  register_id uuid not null references tenant.physical_register(id) on delete restrict,
  shift_id uuid not null references tenant.cash_shift(id) on delete restrict,
  ledger_entry_id uuid not null unique references tenant.cash_ledger_entry(id) on delete restrict,
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
  unique(business_id,command_id)
);
alter table tenant.cash_ledger_entry
  add constraint cash_ledger_movement_fk
  foreign key (movement_id) references tenant.cash_movement(id)
  deferrable initially deferred;

create table tenant.cash_shift_handoff (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete restrict,
  branch_id uuid not null references tenant.branch(id) on delete restrict,
  shift_id uuid not null references tenant.cash_shift(id) on delete restrict,
  outgoing_operator_id uuid not null references umi.user(id) on delete restrict,
  incoming_operator_id uuid not null references umi.user(id) on delete restrict,
  expected_cash_snapshot jsonb not null,
  ledger_sequence bigint not null check (ledger_sequence >= 0),
  command_id uuid not null,
  completed_at timestamptz not null default now(),
  unique(business_id,command_id)
);

create table tenant.cash_count_attempt (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete restrict,
  branch_id uuid not null references tenant.branch(id) on delete restrict,
  register_id uuid not null references tenant.physical_register(id) on delete restrict,
  shift_id uuid not null references tenant.cash_shift(id) on delete restrict,
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
  unique(business_id,command_id)
);

create table tenant.cash_variance_resolution (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete restrict,
  branch_id uuid not null references tenant.branch(id) on delete restrict,
  shift_id uuid not null references tenant.cash_shift(id) on delete restrict,
  count_attempt_id uuid not null references tenant.cash_count_attempt(id) on delete restrict,
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
  unique(business_id,command_id)
);

create table tenant.cash_reconciliation (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete restrict,
  branch_id uuid not null references tenant.branch(id) on delete restrict,
  shift_id uuid not null references tenant.cash_shift(id) on delete restrict,
  count_attempt_id uuid not null references tenant.cash_count_attempt(id) on delete restrict,
  resolution_id uuid references tenant.cash_variance_resolution(id) on delete restrict,
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
  unique(business_id,command_id)
);

create table tenant.cash_shift_close (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete restrict,
  branch_id uuid not null references tenant.branch(id) on delete restrict,
  register_id uuid not null references tenant.physical_register(id) on delete restrict,
  shift_id uuid not null unique references tenant.cash_shift(id) on delete restrict,
  reconciliation_id uuid not null unique references tenant.cash_reconciliation(id) on delete restrict,
  summary jsonb not null,
  command_id uuid not null,
  closed_at timestamptz not null default now(),
  unique(business_id,command_id)
);

create table tenant.no_sale_drawer_event (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references tenant.business(id) on delete restrict,
  branch_id uuid not null references tenant.branch(id) on delete restrict,
  register_id uuid not null references tenant.physical_register(id) on delete restrict,
  shift_id uuid not null references tenant.cash_shift(id) on delete restrict,
  operator_id uuid not null references umi.user(id) on delete restrict,
  reason_code text not null check (reason_code ~ '^[a-z0-9_.-]{1,80}$'),
  approval_id uuid references runtime.elevation_grant(id) on delete restrict,
  command_id uuid not null,
  status text not null default 'requested' check (status='requested'),
  requested_at timestamptz not null default now(),
  unique(business_id,command_id)
);

alter table tenant.pos_checkout_draft add column cash_shift_id uuid
  references tenant.cash_shift(id) on delete restrict;
alter table tenant.pos_committed_sale add column cash_shift_id uuid
  references tenant.cash_shift(id) on delete restrict;

create function tenant.cash_denominations_valid(
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

create function tenant.tg_cash_shift_scope()
returns trigger language plpgsql as $$
declare
  register_row tenant.physical_register%rowtype;
  device_business uuid;
  device_branch uuid;
  device_version integer;
  device_state text;
  session_business uuid;
  session_branch uuid;
  session_device uuid;
  session_operator uuid;
begin
  select * into register_row
  from tenant.physical_register
  where id=new.register_id for update;
  select business_id,branch_id,credential_version,lifecycle_state
    into device_business,device_branch,device_version,device_state
  from tenant.device where id=new.device_id;
  select business_id,branch_id,device_id,user_id
    into session_business,session_branch,session_device,session_operator
  from runtime.operator_session where id=new.operator_session_id;
  if register_row.id is null
     or register_row.business_id<>new.business_id
     or register_row.branch_id<>new.branch_id
     or register_row.currency<>new.currency
     or not register_row.active
     or register_row.status not in ('available','assigned')
     or (
       register_row.assignment_policy='device_required'
       and register_row.assigned_device_id is distinct from new.device_id
     )
     or device_business<>new.business_id
     or device_branch<>new.branch_id
     or device_version<>new.device_credential_version
     or device_state<>'active'
     or session_business<>new.business_id
     or session_branch<>new.branch_id
     or session_device<>new.device_id
     or session_operator<>new.opening_operator_id
     or not tenant.cash_denominations_valid(
       new.opening_denominations,
       new.opening_float_minor_units,
       new.currency
     ) then
    raise exception 'cash shift scope or opening float is invalid';
  end if;
  return new;
end $$;
create trigger cash_shift_scope before insert on tenant.cash_shift
  for each row execute function tenant.tg_cash_shift_scope();

create function tenant.tg_cash_fact_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'cash fact is immutable';
end $$;

create trigger cash_ledger_immutable before update or delete on tenant.cash_ledger_entry
  for each row execute function tenant.tg_cash_fact_immutable();
create trigger cash_movement_immutable before update or delete on tenant.cash_movement
  for each row execute function tenant.tg_cash_fact_immutable();
create trigger cash_handoff_immutable before update or delete on tenant.cash_shift_handoff
  for each row execute function tenant.tg_cash_fact_immutable();
create trigger cash_count_immutable before update or delete on tenant.cash_count_attempt
  for each row execute function tenant.tg_cash_fact_immutable();
create trigger cash_variance_immutable before update or delete on tenant.cash_variance_resolution
  for each row execute function tenant.tg_cash_fact_immutable();
create trigger cash_reconciliation_immutable before update or delete on tenant.cash_reconciliation
  for each row execute function tenant.tg_cash_fact_immutable();
create trigger cash_close_immutable before update or delete on tenant.cash_shift_close
  for each row execute function tenant.tg_cash_fact_immutable();
create trigger no_sale_drawer_immutable before update or delete on tenant.no_sale_drawer_event
  for each row execute function tenant.tg_cash_fact_immutable();

create function tenant.tg_closed_cash_shift_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then
    raise exception 'cash shift deletion is prohibited';
  end if;
  if old.status='closed' then
    raise exception 'closed cash shift is immutable';
  end if;
  if new.business_id<>old.business_id or new.branch_id<>old.branch_id
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
create trigger cash_shift_identity_immutable before update or delete on tenant.cash_shift
  for each row execute function tenant.tg_closed_cash_shift_immutable();

create function tenant.tg_cash_ledger_open_shift()
returns trigger language plpgsql as $$
declare
  shift_row tenant.cash_shift%rowtype;
begin
  select * into shift_row from tenant.cash_shift where id=new.shift_id for update;
  if shift_row.id is null
     or shift_row.status<>'open'
     or shift_row.business_id<>new.business_id
     or shift_row.branch_id<>new.branch_id
     or shift_row.register_id<>new.register_id
     or shift_row.currency<>new.currency
     or shift_row.business_date<>new.business_date
     or new.sequence<>shift_row.ledger_sequence+1 then
    raise exception 'cash ledger posting requires an eligible unresolved shift';
  end if;
  return new;
end $$;
create trigger cash_ledger_open_shift before insert on tenant.cash_ledger_entry
  for each row execute function tenant.tg_cash_ledger_open_shift();

create function tenant.tg_cash_count_guard()
returns trigger language plpgsql as $$
declare shift_row tenant.cash_shift%rowtype;
begin
  select * into shift_row from tenant.cash_shift where id=new.shift_id for update;
  if shift_row.id is null
     or shift_row.business_id<>new.business_id
     or shift_row.branch_id<>new.branch_id
     or shift_row.register_id<>new.register_id
     or shift_row.currency<>new.currency
     or shift_row.ledger_sequence<>new.ledger_sequence
     or shift_row.status not in ('open','suspended','reconciliation_required')
     or not tenant.cash_denominations_valid(
       new.denominations,
       new.counted_minor_units,
       new.currency
     ) then
    raise exception 'cash count scope or ledger sequence is stale';
  end if;
  return new;
end $$;
create trigger cash_count_guard before insert on tenant.cash_count_attempt
  for each row execute function tenant.tg_cash_count_guard();

create function tenant.tg_cash_reconciliation_guard()
returns trigger language plpgsql as $$
declare
  shift_sequence bigint;
  shift_status text;
  count_shift uuid;
  count_sequence bigint;
  count_amount bigint;
begin
  select ledger_sequence,status into shift_sequence,shift_status
  from tenant.cash_shift where id=new.shift_id for update;
  select shift_id,ledger_sequence,counted_minor_units
    into count_shift,count_sequence,count_amount
  from tenant.cash_count_attempt where id=new.count_attempt_id;
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
create trigger cash_reconciliation_guard before insert on tenant.cash_reconciliation
  for each row execute function tenant.tg_cash_reconciliation_guard();

create function tenant.tg_cash_close_guard()
returns trigger language plpgsql as $$
declare
  shift_status text;
  shift_sequence bigint;
  reconciliation_shift uuid;
  reconciliation_sequence bigint;
begin
  select status,ledger_sequence into shift_status,shift_sequence
  from tenant.cash_shift where id=new.shift_id for update;
  select shift_id,ledger_sequence into reconciliation_shift,reconciliation_sequence
  from tenant.cash_reconciliation where id=new.reconciliation_id;
  if shift_status<>'closing'
     or reconciliation_shift<>new.shift_id
     or reconciliation_sequence<>shift_sequence then
    raise exception 'cash close requires the current reconciliation';
  end if;
  return new;
end $$;
create trigger cash_close_guard before insert on tenant.cash_shift_close
  for each row execute function tenant.tg_cash_close_guard();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'physical_register','cash_shift_policy','cash_shift','cash_ledger_entry',
    'cash_movement','cash_shift_handoff','cash_count_attempt',
    'cash_variance_resolution','cash_reconciliation','cash_shift_close',
    'no_sale_drawer_event'
  ] loop
    execute format('alter table tenant.%I enable row level security',table_name);
    execute format('alter table tenant.%I force row level security',table_name);
    execute format(
      'create policy tenant_branch_isolation on tenant.%I
       using (business_id=umi.current_business() and branch_id=umi.current_branch())
       with check (business_id=umi.current_business() and branch_id=umi.current_branch())',
      table_name
    );
    execute format('revoke all on tenant.%I from public,readonly',table_name);
  end loop;
end $$;

grant select on tenant.physical_register,tenant.cash_shift_policy,tenant.cash_shift,
  tenant.cash_ledger_entry,tenant.cash_movement,tenant.cash_shift_handoff,
  tenant.cash_count_attempt,tenant.cash_variance_resolution,tenant.cash_reconciliation,
  tenant.cash_shift_close,tenant.no_sale_drawer_event to api,worker;
grant insert,update on tenant.physical_register,tenant.cash_shift to api,worker;
grant insert on tenant.cash_ledger_entry,tenant.cash_movement,tenant.cash_shift_handoff,
  tenant.cash_count_attempt,tenant.cash_variance_resolution,tenant.cash_reconciliation,
  tenant.cash_shift_close,tenant.no_sale_drawer_event to api,worker;

comment on table tenant.cash_ledger_entry is
  'Append-only physical cash authority. Expected cash is reproduced from these ordered facts.';
comment on table tenant.cash_count_attempt is
  'Immutable blind-count observations. Counted cash never replaces expected cash.';
comment on table tenant.cash_shift_close is
  'One immutable close result for one fully reconciled cash shift.';
