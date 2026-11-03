-- ============================================================================
-- 006 · The second round — items added after the fire
--
-- WHY. `004` froze the cart when it fired, on purpose. The fire wrote the order
-- and its kitchen ticket through `writeOrder`, and `writeOrder` is idempotent by
-- `external_ref`: on the checkout it returns the existing order untouched. So a
-- line added to a fired cart would be CHARGED and never reach the kitchen —
-- silently, which is the worst way (ADR 2026-10-07 §3.2). The freeze was the
-- honest v1. This file lifts it for ADDS.
--
-- WHAT IT DOES
--   1 · `merchant.pos_cart_line.fired_at` — when this line reached the order and
--       its kitchen ticket. NULL means it is still local to the cart: a second
--       round the operator has rung but not yet sent.
--   2 · Moves the merge rule to the UNFIRED lines.
--
-- WHY THE MERGE RULE MOVES. `identity_key` collapses two identical drinks into
-- one line with quantity 2. That is right while the line is local. It is WRONG
-- once the line is on the ticket: a second latte added after the fire would bump
-- the quantity of the line the bar already made, and the extra quantity would be
-- charged without ever being sent. So the unique key becomes partial — it applies
-- only where `fired_at IS NULL` — and an identical item added after the fire is a
-- NEW line, which the second fire then sends. This is the same defect D4 exists
-- to prevent, one level down.
--
-- BACKFILLED, NOT GUESSED. A line of a cart that already carries a
-- `fired_order_id` is, by definition, sent: mark it with the row's own
-- `updated_at`, so no historical line looks like unsent work.
--
-- ADDITIVE AND RE-RUNNABLE. A new nullable column, a guarded constraint drop, a
-- guarded index create, and an update that touches nothing on a second apply. No
-- `begin;` — the caller owns the transaction.
-- ============================================================================

alter table merchant.pos_cart_line
  add column if not exists fired_at timestamptz;

comment on column merchant.pos_cart_line.fired_at is
  'The moment this line reached the order and its kitchen ticket. NULL means the '
  'line is still local to the cart — a second round the operator has rung but not '
  'sent. A fired cart refuses edits to a sent line; it accepts new ones.';

-- A line of a cart that already fired is sent. Stamp it from the row it is.
update merchant.pos_cart_line l
   set fired_at = l.updated_at
  from merchant.pos_cart c
 where c.id = l.cart_id
   and c.fired_order_id is not null
   and l.fired_at is null;

-- The merge rule, now only for the lines still local to the cart.
alter table merchant.pos_cart_line
  drop constraint if exists pos_cart_line_cart_id_identity_key_key;

create unique index if not exists pos_cart_line_unfired_identity_uidx
  on merchant.pos_cart_line (cart_id, identity_key) where fired_at is null;
