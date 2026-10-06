# The register flip is blocked on response shape, not on routes

Status: `BLOCKED — measured 2026-10-06, one hour before the window closed`.
Companion: [`CUTOVER_RUNBOOK.md`](./CUTOVER_RUNBOOK.md) ·
`scripts/umi-cash-register-parity.mjs` (the harness) ·
`apps/umi-api/src/modules/cash/register-flip.integration.ts` (the gate that exists).

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

1. The harness is green on **two** cafés: `elgranribera` (has the 7/9 ladder and a
   card-level override) and one single-tier café, e.g. `kalalacafe`.
2. `device`, `os` and `pending_tier1` are recreated in the new schema — the column,
   the backfill from the old one, **and** the three writers that move the counter.
3. `admin/redemptions/:id/revert`, `admin/reward-config/resync` and `admin/messages`
   are ported, or a decision is recorded that they stop working.
4. The write routes are exercised somewhere that is not a customer's card, or
   accepted in writing as code-reviewed only.
5. A response-shape test lives in CI, so that the next hand-edited route list
   cannot pass on existence alone the way this one did.

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

## What was done on the night

The register switch stayed off. The Wallet switch, which had been flipped first
and would have left the pass reading the new schemas while the panel kept writing
to the old ones, was **reverted** — `WALLET_API_ORIGIN` removed and umi-cash
redeployed — and the rollback was verified by re-issuing a real pass through
`cash.umiconsulting.co` (200, 94 268 bytes, magic `PK`). Every café opened on the
world it went to sleep on.
