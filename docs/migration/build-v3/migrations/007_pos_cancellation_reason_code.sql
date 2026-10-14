-- ============================================================================
-- 007 · A cancellation says WHY, from a list
--
-- WHY. The legacy till this café left recorded its cancellations as free text, and
-- the recovered data is unambiguous about what that produced: **16 of 17
-- cancellations said "prueba"** ("prueba", "Prueba 2", "PRUEB 2"), and exactly one
-- was real ("Cambio"). Every metric built on that column is a lie, and the operator
-- who types nothing at all still cancels.
--
-- The plan states the rule twice — §4 conclusion 5 and §8.3 — as one of the
-- engineering rules this operation applies: **a cancellation asks for a typed
-- reason, not free text**. This is the data half of it.
--
-- WHAT IT DOES
--   1 · `merchant.pos_cart.cancellation_reason_code` — the typed reason.
--   2 · Leaves `cancellation_reason` as what it should always have been: the
--       operator's optional note, never the only reason.
--
-- NO BACKFILL, ON PURPOSE. An old row's free text cannot be turned into a code
-- without guessing, and guessing a reason is how a metric starts lying again.
-- Historical cancellations keep a NULL code; the new ones carry a fact.
--
-- ADDITIVE AND RE-RUNNABLE. A new nullable column with a CHECK, added with
-- `if not exists`. No `begin;` — the caller owns the transaction.
-- ============================================================================

alter table merchant.pos_cart
  add column if not exists cancellation_reason_code text
    check (cancellation_reason_code in
      ('customer_changed', 'operator_mistake', 'duplicate', 'other'));

comment on column merchant.pos_cart.cancellation_reason_code is
  'Why the sale was cancelled, from a fixed list: customer_changed, '
  'operator_mistake, duplicate, other. The typed fact; cancellation_reason holds '
  'the operator''s optional note. NULL on rows cancelled before this landed, '
  'because their free text cannot be classified without guessing.';
