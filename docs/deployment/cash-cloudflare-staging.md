# Cash on Cloudflare staging

## Boundary

The Worker preserves the existing Cash interfaces, including `/umi/admin`.
It forwards data requests and frozen wallet URLs to `umi-api`.
The API uses the canonical `merchant`, `umi`, and `runtime` schemas.
Production remains on Vercel until a separate cutover.

The frontend requires two configuration values:

- `CASH_API_ORIGIN`: `https://api-staging.umiconsulting.co`
- `NEXT_PUBLIC_APP_URL`: `https://umi-cash-staging.hola-8ae.workers.dev`

The Worker holds no database, JWT, or wallet provider secrets.
Internal admin access uses a canonical identity account with the `super_admin` platform role.
The login supports MFA. The old shared admin password and JWT secret stay retired.
Business accounts keep their existing merchant login.

## Deploy

From `apps/umi-cash`, run:

```sh
npm ci
npm test
npx tsc --noEmit
npm run deploy:staging
```

The deployment uses Next 15.5.29, React 19, OpenNext 1.20.16, and Wrangler 4.157.0.
OpenNext needs the Next upgrade. Its current adapter rejects the former Next 14 release.
The standard Worker build fits the free upload limit. Containers and R2 are unnecessary.
`wrangler.jsonc` declares only the staging Worker. It declares no production routes.

Deploy the API compatibility routes before you test the Worker.
The API staging workflow can deploy the selected feature branch through `workflow_dispatch`.
It deploys the same branch that the workflow builds. Push events still deploy `staging`.
The staging deployment must pass the existing backend checks.

## Validate

Use synthetic staging records for these checks:

- Open a public merchant page and its legal pages.
- Sign into the business panel. Read customers, statistics, rewards, settings, and reminder records.
- Sign into `/umi/login` with canonical platform credentials.
- Create a café through the old admin form. Edit its brand, timezone, hours, locations, and rewards.
- Confirm that an unauthenticated request cannot reach internal admin data.
- Confirm that cross-site mutations fail.

The reminder registry retains neither historical text nor delivery receipts.
The UI labels it as registered reminders.
Actual wallet delivery needs a separate device check with an approved test pass.
Keep provider calls away from real client records during these checks.

## Operational tools

Google Wallet tools and the APN diagnostic now live in `apps/umi-api/scripts`.
The tools use the existing backend `jose` dependency and native HTTP requests.
Supply credentials through the shell or an explicit `UMI_ENV_FILE` for Google tools.
The tools no longer read a recovered Vercel export automatically.
Use the backend wallet resync routes for merchant-wide updates.
The retired shared-secret `/api/umi/push-passes` cron is not restored.

`scripts/broadcast-message.ts` in Cash is an authenticated HTTP client for `/api/umi/broadcast`.
It accepts a canonical platform access token or session cookie. Start with `--dry`.

## Rollback

Production needs no rollback because this stage changes no Vercel project or DNS record.
Use `wrangler rollback` from Cash to restore an earlier staging Worker version.
Redeploy the prior API SHA through the staging workflow if the compatibility routes fail.
Merge the feature into `staging` before normal staging releases resume.
The feature adds no schema migration and changes no production secret.

## Staging verification, 2026-11-05 UTC

The staging Worker is live at `https://umi-cash-staging.hola-8ae.workers.dev`.
Its current version is `d5300352-324b-4861-a6fe-36c2d65bc1d2`.
The API staging workflow deployed the compatibility routes successfully.

Real Chromium checks through Playwright over CDP verified these workflows:

- Internal UMI login and the existing admin list.
- Café creation through the old admin form.
- Saved city, minute-level opening hours, and reward changes.
- Business login and the customer list and detail screens.
- Analytics, rewards, settings, and reminder screens, with API responses of 200.
- Public pages, both legal pages, and customer registration with a loyalty card.

The checks used one synthetic café and a reserved test phone number.
The records remain available for staging review.
Test credentials remain in a private local file, outside the repository.
No real client record or wallet provider object was changed by these browser checks.

HTTP checks verified these boundaries on the deployed Worker:

- Anonymous access to internal admin data returns 401.
- A business identity without a platform role receives 403 for internal admin data.
- A cross-site mutation receives 403.

Local database checks also verify location ownership, merchant isolation, split opening hours,
upper reward tiers, broadcast dry runs, SQL parsing, and application startup.
The production dependency audit reports zero known vulnerabilities.
The adapter development toolchain retains audit findings that need a separate upgrade review.
Actual Apple and Google Wallet delivery remains a device check before production cutover.

## Isolated wallet setup

The staging database contains 1,053 wallet-pass records outside the synthetic café.
Treat these as copied live identities. Never enable staging updates for them.

Staging Compose forces `WALLET_MODE=test` for the API and `WALLET_MODE=isolated` for the worker.
Test mode permits APN and Google updates only for the synthetic café in the allowlist.
The worker blocks every outbound wallet update.
The Apple and Google signing builders accept only `WALLET_TEST_MERCHANT_IDS`.
Apple poll downloads use the same guarded builder.
The synthetic café uses `3a010ff6-0bea-4b4b-9801-d9e63e25962c`.

Only the API loads `/home/juan/umi-api-test/.wallet-staging.env` on the VPS.
This private file has mode 0600 and supplies signing credentials and test configuration.
The worker receives no signing credentials. Neither service receives an APN key.
The file uses Compose `format: raw` to preserve key bytes and literal newline escapes.
The VPS Compose release supports this format.

The test configuration uses these public values:

```dotenv
WALLET_TEST_MERCHANT_IDS=3a010ff6-0bea-4b4b-9801-d9e63e25962c
WALLET_PUBLIC_ORIGIN=https://umi-cash-staging.hola-8ae.workers.dev
GOOGLE_WALLET_CLASS_ID=loyalty_staging_20261104
```

Google uses a separate class with explicit `Umi Cash Staging` labels.
The issuer remains the existing issuer. A separate class is not a separate provider sandbox.
Only fresh synthetic cards from the allowed café can receive signed save links.
The class has its own branding and card template. Existing classes are unchanged.

Before a backend rollback, rename the private `.wallet-staging.env` file.
Recreate the API without that file before you deploy an older image.
Older images do not enforce `WALLET_MODE`.
Restore the file only after the isolation guards run again.

See the [Compose env-file reference](https://docs.docker.com/reference/compose-file/services/#env_file),
[Google class creation guide](https://developers.google.com/wallet/retail/loyalty-cards/use-cases/create),
and [Google testing rules](https://developers.google.com/wallet/retail/loyalty-cards/test-and-go-live/request-publishing-access).

## Isolated wallet verification

The Cloudflare proxy returns an Apple pass and a Google save URL with HTTP 200.
The Apple archive passes manifest checksum and CMS signature checks.
Its callback URL uses the staging Worker origin.
A second synthetic café receives HTTP 403 from both providers because it is outside the allowlist.
That negative test café was deleted after the check.

The initial API and worker checks both reported isolated mode at runtime.
The API has signing keys. The worker has no signing keys, and both services have no APN key.
The backend suite passes 2,159 tests. Ten database checks pass for compatibility and SQL parsing.

The returning-customer registration route retains HTTP 409 and returns the existing customer session.
It returns this payload directly so the global error filter cannot remove the session.
The global error filter retains its protection for actual errors.
The staging API health endpoint reports release `966c39a2ce419002a3771d5c91c3889789715456` after the fix.
The [staging deployment](https://github.com/umiconsulting/umi/actions/runs/41979391723) passes its checks.
Real Chromium checks confirm the returning-customer success screen and an Apple pass download through the button.
The Google button receives HTTP 200 and opens the signed save URL.
The browser test blocks navigation to Google before any provider account or installed object changes.

The temporary platform administrator grant was revoked, and its account was suspended after the checks.
The permanent platform administrator remains active.
The synthetic café and its business login remain available for review.
The disposable local PostgreSQL and Redis containers were stopped.
Actual installation in Apple Wallet or Google Wallet remains a physical-device check.

## Test delivery, 2026-11-05

The user installed an Apple pass and scanned its card through the old business interface.
API logs confirm device registration, pass downloads, and a committed scan.
The initial isolated mode blocked the update signal, so the phone retained its earlier content.

The API now uses test mode to permit delivery only for the synthetic café.
Single-card pushes and merchant pushes check ownership before any provider request.
Mixed Apple batches exclude other merchants before they touch card timestamps.
Google updates apply the same allowlist before OAuth or provider requests.
The worker remains isolated, and production retains its existing configuration.

Apple uses the pass signing certificate and key when no APN token key exists.
The certificate includes its WWDR chain. Existing token authentication keeps its precedence.
Staging still receives no APN token key.
New cafés without stamp artwork receive basic empty and earned stamp images instead of HTTP 500.

The backend suite passes 2,164 tests. Type checks, lint, and focused wallet checks pass.
See [protocol research](../research/2026-11-05-staging-wallet-updates.md) for delivery and notification limits.
