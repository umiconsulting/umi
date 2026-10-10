# Production preparation for single cycle rewards

Checked October 7, 2026, America/Mazatlan. This records preparation, not a production release.

Implementation: [PR 213](https://github.com/umiconsulting/umi/pull/213).
The reward policy, expiry, and scan screen changes have not been deployed.
The additive migration has not been applied, and no merchant policy has been activated.
The separate authorized customer balance correction is complete; its evidence stays outside Git.

## Verified

- The production API reports Healthy, with database and Redis checks passing.
- It serves commit `fabffb075f343283ac65b13ea1d21ef6ddef8032`, contract `2.23.0`, and current/expected schema `build-v3-79`.
- The production schema has the canonical parent columns, keys, functions, and roles required by this migration.
- The tenant's active ladder has thresholds 7 and 9. The new policy and entitlement tables are absent.
- The database provider confirms the intended project is active in `us-east-2`.
- The PR's API, contract, lint, token, dashboard, and iOS checks report success. See the [local verification record](2026-10-07-single-cycle-rewards-verification.md) for behavioral and database proof.
- The Cash status says **Canceled by Ignored Build Step**. It does not prove a Cash preview build.
- CodeRabbit skipped review because the PR is a draft. The independent implementation review is recorded separately.

## Remaining gates

1. Obtain a working protected production connection and create a fresh private backup. The saved database password was rejected by both the provider's direct endpoint and its documented session pooler. Its dotenv parsing was independently checked. No dump exists yet. The provider backup metadata API returned an empty backup list with point-in-time recovery disabled, so it supplies no existing backup to restore.
2. Rehearse restoration in the isolated local PostgreSQL 17 cluster. Production includes provider-managed extensions; document any local restore omissions and verify the complete application data and schema.
3. Apply the additive migration before deploying API readers. Check the new tables, functions, grants, and migration behavior explicitly: the migration does not change the `build-v3-79` readiness stamp.
4. Verify the production worker's scheduler, consumer, expiry queue, and delivery settings. API health proves API readiness; it does not prove worker execution.
5. Confirm a Cash production build runs and embeds both canonical API origins. An earlier completed Git integration deployment exists, but recent main deployments and this PR were skipped by the ignored-build rule.
6. Implement the approved-template request path before enabling proactive WhatsApp reminders. The current adapter sends a plain message body, which does not meet the provider's template requirement outside the 24-hour customer service window. Configuration alone cannot fix that request. Complete delivery configuration and review the effect of global lifecycle flags on other scheduled jobs. Database expiry can operate while reminders remain disabled.
7. Review the concrete migration and release actions under [Agent-Safe Change Boundaries](../governance/agent-safe-boundaries.md), which requires human review before database migrations, production-affecting scripts, secret handling, and deployment configuration.
8. Follow the [release sequence and recovery plan](2026-10-07-single-cycle-rewards.md), including the grace-period announcement, activation verification, and a controlled fixture workflow.

The production worker also inherits the image's HTTP healthcheck despite running without an HTTP listener. This is an existing monitoring defect: `compose up` does not wait for that healthcheck and does not restart a process solely because it becomes unhealthy. It still prevents using the container health status as proof that reward jobs work.

Reminder delivery references: [WhatsApp service window](https://www.twilio.com/docs/whatsapp/key-concepts) and [template requests](https://www.twilio.com/docs/content/send-templates-created-with-the-content-template-builder).

No credentials, private backup, or customer reconciliation data belong in the PR.

## Merge into main with deployment held

The October 10 merge uses a deployment hold so the reviewed code can enter `main` before the database migration.

- Set repository variable `UMI_REWARD_RELEASE_HOLD=true` before the merge. Both production GitHub deployment jobs check it. Dashboard previews stay enabled.
- Cash and dashboard Vercel configurations set `git.deploymentEnabled.main=false`. Other branches retain the provider's default deployment behavior.
- Keep the three production apps on their current versions. New clients offer durable redemption retries, which the old API cannot honor.
- After the backup, migration, and release checks pass, release the hold through a reviewed change. Deploy the matching API and worker before the clients.
- Restore Vercel main deployments only after the matching API is ready. Remove or set the repository hold variable to `false` only as part of that release.
- The API workflow has no manual dispatch trigger. Plan a current-main deployment trigger after the database checks; re-enabling a trigger does not deploy a missed commit.

Configuration source: [Vercel configuration schema](https://openapi.vercel.sh/vercel.json). It defines branch-specific deployment control and enables unspecified branches by default.
