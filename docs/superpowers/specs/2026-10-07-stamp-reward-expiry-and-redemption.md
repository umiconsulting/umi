# Stamp reward expiry and redemption

> Superseded on 2026-10-07 by `2026-10-07-single-cycle-reward-policy.md`.
> The user explicitly removed future accumulation. Do not implement this earlier design.

## Approved behavior

El Gran Ribera will use a 30-day expiry for each earned, banked reward.
Existing available rewards will receive 30 days from activation.
Stamps remain valid. Customers can still accumulate rewards within their expiry periods.
Staff must select the redemption quantity and enter the external receipt number.
Umi must show the quantity deducted and the remaining available rewards.
The external cash register remains a manual system.

The user approved 30 days on 2026-10-07. The user also requested the other discussed controls.
Those controls are quantity selection, accurate confirmation, prevention of excess and duplicate deductions, and staff attribution.

## Source and scope

Implement against `origin/main` at `affd6bc` in the isolated feature worktree.
The older local `build-v3` checkout lacks the current reward tiers and reversal behavior.
`apps/umi-api` owns the facts and validation. Cash and the dashboard consume its results.
Use canonical `merchant` tables. Preserve the legacy schemas as historical inputs.

Keep the existing lower-tier choice (`REDEEM_BASE`) separate from banked redemption (`REDEEM`).
The lower-tier choice consumes the current cycle and has quantity one.
It represents current stamp progress, which this policy preserves.
If an administrator reverses that choice, Umi restores a banked unit with the original cash-out deadline.
Birthday rewards and stored money retain their existing policies.

## Reward records

Add one entitlement for each banked reward.
Each entitlement stores its merchant, card, reward identifier, name, tier, threshold, source, and source unit number.
Future entitlements have a real `earned_at` and an immutable `expires_at`.
Imported entitlements have no invented earning date. They have an activation time and a grace deadline.
An entitlement can identify its current redemption. Historical redemption rows retain their identifiers and reversal fields.
Each new unit redemption identifies its entitlement, operation, staff member, and external receipt number.

The available count comes from unclaimed entitlements whose deadline is strictly after the database time.
Use the database clock for every final check. A delayed background job must never make an expired reward redeemable.
Keep `rewards_earned`, `cycle_anchor`, and the stamp events. Expiry changes availability, not lifetime facts or progress.
Derive lower-tier banked availability from entitlement identities for enabled merchants.

The policy starts disabled. Activation creates the existing available units and records the policy start once.
Activation also associates standing historical redemptions with consumed imported units.
That association permits a later reversal without a new 30-day period.
Activation and migration reruns must not duplicate units or extend deadlines.
Other merchants keep their existing policies until an administrator enables expiry for them.

## Redemption transaction

The request carries `redeemQuantity`, `externalReceiptNumber`, and `idempotencyKey`.
The quantity is a positive integer. Banked redemption permits quantities through the authoritative available count.
Expiry-enabled merchants require a receipt reference and a durable operation key.
Reject a combined banked redemption and lower-tier cash-out.
Use the authenticated staff identity. The receipt's waiter name is not an authenticated Umi identity.

Use the existing `IntegrityService` and `merchant.business_command` for command identity, fingerprint, and stored confirmation.
Pass its transaction client into the scan mutation. Avoid a nested transaction.
Take the same card row lock for scans, stamp credits, and reversals.
After the lock, read the current balance and profile, then validate the quantity and eligibility.
Consume available units by earliest expiry, issue time, and identifier.
One quantity batch creates one historical redemption row per unit.
Mixed tiers retain their names in the confirmation.

A repeated command returns the stored confirmation and performs no new write.
A changed quantity, receipt, card, or action with the same key conflicts.
The fingerprint must also bind the authenticated actor.
Validate the visit and birthday guards under the same lock when the operation includes them.
Reject an invalid combined operation before any action changes a fact.

## Reversal

A reversal retains the redemption row and the original entitlement.
Clear the entitlement's current claim only if that claim matches the redemption.
Preserve the original expiry. An expired entitlement remains unavailable after reversal.
Repeat reversals return an unchanged result.
Preserve the existing cycle and lifetime-counter behavior for lower-tier reversals.

## Public contract

Add these optional request fields to the shared scan schema and Cash request types:

```ts
redeemQuantity?: number;
externalReceiptNumber?: string;
idempotencyKey?: string;
```

Expose `rewardExpiryDays`, `nextRewardExpiresAt`, and an available-unit summary on card and preview responses.
The committed response includes:

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

The Cash scan screen keeps only VISIT selected by default.
It offers an explicit quantity and receipt input for banked redemption.
It displays the available count and nearest expiry in the merchant timezone.
It disables confirmation during the request and retains the operation key after an uncertain response.
After success, it displays the actual quantity and remaining balance.
The dashboard's separate redemption action uses the same request and confirmation.

All readers must use the same availability rule: scan, customer card, customer lists, exports, metrics, and wallet passes.
Use customer-facing Spanish text in the existing Spanish flows.
Do not show implementation details in the customer flow.

## Background work

Touch affected cards and refresh their wallet passes after reward expiry.
Send a reminder seven days before expiry through the existing delivery infrastructure.
Use durable, entitlement-specific deduplication. Do not reuse the birthday reminder's dynamic year key.
Group units for the same card and deadline to prevent several identical reminders.
Tests must use local fixtures and adapters. They must not contact real customers.

## Customer reconciliation

Marco Antonio Trujillo has one recorded redemption on September 30, followed by one stamp.
The supplied external receipt, folio 37645, shows three discounted drinks.
The reconstructed available count immediately before that recorded redemption was three.
His later October 5 redemption also affects a correction.
Prepare a separate reconciliation report. Preserve every historical row and identify the missing two units.
Do not silently set a balance or invent an earning date to hide a discrepancy.
Keep real customer data outside the Git repository.
Production corrections and policy activation require the concrete migration and reconciliation results first.

## Required proof

- Redeem three of three units and return zero remaining.
- Refuse zero, fractional, negative, and excess quantities without writes.
- Two concurrent requests for the final unit produce one successful deduction.
- A command retry returns its original response. A changed request conflicts.
- A reward fails at its exact expiry boundary even if the worker has not run.
- A reversal preserves the original deadline before and after expiry.
- Migration and activation reruns preserve counts and deadlines.
- Bulk stamp credits create exactly the earned units and remain idempotent.
- Current-cycle lower-tier, birthday, override, and mixed-tier behavior remains correct.
- All card, wallet, dashboard, and export readers agree.
- RLS prevents cross-merchant access to entitlements and operations.
- Reminder and pass refresh retries produce no duplicate delivery.
- Real browser clicks prove quantity, receipt, confirmation, and refreshed history.

## Tools and evidence

Use PostgreSQL, raw `pg` queries, Vitest, and the existing Playwright/CDP workflow.
Use pnpm 10.29.3 and Node 22 for the repository's locked dependency graph.
PostgreSQL row locks: https://www.postgresql.org/docs/16/explicit-locking.html.
Repository sources include `card-state.sql.ts`, `cash-scan.repository.ts`, `IntegrityService`, and the local verification playbook.
The unit entitlement table is new because the current lifetime counter cannot provide historical earning dates or per-unit deadlines.
