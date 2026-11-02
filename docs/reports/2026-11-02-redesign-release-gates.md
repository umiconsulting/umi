# Redesign release gates

Date: 2026-11-02. Base: `cff2ab671ecd6142faf8de7785323f2867d42927`.

## Result

The dashboard workflow now requires the unit suite and the self-contained browser suite before its build and deployment.
The install selects `umi-workspace` because the root owns the Playwright dependency.
The install also selects the dashboard dependencies. Umi Cash retains its separate npm workflow.
The workflow installs Chromium and its system dependencies through Playwright.

The browser command selects these files:

- `e2e/floor-plan.pw.js`: eight cases.
- `e2e/inventory-quantities.pw.js`: four cases.
- `e2e/recipe-sales-recovery.pw.js`: three cases.
- `e2e/redesign-parity.pw.js`: eleven cases.

The workflow summary identifies ten separate live-fixture cases as **NOT RUN**.
These cases remain outside the self-contained gate:

| Suite                          | Cases | Required external fixture                                                        |
| ------------------------------ | ----- | -------------------------------------------------------------------------------- |
| `inventory-import.pw.js`       | 4     | `UMI_IMPORT_FIXTURE`; the API/database case also needs `UMI_IMPORT_DATABASE_URL` |
| `inventory-initial-cost.pw.js` | 2     | `UMI_INITIAL_COST_FIXTURE`                                                       |
| `inventory-mobile.pw.js`       | 1     | `UMI_MOBILE_FIXTURE`                                                             |
| `inventory-preparation.pw.js`  | 3     | `UMI_PREPARATION_FIXTURE`                                                        |

Both iOS workflows now require the selected native tests before their first Flutter build.
The TestFlight workflow completes these tests before it installs the signing assets.
The selection covers catalog, checkout, partial checkout, Point outcomes, cash, incoming orders, operator permissions, and the complete kitchen test directory.
The workflows retain Flutter `3.44.6`, their Xcode selection, their build defines, and their signing procedure.
The iOS workflow also reacts to changes in `packages/contract/src/catalog.ts`.

Both iOS workflows read `CONTRACT_VERSION` from that catalog and export it through `GITHUB_ENV`.
They fail if the source value is absent or empty.
All three iOS build commands use the exported value instead of `2.23.0`.
The current value is `2.50.0`.
The generated POS lockfile changes only the local `umi_contract` package from `2.47.0` to `2.50.0`.

## Tools and sources

| Tool           | Version                      | Source and use                                                                          |
| -------------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| Node           | 22.23.3                      | Existing workspace runtime                                                              |
| pnpm           | 10.29.3                      | Root `packageManager` and existing workflow                                             |
| Playwright     | 1.62.1                       | Root dependency and existing browser configuration                                      |
| Chromium       | 151.0.7922.34, revision 1234 | Playwright install for this dependency                                                  |
| Flutter / Dart | 3.47.5 / 3.13.4              | Installed local SDK and direct version output                                           |
| Actionlint     | 1.7.12                       | Installed Homebrew tool for workflow syntax and shell checks                            |
| Ruby           | 4.0.9                        | Installed YAML parser for temporary assertions about gate order and contract extraction |

The official [Playwright CI guide](https://playwright.dev/docs/ci) documents the browser install and test sequence.
The official [GitHub environment-file guide](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#setting-an-environment-variable) describes `GITHUB_ENV`.
The task brief supplies the contract extraction command.
The repository verification playbook and Task 1 report supply the existing test commands and their limits.

Existing tools run without prompts after environment permission approval.
They require no new repository dependency or service.
Actionlint remains the workflow parser. A temporary Ruby script checks repository-specific gate order and contract extraction.
The script also compares complete Actionlint findings with the base. This narrow comparison distinguishes existing findings from regressions.

## Initial verification

Use this local PATH for Node and pnpm:

```sh
export PATH='/Users/moon/.npm/_npx/c29883048cd047b6/node_modules/node/bin:/Users/moon/.npm/_npx/c29883048cd047b6/node_modules/.bin':"$PATH"
```

| Check                                                                              | Result                                                                                                          |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile --filter @umi/dashboard... --filter umi-workspace` | Exit 0; two workspace projects; lockfile unchanged                                                              |
| `pnpm --filter @umi/dashboard exec playwright install --with-deps chromium`        | Exit 0 after network permission approval                                                                        |
| Browser command below                                                              | 26 passed; zero skips; zero failures; 54.5 seconds                                                              |
| First native command below                                                         | 269 passed; zero failures                                                                                       |
| Additional kitchen command below                                                   | 20 passed; zero failures                                                                                        |
| Combined native selection                                                          | 289 passed across 17 files; matches the supplied baseline selection                                             |
| `ruby /private/tmp/umi-redesign-check-gates.rb`                                    | Gate order, identical native selections, SDK pins, and both contract readers passed                             |
| Contract failure checks                                                            | Both readers reject an absent declaration and an empty value; both export exactly `2.50.0` from the real source |
| Actionlint base comparison                                                         | Eight existing findings; zero new findings                                                                      |
| Syntax check below                                                                 | Exit 0                                                                                                          |
| `git diff --check`                                                                 | Exit 0                                                                                                          |
| Prettier check for the three workflows and the release report                      | Exit 0 after report formatting                                                                                  |

```sh
pnpm --filter @umi/dashboard exec playwright test --config playwright.config.js \
  e2e/floor-plan.pw.js e2e/inventory-quantities.pw.js \
  e2e/recipe-sales-recovery.pw.js e2e/redesign-parity.pw.js --reporter=line

cd apps/umi-pos
/private/tmp/onca-flutter-sdk-3.47.5/bin/flutter test --no-pub --reporter expanded \
  test/catalog_test.dart test/checkout_test.dart test/partial_checkout_test.dart \
  test/checkout_point_tender_test.dart test/cash_center_test.dart \
  test/incoming_orders_surface_test.dart test/operator_permissions_test.dart \
  test/features/kitchen/kitchen_board_test.dart \
  test/features/kitchen/kitchen_fulfillment_test.dart \
  test/features/kitchen/kitchen_header_test.dart \
  test/features/kitchen/kitchen_push_notifications_test.dart \
  test/features/kitchen/kitchen_unassigned_test.dart \
  test/features/kitchen/lan_kds_node_test.dart
/private/tmp/onca-flutter-sdk-3.47.5/bin/flutter test --no-pub --reporter expanded \
  test/features/kitchen/kitchen_alerts_test.dart \
  test/features/kitchen/ticket_age_test.dart \
  test/features/kitchen/hub_command_forwarder_test.dart \
  test/features/kitchen/hub_account_sequencer_test.dart
```

From the repository root:

```sh
actionlint -oneline .github/workflows/deploy-dashboard.yml \
  .github/workflows/umi-pos-ios.yml .github/workflows/umi-pos-testflight.yml
actionlint -shellcheck='' -ignore '"github.head_ref" is potentially untrusted' \
  .github/workflows/deploy-dashboard.yml .github/workflows/umi-pos-ios.yml \
  .github/workflows/umi-pos-testflight.yml
```

At the initial implementation, the complete Actionlint command exited 1 at the base and after the change.
Its eight findings were two existing `github.head_ref` interpolation findings and six existing ShellCheck findings.
The shell findings concern `ls`, intentional splitting of `UMIPOS_DEFINES`, and an existing signing command substitution.
The syntax command suppresses those two finding classes. The separate comparison confirms zero new complete findings.

The sandbox first blocked Flutter sockets and the Vite port with `EPERM`.
It also blocked the Chromium download with `ENOTFOUND`.
The approved reruns passed. These failures concern environment permissions, not product regressions.
The Chromium install removed the unused local revision 1243 and installed revision 1234.
The final browser run used the committed configuration, with no CDP variable or temporary browser override.

## Baseline and limits

The supplied baseline passed 289 selected native tests on Flutter `3.47.5` and Dart `3.13.4`.
The two new native runs cover the same selection without repeating the first successful run.
The final workflows select the complete `test/features/kitchen/` directory.
The local SDK differs from the retained CI pin `3.44.6`. This task does not certify that CI SDK or a signed archive.

Task 1 already passed 631 dashboard unit tests, the browser suites, and the dashboard bundle.
This task reuses that unit and bundle evidence. It reruns the exact changed install and self-contained browser commands.
The install retains pnpm's existing warnings for ignored dependency build scripts.

Synthetic browser cases prove client behavior. They do not prove live service behavior or persisted data freshness.
Native unit and widget tests do not certify physical hardware or payment-provider outcomes.
The ten live-fixture cases remain separate checks.
No workflow was dispatched. No deployment, merge, or TestFlight release occurred.

## Review fix: branch text in shell scripts

The review identified two existing branch expressions inside shell source.
Both dashboard steps now receive `BRANCH` through their step environment.
The environment expression retains `${{ github.head_ref || github.ref_name }}`.
The build step also receives `RELEASE_VERSION` through its environment instead of direct shell interpolation.
The scripts read these variables as data. The branch selection, URLs, cookie authentication, and deployment arguments retain their values.

Focused verification used Actionlint `1.7.12`, Ruby `4.0.9`, `bash -n`, and `git check-ref-format --branch`.
The temporary script `/private/tmp/umi-redesign-branch-check.rb` rejected the original workflow before the fix.
It then passed for `main`, `staging`, `feature/redesign`, and three valid branch names with shell payloads.
These payloads use command substitution, backticks, and quotes with semicolons.
The script checked both complete shell steps in a temporary directory.
A local `pnpm` stub captured the exact deployment arguments. No deployment command reached Cloudflare.
The command sentinel remained absent in all six cases.
The checks also confirmed the expected environment, API base, public URL, cookie auth, release version, and contract version.

```sh
ruby /private/tmp/umi-redesign-branch-check.rb
actionlint -oneline .github/workflows/deploy-dashboard.yml
```

Both commands exited 0.
The complete three-workflow Actionlint check now reports six existing native ShellCheck findings and no dashboard findings.
The native workflow files remain unchanged in this fix.
The six native findings remain deferred under the review ruling.
The earlier eight-finding count records the initial implementation, before this fix.
The focused checks replace a repeat of the unchanged client suites.
Prettier and `git diff --check` passed for this fix.
