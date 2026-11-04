# PR 252: portable recovery evidence

Source commit: `241254f6c6501ee026e80d7142faa5df561b3355`.
Base: `d6ba07c0`.

The three recipe recovery cases now save screenshots through Playwright output paths. Manual callers retain their two-argument interface.

## Cause and change

Dashboard CI run `41805520855` failed three cases when screenshots used `/private/tmp/umi-inventory-phase2-task2-*.png`. The Linux runner lacked that macOS directory. The failure occurred at screenshot writes. The CI log is `/private/tmp/umi-redesign-ci-dashboard-failure.log`.

Only these two files changed:

- `apps/umi-dashboard/e2e/recipe-sales-recovery.pw.js`
- `apps/umi-dashboard/e2e/recipe-sales-recovery-scenarios.js`

Each Playwright case supplies `testInfo.outputPath(filename)`. The shared scenario accepts an optional third argument for the screenshot path. A manual caller can supply its own path. A two-argument caller uses a unique directory from `mkdtemp` under `node:os.tmpdir()`.

The change preserves every recovery step and assertion. It retains command identity, optimistic version, Spanish domain error and editable draft checks. A comparison against the base normalized only imports, the evidence helper, optional arguments and screenshot statements. The remaining scenario source matched exactly.

The repository search found only the three Playwright callers. The optional argument preserves external manual callers. The task created no macOS-specific root and discarded no screenshots.

The implementation follows the existing `redesign-parity.pw.js` example. Playwright 1.62.1 documents unique test output directories in its installed `types/test.d.ts`.

Official reference: [TestInfo.outputPath](https://playwright.dev/docs/api/class-testinfo#test-info-output-path).

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Three affected browser cases | 3 passed, 4.6 seconds | `/private/tmp/umi-redesign-ci-portability-three.log` |
| Exact self-contained dashboard gate | 26 passed, 52.5 seconds | `/private/tmp/umi-redesign-ci-portability-gate.log` |
| Manual two-argument `translatedError` caller | Passed, including real clicks and editable draft assertion | `/private/tmp/umi-redesign-ci-portability-manual.log` |
| ESLint, both changed files | Exit 0 | Command below |
| Prettier, both changed files | Both files passed | Command below |
| Scenario source comparison | All steps and assertions preserved | Comparison described above |
| Screenshot artifacts | Three valid PNG files in per-test output directories | Sizes below |
| Diff whitespace | Clean | `git diff --check` |

The exact gate used the current Playwright configuration and port 4011. It used the test auth settings and the configured proxy target `127.0.0.1:1`. The browser cases supplied their own request fixtures.

The manual check started a separate test Vite process on port 4011 after the gate stopped. It called `translatedError(page, baseURL)` without an evidence argument. The scenario passed and created a valid 143,016-byte PNG in its unique OS temporary directory. The Vite process then stopped.

The three gate artifacts remain under `/tmp/umi-dashboard-playwright-results`:

| Case | File | Bytes |
| --- | --- | --- |
| Exact replacement retry | `recipe-sales-recovery.pw.j-4ad42-s-retained-command-identity/umi-inventory-phase2-task2-retry-503.png` | 136,071 |
| Stale recipe reload | `recipe-sales-recovery.pw.j-7b6be--saves-with-the-new-version/umi-inventory-phase2-task2-stale-reload.png` | 144,298 |
| Spanish error and editable draft | `recipe-sales-recovery.pw.j-fa791-nd-keeps-the-draft-editable/umi-inventory-phase2-task2-translated-error.png` | 143,039 |

Tools: Node.js 22.23.3, pnpm 10.29.3, Playwright 1.62.1 and Chromium 151.0.7922.34. These tools were already installed. The checks required no installation.

The shell used this existing toolchain:

```sh
export PATH=/Users/moon/.npm/_npx/c29883048cd047b6/node_modules/node/bin:/Users/moon/.npm/_npx/c29883048cd047b6/node_modules/.bin:$PATH
```

Commands from the workspace root:

```sh
pnpm --filter @umi/dashboard exec playwright test --config playwright.config.js e2e/recipe-sales-recovery.pw.js --reporter=line
pnpm --filter @umi/dashboard exec playwright test --config playwright.config.js e2e/floor-plan.pw.js e2e/inventory-quantities.pw.js e2e/recipe-sales-recovery.pw.js e2e/redesign-parity.pw.js --reporter=line
pnpm --filter @umi/dashboard exec eslint e2e/recipe-sales-recovery-scenarios.js e2e/recipe-sales-recovery.pw.js
pnpm exec prettier --check apps/umi-dashboard/e2e/recipe-sales-recovery-scenarios.js apps/umi-dashboard/e2e/recipe-sales-recovery.pw.js
git diff --check
```

## Limits and separate baseline failure

The checks ran locally on macOS. A new Linux CI run remains external verification. The original Linux log establishes the failure cause.

This task changed no app, Dart, API, contract, schema, SQL or workflow file. The native product remains at `2fd267ed`. The isolated Android API on port 4186 and its database remained outside this task.

The separate API run `41805521020` reported 2,144 unit passes and one migration ownership failure already present in staging. This task preserved that assertion and the workflow. Root retains the canonical-owner correction. This report does not claim that the API gate passed.
