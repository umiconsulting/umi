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

Three fields cannot come back by writing more code, because build-v3 dropped what
they were read from:

| field               | umi-cash reads                                          | build-v3                                                                                                    |
| ------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `device`, `os`      | `core.people.metadata`, written from the User-Agent     | no `metadata` on `merchant.customer`. umi-api already returns an honest `null` and says so in `getCustomer` |
| `pendingRewardName` | `cards.metadata.pending_tier1` — the banked-reward flag | no `metadata` on `merchant.loyalty_card`; no column anywhere carries a banked tier                          |

The register's own port answered `null` for the first pair and dropped the third,
which is defensible. What is not defensible is flipping the switch without saying
so out loud, because `pendingRewardName` drives the redemption a barista hands
over: a card holding a reward banked under the old single threshold would be read
as holding the top tier instead of the lower one.

Before this can flip, someone has to either recreate those two facts in the new
schema or state, in the runbook, that they are gone on purpose.

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
2. `device`/`os` and `pendingRewardName` are either implemented or written down as
   deliberately gone.
3. The write routes are exercised somewhere that is not a customer's card, or
   accepted in writing as code-reviewed only.
4. A response-shape test lives in CI, so that the next hand-edited route list
   cannot pass on existence alone the way this one did.

## What was done on the night

The register switch stayed off. The Wallet switch, which had been flipped first
and would have left the pass reading the new schemas while the panel kept writing
to the old ones, was **reverted** — `WALLET_API_ORIGIN` removed and umi-cash
redeployed — and the rollback was verified by re-issuing a real pass through
`cash.umiconsulting.co` (200, 94 268 bytes, magic `PK`). Every café opened on the
world it went to sleep on.
