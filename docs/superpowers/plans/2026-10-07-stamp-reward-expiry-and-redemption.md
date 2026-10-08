# Stamp reward expiry and redemption implementation plan

> Superseded on 2026-10-07 by `2026-10-07-single-cycle-reward-policy.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Execute the tasks with their required tests.

**Goal:** Apply the approved 30-day rule and make each manual reward deduction accurate and auditable.

**Architecture:** Add dated unit entitlements to the canonical merchant model. Use the existing command journal and one card row lock for each mutation. Keep clients thin and expose one shared availability rule.

**Tech Stack:** PostgreSQL 16/17, `pg`, NestJS, TypeScript, Vitest, Next.js Cash, React dashboard, Playwright/CDP.

**Spec:** `docs/superpowers/specs/2026-10-07-stamp-reward-expiry-and-redemption.md`

## Global constraints

- The expiry is 30 days from each future earned reward.
- Existing available rewards have 30 days from activation, with unknown earning dates recorded as NULL.
- Keep stamp progress, tiers, overrides, historical redemptions, and stored money.
- Use canonical merchant tables and Node 22. Do not change legacy write models.
- The policy starts disabled. Preserve current behavior for merchants without the policy.
- Scope edits to the isolated feature worktree. Keep customer data outside Git.
- Use the database clock, actor-bound fingerprints, one card row lock, and durable confirmations.
- Use real database tests for concurrency, expiry, migration, activation, and RLS.
- Production activation, deployment, and customer correction follow successful local verification.

## Task 1: Unit entitlements and availability

**Files:**

- Create `supabase/migrations/20261007000000_stamp_reward_entitlements.sql`.
- Create `apps/umi-api/src/shared/loyalty/reward-entitlements.ts`.
- Create `apps/umi-api/src/shared/loyalty/reward-entitlements.integration.ts`.
- Modify the shared card state and duplicated readers in Cash and customer repositories.
- Modify the local migration runner to apply the canonical new migration after file 79 and before verification.

**Interfaces:** Export transaction-client helpers with these signatures:

```ts
getRewardExpiryPolicy(c: PoolClient, merchantId: string): Promise<{ days: number | null; startedAt: string | null }>;
issueRewardEntitlements(c: PoolClient, input: RewardIssueInput): Promise<string[]>;
redeemRewardEntitlements(c: PoolClient, input: RewardRedeemInput): Promise<RewardRedemptionUnit[]>;
restoreRewardEntitlement(c: PoolClient, merchantId: string, redemptionId: string): Promise<{ linked: boolean; expired: boolean }>;
```

`RewardIssueInput` carries merchantId, cardId, rewardId, rewardName, isBase, threshold, sourceType, sourceId, quantity, earnedAt, and optional consumedRedemptionId.
`RewardRedeemInput` carries merchantId, cardId, quantity, staffId, receiptNumber, and commandId.
`RewardRedemptionUnit` carries id, entitlementId, rewardId, rewardName, isBase, expiresAt, and redeemedAt.
Helpers operate only on the supplied transaction client. Issuance returns no units for disabled merchants.

- [ ] Write a real database test for an available entitlement that becomes unavailable at its exact deadline.
- [ ] Run it with `vitest.integration.config.ts` and verify the missing behavior fails.
- [ ] Add the entitlement schema, tenant policy columns, RLS, explicit grants, source-unit uniqueness, and activation function.
- [ ] Implement issue, claim, restore, and shared availability. Activation imports outstanding units and associates standing historical redemptions.
- [ ] Prove expiry, earliest-expiry selection, mixed tiers, reversal deadlines, activation reruns, source idempotency, and cross-merchant isolation.
- [ ] Verify all duplicated readers use the shared projection and preserve disabled-merchant results.
- [ ] Review the task diff and record exact verification output.

## Task 2: Safe quantity operations

**Files:** Cash scan DTO, shared ScanRequest schema, scan service/repository/module, existing scan tests, and new scan database tests.
**Consumes:** Task 1 helpers and availability fields.
**Produces:** The spec's additive committed redemption response.

- [ ] Write a failing test for quantity three from a balance of three.
- [ ] Add DTO and shared-schema positive integer, receipt-length, and operation-key validation.
- [ ] Use `IntegrityService.execute` for supplied operation keys and store the committed response in the same transaction.
- [ ] Refactor the repository to accept the command's `PoolClient`. Lock the card row before every authoritative guard.
- [ ] For enabled merchants, call `redeemRewardEntitlements` and return the actual unit names.
- [ ] Preserve disabled merchants and validate their fresh quantity under the same lock.
- [ ] Return identifiers from visit inserts and issue entitlements for each completed cycle. Bulk credits use the same issuer.
- [ ] Link consumed lower-tier cash-outs and use the original unit on reversal.
- [ ] Prove the final-unit race, changed-key conflicts, stable replay response, invalid combined operations, and atomic rollback.
- [ ] Review the task diff and record exact verification output.

## Task 3: Cash and dashboard flow

**Files:** Cash scan screen, request types and forwarding route, customer card/detail, wallet presentation, dashboard customer panel and data action.
**Consumes:** Task 2 request and committed response. Task 1 expiry fields.

- [ ] Add a behavioral request test for quantity, external receipt, and preserved operation key after failure.
- [ ] Add explicit quantity and receipt inputs. Keep VISIT as the sole default selection.
- [ ] Display the nearest deadline in the merchant timezone and preserve current-cycle lower-tier and birthday choices.
- [ ] Display the server's committed quantity, grouped reward names, and remaining count.
- [ ] Use the same fields and confirmation in the dashboard redemption action.
- [ ] Show deadlines beside available rewards on customer and wallet surfaces.
- [ ] Drive quantity three, receipt entry, confirmation, and refreshed history with real browser clicks.
- [ ] Review the task diff and record exact verification output.

## Task 4: Expiry refresh and reminders

**Files:** New stamp reward scheduler/processor, worker registration, and targeted worker tests.
**Consumes:** Entitlement deadlines and existing wallet/delivery infrastructure.

- [ ] Write failing tests for deadline refresh and a seven-day reminder that retries once without duplicate delivery.
- [ ] Touch and refresh cards whose available units expired. Keep redemption enforcement independent of the scheduler.
- [ ] Queue grouped reminder delivery with stable entitlement-specific deduplication.
- [ ] Verify a repeated job preserves wallet and reminder behavior, with fixture recipients only.
- [ ] Review the task diff and record exact verification output.

## Task 5: Whole-change verification and release artifacts

**Files:** Release instructions under `docs/deployment/`; customer reconciliation stays in `/private/tmp/marco-trujillo-audit/`.

- [ ] Build a fresh local database from the migration chain and apply the new migration twice.
- [ ] Run targeted database, service, contract, and UI checks, then typecheck and relevant builds.
- [ ] Confirm real Cash requests reach the canonical API in the release checklist.
- [ ] Verify three redeemed units leave zero, and expired units never pass a fresh redemption check.
- [ ] Prepare activation SQL for El Gran Ribera with 30 days. Prepare read-only before/after checks and a rollback procedure.
- [ ] Prepare Marco's separate reconciliation from receipt 37645, the missing two units, and the October 5 entry.
- [ ] Dispatch a whole-branch code review. Resolve required findings and repeat only the affected checks.
- [ ] Report the verified feature state and the exact remaining production actions.
