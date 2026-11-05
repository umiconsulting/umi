# UMI CI foundation

The owner approved the Addy baseline in the conversation on 2026-11-04.
The implementation uses one CI entry point, explicit job dependencies, and repository commands.

## Scope

Keep the existing lint, contract, token, API, database, and secret checks.
Move database verification out of YAML without changing the migration-selection policy.
Require successful validation before automatic deployment of the same release commit.
Preserve staging and main as the release branches and preserve the production hold variable.
Select API, Dashboard, Landing, Cash, and POS checks from source and shared dependency changes.
Reuse validated web artifacts for Cloudflare deployment.
Keep signed POS distribution and hardware certification in their existing workflows.

## Sequence and verification

1. Add a regression test for deployment of an older release commit after a newer push.
   Verify that the old deploy script fails this test, then pin checkout to the release commit.
2. Extract the database verification command and its synthetic fixture.
   Test migration application, repeat-run skipping, checksum drift, and SQL failure against disposable PostgreSQL.
   Replace the inventory test that counts commands in YAML with these behavior checks.
3. Convert existing validation and deployment workflows to reusable components.
   Add one CI entry point with separate security checks and a required-result job.
   Keep deployment credentials outside validation jobs.
4. Run actionlint, ShellCheck, formatting, existing unit checks, and database integration checks.
   Verify aggregate failure behavior and review permissions, triggers, and release identity.

## Boundaries

No production database change, deployment, branch-rule change, or merge is part of local verification.
Existing product suites remain intact except the replaced workflow-layout assertion.
New tests cover the release-identity and migration-runner boundaries.
Cash adds its existing 57 tests and build. The unsigned POS build keeps its existing coverage.
This change adds no new product test scenarios.

## Tools and sources

Use existing pnpm 10.29.3, Node 22 in CI, GitHub Actions, and PostgreSQL 17 with pgvector.
Use actionlint 1.7.12 and installed ShellCheck for workflow and shell verification.
Use pinned dorny/paths-filter v3 for deployment selection instead of a custom diff parser.
Sources: https://github.com/addyosmani/agent-skills/blob/301b02b12bff98e4688e6984af6556802322bbde/.github/workflows/test-plugin-install.yml
and https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows.

Azure Boards remains the canonical tracker. Its MCP tools are unavailable in this session.
No work-item contents or IDs are assumed. This file records implementation steps, not a replacement tracker.

## Local results

- The deployment regression failed against the moving-branch checkout and passed after the commit fix.
- API unit tests passed: 2,147 passed and 29 existing skips.
- Database schema integration passed: 363 passed and two existing skips.
- Realtime integration passed: eight tests.
- The database security gate passed 48 structural checks and reported one unmeasured check.
- The migration runner checks passed against disposable PostgreSQL.
- Dashboard, Landing, and Cash builds passed. Cash used Node 22 and temporary build credentials.
- Cash tests passed: 57 tests. Contract tests passed: 110 tests. Token tests passed: eight tests.
- Generated TypeScript and Dart checks passed, including Dart optional-field behavior.
- `pnpm check:pr` passed with the existing baseline of 68 lint warnings.
- actionlint 1.7.12 and ShellCheck passed within the documented scope.
- Selection examples passed with picomatch, the matcher used by paths-filter.
- The actual aggregate commands passed 2,064 CI scenarios and 304 release scenarios.
- Gitleaks 8.30.1 passed across origin refs, tags, and HEAD. Additional local refs produced findings outside this branch's release history.

The independent Addy review found and verified the fix for production hold selection.
Held runs now cannot advance the deployment baseline.
The review confirmed that live branch rules require no existing status contexts.
The old workflow comments about required checks were stale.

This Linux machine cannot verify the unsigned iOS compilation through Xcode.
The changed GitHub orchestration and provider settings still need verification in their hosted environments.
No live settings or deployment changed during local verification.
The preexisting migration transaction policy remains outside this CI change.
