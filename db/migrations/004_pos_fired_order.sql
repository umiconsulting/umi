-- ============================================================================
-- 004 · The fired order — the column, the primitive, and who may fire
--
-- WHY. A waiter takes an order at a table and sends it to the kitchen; payment
-- happens later at the counter. UmiPOS cannot do it, because `writeOrder` — the
-- one function that writes the order and projects the kitchen ticket — is called
-- from the POS only inside the checkout transaction. An order without payment
-- therefore has no ticket.
--
-- The ADR is `docs/architecture/2026-10-07-pos-fired-order-adr.md`. Its decision
-- in one sentence: the fired order IS the order, and the checkout settles it
-- instead of minting a second one. This file is the first slice of that — the
-- data and the authority. The route, the checkout branch and the POS button come
-- after, and none of them can be written safely before this lands.
--
-- WHAT IT DOES
--   1 · `merchant.pos_cart.fired_order_id` — the column the ADR decided on
--   2 · the `order.fire` permission
--   3 · who holds it in the role catalogue
--   4 · version 2 of the role templates that changed
--
-- WHY A SEPARATE COLUMN AND NOT `origin_order_id`. They answer different
-- questions and a cart may carry both. `origin_order_id` means "an order that
-- arrived from somewhere else and this cart settles it" — the WhatsApp case, where
-- the checkout writes its own order and CLOSES the linked one.
-- `fired_order_id` means "an order THIS cart created without money, which the
-- checkout must settle IN PLACE". Reusing one column for both would make the
-- checkout guess which rule applies, and guessing wrong writes a second kitchen
-- ticket for a round of drinks the bar already made.
--
-- ADDITIVE AND RE-RUNNABLE. A new nullable column, a new permission row keyed by
-- `on conflict`, grants guarded by their primary key, and a template loop that
-- publishes a new version only for a template whose CURRENT version lacks the
-- permission. A second apply reports nothing to do. No `begin;` — the caller owns
-- the transaction, and there is no `create index concurrently` here either way.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1 · The column.
--
-- Nullable, and that is the default state of every cart: a counter sale fires
-- nowhere. `on delete restrict` matches `origin_order_id` and
-- `pos_committed_sale.origin_order_id` — money history may not lose the order it
-- records. A cart, however, is mutable, so the FK on the CART side is the plain
-- `references` default it decides for itself; the restriction that matters lives
-- on the committed sale, which is append-only.
-- ---------------------------------------------------------------------------
alter table merchant.pos_cart
  add column if not exists fired_order_id uuid
    references merchant.customer_order(id);

comment on column merchant.pos_cart.fired_order_id is
  'The order THIS cart created without payment (the ADR''s "fired order"). The '
  'checkout settles it in place instead of writing a second order — a second order '
  'would project a second kitchen ticket. Distinct from origin_order_id, which is '
  'an order that arrived from somewhere else and is only linked and closed.';

-- ---------------------------------------------------------------------------
-- 2 · The primitive.
--
-- `group_key` is the first segment of the key, which is the convention
-- `49_merchant_roles.sql` set for every other permission, so `order.fire` lands in
-- a new `order` group rather than being filed under `pos`. `product_key` is 'pos'
-- for the same reason `cart.write` is: this is a point-of-sale capability.
--
-- `risk_level` is 'medium' to match the rule 49 applies by pattern to `%.write`:
-- firing creates a real order and a real ticket, but it moves no money.
-- ---------------------------------------------------------------------------
insert into umi.permission
  (key, description, product_key, group_key, status, delegable, risk_level)
values
  ('order.fire',
   'Send an order to the kitchen before it is paid',
   'pos', 'order', 'active', true, 'medium')
on conflict (key) do update set
  description = excluded.description,
  product_key = excluded.product_key,
  group_key   = excluded.group_key,
  status      = excluded.status,
  delegable   = excluded.delegable,
  risk_level  = excluded.risk_level;

-- ---------------------------------------------------------------------------
-- 3 · Who holds it.
--
-- Deliberately NOT cashier, staff or viewer. A cashier taking a counter order
-- charges it immediately and never needs to fire; the whole point of the
-- capability is the order that runs ahead of the money. A café that wants its
-- waiters to fire gives them a merchant role with this permission — which is the
-- role-catalogue work that follows, not this file.
--
-- `super_admin` is here because the security gate asserts it holds EVERY
-- permission key, and it is a real requirement rather than a formality: a
-- platform administrator working a café's floor uses the same till.
-- ---------------------------------------------------------------------------
insert into umi.role_permission (role_id, permission_id)
select r.id, p.id
  from (values
    ('super_admin'), ('owner'), ('admin'), ('manager'), ('supervisor')
  ) as g(role_key)
  join umi.role       r on r.key = g.role_key
  cross join umi.permission p
 where p.key = 'order.fire'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4 · Publish version 2 of the templates that changed.
--
-- The templates are the platform's catalogue of what a role IS, and
-- `49_merchant_roles.sql` built them as a SNAPSHOT of `umi.role_permission` at
-- version 1. Adding a permission to the live catalogue therefore does not reach
-- them — by design, because a published version is a promise to the cafés that
-- already use it.
--
-- So the four templates that gained `order.fire` get a NEW version that is the
-- current one plus the permission — never a version that contains only the new
-- permission, which would silently drop everything else. `cashier`, `staff` and
-- `viewer` are untouched, because their live roles were untouched.
--
-- The loop publishes only when the CURRENT version lacks the permission, so a
-- second apply does not mint a third version.
-- ---------------------------------------------------------------------------
do $$
declare
  tpl          record;
  next_version integer;
  copied       integer;
begin
  for tpl in
    select rt.id, rt.key, rt.current_version, rt.name, rt.description
      from umi.role_template rt
     where rt.key in ('owner', 'admin', 'manager', 'supervisor')
       and not exists (
         select 1
           from umi.role_template_revision_permission rp
           join umi.permission p on p.id = rp.permission_id
          where rp.template_id = rt.id
            and rp.version = rt.current_version
            and p.key = 'order.fire'
       )
     order by rt.key
  loop
    next_version := tpl.current_version + 1;

    insert into umi.role_template_revision (template_id, version, name, description)
    values (tpl.id, next_version, tpl.name, tpl.description);

    -- Everything the current version granted, carried forward.
    insert into umi.role_template_revision_permission (template_id, version, permission_id)
    select tpl.id, next_version, rp.permission_id
      from umi.role_template_revision_permission rp
     where rp.template_id = tpl.id
       and rp.version = tpl.current_version;
    get diagnostics copied = row_count;

    -- Plus the one that changed.
    insert into umi.role_template_revision_permission (template_id, version, permission_id)
    select tpl.id, next_version, p.id
      from umi.permission p
     where p.key = 'order.fire';

    update umi.role_template
       set current_version = next_version, updated_at = now()
     where id = tpl.id;

    raise notice '004_pos_fired_order: template % published v% (% permissions carried + order.fire)',
      tpl.key, next_version, copied;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5 · Say what happened, read from the tables rather than asserted.
-- ---------------------------------------------------------------------------
do $$
declare
  holders  integer;
  column_ok boolean;
begin
  select count(*) into holders
    from umi.role_permission rp
    join umi.permission p on p.id = rp.permission_id
   where p.key = 'order.fire';

  select exists (
    select 1 from information_schema.columns
     where table_schema = 'merchant' and table_name = 'pos_cart'
       and column_name = 'fired_order_id'
  ) into column_ok;

  if not column_ok then
    raise exception '004_pos_fired_order: merchant.pos_cart.fired_order_id is missing after the migration.';
  end if;

  raise notice '004_pos_fired_order: order.fire held by % role(s); fired_order_id present. Route and checkout branch still to come.',
    holders;
end $$;
