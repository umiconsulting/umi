-- Gate 3D: append-only post-sale exceptions and compensating financial facts.

insert into umi.permission (key, description)
values
  ('sale.exception.read', 'Read an eligible sale exception'),
  ('sale.exception.history', 'Read sale exception history'),
  ('sale.void.create', 'Create an eligible sale void'),
  ('sale.refund.full', 'Create a full refund'),
  ('sale.refund.partial', 'Create a partial refund'),
  ('sale.refund.cash', 'Create a cash refund'),
  ('sale.refund.manual_terminal', 'Record a manual terminal refund'),
  ('sale.refund.approve', 'Approve a sensitive sale refund'),
  ('sale.refund.other_operator', 'Refund another operator sale'),
  ('sale.refund.other_location', 'Refund a sale from another location'),
  ('sale.refund.reconcile', 'Reconcile an ambiguous refund')
on conflict (key) do update set description=excluded.description;

insert into umi.role_permission (role_id, permission_id)
select r.id,p.id
from umi.role r cross join umi.permission p
where not r.is_platform
  and r.key in ('owner','admin','manager','supervisor','cashier','staff')
  and p.key in ('sale.exception.read','sale.exception.history','sale.refund.partial')
on conflict do nothing;

insert into umi.role_permission (role_id, permission_id)
select r.id,p.id
from umi.role r cross join umi.permission p
where not r.is_platform
  and r.key in ('owner','admin','manager','supervisor')
  and p.key in (
    'sale.void.create','sale.refund.full','sale.refund.cash',
    'sale.refund.manual_terminal','sale.refund.approve',
    'sale.refund.other_operator','sale.refund.reconcile'
  )
on conflict do nothing;

create table merchant.pos_exception_policy (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  version text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  refunds_enabled boolean not null default false,
  voids_enabled boolean not null default false,
  refund_window_minutes integer not null default 0 check (refund_window_minutes between 0 and 525600),
  void_window_minutes integer not null default 0 check (void_window_minutes between 0 and 10080),
  cashier_refund_threshold bigint not null default 0
    check (cashier_refund_threshold between 0 and 9007199254740991),
  cash_refund_threshold bigint not null default 0
    check (cash_refund_threshold between 0 and 9007199254740991),
  cash_refund_requires_shift boolean not null default true,
  require_different_approver boolean not null default true,
  tender_allocation_policy text not null default 'proportional'
    check (tender_allocation_policy in ('proportional','terminal_first','cash_first')),
  tip_refund_policy text not null default 'non_refundable'
    check (tip_refund_policy in (
      'non_refundable','full_refund_only','proportional','manager_selectable','support_required'
    )),
  maximum_lines integer not null default 100 check (maximum_lines between 1 and 500),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  unique(merchant_id,location_id,currency)
);

create table merchant.pos_exception_preview (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  sale_id uuid not null references merchant.pos_committed_sale(id) on delete restrict,
  original_receipt_id uuid not null references merchant.receipt_snapshot(id) on delete restrict,
  operator_session_id uuid not null references runtime.operator_session(id) on delete restrict,
  device_id uuid not null references merchant.device(id) on delete restrict,
  exception_type text not null check (exception_type in ('void','full_refund','partial_refund')),
  reason_code text not null check (reason_code ~ '^[a-z0-9_.-]{1,80}$'),
  note text check (length(note) <= 160 and note !~ '[<>]'),
  selection jsonb not null,
  line_allocations jsonb not null,
  tender_allocations jsonb not null,
  terminal_refund_status text check (terminal_refund_status is null or terminal_refund_status in (
    'not_started','operator_processing_externally','awaiting_operator_confirmation',
    'confirmed_success','operator_reported_failure','outcome_unknown','cancelled_before_confirmation'
  )),
  allocation_policy text not null check (allocation_policy in (
    'proportional','terminal_first','cash_first'
  )),
  restock_intents jsonb not null,
  merchandise_minor_units bigint not null check (merchandise_minor_units between 0 and 9007199254740991),
  tax_minor_units bigint not null check (tax_minor_units between 0 and 9007199254740991),
  discount_minor_units bigint not null check (discount_minor_units between 0 and 9007199254740991),
  tip_minor_units bigint not null check (tip_minor_units between 0 and 9007199254740991),
  total_minor_units bigint not null check (total_minor_units between 1 and 9007199254740991),
  remaining_after_minor_units bigint not null check (remaining_after_minor_units between 0 and 9007199254740991),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  approval_required boolean not null,
  sale_version bigint not null check (sale_version > 0),
  exception_version bigint not null check (exception_version >= 0),
  preview_fingerprint text not null check (preview_fingerprint ~ '^[a-f0-9]{64}$'),
  correlation_id text not null check (length(correlation_id) between 1 and 100),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table merchant.pos_sale_exception (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  sale_id uuid not null references merchant.pos_committed_sale(id) on delete restrict,
  original_receipt_id uuid not null references merchant.receipt_snapshot(id) on delete restrict,
  preview_id uuid not null unique references merchant.pos_exception_preview(id) on delete restrict,
  exception_type text not null check (exception_type in ('void','full_refund','partial_refund')),
  status text not null check (status in ('committed','outcome_unknown','reconciliation_required')),
  reason_code text not null check (reason_code ~ '^[a-z0-9_.-]{1,80}$'),
  note text check (length(note) <= 160 and note !~ '[<>]'),
  operator_id uuid not null references umi.user(id) on delete restrict,
  operator_session_id uuid not null references runtime.operator_session(id) on delete restrict,
  device_id uuid not null references merchant.device(id) on delete restrict,
  device_credential_version integer not null check (device_credential_version > 0),
  approval_id uuid unique references runtime.elevation_grant(id) on delete restrict,
  command_id uuid not null,
  idempotency_key uuid not null,
  command_fingerprint text not null check (command_fingerprint ~ '^[a-f0-9]{64}$'),
  preview_fingerprint text not null check (preview_fingerprint ~ '^[a-f0-9]{64}$'),
  merchandise_minor_units bigint not null check (merchandise_minor_units between 0 and 9007199254740991),
  tax_minor_units bigint not null check (tax_minor_units between 0 and 9007199254740991),
  discount_minor_units bigint not null check (discount_minor_units between 0 and 9007199254740991),
  tip_minor_units bigint not null check (tip_minor_units between 0 and 9007199254740991),
  total_minor_units bigint not null check (total_minor_units between 1 and 9007199254740991),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  business_date date not null,
  correlation_id text not null check (length(correlation_id) between 1 and 100),
  committed_at timestamptz not null default now(),
  unique(merchant_id,command_id),
  unique(merchant_id,idempotency_key)
);

create table merchant.pos_sale_exception_line (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  exception_id uuid not null references merchant.pos_sale_exception(id) on delete restrict,
  sale_id uuid not null references merchant.pos_committed_sale(id) on delete restrict,
  sale_line_id uuid not null references merchant.pos_cart_line(id) on delete restrict,
  original_quantity integer not null check (original_quantity between 1 and 100000),
  compensated_quantity integer not null check (compensated_quantity between 1 and original_quantity),
  original_merchandise_minor_units bigint not null check (original_merchandise_minor_units between 0 and 9007199254740991),
  original_tax_minor_units bigint not null check (original_tax_minor_units between 0 and 9007199254740991),
  original_discount_minor_units bigint not null check (original_discount_minor_units between 0 and 9007199254740991),
  original_tip_minor_units bigint not null check (original_tip_minor_units between 0 and 9007199254740991),
  original_total_minor_units bigint not null check (original_total_minor_units between 0 and 9007199254740991),
  merchandise_minor_units bigint not null check (merchandise_minor_units between 0 and 9007199254740991),
  tax_minor_units bigint not null check (tax_minor_units between 0 and 9007199254740991),
  discount_minor_units bigint not null check (discount_minor_units between 0 and 9007199254740991),
  tip_minor_units bigint not null check (tip_minor_units between 0 and 9007199254740991),
  total_minor_units bigint not null check (total_minor_units between 0 and 9007199254740991),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  restock_decision text not null check (restock_decision in (
    'restock','do_not_restock','inspection_required','not_applicable','unknown_until_inventory_review'
  )),
  unique(exception_id,sale_line_id)
);

create table merchant.pos_tender_compensation (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  exception_id uuid not null references merchant.pos_sale_exception(id) on delete restrict,
  original_tender_id uuid not null references merchant.pos_tender_fact(id) on delete restrict,
  tender_type text not null check (tender_type in ('cash','manual_terminal')),
  amount_minor_units bigint not null check (amount_minor_units between 1 and 9007199254740991),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  reversal_status text not null check (reversal_status in (
    'confirmed_success','operator_reported_failure','outcome_unknown'
  )),
  correlation_id text not null check (length(correlation_id) between 1 and 100),
  operator_asserted boolean not null default false,
  created_at timestamptz not null default now(),
  unique(exception_id,original_tender_id)
);

create table merchant.pos_cash_compensation (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  exception_id uuid not null references merchant.pos_sale_exception(id) on delete restrict,
  original_tender_id uuid not null references merchant.pos_tender_fact(id) on delete restrict,
  current_shift_id uuid not null references merchant.cash_shift(id) on delete restrict,
  current_register_id uuid not null references merchant.physical_register(id) on delete restrict,
  ledger_entry_id uuid not null unique references merchant.cash_ledger_entry(id) on delete restrict,
  amount_minor_units bigint not null check (amount_minor_units between 1 and 9007199254740991),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  unique(exception_id,original_tender_id)
);

create table merchant.pos_restock_intent (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  exception_line_id uuid not null unique references merchant.pos_sale_exception_line(id) on delete restrict,
  sale_line_id uuid not null references merchant.pos_cart_line(id) on delete restrict,
  quantity integer not null check (quantity between 1 and 100000),
  decision text not null check (decision in (
    'restock','do_not_restock','inspection_required','not_applicable','unknown_until_inventory_review'
  )),
  inventory_status text not null default 'intent_only' check (inventory_status='intent_only'),
  created_at timestamptz not null default now()
);

create table merchant.pos_exception_receipt (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete restrict,
  location_id uuid not null references merchant.location(id) on delete restrict,
  exception_id uuid not null unique references merchant.pos_sale_exception(id) on delete restrict,
  original_receipt_id uuid not null references merchant.receipt_snapshot(id) on delete restrict,
  receipt_number text not null,
  snapshot jsonb not null,
  business_date date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  total_minor_units bigint not null check (total_minor_units between 1 and 9007199254740991),
  issued_at timestamptz not null default now(),
  unique(merchant_id,receipt_number)
);

alter table merchant.cash_ledger_entry
  drop constraint cash_ledger_entry_entry_type_check;
alter table merchant.cash_ledger_entry
  add constraint cash_ledger_entry_entry_type_check check (entry_type in (
    'opening_float','cash_sale','cash_refund','paid_in','paid_out','safe_drop',
    'drawer_correction','handoff_transfer','count_observation','variance_resolution','close_adjustment'
  ));
alter table merchant.cash_ledger_entry
  add column sale_exception_id uuid references merchant.pos_sale_exception(id) on delete restrict;
create unique index cash_ledger_exception_uq
  on merchant.cash_ledger_entry(sale_exception_id) where sale_exception_id is not null;

create function merchant.tg_pos_exception_line_limit()
returns trigger language plpgsql as $$
declare prior_quantity bigint;
declare source_quantity bigint;
declare source_merchandise bigint;
declare source_tax bigint;
declare source_discount bigint;
declare source_tip bigint;
declare source_total bigint;
declare receipt_has_discount boolean;
declare receipt_has_tip boolean;
declare receipt_tip bigint;
declare direct_discount bigint;
declare order_discount bigint;
declare order_share bigint;
declare line_ordinal bigint;
declare last_ordinal bigint;
declare gross_total bigint;
declare prior_order_share bigint;
declare prior_tip_share bigint;
declare prior_merchandise bigint;
declare prior_tax bigint;
declare prior_discount bigint;
declare prior_tip bigint;
declare prior_total bigint;
begin
  select l.quantity,
         ((receipt_line->'lineTotal'->>'minorUnits')::bigint-
          coalesce((receipt_line->'tax'->>'minorUnits')::bigint,0)),
         coalesce((receipt_line->'tax'->>'minorUnits')::bigint,0),
         coalesce((receipt_line->'discount'->>'minorUnits')::bigint,0),
         coalesce((receipt_line->'tip'->>'minorUnits')::bigint,0),
         ((receipt_line->'lineTotal'->>'minorUnits')::bigint-
          coalesce((receipt_line->'discount'->>'minorUnits')::bigint,0)+
          coalesce((receipt_line->'tip'->>'minorUnits')::bigint,0)),
         receipt_line ? 'discount',receipt_line ? 'tip',
         coalesce((r.snapshot->'tip'->>'minorUnits')::bigint,0)
    into source_quantity,source_merchandise,source_tax,source_discount,source_tip,source_total,
         receipt_has_discount,receipt_has_tip,receipt_tip
  from merchant.pos_cart_line l
  join merchant.pos_committed_sale s on s.cart_id=l.cart_id and s.id=new.sale_id
  join merchant.receipt_snapshot r on r.id=s.receipt_snapshot_id
  cross join lateral (
    select value as receipt_line from jsonb_array_elements(r.snapshot->'lines') value
    where value->>'lineRef'=new.sale_line_id::text
  ) receipt
  where l.id=new.sale_line_id;
  if source_quantity is not null and not receipt_has_discount then
    with pairs as (
      select draft.value as draft,entry.value as entry
      from merchant.pos_committed_sale sale
      join merchant.pos_checkout_draft checkout on checkout.cart_id=sale.cart_id
      cross join lateral jsonb_array_elements(checkout.discount_drafts)
        with ordinality draft(value,ordinal)
      join lateral jsonb_array_elements(checkout.payment_summary->'discounts'->'entries')
        with ordinality entry(value,ordinal) using (ordinal)
      where sale.id=new.sale_id and checkout.state in ('completed','receipt_available')
    )
    select coalesce(sum((entry->'amount'->>'minorUnits')::bigint)
             filter (where draft->>'lineId'=new.sale_line_id::text),0),
           coalesce(sum((entry->'amount'->>'minorUnits')::bigint)
             filter (where draft->>'lineId' is null),0)
      into direct_discount,order_discount from pairs;
    with receipt_lines as (
      select value,ordinal,
             sum((value->'lineTotal'->>'minorUnits')::bigint) over () as total,
             max(ordinal) over () as last
      from merchant.pos_committed_sale sale
      join merchant.receipt_snapshot snapshot on snapshot.id=sale.receipt_snapshot_id
      cross join lateral jsonb_array_elements(snapshot.snapshot->'lines')
        with ordinality line(value,ordinal)
      where sale.id=new.sale_id
    )
    select target.ordinal,target.last,target.total,
           coalesce((select sum(
             floor((order_discount::numeric*(prior.value->'lineTotal'->>'minorUnits')::numeric)/
               greatest(prior.total,1))::bigint)
             from receipt_lines prior where prior.ordinal<prior.last),0)
      into line_ordinal,last_ordinal,gross_total,prior_order_share
    from receipt_lines target
    where target.value->>'lineRef'=new.sale_line_id::text;
    if line_ordinal=last_ordinal then
      order_share:=order_discount-prior_order_share;
    else
      order_share:=floor((order_discount::numeric*(source_merchandise+source_tax)::numeric)/
        greatest(gross_total,1))::bigint;
    end if;
    source_discount:=direct_discount+order_share;
    source_total:=source_merchandise+source_tax-source_discount+source_tip;
  end if;
  if source_quantity is not null and not receipt_has_tip then
    with receipt_lines as (
      select value,ordinal,
             sum((value->'lineTotal'->>'minorUnits')::bigint) over () as total,
             max(ordinal) over () as last
      from merchant.pos_committed_sale sale
      join merchant.receipt_snapshot snapshot on snapshot.id=sale.receipt_snapshot_id
      cross join lateral jsonb_array_elements(snapshot.snapshot->'lines')
        with ordinality line(value,ordinal)
      where sale.id=new.sale_id
    )
    select target.ordinal,target.last,target.total,
           coalesce((select sum(
             floor((receipt_tip::numeric*(prior.value->'lineTotal'->>'minorUnits')::numeric)/
               greatest(prior.total,1))::bigint)
             from receipt_lines prior where prior.ordinal<prior.last),0)
      into line_ordinal,last_ordinal,gross_total,prior_tip_share
    from receipt_lines target
    where target.value->>'lineRef'=new.sale_line_id::text;
    if line_ordinal=last_ordinal then
      source_tip:=receipt_tip-prior_tip_share;
    else
      source_tip:=floor((receipt_tip::numeric*(source_merchandise+source_tax)::numeric)/
        greatest(gross_total,1))::bigint;
    end if;
    source_total:=source_merchandise+source_tax-source_discount+source_tip;
  end if;
  if source_quantity is null or source_quantity<>new.original_quantity
     or source_merchandise<>new.original_merchandise_minor_units
     or source_tax<>new.original_tax_minor_units
     or source_discount<>new.original_discount_minor_units
     or source_tip<>new.original_tip_minor_units
     or source_total<>new.original_total_minor_units then
    raise exception 'refund source line mismatch';
  end if;
  select coalesce(sum(compensated_quantity),0),
         coalesce(sum(merchandise_minor_units),0),coalesce(sum(tax_minor_units),0),
         coalesce(sum(discount_minor_units),0),coalesce(sum(tip_minor_units),0),
         coalesce(sum(total_minor_units),0)
    into prior_quantity,prior_merchandise,prior_tax,prior_discount,prior_tip,prior_total
  from merchant.pos_sale_exception_line
  where sale_id=new.sale_id and sale_line_id=new.sale_line_id;
  if prior_quantity+new.compensated_quantity>source_quantity
     or prior_merchandise+new.merchandise_minor_units>new.original_merchandise_minor_units
     or prior_tax+new.tax_minor_units>new.original_tax_minor_units
     or prior_discount+new.discount_minor_units>new.original_discount_minor_units
     or prior_tip+new.tip_minor_units>new.original_tip_minor_units
     or prior_total+new.total_minor_units>new.original_total_minor_units then
    raise exception 'refund exceeds remaining line facts';
  end if;
  return new;
end $$;
create trigger pos_exception_line_limit before insert on merchant.pos_sale_exception_line
  for each row execute function merchant.tg_pos_exception_line_limit();

create function merchant.tg_pos_exception_preview_transition()
returns trigger language plpgsql as $$
begin
  if old.terminal_refund_status in ('confirmed_success','outcome_unknown')
     and new.terminal_refund_status is distinct from old.terminal_refund_status then
    raise exception 'terminal refund outcome is immutable';
  end if;
  if new.merchant_id is distinct from old.merchant_id
     or new.location_id is distinct from old.location_id
     or new.sale_id is distinct from old.sale_id
     or new.original_receipt_id is distinct from old.original_receipt_id
     or new.operator_session_id is distinct from old.operator_session_id
     or new.device_id is distinct from old.device_id
     or new.exception_type is distinct from old.exception_type
     or new.reason_code is distinct from old.reason_code
     or new.note is distinct from old.note
     or new.selection is distinct from old.selection
     or new.line_allocations is distinct from old.line_allocations
     or new.tender_allocations is distinct from old.tender_allocations
     or new.allocation_policy is distinct from old.allocation_policy
     or new.restock_intents is distinct from old.restock_intents
     or new.merchandise_minor_units is distinct from old.merchandise_minor_units
     or new.tax_minor_units is distinct from old.tax_minor_units
     or new.discount_minor_units is distinct from old.discount_minor_units
     or new.tip_minor_units is distinct from old.tip_minor_units
     or new.total_minor_units is distinct from old.total_minor_units
     or new.remaining_after_minor_units is distinct from old.remaining_after_minor_units
     or new.currency is distinct from old.currency
     or new.approval_required is distinct from old.approval_required
     or new.sale_version is distinct from old.sale_version
     or new.exception_version is distinct from old.exception_version
     or new.preview_fingerprint is distinct from old.preview_fingerprint
     or new.correlation_id is distinct from old.correlation_id
     or new.expires_at is distinct from old.expires_at
     or new.created_at is distinct from old.created_at then
    raise exception 'refund preview financial facts are immutable';
  end if;
  return new;
end $$;
create trigger pos_exception_preview_transition before update on merchant.pos_exception_preview
  for each row execute function merchant.tg_pos_exception_preview_transition();

create function merchant.tg_pos_exception_approval_binding()
returns trigger language plpgsql as $$
declare approval_required boolean;
declare preview_total bigint;
declare source_total bigint;
declare prior_total bigint;
begin
  select p.approval_required,p.total_minor_units into approval_required,preview_total
  from merchant.pos_exception_preview p
  where p.id=new.preview_id and p.sale_id=new.sale_id
    and p.merchant_id=new.merchant_id and p.location_id=new.location_id
    and p.preview_fingerprint=new.preview_fingerprint
  for share;
  select r.grand_total,coalesce(sum(x.total_minor_units),0)
    into source_total,prior_total
  from merchant.pos_committed_sale s
  join merchant.receipt_snapshot r on r.id=s.receipt_snapshot_id
  left join merchant.pos_sale_exception x on x.sale_id=s.id
  where s.id=new.sale_id
  group by r.grand_total;
  if preview_total is null or preview_total<>new.total_minor_units
     or source_total is null or prior_total+new.total_minor_units>source_total then
    raise exception 'refund exceeds remaining sale facts';
  end if;
  if approval_required and new.approval_id is null then
    raise exception 'refund approval is required';
  end if;
  if new.approval_id is not null and not exists(
    select 1 from runtime.elevation_grant g
    where g.id=new.approval_id and g.merchant_id=new.merchant_id
      and g.location_id=new.location_id and g.permission_key='sale.refund.approve'
      and g.method='manager_approval' and g.command_fingerprint=new.command_fingerprint
      and g.consumed_at is not null and g.consumed_by_command_id=new.command_id
      and g.approved_by is not null and g.expires_at>=g.consumed_at
  ) then
    raise exception 'refund approval binding mismatch';
  end if;
  return new;
end $$;
create trigger pos_exception_approval_binding before insert on merchant.pos_sale_exception
  for each row execute function merchant.tg_pos_exception_approval_binding();

create function merchant.tg_pos_cash_compensation_binding()
returns trigger language plpgsql as $$
begin
  if not exists(
    select 1
    from merchant.pos_sale_exception x
    join merchant.pos_committed_sale s on s.id=x.sale_id
    join merchant.pos_tender_fact t on t.id=new.original_tender_id and t.cart_id=s.cart_id
    join merchant.cash_shift sh on sh.id=new.current_shift_id
    join merchant.cash_ledger_entry le on le.id=new.ledger_entry_id
    where x.id=new.exception_id and x.merchant_id=new.merchant_id
      and x.location_id=new.location_id and t.tender_type='cash'
      and sh.merchant_id=new.merchant_id and sh.location_id=new.location_id
      and sh.register_id=new.current_register_id and sh.status='open'
      and sh.currency=new.currency
      and le.sale_exception_id=new.exception_id and le.shift_id=new.current_shift_id
      and le.register_id=new.current_register_id and le.entry_type='cash_refund'
      and le.amount_minor_units=new.amount_minor_units and le.currency=new.currency
  ) then
    raise exception 'cash refund binding mismatch';
  end if;
  return new;
end $$;
create trigger pos_cash_compensation_binding before insert on merchant.pos_cash_compensation
  for each row execute function merchant.tg_pos_cash_compensation_binding();

create function merchant.tg_pos_tender_compensation_limit()
returns trigger language plpgsql as $$
declare source_amount bigint;
declare prior_amount bigint;
begin
  select amount_minor_units into source_amount
  from merchant.pos_tender_fact where id=new.original_tender_id for share;
  select coalesce(sum(amount_minor_units),0) into prior_amount
  from merchant.pos_tender_compensation where original_tender_id=new.original_tender_id;
  if source_amount is null or prior_amount+new.amount_minor_units>source_amount then
    raise exception 'refund exceeds remaining tender facts';
  end if;
  return new;
end $$;
create trigger pos_tender_compensation_limit before insert on merchant.pos_tender_compensation
  for each row execute function merchant.tg_pos_tender_compensation_limit();

create function merchant.tg_pos_exception_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'post-sale compensation is append-only';
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'pos_sale_exception','pos_sale_exception_line','pos_tender_compensation',
    'pos_cash_compensation','pos_restock_intent','pos_exception_receipt'
  ] loop
    execute format('create trigger %I_append_only before update or delete on merchant.%I
      for each row execute function merchant.tg_pos_exception_append_only()',table_name,table_name);
  end loop;
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'pos_exception_policy','pos_exception_preview','pos_sale_exception',
    'pos_sale_exception_line','pos_tender_compensation','pos_cash_compensation',
    'pos_restock_intent','pos_exception_receipt'
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

grant select on merchant.pos_exception_policy,merchant.pos_exception_preview,
  merchant.pos_sale_exception,merchant.pos_sale_exception_line,
  merchant.pos_tender_compensation,merchant.pos_cash_compensation,
  merchant.pos_restock_intent,merchant.pos_exception_receipt to api,worker;
grant insert on merchant.pos_exception_preview,merchant.pos_sale_exception,
  merchant.pos_sale_exception_line,merchant.pos_tender_compensation,
  merchant.pos_cash_compensation,merchant.pos_restock_intent,
  merchant.pos_exception_receipt to api,worker;
grant update on merchant.pos_exception_preview to api,worker;

comment on table merchant.pos_sale_exception is
  'Immutable post-sale exception. It never changes the original committed sale.';
comment on table merchant.pos_tender_compensation is
  'Append-only compensation linked to one original tender fact.';
comment on table merchant.pos_restock_intent is
  'Inventory intent only. Gate 3D does not change stock.';
comment on table merchant.pos_exception_receipt is
  'Immutable exception receipt. It never replaces the original receipt.';
