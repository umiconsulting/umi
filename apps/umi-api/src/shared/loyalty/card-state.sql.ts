/**
 * The derived loyalty state of one card, in SQL. One author, two readers.
 *
 * `merchant.loyalty_card` is identity-only. The old `total_visits`,
 * `visits_this_cycle`, `pending_rewards` and `balance_cents` cache columns are
 * gone, so every caller computes the same four numbers from the event tables:
 *
 *   total_visits      = COUNT(merchant.loyalty_visit)
 *   visits_this_cycle = total_visits % visits_required
 *   pending_rewards   = floor(total_visits / visits_required)
 *                         - COUNT(merchant.loyalty_redemption)
 *   balance_cents     = COALESCE(SUM(merchant.loyalty_stored_value_ledger.delta), 0)
 *
 * `visits_required` is the merchant's active `merchant.loyalty_reward`, and it
 * defaults to 10 when no reward row exists. The default also prevents a division
 * by zero.
 *
 * WHY THIS IS SHARED. The register (`cash-scan.repository.ts`) and the wallet
 * pass (`wallet-pass.repository.ts`) both show these numbers to the same person
 * at the same moment: the customer reads the phone while the barista reads the
 * till. Two copies of this formula would drift, and the customer would see the
 * disagreement before we did. Keep one copy.
 *
 * The query returns `visits_required` as well, so the threshold that produced
 * the modulo is always the threshold that gets displayed.
 *
 * Parameters: $1 = merchant id, $2 = card id.
 * It returns no row when the card does not exist, or when RLS hides it.
 */
export const LOYALTY_CARD_STATE_SQL = `
  WITH vr AS (
    SELECT COALESCE((
      SELECT stamps_required FROM merchant.loyalty_reward
      WHERE merchant_id = $1::uuid AND active AND type = 'stamps_free_item'
      ORDER BY created_at DESC NULLS LAST LIMIT 1), 10) AS n
  ),
  -- SUM(stamps), never COUNT(*). One interaction can be worth up to 50 stamps:
  -- the "Agregar sellos" catch-up path credits a customer who arrived from an
  -- external loyalty system. COUNT(*) reads that as one stamp and silently
  -- shortens her card — measured at 18 Kalala customers and 87 stamps, worst
  -- card 20 -> 5. She sees it on her own phone, and no gate reports it.
  -- COALESCE because a card with no visits yet must read 0, not NULL.
  tv AS (SELECT COALESCE(SUM(stamps), 0)::int AS n FROM merchant.loyalty_visit
          WHERE merchant_id = $1::uuid AND card_id = $2::uuid),
  rr AS (SELECT COUNT(*)::int AS n FROM merchant.loyalty_redemption
          WHERE merchant_id = $1::uuid AND card_id = $2::uuid),
  bal AS (SELECT COALESCE(SUM(delta), 0)::int AS n FROM merchant.loyalty_stored_value_ledger
           WHERE merchant_id = $1::uuid AND card_id = $2::uuid)
  SELECT c.card_number,
         tv.n                 AS total_visits,
         (tv.n % vr.n)        AS visits_this_cycle,
         (tv.n / vr.n - rr.n) AS pending_rewards,
         bal.n                AS balance_cents,
         vr.n                 AS visits_required
  FROM merchant.loyalty_card AS c, vr, tv, rr, bal
  WHERE c.merchant_id = $1::uuid AND c.id = $2::uuid`;

/** The row `LOYALTY_CARD_STATE_SQL` returns. */
export interface LoyaltyCardState {
  card_number: string;
  total_visits: number;
  visits_this_cycle: number;
  pending_rewards: number;
  balance_cents: number;
  visits_required: number;
}
