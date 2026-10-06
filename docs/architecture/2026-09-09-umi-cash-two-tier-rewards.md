# Two-Tier Reward Ladder (umi-cash) — design note

**Client ask (El Gran Ribera, 2026-09-09):** "Si a las 7 visitas es un capuccino y a las 9 bebida
rocas/frappé/caliente, que salga ahí que dos visitas más y bebida rocas. Que sean como de otro
color los 2 extras."

**Goal:** a tenant may run an optional second reward tier above its standard one. The pass shows
both, the two extra stamps render in their own color, and once the lower tier is reached the pass
reads "capuccino listo · o 2 visitas más y bebida rocas".

## Decisions (assumptions until the client confirms — flagged in the PR)

1. **Either/or, not both.** At the lower threshold the customer may cash out the lower reward
   (card resets to 0) OR keep stamping; the cycle completes at the upper threshold and banks the
   upper reward exactly as a single-tier cycle does today. Nobody gets two drinks per cycle.
2. **Cash-out at 8 loses the 8th stamp.** The early cash-out consumes the card, like tearing off a
   full punch card. Carry-over is a one-line change if the client prefers it.
3. **Rewards banked before the ladder existed stay the lower reward.** Switching a ladder on tags
   every card with `pending_rewards > 0` (`cards.metadata.pending_tier1 = pending_rewards`); the
   redeem path hands the lower tier over first and counts the tag down. No silent upgrade.
4. **Per-client overrides replace the lower tier only** (they were reward-only by the 2026-09-01
   decision); the upper tier is tenant-wide.
5. **Single-tier tenants are untouched.** `profile.baseTier === null` collapses every helper in
   `reward-tiers.ts` to the pre-ladder behavior — Kalala/Néctar copy, strips, and moments are
   byte-for-byte what they were (one deliberate exception: "0 visitas" can no longer be shown;
   the count floors at 1 because the next visit earns).

## Data model

- `reward_configs.kind` gains `'upgrade'` (migration `20260910000000`, CHECK constraint only —
  no new columns). The upper tier is an `is_active` row of that kind, retired together with the
  standard row on every rewards-settings save. `getActiveRewardConfig` still filters
  `kind = 'standard'`, so nothing that reads "the reward" can pick the upper tier by accident.
- `RewardProfile` (reward-profile.ts): `visitsRequired`/`rewardName`/`redemptionConfigId` are the
  **cycle** values (upper tier when present) so every existing threshold/rollover computation stays
  correct; `baseTier` carries the lower tier or `null`.
- New scan action `REDEEM_BASE`: records a redemption against the lower tier's config (bitácora
  stays truthful) and resets `visits_this_cycle`. `REDEEM` (banked) records the tier that
  `bankedReward()` resolves.

## Rendering

- Strip (Apple `strip@2x.png`, Google `heroImage`): slots ≥ `baseTier.visitsRequired` use
  `/logos/{slug}-stamp-bonus-{filled,empty}.png`; a tenant without that art gets the regular stamp
  tinted ice-blue at render time. Google's content-addressed URL becomes
  `{filled}-{required}-b{base}.png` so the cache still turns over per state.
- Copy lives in `reward-tiers.ts` and is shared by Google text modules, Apple fields, the customer
  web card, the staff scan screen, and the lifecycle moments (`base_reward_ready` is new;
  `{upgradeRewardName}`/`{visitsToUpgrade}` are available to tenant copy).

## Rollout for El Gran Ribera

1. Apply the migration to prod (owner-approved DDL, before the deploy).
2. Deploy; in Recompensas turn on "Segundo nivel": 9 visitas, name per the client.
3. Existing Google objects keep their 7-slot strip until their next update — trigger a fleet push
   (`POST /api/umi/push-passes`, the live lifecycle sender) or wait for the next scan per card.
4. Swap `elgranribera-stamp-bonus-*.png` for client-approved art whenever they have it.
