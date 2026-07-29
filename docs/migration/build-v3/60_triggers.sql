-- ============================================================================
-- build-v3 · 60_triggers
-- Attach the shared touch-updated_at trigger to every base table that has an
-- updated_at column (dynamic — no per-table maintenance).
-- ============================================================================
do $$
declare r record;
begin
  for r in
    select c.table_schema, c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.column_name = 'updated_at'
      and c.table_schema in ('umi','tenant','runtime')
      and t.table_type = 'BASE TABLE'
  loop
    execute format(
      'create trigger touch_updated_at before update on %I.%I
         for each row execute function public.tg_touch_updated_at()',
      r.table_schema, r.table_name);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- tenant.contact.normalized_value is DERIVED, never supplied (BACKFILL_METHODOLOGY
-- L15). The app used to hand-roll its own normalization into this column, which is
-- how the corruption stayed self-consistent — the same broken function on read AND
-- write, so a phantom key still matched. Deriving it here (plus the
-- REVOKE UPDATE (normalized_value) in 90_rls) makes the column UNFORGEABLE: raw is
-- the truth, normalized is a pure function of it.
-- ----------------------------------------------------------------------------
create or replace function tenant.tg_contact_normalize() returns trigger
  language plpgsql
  set search_path = pg_catalog as $$
declare
  v_channel_key text;
begin
  select ct.key into v_channel_key from umi.channel_type ct where ct.id = new.channel_id;
  -- phone-family carries the number in raw_phone_number; other channels in raw_value.
  new.normalized_value := tenant.normalize_identity(
    v_channel_key,
    coalesce(new.raw_phone_number, new.raw_value)
  );
  return new;
end $$;

-- Fires on EVERY insert/update (not column-scoped): an UPDATE that touched only
-- normalized_value would otherwise skip the trigger and forge the column.
create trigger contact_normalize
  before insert or update on tenant.contact
  for each row execute function tenant.tg_contact_normalize();

-- ============================================================================
-- POS INTEGRITY TRIGGERS
-- ============================================================================

-- A branch must belong to the business the row claims. Most POS tables get this
-- structurally through the composite FK on tenant.branch (business_id, id); the
-- integrity tables carry a nullable branch_id, which a composite FK cannot express,
-- so they get it here instead.
create or replace function tenant.tg_integrity_scope() returns trigger
  language plpgsql
  set search_path = pg_catalog as $$
begin
  if new.branch_id is not null and not exists (
    select 1 from tenant.branch where id = new.branch_id and business_id = new.business_id
  ) then
    raise exception 'branch_tenant_mismatch' using errcode = '23514';
  end if;
  -- A compensating entry must compensate something in the SAME business, or a refund
  -- in one café could cancel a sale in another.
  --
  -- The table test MUST be its own statement. Folding it into a single condition —
  -- `if tg_table_name = 'financial_event' and new.compensates_event_id is not null` —
  -- compiles to one SQL expression, and SQL's AND does not promise to short-circuit,
  -- so PL/pgSQL resolves the field against whichever record it was handed and raises
  -- `record "new" has no field "compensates_event_id"` on every audit_event insert.
  -- One trigger function serving three tables has to branch before it reads.
  if tg_table_name = 'financial_event' then
    if new.compensates_event_id is not null and not exists (
      select 1 from tenant.financial_event
      where id = new.compensates_event_id and business_id = new.business_id
    ) then
      raise exception 'compensation_tenant_mismatch' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger business_command_scope before insert on tenant.business_command
  for each row execute function tenant.tg_integrity_scope();
create trigger audit_event_scope before insert on tenant.audit_event
  for each row execute function tenant.tg_integrity_scope();
create trigger financial_event_scope before insert on tenant.financial_event
  for each row execute function tenant.tg_integrity_scope();

-- The audit hash chain. Each event hashes the previous event's hash, so removing or
-- editing any row in the middle breaks every hash after it and the tampering is
-- detectable without a second copy of the data.
--
-- The advisory lock serialises writers PER BUSINESS: without it two concurrent events
-- read the same predecessor and the chain forks, which silently destroys the property
-- the table exists for. Locking per business rather than globally keeps one busy café
-- from serialising every other café's audit writes.
--
-- occurred_at is overwritten with the SERVER clock. A caller — including a till whose
-- clock has drifted — must not be able to choose where in the chain its event lands.
create or replace function tenant.tg_audit_event_hash() returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, extensions as $$
declare
  prior text;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.business_id::text, 0));
  select event_hash into prior
    from tenant.audit_event
   where business_id = new.business_id
   order by occurred_at desc, id desc
   limit 1;
  new.previous_hash := prior;
  new.occurred_at := clock_timestamp();
  new.event_hash := encode(extensions.digest(
    concat_ws('|', new.id, new.business_id, coalesce(new.branch_id::text, ''),
      coalesce(new.actor_user_id::text, ''), coalesce(new.command_id::text, ''),
      new.event_type, new.entity_type, coalesce(new.entity_id::text, ''),
      new.outcome, coalesce(new.reason_code, ''), new.public_data::text,
      new.correlation_id, coalesce(prior, ''), new.occurred_at::text),
    'sha256'), 'hex');
  return new;
end $$;

create trigger audit_event_hash before insert on tenant.audit_event
  for each row execute function tenant.tg_audit_event_hash();

-- Append-only: history that can be edited is not history.
create trigger audit_event_append_only before update or delete on tenant.audit_event
  for each row execute function tenant.tg_append_only();
create trigger financial_event_append_only before update or delete on tenant.financial_event
  for each row execute function tenant.tg_append_only();
create trigger receipt_snapshot_append_only before update or delete on tenant.receipt_snapshot
  for each row execute function tenant.tg_append_only();
create trigger committed_sale_append_only before update or delete on tenant.pos_committed_sale
  for each row execute function tenant.tg_append_only();
create trigger offline_replay_command_append_only
  before update or delete on tenant.offline_replay_command
  for each row execute function tenant.tg_append_only();
create trigger offline_mapping_append_only
  before update or delete on tenant.offline_provisional_mapping
  for each row execute function tenant.tg_append_only();
create trigger audit_internal_append_only
  before update or delete on runtime.audit_event_internal
  for each row execute function tenant.tg_append_only();

-- Losing a terminal must end everything it could do, in one statement, at the moment
-- its status changes — not when some service remembers to clean up. Sessions are
-- addressed through (principal_type, principal_id), which is how this schema models a
-- session's subject.
create or replace function runtime.revoke_device_sessions() returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog as $$
begin
  if new.status in ('revoked','replaced','rotated')
     and old.status is distinct from new.status then
    update runtime.session
       set is_active = false,
           revoked_at = coalesce(revoked_at, now()),
           revoked_reason = 'device_' || new.status
     where principal_type = 'device' and principal_id = new.id and is_active;
    update runtime.operator_session
       set state = 'ended', ended_at = now()
     where device_id = new.id and state <> 'ended';
  end if;
  return new;
end $$;

create trigger device_session_revocation
  after update of status on tenant.device
  for each row execute function runtime.revoke_device_sessions();

-- Defence in depth for offline replay. RLS already scopes these rows to the proven
-- device; this refuses the write even if a caller reaches the table another way —
-- through the worker pool, a future service, or a mistake. A revoked device, a rotated
-- credential, an ended shift or a missing permission each stop the sale here, in the
-- database, where no application bug can talk past it.
create or replace function tenant.validate_offline_replay_authority() returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog as $$
declare
  device_record   record;
  operator_record record;
begin
  select business_id, branch_id, credential_version, status
    into device_record
    from tenant.device where id = new.device_id;
  if not found
     or device_record.business_id <> new.business_id
     or device_record.branch_id is distinct from new.branch_id
     or device_record.credential_version <> new.credential_version
     or device_record.status <> 'active' then
    raise exception using errcode = '42501', message = 'offline replay authority invalid';
  end if;

  select business_id, branch_id, device_id, state, expires_at, permissions
    into operator_record
    from runtime.operator_session where id = new.operator_session_id;
  if not found
     or operator_record.business_id <> new.business_id
     or operator_record.branch_id <> new.branch_id
     or operator_record.device_id <> new.device_id
     or operator_record.state <> 'active'
     or operator_record.expires_at <= clock_timestamp()
     or not ('offline.replay' = any(operator_record.permissions)
             or '*' = any(operator_record.permissions)) then
    raise exception using errcode = '42501',
      message = 'offline replay operator authority invalid';
  end if;
  return new;
end $$;

create trigger offline_replay_authority_guard
  before insert on tenant.offline_replay_command
  for each row execute function tenant.validate_offline_replay_authority();

-- ----------------------------------------------------------------------------
-- THE BUSINESS DATE is derived, never supplied.
--
-- Same discipline as tenant.contact.normalized_value: a column a caller could write
-- is a column a caller can get wrong, and this one decides which day's revenue a sale
-- lands in. A POS terminal with a drifted clock, or a client that computes midnight in
-- the wrong timezone, would silently move money between trading days.
--
-- The source timestamp differs per table (customer_order has placed_at, pos_cart has
-- created_at), so the column name is passed as a trigger argument and read through
-- to_jsonb rather than duplicating the function. Subtracting business_day_start before
-- casting to date is what makes an 01:00 sale belong to the previous trading day.
-- ----------------------------------------------------------------------------
create or replace function tenant.tg_business_date() returns trigger
  language plpgsql
  set search_path = pg_catalog as $$
declare
  v_tz        text;
  v_day_start time;
  v_at        timestamptz;
begin
  select b.timezone, b.business_day_start
    into v_tz, v_day_start
    from tenant.business b
   where b.id = new.business_id;
  if v_tz is null then
    raise exception 'business_date: unknown business %', new.business_id using errcode = '23503';
  end if;
  v_at := coalesce((to_jsonb(new) ->> tg_argv[0])::timestamptz, now());
  new.business_date := ((v_at at time zone v_tz) - v_day_start::interval)::date;
  return new;
end $$;

-- INSERT **or UPDATE**, for the same reason contact_normalize does: a trigger that
-- only fires on insert leaves the column forgeable by a later UPDATE. Re-deriving is
-- idempotent, so firing on update costs nothing and closes the hole.
create trigger customer_order_business_date
  before insert or update on tenant.customer_order
  for each row execute function tenant.tg_business_date('placed_at');

-- The POS cart carries one too, and it must be derived by the SAME function, or the
-- cart and the order it becomes could disagree about the day.
create trigger pos_cart_business_date
  before insert or update on tenant.pos_cart
  for each row execute function tenant.tg_business_date('created_at');
