#!/usr/bin/env node
/**
 * CAN THE CYCLE BE RECONSTRUCTED FROM THE EVENT LOG? (read-only, production)
 *
 * build-v3 derives `visits_this_cycle` from lifetime stamps, which assumes the
 * customer always ran 0 → 1 → … → T → 0. Two things break that loop: an early
 * cash-out (the card is torn off mid-cycle) and the café changing its threshold
 * under a cycle already in flight.
 *
 * This replays each card's history — visits, bulk stamp credits, canjes, reverts —
 * against the reward config that was ACTIVE AT THE TIME (loyalty.reward_configs
 * carries `activated_at` for every retired row, so the history is still there) and
 * compares the result with the cache the till has been reading.
 *
 * If the replay reproduces the cache, the "cycle anchor" is derivable and nothing
 * has to be invented. Where it does not, the disagreement is the interesting part.
 *
 *   DATABASE_URL=... node scripts/analysis/cycle-replay.mjs [slug]
 */
import { createRequire } from 'node:module';
const pg = createRequire('/home/juan/Projects/umiconsulting/umi/apps/umi-api/')('pg');

const SLUG = process.argv[2] ?? null;
const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const { rows: tenants } = await c.query(
  `select id::text, slug from core.tenants ${SLUG ? 'where slug = $1' : ''} order by slug`,
  SLUG ? [SLUG] : [],
);

/** T(t): the threshold resolveRewardProfile would have used, from rows active at t. */
function thresholdAt(configs, t) {
  const active = configs.filter(
    (r) => r.activated_at <= t && (r.retired_at === null || r.retired_at > t),
  );
  const newest = (kind) =>
    active.filter((r) => r.kind === kind).sort((a, b) => b.activated_at - a.activated_at)[0] ??
    null;
  const std = newest('standard');
  const upg = newest('upgrade');
  if (upg && std && upg.visits_required > std.visits_required) {
    return { t: upg.visits_required, baseId: std.id, topId: upg.id };
  }
  const row = std ?? upg;
  return { t: row?.visits_required ?? 10, baseId: row?.id ?? null, topId: row?.id ?? null };
}

for (const tenant of tenants) {
  const { rows: configs } = await c.query(
    `select id::text as id, kind, visits_required, activated_at, is_active
       from loyalty.reward_configs where tenant_id = $1::uuid order by activated_at`,
    [tenant.id],
  );
  // A row stops being active when a NEWER row of its kind is activated. Reconstruct
  // that as a retirement timestamp, since `is_active` only carries today's answer.
  for (const kind of ['standard', 'upgrade', 'override']) {
    const rows = configs.filter((r) => r.kind === kind);
    rows.forEach((r, i) => (r.retired_at = rows[i + 1]?.activated_at ?? null));
  }

  const { rows: cards } = await c.query(
    `select id::text as id, card_number, total_visits, visits_this_cycle, pending_rewards
       from loyalty.cards where tenant_id = $1::uuid order by card_number`,
    [tenant.id],
  );
  const { rows: visits } = await c.query(
    // Legacy keeps the stamp count in `metadata.seals` for a manual bulk credit and
    // nothing at all for a normal visit, which is a single stamp.
    `select loyalty_card_id::text as card, occurred_at,
            coalesce((metadata->>'seals')::int, 1) as stamps
       from loyalty.visit_events where tenant_id = $1::uuid order by occurred_at`,
    [tenant.id],
  );
  const { rows: redemptions } = await c.query(
    `select loyalty_card_id::text as card, redeemed_at, reward_config_id::text as config,
            note, reverted_at
       from loyalty.reward_redemptions where tenant_id = $1::uuid order by redeemed_at`,
    [tenant.id],
  );

  const events = new Map();
  const push = (card, e) => events.set(card, [...(events.get(card) ?? []), e]);
  for (const v of visits) push(v.card, { at: v.occurred_at, kind: 'visit', stamps: v.stamps });
  for (const r of redemptions) {
    push(r.card, {
      at: r.redeemed_at,
      kind: 'redeem',
      config: r.config,
      early: (r.note ?? '').startsWith('Canje anticipado'),
    });
    if (r.reverted_at) push(r.card, { at: r.reverted_at, kind: 'revert' });
  }

  let same = 0;
  const diffs = [];
  for (const card of cards) {
    let v = 0;
    let pending = 0;
    let total = 0;
    for (const e of (events.get(card.id) ?? []).sort((a, b) => a.at - b.at)) {
      const T = thresholdAt(configs, e.at);
      if (e.kind === 'visit') {
        total += e.stamps;
        const sum = v + e.stamps;
        pending += Math.floor(sum / T.t);
        v = sum % T.t;
      } else if (e.kind === 'redeem') {
        if (e.early) v = 0;
        else pending -= 1;
      } else if (e.kind === 'revert') {
        pending += 1;
      }
    }
    const cycleOk = v === card.visits_this_cycle;
    const pendingOk = pending === card.pending_rewards;
    const totalOk = total === card.total_visits;
    if (cycleOk && pendingOk) same++;
    else
      diffs.push({
        card: card.card_number,
        cache: `${card.visits_this_cycle}/${card.pending_rewards}`,
        replay: `${v}/${pending}`,
        total: `${card.total_visits} vs ${total}${totalOk ? '' : ' ✗'}`,
        events: (events.get(card.id) ?? []).length,
      });
  }
  console.log(`\n=== ${tenant.slug}: ${same}/${cards.length} cards agree (cycle + pending) ===`);
  for (const d of diffs.slice(0, 12)) console.log('   ', JSON.stringify(d));
  if (diffs.length > 12) console.log(`    … ${diffs.length - 12} more`);
}
await c.end();
