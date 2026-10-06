/**
 * The three reward rows a card's profile is resolved from — one author.
 *
 * The ladder is rows, not columns: `merchant.loyalty_reward.kind` carries
 * `standard` (the lower rung, cashed out early), `upgrade` (the tier the cycle
 * ends at) and `override` (a per-card reward). Every reader that needs "what
 * reward is this card working toward" reads these, and every one of them used to
 * spell the query out by hand — the same shape of duplication that let the till,
 * the pass and the dashboard disagree in the first place.
 *
 * `$1` = merchant id, `$2` = card id (only in CARD_OVERRIDE_ROW_SQL).
 */

/** The café's ACTIVE ladder rows, newest first within each kind. */
export const ACTIVE_LADDER_ROWS_SQL = `
  SELECT r.id::text, r.kind,
         r.stamps_required AS visits_required,
         r.name            AS reward_name,
         r.description     AS reward_description
    FROM merchant.loyalty_reward r
   WHERE r.merchant_id = $1::uuid AND r.active = true AND r.type = 'stamps_free_item'
     AND r.kind IN ('standard','upgrade')
   ORDER BY r.created_at DESC NULLS LAST`;

/**
 * This card's override row, if it has one.
 *
 * Reached through the card's own column and NOT filtered on `active`: override
 * rows are inactive by design (`kind='override'`), so an "active" lookup would
 * never find one.
 */
export const CARD_OVERRIDE_ROW_SQL = `
  SELECT r.id::text, r.kind,
         r.stamps_required AS visits_required,
         r.name            AS reward_name,
         r.description     AS reward_description
    FROM merchant.loyalty_reward r
    JOIN merchant.loyalty_card ca
      ON ca.merchant_id = r.merchant_id AND ca.reward_override_id = r.id
   WHERE ca.merchant_id = $1::uuid AND ca.id = $2::uuid`;
