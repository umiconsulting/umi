/**
 * The derived loyalty state of one card, in SQL. One author, two readers.
 *
 * `merchant.loyalty_card` carries no counters. The old `total_visits`,
 * `visits_this_cycle`, `pending_rewards` and `balance_cents` cache columns are
 * gone, so every caller computes the same four numbers from the event tables and
 * the CARD'S TWO ANCHORS (79_cycle_anchor.sql):
 *
 *   total_visits      = SUM(merchant.loyalty_visit.stamps)
 *   visits_this_cycle = (total_visits - cycle_anchor) % visits_required
 *   pending_rewards   = rewards_earned - COUNT(canjes that stand)
 *   balance_cents     = COALESCE(SUM(merchant.loyalty_stored_value_ledger.delta), 0)
 *
 * WHY THE ANCHORS ARE THERE, in one line each: a plain modulo assumes every cycle
 * ran 0 → 1 → … → threshold → 0 at a threshold that never moved. An early cash-out
 * restarts the cycle at the customer's current stamp count (not a multiple), and a
 * threshold that moved leaves a cycle finishing under the old one. `cycle_anchor` is
 * where the current cycle began, and `rewards_earned` counts the cycles this card
 * has completed — which no formula can recover from the events, because earning a
 * reward wrote no row. Measured before that file was written: the derivation below
 * reproduces umi-cash's own numbers for 1053 of 1053 cards.
 *
 * A canje with `cycle_reset` is an early cash-out: it consumed the cycle, not a
 * banked reward, so it does not count here.
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
 * A PLAIN LITERAL, and deliberately not a function. `sql-preflight` rebuilds every
 * interpolated statement by substituting named template constants, one import deep —
 * a fragment built by a function call is invisible to it, so every reader would be
 * counted as UNCOVERED and the gate's "name every exception in writing" rule would
 * force five written exceptions for five statements that are perfectly checkable.
 * Every reader therefore names the merchant id `$1`.
 */
export const EFFECTIVE_VISITS_REQUIRED_SQL = `
  (SELECT CASE
            WHEN up.n IS NOT NULL AND up.n > COALESCE(std.n, 0) THEN up.n
            WHEN std.n IS NOT NULL THEN std.n
            ELSE 10
          END
     FROM (SELECT (SELECT r.stamps_required FROM merchant.loyalty_reward r
                    WHERE r.merchant_id = $1::uuid AND r.active
                      AND r.type = 'stamps_free_item'
                      AND r.kind = 'upgrade'
                    ORDER BY r.created_at DESC NULLS LAST LIMIT 1) AS n) AS up,
          (SELECT (SELECT r.stamps_required FROM merchant.loyalty_reward r
                    WHERE r.merchant_id = $1::uuid AND r.active
                      AND r.type = 'stamps_free_item'
                      AND r.kind = 'standard'
                    ORDER BY r.created_at DESC NULLS LAST LIMIT 1) AS n) AS std)`;

/**
 * The same rule for a statement whose merchant id is a COLUMN rather than `$1`
 * (`lifecycle.repository.ts` correlates on `c.merchant_id`). Kept as its own literal
 * for the same preflight reason, and defined next to the other so the two cannot
 * drift apart.
 */
export const EFFECTIVE_VISITS_REQUIRED_CORRELATED_SQL = `
  (SELECT CASE
            WHEN up.n IS NOT NULL AND up.n > COALESCE(std.n, 0) THEN up.n
            WHEN std.n IS NOT NULL THEN std.n
            ELSE 10
          END
     FROM (SELECT (SELECT r.stamps_required FROM merchant.loyalty_reward r
                    WHERE r.merchant_id = c.merchant_id AND r.active
                      AND r.type = 'stamps_free_item'
                      AND r.kind = 'upgrade'
                    ORDER BY r.created_at DESC NULLS LAST LIMIT 1) AS n) AS up,
          (SELECT (SELECT r.stamps_required FROM merchant.loyalty_reward r
                    WHERE r.merchant_id = c.merchant_id AND r.active
                      AND r.type = 'stamps_free_item'
                      AND r.kind = 'standard'
                    ORDER BY r.created_at DESC NULLS LAST LIMIT 1) AS n) AS std)`;

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
          WHERE merchant_id = $1::uuid AND card_id = $2::uuid
            AND reverted_at IS NULL AND NOT cycle_reset),
  bal AS (SELECT COALESCE(SUM(delta), 0)::int AS n FROM merchant.loyalty_stored_value_ledger
           WHERE merchant_id = $1::uuid AND card_id = $2::uuid)
  SELECT c.card_number,
         tv.n                 AS total_visits,
         ((tv.n - c.cycle_anchor) % vr.n) AS visits_this_cycle,
         (c.rewards_earned - rr.n)        AS pending_rewards,
         bal.n                AS balance_cents,
         vr.n                 AS visits_required,
         -- Both anchors ride along: a writer needs them to compute the next value
         -- (the scan) or to preserve the position across a threshold change (the
         -- reward-config save), and re-reading the card to get them would be a
         -- second round trip under the same lock.
         c.cycle_anchor,
         c.rewards_earned,
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
  /** The lifetime stamp count at which the current cycle began (79_cycle_anchor.sql). */
  cycle_anchor: number;
  /** Cycles this card has completed in its life — the numerator of pending_rewards. */
  rewards_earned: number;
}
