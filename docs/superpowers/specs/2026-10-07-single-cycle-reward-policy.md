# Single cycle reward policy

## Current instruction

El Gran Ribera must stop future reward accumulation.
The customer can redeem the first reward at visit 7, 8, or 9.
The customer can instead continue to visit 9 for the higher reward.
At visit 9, Umi must block further visits until redemption or expiry.
Redemption consumes the visits required by the selected reward.
The first reward consumes 7 visits. The second reward consumes 9 visits.
The first reward leaves zero visits at 7, one at 8, and two at 9.
The second reward leaves zero visits at 9.
At visit 9, offer both rewards as exclusive choices for the same entitlement.
Retained visits start the next cycle. They have no deadline until that cycle reaches visit 7.

The reward expires 30 days after first eligibility at visit 7.
The user confirmed this starting point.
The upgrade at visit 9 must preserve the original deadline.
On expiry, reset the cycle to zero. The user requested the best approach; this is the recommended approach.
Visits 1–6 remain valid without an expiry.

The user also requested the previous controls: receipt number, authenticated staff identity, exact confirmation, and duplicate protection.
Keep birthday and stored-value policies separate.
Keep other merchants' behavior unchanged.
No production activation or correction occurs during local implementation.

## Cycle facts and availability

Keep lifetime stamp events, historical redemption rows, and `rewards_earned`.
Use `cycle_anchor` as an absolute lifetime offset for the new policy.
An enabled card shows `total_stamps - cycle_anchor` from 0 to 9, without modulo.
Open one cycle entitlement at first eligibility.
Store the eligibility time, immutable expiry, cycle anchor, and both reward tier snapshots.
The visit at 9 upgrades the same entitlement. It must not issue a second reward.
One open cycle entitlement per card is the maximum.

Use the database clock for final eligibility checks after the card lock.
Reads must show zero after expiry even before the worker runs.
Mutation and expiry jobs must advance the absolute anchor when that cycle expires.
Do not erase stamp events or subtract lifetime earned facts.
Consume by earliest expiry where historical obligations coexist.

## Existing balances and recovery

Preserve existing available rewards during a 30-day grace period from activation.
Imported units have unknown eligibility dates, represented by NULL.
Record the activation time and grace deadline instead of an invented earning date.
Preserve current partial progress. Normalize the old modulo anchor to the absolute offset at activation.
Store the previous anchor and lifetime count in an activation audit record.
If the partial cycle is already at 7 or 8, its deadline also starts at activation.
Block visits while available imported or recovery units remain.
Staff can redeem the imported backlog explicitly; quantity applies only to that backlog.
New cycle redemption has quantity one.

Associate standing historical redemptions with consumed imported units.
A reversal preserves the original unit and expiry, and retains every historical row.
A restored earlier unit must preserve later cycle progress.
Store the selected tier and consumed visits with each new redemption link.
Store the cycle anchor before and after each current cycle redemption.
Historical imports have NULL consumption facts when these facts are unknown.
A reversal restores the selected reward, with its original deadline, as a recovery obligation.
It preserves retained visits and later progress. It does not rewind the anchor or credit visits.
It becomes a recovery obligation and blocks further visits until redeemed or expired.
Historical recovery can coexist with a later cycle unit. This is an audit exception, not future reward earning.
Repeat reversals are unchanged results.

## Atomic commands

Require `externalReceiptNumber` and `idempotencyKey` for stamp redemption under the enabled policy.
Use authenticated staff identity, not a manually typed waiter name.
Reuse `IntegrityService` and `merchant.business_command` for actor-bound fingerprints and stored responses.
Pass its transaction client into the mutation. Avoid nested transactions.
Use the same card row lock for scan, bulk credits, reversal, expiry, and activation.
Recheck quantity, progress, policy, expiry, visit limits, and birthday eligibility under that lock.
Reject combined visit and stamp redemption for enabled cards.
Reject combined `REDEEM` and `REDEEM_BASE` for every card.
Bulk credits must fit within the remaining capacity to 9 and cannot cross into a second cycle.
Reject excess credit without truncation or a partial write.
A repeated command returns its committed result without another write.
A changed actor, card, quantity, receipt, or action with the same key conflicts.

## Shared response

Retain existing card fields. Add these fields to every applicable card surface:

```ts
rewardPolicy: 'accumulate' | 'single_cycle';
rewardExpiryDays: number | null;
nextRewardExpiresAt: string | null;
legacyPendingRewards: number;
cycleRewardAvailable: boolean;
visitBlockedReason: 'REDEMPTION_REQUIRED' | null;
merchantTimezone: string;
availableRewards: { rewardName: string; quantity: number; expiresAt: string }[];
```

`pendingRewards` is the authoritative count of all unexpired, unclaimed units, including the cycle reward at 7–8.
`visitsThisCycle` preserves 9 until redemption and shows zero after cycle expiry.
`baseReward.canRedeem` permits the cycle's first reward at 7–9.
At 9, `REDEEM` redeems the higher reward. Before 9, `REDEEM` can consume only an imported or recovery obligation.
`REDEEM_BASE` consumes 7 visits from the current eligible cycle at 7–9.
`REDEEM` consumes 9 visits when it selects the current cycle's second reward at 9.
Policy-aware reward copy must describe the current reward and cycle, not banked future rewards.

The committed response contains:

```ts
redemption?: {
  operationId: string;
  quantity: number;
  remainingRewards: number;
  externalReceiptNumber: string | null;
  operator: { id: string; name: string };
  redeemedAt: string;
  replayed: boolean;
  items: { rewardName: string; quantity: number }[];
};
```

Requests add optional `redeemQuantity`, `externalReceiptNumber`, and `idempotencyKey` for compatibility.
Enabled cycle redemptions require quantity one; legacy backlog permits a valid requested quantity.

## Client behavior

Keep VISIT as the sole default selection where a visit is allowed.
Select visit and cycle redemption exclusively under this policy.
At 7–8, show the first reward, the option to continue, and the original expiry.
At 9, disable visits and offer both the first reward and the higher reward.
At scanning, ask the customer which eligible reward they want.
Show the required visits and the visits that remain for each choice.
Offer the choice to continue at 7–8. Require an explicit reward choice before redemption.
Require the external receipt number before redemption confirmation.
Preserve the operation key and request after an uncertain response.
Display the server's committed quantity, reward names, operator, receipt, and remaining balance.
Display the server's remaining cycle visits after redemption.
Show expiry in the merchant timezone in Cash, dashboard, customer cards, and wallet passes.
Keep legacy balances clear during the transition.
Use the canonical API routes for authoritative operations.

## Jobs and release

Refresh wallet passes when a cycle expires. Persist a refresh marker for retry.
Send a reminder seven days before expiry with a stable entitlement-specific deduplication key.
Group units by card and expiry to avoid repeated identical messages.
Use the existing delivery infrastructure with fixture adapters in tests.
Do not contact real customers during local checks.

Prepare activation SQL, before and after queries, and a rollback procedure.
Activation and migration reruns must preserve counts and deadlines.
Policy starts disabled until the verified release.
Keep Marco's reconciliation outside Git. The September 30 receipt and October 5 redemption require a separate audit.

## Required proof

- Visit 7 creates one reward and one immutable 30-day deadline.
- Visit 8 and 9 preserve that deadline and create no additional unit.
- First reward redemption at 7, 8, and 9 leaves 0, 1, and 2 visits respectively.
- Second reward redemption at 9 leaves zero visits.
- Both choices at 9 consume one entitlement; duplicate or concurrent choices cannot claim both.
- Retained visits have no expiry until their next seventh visit creates a new deadline.
- Visit 10 and excess bulk credits fail without writes.
- Expiry resets the cycle in reads and mutations at the exact boundary.
- Visits 1–6 remain valid without a deadline.
- Duplicate and concurrent commands cannot consume a reward twice.
- Changed requests conflict; retries return the original committed result.
- Activation preserves legacy units, progress, history, and deadlines on rerun.
- Reversals preserve the selected tier, original deadline, retained visits, and later progress.
- Birthday, overrides, mixed tiers, and disabled merchants retain correct behavior.
- Lists, exports, metrics, wallet passes, and scan state agree.
- RLS prevents cross-merchant reads and writes.
- Reminder and wallet retries have durable deduplication.
- Real browser clicks prove reward choice, receipt entry, retained visits, and refreshed history.

## Tools and sources

Use PostgreSQL 16.15, pg 8.22.0, Node 22, pnpm 10.29.3, Vitest 2.1.9, and Playwright/CDP.
PostgreSQL row lock semantics: https://www.postgresql.org/docs/16/explicit-locking.html.
Repository sources: shared card SQL, reward profile, scan repository, IntegrityService, and local verification playbook.
Unit entitlements provide historical grace and reversal deadlines that card-only fields cannot represent.
