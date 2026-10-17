# Production preparation for single cycle rewards

Updated October 17, 2026, America/Mazatlan. This records preparation, not a production release.
The production observations below date from October 7 unless stated otherwise.

Implementation: [PR 213](https://github.com/umiconsulting/umi/pull/213).
Current production database migration and activation states remain unverified.
The separate authorized customer balance correction is complete; its evidence stays outside Git.

## Verified on October 7

- The production API reports Healthy, with database and Redis checks passing.
- It serves commit `fabffb075f343283ac65b13ea1d21ef6ddef8032`, contract `2.23.0`, and current/expected schema `build-v3-79`.
- The production schema has the canonical parent columns, keys, functions, and roles required by this migration.
- The tenant's active ladder has thresholds 7 and 9. The new policy and entitlement tables are absent.
- The database provider confirms the intended project is active in `us-east-2`.
- The PR's API, contract, lint, token, dashboard, and iOS checks report success. See the [local verification record](2026-10-07-single-cycle-rewards-verification.md) for behavioral and database proof.
- The Cash status says **Canceled by Ignored Build Step**. It does not prove a Cash preview build.
- CodeRabbit skipped review because the PR is a draft. The independent implementation review is recorded separately.

## Production observations, October 17

The production API reported Healthy at commit `7f4d2f4c0abd0e77cc5ea1616cf4ed133c4c6d59`, contract `2.39.0`, and schema `build-v3-79`.
The release hold was `false`, with its last update on October 14 at 21:32 UTC.
These deployments occurred outside this rehearsal. Current database migration and tenant activation states require read-only verification.
API health does not prove worker execution or the current client builds.

## Backup and restore evidence, October 17

The complete custom archive was created on October 11. Its checksum passed a fresh verification on October 17.
The isolated PostgreSQL 17.11 restore passed for `umi`, `merchant`, and `runtime`, with the required public trigger function and supported extensions.
Canonical metadata, the compared application data, and sequence states matched the archive.
Provider schemas and extensions remain outside the local restore scope. The complete archive remains preserved.
The [verification record](2026-10-07-single-cycle-rewards-verification.md#archive-restore-and-activation-rehearsal-october-17) states the compatibility adjustments and activation results.
No application consumers started, and this rehearsal made no production changes.

## Release gates

1. Backup access and archive verification passed. Create a fresh private backup immediately before the production release.
2. Restoration passed for the application scope described above. Retain the complete archive and review the provider exclusions before production changes.
3. Verify the current production database state through read-only checks before further migration actions. Check the tables, functions, grants, and tenant policy explicitly: the migration does not change the `build-v3-79` readiness stamp.
4. Verify the production worker's scheduler, consumer, expiry queue, and delivery settings. API health proves API readiness; it does not prove worker execution.
5. Confirm a Cash production build runs and embeds both canonical API origins. An earlier completed Git integration deployment exists, but recent main deployments and this PR were skipped by the ignored-build rule.
6. Implement the approved-template request path before enabling proactive WhatsApp reminders. The current adapter sends a plain message body, which does not meet the provider's template requirement outside the 24-hour customer service window. Configuration alone cannot fix that request. Complete delivery configuration and review the effect of global lifecycle flags on other scheduled jobs. Database expiry can operate while reminders remain disabled.
7. Review the concrete migration and release actions under [Agent-Safe Change Boundaries](../governance/agent-safe-boundaries.md), which requires human review before database migrations, production-affecting scripts, secret handling, and deployment configuration.
8. Follow the [release sequence and recovery plan](2026-10-07-single-cycle-rewards.md), including the grace-period announcement, activation verification, and a controlled fixture workflow. Supply the transaction activation setting only after the compatible applications pass verification.

The production worker also inherits the image's HTTP healthcheck despite running without an HTTP listener. This is an existing monitoring defect: `compose up` does not wait for that healthcheck and does not restart a process solely because it becomes unhealthy. It still prevents using the container health status as proof that reward jobs work.

Reminder delivery references: [WhatsApp service window](https://www.twilio.com/docs/whatsapp/key-concepts) and [template requests](https://www.twilio.com/docs/content/send-templates-created-with-the-content-template-builder).

No credentials, private backup, or customer reconciliation data belong in the PR.

## Historical deployment hold plan

The October 10 plan held deployment so reviewed code could enter `main` before the database migration.
The GitHub jobs checked `UMI_REWARD_RELEASE_HOLD`. The Cash and dashboard configurations disabled Vercel deployments from `main`.
The plan required the matching API and worker before the clients.

The October 17 observations above supersede that planned hold state.
Use the current release gates and [release sequence](2026-10-07-single-cycle-rewards.md) for subsequent actions.
Verify the current database and deployments before any production change.

Configuration source: [Vercel configuration schema](https://openapi.vercel.sh/vercel.json). It defines branch-specific deployment control and enables unspecified branches by default.
