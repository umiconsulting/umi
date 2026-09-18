\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- build-v3 · 67_table_state — workstream D, steps 3, 4 and 5's live half: where
-- a table is, how long the party has been on it, and which tables are one party.
--
-- WHY THIS IS A TABLE AND NOT A COLUMN ON THE PLAN. The floor plan is a versioned
-- DOCUMENT (`merchant.floor_plan.draft/published`, build-v3-62): it is edited by
-- the dashboard, published when it is right, and read by the POS. Table state is
-- the opposite kind of fact. It changes many times an hour, it belongs to one
-- shift rather than to a layout version, and losing it must not touch the plan.
-- Writing it into the document would bump the plan's version on every seating and
-- would make "publish the layout" and "seat a party" compete for one row lock.
--   So the document says which tables EXIST and where; this table says what is
-- happening ON them right now. `table_id` is the document's element id and there
-- is deliberately no foreign key: the plan is JSON, so there is no row to point
-- at. The map is the authority that a table exists, and every operation below
-- resolves the table against the served document before it writes.
--
-- COLOUR IS NOT A STATE (plan §8D step 3). The six states live in a text column
-- with a CHECK, because a column can be read by a screen reader, printed on a
-- ticket, counted by a report and asserted by a test. A colour cannot.
--
--   open              nobody is on it and it is ready
--   seated            a party is on it
--   ordered           a party is on it and food is in
--   served            a party is on it and food is out
--   awaiting_payment  a party is on it and the bill is asked for
--   dirty             nobody is on it and it needs wiping
--
-- THE INVARIANTS ARE IN SQL, NOT IN THE API, because they are what makes the
-- state readable at all — a row saying `seated` with no `seated_at` is a turn
-- timer with no origin, and a `party_size` of 0 with a party on the table is a
-- number every downstream count would propagate. An application check is a
-- promise; a CHECK constraint is enforced for every writer including a future
-- one, a backfill, and psql.
--
--   table_state_party_presence   a party is present (state in the four party
--                                states) EXACTLY when seated_at is not null.
--   table_state_party_size_present  party_size is present exactly when a party is.
--   table_state_party_size_range party_size is 1..100 when present.
--   table_state_group_requires_party  group_id is non-null only with a party —
--                                a merge group with nobody in it is a dangling
--                                claim that split/move would have to guess about.
--
-- THE TURN TIMER IS IMMUTABLE WHILE A PARTY STAYS (plan §8D step 5, and the
-- acceptance's "a server can move a party of eight ... in fewer than five
-- seconds"): moving a party to another table must not restart its clock, and
-- neither may advancing it to `served`. That is a cross-operation rule that a
-- CHECK cannot express and that a client can silently break, so
-- `table_state_turn_timer_immutable` refuses any UPDATE that changes a non-null
-- seated_at into a different non-null one. Clearing a table (party leaves) and
-- seating one (party arrives) both legitimately set the column, so the trigger
-- only refuses the present-to-present change.
--
-- WHAT IS NOT ENFORCED HERE, STATED PLAINLY. Group coherence — every row sharing
-- a group_id carries the same seated_at and party_size, in one location — is a
-- cross-row rule. It is enforced by the merge/split/move operations and asserted
-- by `table-map/table-state.integration.ts`, not by a constraint; a trigger that
-- reads its own table on every row write would also make a multi-row merge need
-- deferred checking, which this increment does not need. The partial index below
-- is what makes the group lookup cheap enough for those operations.
--
-- SCOPE, RLS AND GRANTS COME AFTER 90_rls, NOT BEFORE, for the reason
-- 65_table_reservation records at length: 90_rls has already swept the catalog,
-- its `alter default privileges` deliberately does not arm the request path, and
-- a table created after the sweep carries the equivalent predicate itself.
--   `api` DOES get DELETE here, unlike on table_reservation, and the difference
-- is the point: a reservation is a claim that happened and stays as history,
-- while a state row is CURRENT state. When a table is removed from the plan its
-- state row is not history, it is stale, and the publish path deletes the ones
-- that have no party on them.
--
-- Idempotent and re-runnable: guarded table, guarded trigger, guarded policy.
-- ============================================================================

create table if not exists merchant.table_state (
  merchant_id uuid not null,
  location_id uuid not null,
  -- The floor-plan element id (the contract's `Id` is a uuid). No foreign key:
  -- the plan is a JSON document, so the map is the authority on existence.
  table_id uuid not null,
  state text not null default 'open'
    check (state in ('open','seated','ordered','served','awaiting_payment','dirty')),
  -- The turn timer's origin. Never rewritten while a party stays (see the
  -- trigger below); reset to null when the party leaves.
  seated_at timestamptz,
  party_size integer,
  -- The merge identity: the tables of one party share one group_id.
  group_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (merchant_id, location_id, table_id),
  foreign key (merchant_id, location_id)
    references merchant.location(merchant_id, id) on delete restrict,
  constraint table_state_party_presence check (
    (state in ('seated','ordered','served','awaiting_payment')) = (seated_at is not null)
  ),
  constraint table_state_party_size_present check (
    (seated_at is not null) = (party_size is not null)
  ),
  constraint table_state_party_size_range check (
    party_size is null or party_size between 1 and 100
  ),
  constraint table_state_group_requires_party check (
    group_id is null or seated_at is not null
  )
);

comment on table merchant.table_state is
  'Live table state for the table map: one row per table that is not simply open. The floor plan (merchant.floor_plan) says which tables exist; this says what is happening on them.';
comment on column merchant.table_state.seated_at is
  'The turn timer''s origin. Refused by table_state_turn_timer_immutable from changing while a party is present, so a move cannot restart the clock.';
comment on column merchant.table_state.group_id is
  'Merge identity: the tables of one merged party share it. Coherence across rows is enforced by the table-map operations, not by a constraint.';

-- The group lookup the merge and split operations make, indexed. Partial so it
-- does not carry the ungrouped majority of tables.
create index if not exists table_state_group_idx
  on merchant.table_state (merchant_id, location_id, group_id)
  where group_id is not null;

-- The turn timer may not restart while a party stays. Present-to-present only:
-- seating sets a null to a timestamp, clearing sets a timestamp to null, and both
-- are legitimate. A present-to-present change is a move that reset the clock, or
-- a service transition that reset it, and both are wrong.
create or replace function merchant.tg_table_state_keep_turn_timer() returns trigger
  language plpgsql
  set search_path = pg_catalog, merchant as $$
begin
  if old.seated_at is not null
     and new.seated_at is not null
     and new.seated_at is distinct from old.seated_at
  then
    raise exception 'TABLE_STATE_TURN_TIMER_RESTART' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists table_state_turn_timer_immutable on merchant.table_state;
create trigger table_state_turn_timer_immutable before update on merchant.table_state
  for each row execute function merchant.tg_table_state_keep_turn_timer();

-- 60_triggers swept the catalog BEFORE this table existed, so the shared
-- `updated_at` trigger is attached here by hand. Same reason as
-- 65_table_reservation: a sweep that has already run cannot see a new table.
drop trigger if exists touch_updated_at on merchant.table_state;
create trigger touch_updated_at before update on merchant.table_state
  for each row execute function public.tg_touch_updated_at();

alter table merchant.table_state enable row level security;
alter table merchant.table_state force row level security;
drop policy if exists table_state_scope on merchant.table_state;
create policy table_state_scope on merchant.table_state
  using (merchant_id = (select umi.current_merchant())
    and ((select umi.current_location()) is null or location_id = (select umi.current_location())))
  with check (merchant_id = (select umi.current_merchant())
    and ((select umi.current_location()) is null or location_id = (select umi.current_location())));

grant select, insert, update, delete on merchant.table_state to api, worker;
grant select on merchant.table_state to readonly;

insert into runtime.schema_migration(version,status)
values('build-v3-67','applied') on conflict(version) do nothing;

commit;
