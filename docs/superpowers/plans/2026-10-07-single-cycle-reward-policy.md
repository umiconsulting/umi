# Single cycle reward policy implementation plan

Spec: `docs/superpowers/specs/2026-10-07-single-cycle-reward-policy.md`.
Use subagent-driven-development with distinct file ownership and task review.
Worktree: `/private/tmp/umi-reward-expiry-20261007`, base `affd6bc`.
No production activation or customer correction occurs in this plan.

## Task 1: Policy, entitlements, and shared state

Own the canonical migration, reward-entitlements helpers and integration tests, shared card SQL, and duplicated availability readers.
Add policy columns and explicit activation. Import legacy obligations and audit anchor normalization.
Add one open cycle constraint, immutable deadlines, tier snapshots, expiry markers, RLS, and grants.
Expose getRewardExpiryPolicy, syncCycleReward, expireCycleReward, redeemRewardEntitlements, and restoreRewardEntitlement on a supplied PoolClient.
Provide shared SQL projections for policy-aware cycle position and available unit counts.
Integrate the new migration into the fresh-build runner before 99_verify.
Protect enabled anchors from the old configuration rewrite.
Write real DB tests first. Prove cycle7/8/9, exact expiry, import reruns, recovery, and RLS.

## Task 2: Safe scans, credits, and reversals

Own cash-scan.repository.ts, cash-scan.service.ts, DTO/module/controller changes, contract schemas, and scan tests.
Consume Task 1 transaction helpers. Reuse IntegrityService for replay and actor binding.
Take card row locks and enforce fresh guards in one transaction.
Cap visits and bulk credits at9. Open at7 and upgrade at9 without another unit.
Separate visit from stamp redemption. Require receipt and key for enabled redemption.
Consume the selected threshold on cycle redemption. Preserve later progress on historical reversals.
Return the committed confirmation and policy-aware preview fields.
Write behavioral and DB tests first. Prove concurrency, replay, rollback, credits, and disabled behavior.

## Task 3: Client and wallet surfaces

Own Cash and dashboard UI files, Cash request types, API card/read service projections, and wallet presentation.
Consume the agreed additive contract. Do not edit scan repository/service or shared contract schemas.
Add receipt, exclusive cycle actions, cap guidance, original expiry, committed confirmation, and stable retries.
Show legacy balances separately. Use the merchant timezone.
Verify requests with behavioral tests and operator flows with real browser clicks.

## Task 4: Expiry jobs and reminders

Own new scheduler/processor, worker module registration, and targeted worker tests.
Consume entitlements and expiry helper under the same card row lock.
Touch and refresh expired cards with durable retry markers.
Deliver grouped seven-day reminders through the existing outbox with stable keys.
Use fixture recipients and adapters. Prove repeated jobs cannot duplicate delivery.

## Task 5: Whole-change proof and release

Build a fresh private database. Apply the migration twice.
Run relevant service, DB, contract, client checks, typechecks, and builds.
Verify real browser workflows with fixture accounts and canonical routes.
Prepare tenant activation SQL, verification queries, worker/routing checklist, and rollback instructions.
Prepare Marco's separate reconciliation outside Git.
Dispatch an independent whole-change review and resolve required findings.
Report exact local proof and outstanding production actions.

## Task 6: Retained visits and selected reward facts

User steering replaces whole-cycle reset with threshold consumption.
Own the entitlement migration, helpers, shared state, and entitlement integration tests.
Make cycle_base available for the current unit at 7–9, including a top-tier unit.
Consume the explicitly selected tier snapshot and advance the anchor by 7 or 9.
Store selected tier, consumed visits, and anchors before and after in the redemption link.
Preserve NULL consumption facts for historical imports.
Restore the selected reward as recovery without crediting visits or rewinding the anchor.
Write failing DB tests first. Prove all four choices, new deadlines after carryover, recovery, and migration reruns.
Use the same card lock and retain historical expiry ordering.

## Task 7: Mutation and contract alignment

Own scan repository/service, scan tests, and contract artifacts.
Consume Task 6 helpers. Permit REDEEM_BASE at 9 while enforcing exclusive choices.
Preview base eligibility through 9. Preserve historical priority.
Verify exact remaining visits and selected reward in the committed response and replay.
Write failing tests first. Prove concurrent base/top choices consume only one unit.
Keep disabled merchants, bulk limits, birthday, receipts, and actor attribution correct.

## Task 8: Scan choices and client presentation

Own Cash/dashboard flows, API presentation, wallet presentation, and client tests.
Show both eligible reward choices at 9, and the base choice at 7–8.
Show the visit cost and remaining visits. Preserve exclusive actions and explicit reward selection.
Keep VISIT as the default only where allowed. Keep the choice to continue at 7–8.
Display authoritative remaining visits after redemption and preserve durable retries.
Update obsolete full-reset copy across the owned surfaces.
Use tests and actual browser workflows for first-at-8, first-at-9, and second-at-9.
