\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- build-v3 · 65_table_reservation — workstream D, step 6 and its acceptance
-- line: "a double booking is impossible at the database level".
--
-- WHY AN EXCLUSION CONSTRAINT, AND WHY NOT A CHECK. A booking is a claim on a
-- table for a window of time. The failure that matters is two claims on the same
-- table at the same time, and an application check cannot prevent it: "is this
-- table free?" and the INSERT that follows are two statements, so two tills (or
-- two tabs) that run them concurrently both read "free" and both write. Raising
-- the isolation level moves the race rather than closing it — the caller then
-- owes a retry loop. The exclusion constraint is the only form that holds
-- without cooperation: it indexes the windows and refuses the second row inside
-- the same statement that would have committed it.
--   merchant.table_reservation_no_double_booking IS the guarantee.
--
-- WHAT IS EXCLUDED. Same location, same table, overlapping window — but only
-- for the statuses that OCCUPY a table: 'booked' and 'seated'. 'cancelled',
-- 'completed' and 'no_show' release their window, so the table can be re-booked
-- immediately while the rows stay for history. The partial predicate is part of
-- the constraint, not of a call site, so it cannot be forgotten by one caller.
--
-- HALF-OPEN, OR TWO BOOKINGS MUST BE ABLE TO TOUCH. `during` is `[)`: 18:00-20:00
-- and 20:00-22:00 do not overlap, which is what a turn-time board means by
-- "back to back", and it is what tstzrange's && already answers. The checks
-- below make the stored form canonical instead of trusting every writer.
--
-- THE INDEX IS ALSO THE MAP'S READ PATH. The GiST index the constraint builds
-- answers "what is on this table tonight" by (location_id, table_id), which is
-- the query the table map makes on every redraw.
--
-- SCOPE, RLS AND GRANTS COME AFTER 90_rls, NOT BEFORE. 90_rls sweeps the catalog
-- for tables carrying a merchant_id and gives each one a merchant_isolation
-- policy plus a restrictive location_narrowing one; a table created after that
-- sweep carries the equivalent predicate itself, in one policy, exactly as
-- 62_floor_plan does. Same reason for the explicit grants: 90_rls' static grant
-- block has already run, and its `alter default privileges` deliberately does
-- NOT arm the request path, so `api` gets nothing it is not granted here.
--   Measured 2026-09-16 on a fresh build of the whole chain: placing this file
-- before 90_rls instead yields THREE policies on the table (the two sweep
-- policies plus the scope policy) and hands `api` DELETE. Placing it after
-- 90_rls reproduces the live database's shape for 62_floor_plan exactly, which
-- is the placement this chain uses.
--
-- btree_gist, AND WHY THE OPERATOR CLASS IS NAMED. Equality on uuid inside a
-- GiST index is not something PostgreSQL core provides, so the two equality
-- columns need btree_gist. The extension goes into `extensions`, the schema
-- 00_foundation gives every extension. The constraint names the operator class
-- explicitly because an unqualified `with =` is resolved through search_path: a
-- fresh build carries `extensions` on the DATABASE search_path (00_foundation
-- sets it) and the database that holds the customers does not, so the
-- unqualified form would apply on CI and fail on ours.
--   Measured 2026-09-16 with `search_path = "$user", public`:
--     ERROR: data type uuid has no default operator class for access method "gist"
--   `extensions.gist_uuid_ops` resolves under either search_path (verified).
--
-- Idempotent and re-runnable: guarded extension, guarded table, guarded policy,
-- guarded trigger.
-- ============================================================================

create extension if not exists btree_gist schema extensions;

create table if not exists merchant.table_reservation (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null,
  location_id uuid not null,
  -- The floor-plan element's id. The floor plan is a JSON document
  -- (merchant.floor_plan.draft/published), so there is no row to point a foreign
  -- key at; the map is the authority that a table_id exists.
  table_id uuid not null,
  guest_name text,
  guest_phone text,
  party_size integer not null check (party_size between 1 and 100),
  during tstzrange not null,
  status text not null default 'booked'
    check (status in ('booked','seated','completed','cancelled','no_show')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (merchant_id, location_id)
    references merchant.location(merchant_id, id) on delete restrict,
  -- A hold must have two ends. `check` passes on NULL, so `lower < upper` alone
  -- lets a half-open-to-infinity window through — and one of those occupies the
  -- table for ever.
  check (lower(during) is not null and upper(during) is not null),
  check (not isempty(during)),
  check (lower(during) < upper(during)),
  -- Canonical `[)`: a writer cannot widen a hold by handing in `[]`.
  check (lower_inc(during) and not upper_inc(during)),
  constraint table_reservation_no_double_booking exclude using gist (
    location_id extensions.gist_uuid_ops with =,
    table_id    extensions.gist_uuid_ops with =,
    during with &&
  ) where (status in ('booked','seated'))
);

comment on table merchant.table_reservation is
  'A booking holds one floor-plan table for one time window. Overlap is refused by the exclusion constraint, not by the API.';
comment on constraint table_reservation_no_double_booking on merchant.table_reservation is
  'THE GUARANTEE. Two bookings may not hold the same table at the same location over overlapping windows while either is booked or seated. Enforced by the index, in the same statement, so two concurrent writers cannot both pass. An application-level check would race.';

-- 60_triggers swept the catalog for `updated_at` BEFORE this table existed, so
-- the shared trigger is attached here. Same reasoning as 63_channel_attribution's
-- column grants: a sweep that has already run cannot see a table added after it.
drop trigger if exists touch_updated_at on merchant.table_reservation;
create trigger touch_updated_at before update on merchant.table_reservation
  for each row execute function public.tg_touch_updated_at();

alter table merchant.table_reservation enable row level security;
alter table merchant.table_reservation force row level security;
drop policy if exists table_reservation_scope on merchant.table_reservation;
create policy table_reservation_scope on merchant.table_reservation
  using (merchant_id = (select umi.current_merchant())
    and ((select umi.current_location()) is null or location_id = (select umi.current_location())))
  with check (merchant_id = (select umi.current_merchant())
    and ((select umi.current_location()) is null or location_id = (select umi.current_location())));

-- `api` gets no DELETE: a cancellation is a status, and the row is history.
grant select, insert, update on merchant.table_reservation to api, worker;
grant select on merchant.table_reservation to readonly;

insert into runtime.schema_migration(version,status)
values('build-v3-65','applied') on conflict(version) do nothing;

commit;
