# Phase 3d-lifecycle — Cash-cron WhatsApp journeys (binding + cutover record)

**Status:** Built & verified (tsc + 199 vitest + `nest build` green; queries + dedup
smoke-tested on the local replica). Uncommitted on `main` with the rest of Phase 3.
**Source:** `apps/umi-conversaflow/supabase/functions/job-worker/processors/cash-cron.ts`
(1,204 LOC) + RPCs in `…/supabase/migrations/20260613000003_cron_jobs.sql`.

## Scope decision — only the WhatsApp half ports

`cash-cron.ts` had 7 journeys. **Only 4 emit WhatsApp** and were ported. The other
3 are **Apple PassKit + Google Wallet push only, with no WhatsApp output** → they
belong to umi-cash (the live loyalty/wallet writer) and were **dropped entirely**
(spec §2.1.1 / §7.4 — avoids the "wallet-push double-fire"):

| Journey | Output | Action |
|---|---|---|
| `birthday_rewards` (issuance) | writes BirthdayReward + Apple/Google push | **DROP** (umi-cash owns issuance + wallet) |
| `expire_birthday_rewards` | status→EXPIRED + Apple/Google push | **DROP** (umi-cash) |
| `goal_proximity` | Apple push only | **DROP** (umi-cash) |
| `reward_expiring` | WhatsApp | **PORT** |
| `streak_recognition` (3/6/12w) | WhatsApp | **PORT** |
| `welcome_no_visit` | WhatsApp | **PORT** |
| `winback_inactive` (14/30/60d) | WhatsApp | **PORT** |

`reward_expiring` reads `loyalty.birthday_rewards`, which umi-cash writes — clean
read/write split: umi-cash issues birthday rewards; the bot nudges on expiry.

## Binding map (umi_cash Prisma → canonical), all verified on the replica

| Legacy | Canonical |
|---|---|
| `umi_cash."LoyaltyCard"` | `loyalty.cards` (→ `account_id` → `loyalty.accounts.person_id` → `core.people`) |
| `umi_cash."Visit".cardId/scannedAt` | `loyalty.visit_events.loyalty_card_id / occurred_at` |
| `umi_cash."BirthdayReward"` status `ACTIVE` | `loyalty.birthday_rewards` status **`active`** (lowercase; CHECK active/redeemed/expired) |
| `umi_cash."User".name / .phone` | `core.people.display_name / normalized_phone` (phone required to send) |
| `umi_cash."Tenant"` `subscriptionStatus=ACTIVE` | `core.tenants.status = 'active'`; name/timezone on `core.tenants` |
| `tenant.lifecycleCopy / birthdayRewardName` | `loyalty.programs.branding->'lifecycle_copy'` / `loyalty.programs.birthday_reward_name` |
| `RewardConfig` (visitsRequired/rewardName) | `loyalty.reward_configs` where `is_active` order by `activated_at desc` |
| `WhatsAppOutbox` idempotency + `LifecycleEvent` | `loyalty.lifecycle_sends` **UNIQUE(tenant_id, card_id, journey)** |

### Streak / winback — ported verbatim from the RPC SQL (no guessing)
- **streak (`get_streak_cards`)**: card qualifies when
  `weeks = COUNT(DISTINCT date_trunc('week', occurred_at))` over visits since
  `date_trunc('week', now()) - (weeks-1) weeks` (a visit in each of the last N ISO weeks).
- **winback (`get_winback_cards`)**: a visit in `[now-(days+1), now-days)` **and**
  no visit since `now-days` (most recent visit ~`days` ago).

## Dedup & delivery
- `LifecycleRepository.claimSend` = `INSERT … ON CONFLICT (tenant_id,card_id,journey)
  DO NOTHING`; first claim → enqueue, repeat claim → skip. Proven on the replica
  (1 then 0). `reward_expiring` journey key = `reward_expiring_${year}` (matches source).
- On claim, enqueue `whatsapp.lifecycle` → `outbound` queue (handler already built in
  3d). `to` = `core.people.normalized_phone`; `TwilioAdapter.toWhatsApp()` adds the
  `whatsapp:` prefix idempotently.

## Scheduling & the cutover switch
- `LifecycleScheduler` (worker-only) registers BullMQ `upsertJobScheduler` repeatables,
  UTC patterns mirroring `20260613000003_cron_jobs.sql`:
  `reward_expiring 0 14 * * *`, `welcome_no_visit 0 17 * * *`,
  `winback_inactive 30 17 * * *`, `streak_recognition 0 18 * * 1`.
- **`LIFECYCLE_CRONS_ENABLED` (default `false`)** is the entire cutover switch. umi-cash
  still runs these journeys during the dual-writer window, so enabling here first would
  **double-send**. At cutover: disable the umi-cash crons, then set
  `LIFECYCLE_CRONS_ENABLED=true` on the VPS worker. When false, the scheduler tears its
  own schedulers down (idempotent), so flipping the flag fully starts/stops delivery.

## Files
`src/modules/lifecycle/{lifecycle.repository,lifecycle.service,lifecycle-copy,lifecycle.module}.ts`,
`src/jobs/{lifecycle.processor,lifecycle.scheduler}.ts`, `LIFECYCLE_CRONS_ENABLED` in
`config.schema.ts`, wired in `worker.module.ts`.
