\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- build-v3 · 74_kitchen_courses — §8H step 4: courses and staging.
--
-- THE PROBLEM THE COLUMN SOLVES. A ticket is not a single firing. A table orders
-- starters and mains, and the kitchen must not send the second course out with the
-- first — a dessert that leaves with the entradas is a dessert the guest eats warm
-- and an hour early. Nothing in this build could express that: `merchant.order_item`,
-- `merchant.pos_cart_line`, `merchant.kitchen_order_item` and `merchant.kitchen_order`
-- carried no course at all, so every line was course 1 and the whole ticket fired at
-- once, by construction.
--
-- THE MODEL, IN ONE SENTENCE. `course_number` is 1-based and lives on BOTH the order
-- line and the kitchen line, so the till's intent survives the projection; and
-- `fired_through_course` lives on the kitchen ORDER, so "what the kitchen is working
-- on right now" is a fact in one row rather than a guess made per item.
--
--   an item is FIRED  ⇔  course_number <= fired_through_course
--   an item is HELD   ⇔  course_number >  fired_through_course
--
-- WHY THE FLAG IS DERIVED AND NOT STORED. A stored `fired boolean` per item would be
-- a second place for the truth, and the two places would disagree the moment a ticket
-- fired course 2 and someone corrected course 1. Every reader computes the flag from
-- the pair (the same reason `order_item.voided_at IS NULL` is the liveness test rather
-- than a `live` column), and the read returns EVERY item with its course and its flag —
-- a held item is visible and marked held, never hidden in SQL. Hiding it would move the
-- decision out of the client that knows how its cook wants to see the rail.
--
-- WHY `fired_through_course` IS NOT AN ENUM OR AN ARRAY. A watermarked high-water mark
-- is monotone: "we are through course 2" cannot be expressed as a set that forgot to
-- include course 1, and it cannot silently un-fire course 1 when course 2 is added. The
-- command that writes it is a `greatest(...)` so a stale retry of "fire course 1" after
-- "fire course 2" is a no-op instead of a rewind, which is the whole of §8H step 4's
-- idempotence requirement.
--
-- WHY 20 AND NOT UNBOUNDED. A course number is a small ordinal a cook says out loud
-- ("fire two"), not a sequence. A CHECK bounds it so a bad client cannot write 10_000
-- and make one ticket unreadable, and the bound is wide enough for any real service —
-- a tasting menu with a cheese course is not close to 20. The bound lives in SQL and
-- not only in the contract for the reason 67_table_state.sql gives: an application
-- check is a promise, and a CHECK is enforcement for every writer, including a
-- backfill and psql.
--
-- FOUR TABLES, ONE COLUMN, AND WHY EACH ONE. `pos_cart_line` is what the cashier set
-- before the sale existed. `order_item` is the commercial record of the sale — it is
-- what a receipt and the dashboard read, and it must survive the kitchen entirely, so
-- the course cannot live only on the kitchen row. `kitchen_order_item` is the kitchen's
-- own copy, written by the projector from `order_item` (a kitchen line and its source
-- line are separate rows by design, §2 of ORDER_MODEL). `kitchen_order` holds the
-- watermark.
--
-- WHAT THIS FILE DOES NOT DO. The POS client that taps "fire course 2" (layer 4 of the
-- plan's step) is a separate job, as is the station routing of a held item. This file,
-- and the contract and API work that accompany it, make the fact expressible and
-- readable; nothing here decides how a cook sees it.
--
-- IT ALSO WIDENS ONE VOCABULARY. `fire_course` is the command that moves the watermark,
-- and `merchant.kitchen_command.command_type` was CHECK-constrained to the seven commands
-- 42_pos_kitchen.sql knew. A course column without that widening is a course nobody can
-- fire — see section 3, which corrects the constraint by its DEFINITION rather than its
-- name so a database that already carries the old list is fixed rather than skipped.
--
-- Idempotent and re-runnable: guarded columns, guarded constraints, a guarded view
-- re-declaration, and a guarded version row.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · The columns
--
-- `add column if not exists` so the file re-runs against a database that already has
-- some of them. NOT NULL with DEFAULT 1 is the correct shape for the rows that already
-- exist and for a client that never learned about courses: every line written before
-- today was, in fact, fired with the rest of its ticket, and 1 is the course number
-- that says exactly that. A nullable column would have made "no course" a third state
-- that every reader would have to interpret, and "no course" and "course 1" would then
-- have had different firing behaviour.
-- ---------------------------------------------------------------------------
alter table merchant.pos_cart_line
  add column if not exists course_number smallint not null default 1;
alter table merchant.order_item
  add column if not exists course_number smallint not null default 1;
alter table merchant.kitchen_order_item
  add column if not exists course_number smallint not null default 1;
alter table merchant.kitchen_order
  add column if not exists fired_through_course smallint not null default 1;

comment on column merchant.pos_cart_line.course_number is
  'The course the CASHIER set for this line, 1-based. Travels with the line through checkout; the identity key does not include it, so changing the course of a line on the till updates that line instead of splitting it in two.';
comment on column merchant.order_item.course_number is
  'The course this line is served in, 1-based, copied from the cart at commit. It is the commercial record of the customer''s intent, so it lives with the sale and survives the kitchen entirely — a receipt reprinted next year still knows the dessert was course 3.';
comment on column merchant.kitchen_order_item.course_number is
  'The course of this kitchen line, copied from merchant.order_item by the projector. Whether the item is FIRED is derived, not stored: course_number <= kitchen_order.fired_through_course.';
comment on column merchant.kitchen_order.fired_through_course is
  'The high-water mark of firing: every item of course <= this number is on the rail, every item above it is held. Monotone by construction (the fire_course command writes greatest(current, requested)), so a replay of an older command can never rewind a ticket that has already fired past it.';

-- ---------------------------------------------------------------------------
-- 2 · The guards
--
-- Guarded with the `if not exists (select 1 from pg_constraint ...)` pattern
-- 69_procurement.sql uses, because all four tables predate this file: the constraint
-- may already exist on a re-run, and re-adding it is an error rather than a no-op.
--
-- The three course guards are the same expression on three tables, named separately
-- because a CHECK is an object on a table and the name is what a failing writer sees.
-- `between 1 and 20` is stated as two comparisons rather than a BETWEEN so the verify
-- block can assert the bound it means instead of a rendering PostgreSQL is free to
-- change.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname='merchant' and cl.relname='pos_cart_line'
       and c.conname='pos_cart_line_course_number_ck'
  ) then
    alter table merchant.pos_cart_line add constraint pos_cart_line_course_number_ck
      check (course_number >= 1 and course_number <= 20);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname='merchant' and cl.relname='order_item'
       and c.conname='order_item_course_number_ck'
  ) then
    alter table merchant.order_item add constraint order_item_course_number_ck
      check (course_number >= 1 and course_number <= 20);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname='merchant' and cl.relname='kitchen_order_item'
       and c.conname='kitchen_order_item_course_number_ck'
  ) then
    alter table merchant.kitchen_order_item add constraint kitchen_order_item_course_number_ck
      check (course_number >= 1 and course_number <= 20);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname='merchant' and cl.relname='kitchen_order'
       and c.conname='kitchen_order_fired_through_course_ck'
  ) then
    alter table merchant.kitchen_order add constraint kitchen_order_fired_through_course_ck
      check (fired_through_course >= 1);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3 · The command vocabulary
--
-- `merchant.kitchen_command.command_type` is CHECK-constrained to the seven commands
-- 42_pos_kitchen.sql knew about, and a course that cannot be fired is a course column
-- that does nothing: `fire_course` would die on the journal insert with a bare 23514 and
-- the cook would see a 500 on the one control §8H step 4 exists to add. The vocabulary
-- is therefore widened HERE, in the file that adds the concept, rather than left for the
-- API to discover at runtime.
--
-- It is a CORRECTION as well as a guard, and for the reason 70_tender's stamped-shape
-- block gives: the constraint already exists on every database that ran 42, so
-- `if not exists` would find it, do nothing, and leave `fire_course` refused forever.
-- The test is therefore the DEFINITION the server is enforcing — `command_type = ANY
-- (...)` either names `fire_course` or it does not — and the constraint is dropped and
-- re-added only when it does not. That is idempotent in the sense that matters: a second
-- run finds the widened text and touches nothing.
--
-- The values are quoted with the same spellings the contract's `KitchenCommandType`
-- declares, and the pre-existing seven are preserved verbatim: this widens the
-- vocabulary, it does not renumber it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace ns on ns.oid = cl.relnamespace
   where ns.nspname='merchant' and cl.relname='kitchen_command'
     and c.conname='kitchen_command_command_type_check';

  if v_def is null then
    alter table merchant.kitchen_command
      add constraint kitchen_command_command_type_check
      check (command_type in ('start_preparation','mark_item_ready','mark_order_ready',
                              'complete','recall','cancel_ack','change_priority',
                              'fire_course'));
  elsif v_def not like '%fire_course%' then
    -- Replacing a CHECK revalidates every existing row, which is the point: a command
    -- journaled before today cannot be holding a type the vocabulary never allowed.
    alter table merchant.kitchen_command drop constraint kitchen_command_command_type_check;
    alter table merchant.kitchen_command
      add constraint kitchen_command_command_type_check
      check (command_type in ('start_preparation','mark_item_ready','mark_order_ready',
                              'complete','recall','cancel_ack','change_priority',
                              'fire_course'));
    raise notice 'kitchen_command_command_type_check widened with fire_course';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4 · The read
--
-- `kds.station_order` is the projection the board reads, and a column the view does not
-- carry is a column the board cannot show. It is re-declared HERE rather than edited in
-- 42_pos_kitchen.sql so that the file which adds the columns also carries the read that
-- exposes them, and so that a database already running 42+73 takes the change through
-- the same path as a fresh build.
--
-- `create or replace view` preserves the relation and its grants but NOT its options, so
-- `security_invoker = true` is re-stated: without it the view would silently start
-- running with its owner's rights and the board would read past RLS. The column list is
-- unchanged in order and the new column is appended, which is what makes `or replace`
-- legal here.
--
-- `fired` is computed in the view rather than in the API for one reason: the API is not
-- the only reader. A support query, a future report and a second client all read this
-- view, and a rule that lives in one service is a rule the next reader does not have.
-- The item's course and flag are returned for EVERY item — held ones included. The view
-- never filters on `fired`.
-- ---------------------------------------------------------------------------
create or replace view kds.station_order with (security_invoker = true) as
select ko.id, ko.merchant_id, ko.location_id, i.station_id, ko.source_order_id,
       ko.public_reference, ko.source, ko.fulfillment_type, ko.business_date,
       ko.status, ko.priority, ko.version, ko.queued_at, ko.preparation_started_at,
       ko.ready_at, ko.completed_at, ko.cancelled_at, ko.updated_at,
       coalesce(jsonb_agg(jsonb_build_object(
         'id',i.id::text,'sourceOrderItemId',i.source_order_item_id::text,
         'status',i.status,'productName',i.product_name,'variantName',i.variant_name,
         'modifiers',i.modifiers,'quantity',i.quantity,'preparationNote',i.preparation_note,
         'displayOrder',i.display_order,'targetSeconds',i.target_seconds,'version',i.version,
         'courseNumber',i.course_number,
         'fired',(i.course_number <= ko.fired_through_course)
       ) order by i.display_order,i.id) filter (where i.id is not null),'[]'::jsonb) items,
       coalesce(e.last_event_sequence,0) as last_event_sequence,
       ko.fired_through_course
  from merchant.kitchen_order ko
  join merchant.kitchen_order_item i on i.kitchen_order_id=ko.id and i.merchant_id=ko.merchant_id
  left join lateral (
    select max(event.sequence) as last_event_sequence
      from merchant.kitchen_event event
     where event.kitchen_order_id=ko.id and event.merchant_id=ko.merchant_id
  ) e on true
 group by ko.id,i.station_id,e.last_event_sequence;

comment on view kds.station_order is
  'The board''s read projection. Carries every item with its course and whether it is fired (course_number <= kitchen_order.fired_through_course); held items are marked, never hidden.';

-- ---------------------------------------------------------------------------
-- 5 · Bookkeeping
--
-- The same trailing statement 70_tender, 72_mp_point and 73_mp_refund perform: one
-- version row, guarded so a re-run is a no-op. 99_verify asserts it, so a database that
-- took these objects without the version — or the reverse — fails the build rather than
-- passing on a half-applied shape.
-- ---------------------------------------------------------------------------
insert into runtime.schema_migration(version,status)
values('build-v3-74','applied') on conflict(version) do nothing;

commit;
