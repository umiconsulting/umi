-- ============================================================================
-- 005 · The order type — how the order leaves the counter
--
-- WHY. The POS already shows the operator a choice between "Comer aquí" and
-- "Para llevar" in its top bar, but the server never learned it: the fire and the
-- checkout both wrote `fulfillment_type = 'dine_in'` as a constant
-- (`pos-cart.repository.ts`, `pos-checkout.repository.ts`). Every takeaway sale
-- therefore reached the order and the reports as a sale eaten in the café.
--
-- The plan is `docs/plans/2026-10-07-integrated-operation-plan.md` §8.2 F3, and
-- the decision is its D5: the order type is DATA of the order, not a permission
-- and not a screen state. It is the shape of the order, so it lives with the
-- order's other draft facts — on the cart — and flows to `customer_order` when
-- the order is written.
--
-- WHAT IT DOES
--   1 · `merchant.pos_cart.fulfillment_type`, defaulted so every cart that
--       exists today keeps the meaning it already had.
--
-- ONLY THE TWO TYPES THIS CAFÉ USES. "Domicilio" and the aggregators are not
-- here on purpose (§9): the CHECK admits a dine-in or a takeaway order and
-- nothing else, so a value the operation does not use cannot enter by accident.
-- A café that later delivers adds the value with its own decision.
--
-- ADDITIVE AND RE-RUNNABLE. A new column with a default is safe on a populated
-- table: PostgreSQL backfills the default without a rewrite. `add column if not
-- exists` makes a second apply a no-op. No `begin;` — the caller owns the
-- transaction.
-- ============================================================================

alter table merchant.pos_cart
  add column if not exists fulfillment_type text not null default 'dine_in'
    check (fulfillment_type in ('dine_in', 'takeout'));

comment on column merchant.pos_cart.fulfillment_type is
  'How the order leaves the counter: dine_in or takeout. A cart fact that flows '
  'to customer_order.fulfillment_type when the order is written at fire or '
  'checkout. The operator chooses it in the POS top bar; the server decides '
  'nothing about it.';
