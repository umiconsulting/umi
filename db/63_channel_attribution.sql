\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- build-v3 · 63_channel_attribution — D1 / D3 of the 2026-09-15 platform plan
-- (docs/plans/2026-09-15-ultimate-platform-plan.md §3.4, §8A steps 1-4)
--
-- ADR: docs/architecture/2026-09-13-pos-channel-attribution-adr.md
-- (Approach B, link-don't-merge: the sale keeps its own POS-minted order and
-- LINKS the upstream commercial order it settles, with the channel frozen here).
--
-- WHY THIS FILE EXISTS. Commit 5eab37e added `origin_order_id` and
-- `origin_channel` by EDITING 20_merchant.sql. A database built from scratch got
-- them; a database that already existed did not, so GET /reportes failed with
-- `column s.origin_channel does not exist` (D1). 20_merchant.sql is reverted to
-- its pre-5eab37e shape and this numbered file is the only path that reaches a
-- live database (D3). A fresh build and an upgraded build end in the same shape.
--
-- Idempotent and re-runnable: every statement is guarded.
-- ============================================================================

-- Same column definitions as 20_merchant.sql carried: inline FK to
-- merchant.customer_order(id), `on delete restrict` on the committed sale
-- (money history may not lose the order it records), plain restrict-by-default
-- on the mutable cart. The check expression is copied verbatim.
alter table merchant.pos_cart
  add column if not exists origin_order_id uuid
    references merchant.customer_order(id),
  add column if not exists origin_channel text
    check (origin_channel in ('walk_in','whatsapp','web','aggregator'));

alter table merchant.pos_committed_sale
  add column if not exists origin_order_id uuid
    references merchant.customer_order(id) on delete restrict,
  add column if not exists origin_channel text
    check (origin_channel in ('walk_in','whatsapp','web','aggregator'));

-- ----------------------------------------------------------------------------
-- Backfill, faithfully rather than blindly.
--
-- A cart or sale that carries an upstream commercial order inherits THAT order's
-- channel. The channel column on merchant.customer_order is `source`
-- ('whatsapp','pos','web','dashboard'). Only values the check constraint accepts
-- are written, because writing 'pos' or 'dashboard' would abort the migration:
--   whatsapp / web / aggregator -> copied through
--   pos      -> the POS's own order, i.e. no upstream channel -> walk_in
--   dashboard-> a back-office order, not a sales channel -> walk_in
--   null     -> walk_in
-- A dangling origin_order_id (impossible while the FK holds, but the second
-- statement is the belt to that brace) also lands on walk_in, and nothing is
-- left null: the report coalesces to walk_in, so storing it costs nothing and
-- makes `origin_channel is not null` a usable invariant.
-- ----------------------------------------------------------------------------

update merchant.pos_cart c
   set origin_channel = case when o.source in ('whatsapp','web','aggregator')
                             then o.source else 'walk_in' end
  from merchant.customer_order o
 where c.origin_order_id = o.id;

update merchant.pos_cart
   set origin_channel = 'walk_in'
 where origin_channel is null;

-- pos_committed_sale is append-only (merchant.tg_append_only, armed by
-- 60_triggers). The guard is lifted through the sanctioned helper, which puts
-- the trigger back — including when the statement fails — inside this same
-- transaction. Never `alter table ... disable trigger` directly here.
select merchant.with_append_only_writable(
  'merchant.pos_committed_sale',
  $sql$
    update merchant.pos_committed_sale s
       set origin_channel = case when o.source in ('whatsapp','web','aggregator')
                                 then o.source else 'walk_in' end
      from merchant.customer_order o
     where s.origin_order_id = o.id
  $sql$);

select merchant.with_append_only_writable(
  'merchant.pos_committed_sale',
  $sql$
    update merchant.pos_committed_sale
       set origin_channel = 'walk_in'
     where origin_channel is null
  $sql$);

-- ----------------------------------------------------------------------------
-- The UPDATE grant 90_rls.sql cannot give a column that does not exist yet.
--
-- 90_rls revokes the table-level UPDATE on merchant.pos_cart from api and grants
-- it back column by column (business_date is the protected one). That loop runs
-- BEFORE this file, so on a fresh build it never sees origin_order_id /
-- origin_channel and the POS could not stamp them at checkout. The columns are
-- public (SELECT is table-level), so only UPDATE is restored. pos_committed_sale
-- needs nothing: it is append-only and takes no UPDATE from api at all.
-- ----------------------------------------------------------------------------
grant update (origin_order_id, origin_channel) on merchant.pos_cart to api;

insert into runtime.schema_migration(version,status)
values('build-v3-63','applied') on conflict(version) do nothing;

commit;
