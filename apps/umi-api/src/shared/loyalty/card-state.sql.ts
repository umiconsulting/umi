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

/**
 * The threshold the CYCLE runs to, in SQL, for one merchant.
 *
 * A café's ladder is two active `merchant.loyalty_reward` rows: the `standard`
 * reward (the lower rung, which a customer may cash out early) and the `upgrade`
 * tier above it, where the cycle actually ends. umi-cash resolved the cycle from
 * the profile — `resolveRewardProfile` counts the upgrade row only when it sits
 * strictly above the standard one — so this is that rule, once, in SQL. It lives
 * here because three readers must agree: the scan, the wallet pass, and the
 * customer's own card page.
 *
 * WHY THE TOP TIER, AND NOT THE STANDARD ROW. Reading only the standard row made
 * El Gran Ribera's till and passes treat a 9-visit program as a 7-visit one: every
 * customer's cycle completed two visits early and the upper tier — a drink the café
 * sells — stopped existing. The four cafés with no ladder are untouched: with no
 * `upgrade` row this is exactly the old single-row subquery, defaulting to 10.
 *
 * `merchant` is the SQL expression holding the merchant id — a parameter
 * (`'$1::uuid'`) or a column (`'c.merchant_id'`). Pass it in rather than letting
 * each caller spell the subquery out again: five readers did exactly that, and only
 * one of them has to drift for the till, the pass and the dashboard to disagree.
 */
export const effectiveVisitsRequiredSql = (merchant: string): string => `
  (SELECT CASE
            WHEN up.n IS NOT NULL AND up.n > COALESCE(std.n, 0) THEN up.n
            WHEN std.n IS NOT NULL THEN std.n
            ELSE 10
          END
     FROM (SELECT (SELECT r.stamps_required FROM merchant.loyalty_reward r
                    WHERE r.merchant_id = ${merchant} AND r.active
                      AND r.type = 'stamps_free_item'
                      AND r.kind = 'upgrade'
                    ORDER BY r.created_at DESC NULLS LAST LIMIT 1) AS n) AS up,
          (SELECT (SELECT r.stamps_required FROM merchant.loyalty_reward r
                    WHERE r.merchant_id = ${merchant} AND r.active
                      AND r.type = 'stamps_free_item'
                      AND r.kind = 'standard'
                    ORDER BY r.created_at DESC NULLS LAST LIMIT 1) AS n) AS std)`;

/** `effectiveVisitsRequiredSql` for the common case, where the merchant id is `$1`. */
export const EFFECTIVE_VISITS_REQUIRED_SQL = effectiveVisitsRequiredSql('$1::uuid');

export const LOYALTY_CARD_STATE_SQL = `
  WITH vr AS (
    SELECT COALESCE(${EFFECTIVE_VISITS_REQUIRED_SQL}, 10) AS n
  ),
  -- SUM(stamps), never COUNT(*). One interaction can be worth up to 50 stamps:
  -- the "Agregar sellos" catch-up path credits a customer who arrived from an
  -- external loyalty system. COUNT(*) reads that as one stamp and silently
  -- shortens her card — measured at 18 Kalala customers and 87 stamps, worst
  -- card 20 -> 5. She sees it on her own phone, and no gate reports it.
  -- COALESCE because a card with no visits yet must read 0, not NULL.
  tv AS (SELECT COALESCE(SUM(stamps), 0)::int AS n FROM merchant.loyalty_visit
          WHERE merchant_id = $1::uuid AND card_id = $2::uuid),
  -- COUNT(*) of the canjes that still STAND. A reverted canje keeps its row (the
  -- bitácora has to show it) but gives the reward back, so counting it would make
  -- the undo cost the customer a reward — the exact opposite of what it is for.
  rr AS (SELECT COUNT(*)::int AS n FROM merchant.loyalty_redemption
          WHERE merchant_id = $1::uuid AND card_id = $2::uuid AND reverted_at IS NULL),
  bal AS (SELECT COALESCE(SUM(delta), 0)::int AS n FROM merchant.loyalty_stored_value_ledger
           WHERE merchant_id = $1::uuid AND card_id = $2::uuid)
  SELECT c.card_number,
        tv.n                 AS total_visits,
        (tv.n % vr.n)        AS visits_this_cycle,
        (tv.n / vr.n - rr.n) AS pending_rewards,
        bal.n                AS balance_cents,
        vr.n                 AS visits_required,
        -- How many of this card's banked rewards were earned under the pre-ladder
        -- single threshold and must therefore be handed over as the LOWER tier
        -- first. A counter, not a flag: the reward-config save that turns a ladder
        -- on seeds it with the card's banked rewards, redeeming one of those
        -- decrements it, and reverting that redemption increments it.
        c.pending_tier1
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
  pending_tier1: number;
}
