# The register flip is blocked on response shape, not on routes

Status: update 2026-10-06 (later the same night) below. The original finding and
the plan it produced are kept as written.

Status at the time: `BLOCKED — measured 2026-10-06, one hour before the window closed`.
Companion: [`CUTOVER_RUNBOOK.md`](./CUTOVER_RUNBOOK.md) ·
`scripts/umi-cash-register-parity.mjs` (the harness) ·
`apps/umi-api/src/modules/cash/register-flip.integration.ts` (the gate that exists).

---

## Update — what was ported after the window closed

Everything below is **additive and unflipped**: `CASH_API_ORIGIN` and
`WALLET_API_ORIGIN` are still unset, and the cafés' tills still read the old
schemas.

### The shapes are ported, and now tested against a recording

All ten measured differences are closed: `slug` and the four lifecycle registries,
`?days=` plus `prevPeriodVisits` / `rewardsRedeemedInRange` / `redemptions[]`,
`device` / `os`, the eight customer-detail fields, `pages`, `role`, and the numeric
`rewardCostCentavos`. The registry is a byte-for-byte port: the scan path's copy had
been **paraphrased**, so a flip would have rewound every café's lock-screen wording
to an older draft.

`scripts/umi-cash-shape-capture.mjs` walks the seven screens on
`cash.umiconsulting.co` with a real café credential and writes
`apps/umi-api/src/modules/cash/register-shapes.json`; `register-shape.contract.spec.ts`
asserts in CI that umi-api still sends every path in that file. Exit criterion 5 is
met by construction: the test compares the port against a recording of the original,
not against the port. Removing `slug` from `getSettings` makes it fail.

### The ladder exists in the API now

`resolveRewardProfile` and the tier copy are ported from umi-cash, the cycle
threshold resolves to the ladder's upper tier in one place
(`EFFECTIVE_VISITS_REQUIRED_SQL`), the Rewards screen is served all three rows,
and the scan hands over the tier a card is owed.

The write had a live defect, not a latent one. `CashRepository.upsertRewardConfig`
retired **every** active reward row and inserted one `kind='standard'` row — no
`kind` filter — and the dashboard's Settings → Rewards save reaches umi-api today
through `/api/merchants/:id/cash/reward-config`. A manager saving that screen at El
Gran Ribera would have deleted the café's sold 9-visit tier, silently, with no
audit trail. It is fixed, and the same write now tags cards that hold a pre-ladder
banked reward so those are handed over as the lower tier first.

Verified against the QA project (build-v3 applied, including `78`), in a
transaction that was rolled back: all eighteen statements this port touches
`PREPARE` cleanly, and the cycle arithmetic behaves — one card holding 15 stamps
reads `visits_this_cycle` 5/10 with no ladder, 6/9 with a 7+9 ladder, and back to
1/7 when the "upgrade" row is mis-set BELOW the standard threshold, which is the
same rule `resolveRewardProfile` applies.

### Two of the three unlisted routes are ported

`admin/redemptions/:id/revert` (ADMIN-only, the two-tap undo) and
`admin/reward-config/resync` ("Actualizar pases") now exist in umi-api and are on
the flip list. `admin/messages` is **named, not ported**: AB#107 rebuilds that
screen from `merchant.message`, and the harness excludes it by name so a silent pass
is impossible and a silent gap is impossible too.

Porting the revert required a second fix: `pending_rewards` derives from
`COUNT(loyalty_redemption)`, which counted reverted canjes, so undoing a redemption
would have _cost_ the customer a reward. Reverted rows now stay in the bitácora and
out of the count. One card in production has reverted redemptions.

## What still blocks the flip

### 1. The cycle cannot be cut short (El Gran Ribera only)

umi-cash's scan accepts a `REDEEM_BASE` action: at 7 of 9 stamps the barista can
hand over the capuccino early and **tear the card off** — `visits_this_cycle` goes
to 0 and the customer starts cycling again. umi-api's scan accepts only
BIRTHDAY/REDEEM/VISIT.

That is not a missing branch; the shape of the data has no room for it.
build-v3 has no cache columns, so the scan _derives_
`visits_this_cycle = SUM(stamps) % visits_required` and
`pending_rewards = SUM(stamps) / visits_required − COUNT(redemptions)`. Both are
monotone in the customer's lifetime stamps, and an early cash-out is not: it resets
the numerator and consumes one reward that was never banked. Adding an action that
writes the redemption without the reset would make `pending_rewards` go **negative**
at the next visit and then swallow the reward the customer actually earned.

Measured on production, 2026-10-06:

| café          | cards | cycle numbers that already differ |
| ------------- | ----- | --------------------------------- |
| elgranribera  | 592   | 23                                |
| kalalacafe    | 440   | 0                                 |
| nectarcafe    | 20    | 0                                 |
| northwestcafe | 1     | 0                                 |

(`visits_this_cycle` derived at the upper tier vs. the till's own cached value. At
the standard tier the same measure is 7 of 592 — the cache is history-dependent:
it was written against whichever config was active at each customer's last visit,
so _neither_ formula reproduces it everywhere, and the ladder makes the gap wider.)

One card holds the whole problem: `EGR-6659949340` has 49 lifetime stamps, one early
cash-out (its `note` reads `Canje anticipado con 8/9 visitas` — the only non-null
note among 184 redemptions in production), two reverted canjes, and a config that
changed underneath it.

**What it takes**, in order: a cycle anchor in the schema (the reset has to be
derivable — either a carried `loyalty.reward_redemptions.note`/flag marking an early
cash-out, or a `cycle_started_at` on the card), the four derive sites updated to
count visits since the anchor, a data carry for the cards that already cashed out,
and `REDEEM_BASE` added to the scan. Then the two counters are right for every card,
not approximately right for most of them.

Until then, flipping means telling El Gran Ribera's baristas that the "canjear
nivel 1" button no longer exists and that 23 customers' progress reads differently
from yesterday — that is a product decision for the owner, not a deploy step.

### 2. The café-wide Google resync is not ported

`reward-config/resync` touches Apple passes and pushes. A merchant-wide Google
re-PATCH (umi-cash's `refreshGoogleWalletObjectsForTenant`) has no counterpart in
umi-api yet, so the route answers `google: null` and the screen renders
`Google: 0/0` — a number nobody measured, in a field the operator only reads when
something is already wrong.

## What happened

Setting `CASH_API_ORIGIN` forwards 24 register routes from `cash.umiconsulting.co`
to umi-api. On 2026-10-06 the Wallet switch had already been flipped and we were
an hour from the cafés opening, so the register switch was exercised — with a real
café credential, against both origins — before being turned on.

The login matched. The screens did not.

`register-flip.integration.ts` proves every forwarded route **exists** on the
destination. That is all it proves. A Next rewrite is a proxy: it does not compare
what comes back. So a ported route that answers `200` with a different shape is a
café screen that renders zeros — and no test, no gate and no log says a word.

## What differs, measured

`kalalacafe`, 2026-10-06, same token, both origins:

| route                  | what umi-api does not send                                                                                                                                                                                | who reads it                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `/admin/settings`      | `lifecycleCopy`, `lifecycleDefaults`, `lifecycleJourneys`, `lifecycleVariables`, and `slug` (it sends `handle` instead)                                                                                   | `settings/_shared.ts` declares all four; the page reads `s.lifecycleCopy` to count overrides                |
| `/admin/analytics`     | `prevPeriodVisits`, `redemptions`, `rewardsRedeemedInRange` — and it ignores `?days=7\|30\|90\|365`, always answering a 30-day window                                                                     | `analytics/page.tsx` types all three and sends `days=` on every range chip                                  |
| `/admin/reward-config` | `upgrade`. `getRewardConfig` returns only `{ active, history }` and nothing under `modules/cash` knows the ladder exists; `rewardCostCentavos` is also a string `"0"` where umi-cash sends the number `0` | `rewards/page.tsx` and the till home both read `data.upgrade` — this is how the 7/9 ladder disappears       |
| `/admin/customers/:id` | `rewardName`, `rewardDescription`, `baseReward`, `pendingRewardName`, `customReward`, `rewardsRedeemed`, `recentRedemptions`, `viewerIsAdmin`                                                             | the customer screen: the reward line, the ladder, the redemption bitácora, and the ADMIN-only revert button |
| `/admin/customers`     | `device`, `os` on every row                                                                                                                                                                               | the list, cosmetic                                                                                          |
| `/admin/gift-cards`    | `pages` is renamed `totalPages`                                                                                                                                                                           | nothing today — the screen is a "próximamente" stub                                                         |
| `/admin/stats`         | `role`                                                                                                                                                                                                    | nothing — the layout only reads the status code                                                             |

## The part that is not a gap in the port

### Three routes are on no list at all

`--routes-only` walks every `/api/${...}/...` the umi-cash app builds and compares
it with the flip list. Three of the register's own routes are called by its screens,
are on **no** switch, and do not exist in umi-api — so after a flip they would keep
being served by umi-cash against a database nothing else writes to any more, and go
on answering as if nothing had changed:

| route                          | who calls it                         | what it does                                                                                                                                                         |
| ------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin/redemptions/:id/revert` | the customer screen's two-tap revert | undoes a redemption. This is the one that reads a canje back after a mistake.                                                                                        |
| `admin/reward-config/resync`   | the rewards screen's "resync"        | republishes a reward change to every pass at the café                                                                                                                |
| `admin/messages`               | the messages screen                  | next.config says this screen was "rebuilt from `merchant.message`" and the route was "deleted, not moved" — the route is still on disk and the screen still calls it |

The first two are write paths on money-adjacent state. They need to be ported, or
the flip needs to be accompanied by a decision that those two buttons stop working.

Three fields cannot come back by writing more code, because build-v3 dropped what
they were read from:

| field               | umi-cash reads                                          | build-v3                                                                                                    |
| ------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `device`, `os`      | `core.people.metadata`, written from the User-Agent     | no `metadata` on `merchant.customer`. umi-api already returns an honest `null` and says so in `getCustomer` |
| `pendingRewardName` | `cards.metadata.pending_tier1` — the banked-reward flag | no `metadata` on `merchant.loyalty_card`; no column anywhere carries a banked tier                          |

**Decision, 2026-10-06: they are recreated.** Sized against real data first, rather
than against the shape of the old schema:

| legacy source                | how much of it is real                                               |
| ---------------------------- | -------------------------------------------------------------------- |
| `core.people.metadata`       | `device` and `os` on **1019** of 1048 customers                      |
| `merchant`… `cards` metadata | `pending_tier1` on **7** cards — a small set, and a load-bearing one |

`pending_tier1` is a **counter**, not a flag, and three writers move it in umi-cash:
the reward-config save tags every card that already holds a banked reward, a scan
that cashes one of those out decrements it, and a redemption revert increments it.
Recreating the column without recreating those three writes would leave the counter
permanently out of step with the rewards it describes — which is the redemption a
barista hands over.

The two `metadata` columns also carried `source_systems`, `synthetic`,
`lifecycle_message` and `lifecycle_message_updated_at`. The last pair already has
typed homes on `merchant.loyalty_card`; the first two are not read by the register
and are not being carried.

## The harness

```sh
PARITY_SLUG=kalalacafe PARITY_IDENTIFIER=admin@kalalacafe.mx PARITY_PASSWORD=... \
  node scripts/umi-cash-register-parity.mjs
```

It logs in on both origins, walks every comparable GET, and compares **shape** —
every key path and its type, arrays collapsed to their first element. Values are
deliberately not compared: the two origins are two live databases some seconds
apart, and a value that moves is not the failure mode. A key that is missing is.

It covers the six screens above plus the customer detail, and it does **not**
cover the writes (`scan`, `scan/preview`, `scan/seals`, `purchase`, `topup`,
`gift`, `customers`, `client-error`, `auth/logout`). Exercising those costs real
money on real cards, so they stay on code review until somebody decides how to
stage them — that decision is itself an exit criterion below.

## Exit criteria for flipping `CASH_API_ORIGIN`

Status as of the update above.

1. The harness is green on **two** cafés: `elgranribera` (has the 7/9 ladder and a
   card-level override) and one single-tier café, e.g. `kalalacafe`.
   ☐ **outstanding** — it needs both switches on to be meaningful end to end, and
   the two remaining blockers below. The response half is now covered by the
   recording-based contract test, which runs in CI without credentials.
2. `device`, `os` and `pending_tier1` are recreated in the new schema — the column,
   the backfill from the old one, **and** the three writers that move the counter.
   ☑ DDL and carry in PR #191; the three writers are ported (reward-config seeds it,
   a banked redemption decrements it, a revert increments it). ⚠️ **The DDL must be
   applied to production BEFORE the image that reads it rolls** — see the runbook.
3. `admin/redemptions/:id/revert`, `admin/reward-config/resync` and `admin/messages`
   are ported, or a decision is recorded that they stop working.
   ☑ The first two are ported and on the flip list. `admin/messages` is recorded:
   AB#107 rebuilds the screen from `merchant.message`; the harness excludes it by
   name.
4. The write routes are exercised somewhere that is not a customer's card, or
   accepted in writing as code-reviewed only. ☐ **outstanding** — unchanged.
5. A response-shape test lives in CI, so that the next hand-edited route list
   cannot pass on existence alone the way this one did.
   ☑ `register-shape.contract.spec.ts` compares against
   `register-shapes.json`, a recording taken from production with a real café
   credential.

## Where each fix goes

Every one of these is **additive** — the register is not flipped, so nothing here
reaches a café until the switch is on, and a partial landing breaks nothing. The
source of truth for each shape is the umi-cash route named beside it; read it, do
not reconstruct it from this table.

| what                                                                                                                                          | write it in                                               | the shape to match                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slug`                                                                                                                                        | `CashReadService.getSettings`                             | the merchant's `handle` under the key the panel reads. It is the same value `handle` already carries; the panel was never told the name changed.                                                                                                                                                                                                                                                                                 |
| `lifecycleCopy`, `lifecycleDefaults`, `lifecycleJourneys`, `lifecycleVariables`                                                               | `CashReadService.getSettings` + `CashRepository.branding` | `apps/umi-cash/src/lib/lifecycle-copy.ts` holds all four as literals, and `admin/settings/route.ts` shows the wiring: overrides come from `programs.branding.lifecycle_copy`, defaults/journeys/variables are constants. `modules/cash/lifecycle-copy.ts` already has four of the fifteen journeys and the interpolation helper; it is missing `base_reward_ready`, `reward_redeemed`, `visit_recorded` and the two meta tables. |
| `upgrade`                                                                                                                                     | `CashRepository.rewardConfig` + `getRewardConfig`         | `admin/reward-config/route.ts`: a second row, `kind = 'upgrade'`, newest by `activated_at`, mapped by the same `toApi`. `merchant.loyalty_reward` already carries it — El Gran Ribera has an active `kind='upgrade'` row at 9 stamps beside its `standard` at 7. Also cast `value`/`reward_cost_cents` to a **number**; it arrives as a string today.                                                                            |
| `prevPeriodVisits`, `rewardsRedeemedInRange`, `redemptions`                                                                                   | `getAnalytics` + `CashRepository.analytics`               | `admin/analytics/route.ts`. The range comes from `?days=` — `apps/umi-cash/src/lib/analytics-range.ts` is the agreement on which values exist (7/30/90/365, anything else 30) and the panel sends it on every chip. `redemptions` is a 50-row log joined to the customer's name and card number, including `revertedAt`.                                                                                                         |
| `device`, `os`                                                                                                                                | `getCustomers`, `getCustomer`                             | see the dropped-metadata note above — decide, then either implement or record.                                                                                                                                                                                                                                                                                                                                                   |
| `pages`                                                                                                                                       | `getGiftCards`                                            | `admin/gift-cards/route.ts` returns `pages`; the port renamed it `totalPages`. Nothing reads it today (the screen is a stub), so this one is free either way.                                                                                                                                                                                                                                                                    |
| `role`                                                                                                                                        | `getStats`                                                | `admin/stats/route.ts` returns the caller's own role from the token. The panel does not read it; the harness compares it because the route is in the flip list.                                                                                                                                                                                                                                                                  |
| `rewardName`, `rewardDescription`, `baseReward`, `pendingRewardName`, `customReward`, `rewardsRedeemed`, `recentRedemptions`, `viewerIsAdmin` | `getCustomer`                                             | `admin/customers/[id]/route.ts`. The ladder fields come from `lib/scan-helpers.ts` (`cardRewardFields`) over `lib/prisma-helpers.ts` (`getRewardProfileForCard`) — `baseReward.ready` is `isBaseReady` from `lib/reward-tiers.ts`. `customReward` is the card's `reward_override_id` row; `viewerIsAdmin` is the caller's role, which the controller has and the service does not yet receive.                                   |

Then re-run the harness against **both** cafés and paste the output in the pull
request. A green run on `kalalacafe` alone would miss the ladder entirely, which is
the one difference on this list that costs a customer a free drink.

**Status of this table: all ten rows are done** as of the update above, with one
recorded exception — `recentRedemptions[].note` has no column in build-v3 to read
(only one of 184 production redemptions ever carried a note, and that one is the
early cash-out marker the cycle-anchor work below needs to carry). It is sent as
`null`, and the key exists so the frozen client's shape is intact.

## What was done on the night

The register switch stayed off. The Wallet switch, which had been flipped first
and would have left the pass reading the new schemas while the panel kept writing
to the old ones, was **reverted** — `WALLET_API_ORIGIN` removed and umi-cash
redeployed — and the rollback was verified by re-issuing a real pass through
`cash.umiconsulting.co` (200, 94 268 bytes, magic `PK`). Every café opened on the
world it went to sleep on.
