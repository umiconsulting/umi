# Staging architecture dispositions — 2026-11-15

**Baseline:** PR #284, `edba4a8d09e464a75b1676c0792433a6577253ae`.
**Scope:** Current staging release. One backend authority and the existing LAN KDS node remain.
**Authority:** The assigned release brief permits conservative, reversible staging defaults.
These decisions authorize no commercial terms, real-merchant activation, or production change.
**Completion:** Six dispositions are final for this release. ADOPT names required work; it does not report completed implementation.

All source paths below refer to the baseline commit, not the dirty root checkout.
Documented fact describes inspected source. Source-backed tradeoff describes a documented cost or constraint.
Umi-specific inference identifies the release choice.

## 1. API compatibility window — ADOPT

**Decision and status:** ADOPT one supported HTTP major, `/api/v1`, throughout this staging release.
Retain v1 until every enrolled staging client has a verified replacement and every pending journal has reconciled.
Only candidate-bound builds receive certification in this record; older builds need explicit replay and workflow checks.

**Basis — documented fact:** `packages/contract/src/catalog.ts` defines artifact `2.55.0` and `API_MAJOR_VERSION = 1`.
The generator emits both values. The POS currently compares artifact majors in `release_compatibility.dart`.
The API release identity omits the HTTP major. Artifact version and HTTP major are separate axes.
[SemVer](https://semver.org/) defines version compatibility against a declared public API; it supplies no support period.

**Release consequence and slice:** Add `apiMajorVersion` from `API_MAJOR_VERSION` to
`apps/umi-api/src/shared/release/release-identity.service.ts`.
Use generated `apiMajorVersion` in `apps/umi-pos/lib/core/release/release_compatibility.dart` for the HTTP-major check.
Preserve environment and minimum-POS checks. Keep artifact version for identity and schema verification.
Deploy the additive API field before the updated POS. A missing HTTP major must produce an explicit unsupported result.

**Acceptance:** Extend `apps/umi-pos/test/release_compatibility_test.dart` and
`apps/umi-api/src/modules/health/health.service.spec.ts`.
Prove v1 acceptance, v2 rejection, missing-major rejection, minimum-version rejection, and environment rejection.
Prove that an artifact-major change alone does not fail the HTTP-major check.
Run `pnpm --filter @umi/contract generate:check` and the extended tests.
Replay an immutable journal from the previous staged build before any client retirement.

## 2. Payment business model — EXCLUDE

**Decision and status:** EXCLUDE a new commercial payment model from this release.
No platform commission, pooled settlement, surcharge, merchant contract, or pricing promise enters staging scope.
Existing cash, manual-terminal evidence, and Point adapter behavior remain technical capabilities.

**Basis — documented fact:** `apps/umi-api/src/modules/tender/tender.module.ts` registers cash, manual terminal, and Point.
`apps/umi-api/src/modules/mercado-pago/point-credential.repository.ts` stores credentials per merchant.
`resolveToken` in `providers/mercado-pago-point.transport.ts` also permits a deployment-token fallback.
That fallback cannot prove isolation between merchant settlement accounts.
`apps/umi-api/src/modules/wallet/wallet.module.ts` manages passes; it supplies no commercial payment agreement.

**Release consequence — Umi-specific inference:** Retain technical tests and exclude live collection.
Use only synthetic merchants and provider fakes or an explicitly isolated sandbox.
`deploy/staging/compose.yml` sets wallet modes, but those modes do not disable Point charges.
The release check must verify Point availability separately and prove that staging cannot reach a live payment account.
Actual credentials and deployed availability remain UNVERIFIED by this decision review.

## 3. Conekta — EXCLUDE

**Decision and status:** EXCLUDE the Conekta gateway, QR payment, SPEI, OXXO, and BNPL integration from this release.
Order intake may retain payment at the counter.

**Basis — documented fact:** The tender registry has no Conekta adapter.
`apps/umi-api/src/modules/tender/tender.integration.ts` explicitly expects refusal for provider `conekta` before an attempt exists.
The September tender ADR's claim that no Point adapter exists is superseded by the baseline source.
Its Conekta integration is still absent.
[Conekta's test procedure](https://developers.conekta.com/docs/probar-localmente-los-webhooks-con-ngrok)
requires test credentials and webhook delivery; this review exercised neither.

**Release consequence — Umi-specific inference:** Retain the provider port and the refusal.
Do not add an apparent payment option without capture, reconciliation, refund, and duplicate-event evidence.
This release exclusion does not reject Conekta for a later release.

## 4. ONCA offline limits — ADOPT

**Decision and status:** ADOPT default-deny for new ONCA offline-cash activation in this release.
Positive exposure limits belong only to synthetic staging fixtures until the site drill proves the real devices.
No unlimited exposure is accepted.

**Basis — documented fact:** `db/migrations/002_onca_onboarding.sql` deliberately creates no offline-cash policy.
`apps/umi-api/src/modules/pos-offline/pos-offline.service.ts` issues a disabled policy when configuration is absent.
It checks cash exposure during replay. `apps/umi-pos/lib/features/offline/offline_policy.dart` checks local limits and expiry.
An absent onboarding insert does not prove that a deployed policy row is absent.

**Release consequence and slice:** Preserve these implementations.
Extend `apps/umi-api/src/modules/pos-offline/pos-offline.integration.ts` with the disabled-policy acceptance case.
Use the existing synthetic bounds in `apps/umi-pos/test/offline_policy_test.dart`:
MXN 100 per sale, MXN 300 accumulated, three pending sales, and ten queued commands.
Policy age is 600 seconds; catalog, pricing, and tax ages are 900, 600, and 600 seconds.
These are fixture values, not ONCA terms or hardware capacity claims.

**Acceptance:** A synthetic ONCA-shaped location without a policy cannot commit offline cash.
Prove each boundary and its next value, expiry, restart recovery, replay deduplication, and visible conflict retention.
Run the API integration test and the POS offline-policy and offline-journal tests.
Inspect the effective staging policy without changing a real merchant.
Printer, drawer, storage capacity, and a full disconnected shift remain UNVERIFIED on actual devices.

## 5. On-premise API replica — REJECT

**Decision and status:** REJECT an on-premise API and database replica for this release.

**Basis — documented fact:** Fusion plan §4.5 prohibits an alternate local server or database authority.
The baseline already has the LAN node, durable journal, ordered replay, and API-owned checkout.
`apps/umi-api/src/modules/pos-offline/pos-offline.service.ts` authorizes replay through the active backend context.
The staging workflow validates and deploys one exact API commit.

**Basis — source-backed tradeoff:** PostgreSQL 17 documents replication conflicts, stopped replication, and manual resolution.
Replication does not supply independent offline-write semantics.
[PostgreSQL conflict documentation](https://www.postgresql.org/docs/17/logical-replication-conflicts.html)

**Release consequence — Umi-specific inference:** Keep the existing LAN node and one financial writer.
No measured failure here justifies another deployment, credential store, backup procedure, or conflict authority.
Use `db/migrate.sh` and `db/migrations/README.md` for current forward migrations.
Older Supabase migration instructions do not create another active migration ledger.

## 6. LAN revocation window — ADOPT

**Decision and status:** ADOPT a maximum 300-second offline trust period for synthetic staging devices.
Measure it from the last successful cloud validation of that peer and credential.
This is a conservative release default, not a measured merchant requirement.

**Basis — documented fact:** `_authenticate` in `apps/umi-pos/lib/features/kitchen/lan_kds_node.dart`
rechecks cloud status after 30 seconds and uses a two-second request timeout.
It deletes cached trust after an explicit rejection, but permits a known credential during cloud failure without an expiry.
The 30-second recheck is not an offline revocation guarantee.

**Release consequence and slice:** Enforce the 300-second limit in that file for every authenticated LAN request.
Bind the validation record to the credential hash and merchant/location scope.
Use monotonic elapsed time within the process. Treat restart, clock rollback, and an absent validation record as a required online refresh.
Local traffic must not renew trust. An explicit cloud rejection must remove trust immediately when received.
Retain queued commands and the existing KDS node after refusal.

**Acceptance:** Extend `apps/umi-pos/test/features/kitchen/lan_kds_node_test.dart` with a controlled clock.
Prove acceptance before 300 seconds and refusal at 300 seconds, including HTTP 5xx and timeout paths.
Prove rejection after restart, scope change, credential change, clock rollback, and explicit revocation.
Run that test file and repeat the outage drill on native staging devices.
The baseline fails this expiry requirement by source inspection; implementation and device proof remain required.

## Router experiment, cost, and verification boundary

**Router disposition:** EXCLUDE the 40-case experiment from this release. It was not run. No new router is adopted.
No comparative evidence supports a router change; the six decisions need no new routing component.
This exclusion claims no benchmark result and no proof that the current router is optimal.

| Option                                                | Incremental TCO over three years                                                                         | Release disposition |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------- |
| Existing backend, bounded LAN trust, current adapters | No new license or infrastructure purchase; engineering, maintenance, and checks require internal costing | Selected            |
| Add Conekta now                                       | Integration, provider fees, reconciliation, and maintenance remain unpriced                              | Excluded            |
| Add an on-premise replica                             | Hardware, operations, backup, migration, and conflict support remain unpriced                            | Rejected            |

These are cost categories, not quotes. Total TCO is UNVERIFIED without labor rates and operating measurements.
Reconsider exclusions after a funded payment requirement or a measured failure of the existing outage path.
Reconsider the trust period only after the device drill and an explicit exposure decision.

**Rollback:** Keep the preceding verified artifacts. Preserve journals and additive API fields.
Revert the client change only after pending replay succeeds. Never restore indefinite offline trust as an automatic rollback.

**Review method:** Git 2.56.0 and ripgrep 15.2.0 inspected the immutable candidate source.
Node 24.21.0 and Prettier 3.9.4 support the document check.
The workspace tool doctrine recommends these installed tools; Git is GPL-2.0, ripgrep is MIT/Unlicense, and Prettier is MIT.
They require no installation, interactive prompt, or runtime adoption. `git show` is the fallback for worktree drift.
No custom research tool was necessary. Sources used repository code and official documentation, checked on 2026-11-15.
The named consolidation `RUN.md` was absent from the supplied worktree and this bot's task folder; the assigned six-item list supplied its scope.

**Performed:** Source inspection and document validation only. Product code, configuration, PRs, databases, and deployments were unchanged by this task.
**Still required:** The named implementation slices, executable acceptance checks, deployed payment isolation, and real-device validation.
This record closes release dispositions; it does not declare PR #284 ready for deployment.
