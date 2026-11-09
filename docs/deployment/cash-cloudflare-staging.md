# Cash on Cloudflare: staging candidate and cutover package

Status: local candidate. Not deployed. Publication is held.
Run date: 2026-11-08 local (2026-11-09 UTC).

This document describes the Cloudflare Worker candidate for the existing Next.js Cash application.
It records the local checks, the canonical API prerequisite, the cutover package, and the rollback package.
The candidate preserves the public, business, and internal `/umi/admin` interfaces.
The Worker forwards data requests and frozen wallet URLs to `umi-api`.
`umi-api` owns authentication, merchant data, loyalty rules, and wallet providers.
Production stays on Vercel until Juan approves the cutover.

## Candidate identity

| Item              | Value                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------- |
| Worktree          | `/home/juan/Projects/umiconsulting/umi/.worktrees/cash-cloudflare-candidate-20261108`         |
| Branch            | `feat/cash-cloudflare-candidate-20261108`                                                     |
| Code head tested  | `a53b46ffd0aa7b0b1e453bb1c03e630b0e22c8ff`                                                    |
| First parent      | `d01c9f47a349af58aaa0e5ddebfa4c745598a7ef` (original Cash candidate)                          |
| Second parent     | `b4ba45fc7ec111dd02e0a0f86dad324697a4ca48` (current `origin/staging`)                         |
| Original worktree | `/home/juan/Projects/umiconsulting/umi-cash-cloudflare-staging-20261104`, clean at `d01c9f47` |
| PR #259           | OPEN, draft, base `staging`, `mergeable=false`, `mergeable_state=dirty`                       |

This document is committed on the same branch after the code head. Use `git log -1` for the current head.
The candidate preserves the original worktree. It does not update PR #259.
The merge resolves two conflicts:

- `.github/workflows/deploy-backend.yml`: keep the registry-scoped GHCR login from the Cash branch.
  Keep the exact-SHA release identity from staging.
- `apps/umi-api/package.json`: keep the `sales-analysis` integration test from staging.
  Keep the `cash-compatibility` integration test from the Cash branch.

No other conflict occurred. No gate is weaker after the merge.

Pins:

| Package                  | Version |
| ------------------------ | ------- |
| `next`                   | 15.5.29 |
| `react`                  | 19.3.1  |
| `react-dom`              | 19.3.1  |
| `@opennextjs/cloudflare` | 1.20.16 |
| `wrangler`               | 4.157.0 |

## Boundary

The Worker holds no database, JWT, or wallet provider secrets.
Internal admin access uses a canonical identity account with the `super_admin` platform role.
The login supports MFA. The old shared admin password and JWT secret stay retired.
Business accounts keep their existing merchant login.
Cash keeps its separate npm lockfile. Cash stays outside pnpm.
`prisma/`, database drivers, signing keys, and provider credentials stay out of the Worker bundle.

## Configuration and environment-name mapping

| Purpose               | Name                               | Staging value                                   | Production target               | Owner      |
| --------------------- | ---------------------------------- | ----------------------------------------------- | ------------------------------- | ---------- |
| API origin            | `CASH_API_ORIGIN`                  | `https://api-staging.umiconsulting.co`          | `https://api.umiconsulting.co`  | Worker var |
| Public app origin     | `NEXT_PUBLIC_APP_URL`              | `https://umi-cash-staging.hola-8ae.workers.dev` | `https://cash.umiconsulting.co` | Worker var |
| Wallet public origin  | `WALLET_PUBLIC_ORIGIN`             | `https://umi-cash-staging.hola-8ae.workers.dev` | `https://cash.umiconsulting.co` | API env    |
| Wallet delivery mode  | `WALLET_MODE`                      | `test` (API) and `isolated` (worker)            | Production mode, unchanged      | API env    |
| Wallet test allowlist | `WALLET_TEST_MERCHANT_IDS`         | `3a010ff6-0bea-4b4b-9801-d9e63e25962c`          | Not set                         | API env    |
| Google staging class  | `GOOGLE_WALLET_CLASS_ID`           | `loyalty_staging_20261104`                      | Existing production class       | API env    |
| Cookie domain         | `COOKIE_DOMAIN`                    | `.umiconsulting.co` in reviewed tests           | Confirm before cutover          | API env    |
| Cookie security       | `COOKIE_SECURE`, `COOKIE_SAMESITE` | Secure cookies                                  | Confirm before cutover          | API env    |

The Worker reads `CASH_API_ORIGIN` and `NEXT_PUBLIC_APP_URL` only.
`backendOrigin()` rejects credentials, paths, queries, and non-HTTPS origins.
The API signs wallet passes with `WALLET_PUBLIC_ORIGIN`.
The two origins must agree. A mismatch breaks installed passes.

`wrangler.jsonc` declares these staging values:

```jsonc
"vars": {
  "CASH_API_ORIGIN": "https://api-staging.umiconsulting.co",
  "NEXT_PUBLIC_APP_URL": "https://umi-cash-staging.hola-8ae.workers.dev"
}
```

## Account and project inventory

| Item                | Value                                                   | Source                         |
| ------------------- | ------------------------------------------------------- | ------------------------------ |
| Cloudflare account  | `8aef562d6d0c51b70f1b83fa1d2912a4`                      | `apps/umi-cash/wrangler.jsonc` |
| Worker name         | `umi-cash-staging`                                      | `apps/umi-cash/wrangler.jsonc` |
| Worker host         | `https://umi-cash-staging.hola-8ae.workers.dev`         | `wrangler.jsonc`, prior run    |
| Worker routes       | None declared. `workers_dev=true`, `preview_urls=false` | `wrangler.jsonc`               |
| Compatibility date  | `2026-11-04`                                            | `wrangler.jsonc`               |
| Compatibility flags | `nodejs_compat`, `global_fetch_strictly_public`         | `wrangler.jsonc`               |
| Vercel project      | `umi-cash` (documented, not re-probed)                  | Prior cutover record           |
| Production host     | `https://cash.umiconsulting.co`                         | HTTP probe, 2026-11-09 UTC     |

Read status:

- Wrangler 4.157.0 is not authenticated in this shell.
  Version, deployment, domain, and rollback inventory reads are blocked.
  The last documented Worker version is `d5300352-324b-4861-a6fe-36c2d65bc1d2` (2026-11-05 UTC).
- Vercel CLI 62.4.0 is installed. The stored credential is rejected with
  `The specified token is not valid`.
  Project, environment, and domain inventory reads are blocked.
- A read-only probe of `https://cash.umiconsulting.co` returns `server: Vercel`.
  `/umi/login` returns HTTP 200. The frozen Apple route returns HTTP 401 without a token.

The inventory contains no secret values.

## Canonical API prerequisite

The Worker needs a canonical API build with the Cash compatibility routes.
The old preview used an API image built from the feature branch.
Current staging `b4ba45fc` does not contain that branch.
A merge-base check confirms that `d01c9f47` is not an ancestor of `origin/staging`.

Read-only probes, 2026-11-09 04:04-04:07 UTC:

| Probe                         | Staging `b4ba45fc`     | Production `1bbc9b1`   | Meaning                                         |
| ----------------------------- | ---------------------- | ---------------------- | ----------------------------------------------- |
| `GET /health`                 | 200, release `b4ba45f` | 200, release `1bbc9b1` | Both APIs are healthy                           |
| `GET /api/umi/session`        | 404 `Cannot GET`       | 404 `Cannot GET`       | Cash platform route is absent                   |
| `GET /api/umi/tenants`        | 404 `Cannot GET`       | Not probed             | Cash platform route is absent                   |
| `GET /api/:ref/config`        | 404 `Cannot GET`       | 404 `Cannot GET`       | Cash public route is absent                     |
| `GET /api/geocode`            | 401                    | 401                    | An existing API route works                     |
| `GET /api/:ref/passes/apple`  | 401 `No autorizado`    | 401 `No autorizado`    | Wallet route exists and rejects a missing token |
| `GET /api/:ref/passes/google` | 401 `No autorizado`    | 401 `No autorizado`    | Google route exists and rejects a missing token |

The required API build contains these capabilities:

- `GET /api/:merchantRef/config`, from `CashPublicController`.
- `GET /api/umi/session`, `GET|PATCH|DELETE /api/umi/tenants`, and `POST /api/umi/broadcast`,
  from `CashPlatformController`.
- `GET /api/:handle/passes/apple/v1/passes/:passTypeId/:serial` with `If-Modified-Since` support.
  The route returns HTTP 304 when the pass did not change. It returns HTTP 200 when the pass changed.
  It returns HTTP 401 for an invalid token, even when the date matches.
- `POST /api/:merchantRef/customers` returns HTTP 409 with the existing customer session.
  The controller returns the session directly so the global error filter cannot remove it.
- `WALLET_MODE` isolation guards for Apple and Google delivery.

The candidate contains all of these capabilities in source.
They are not deployed.

Local Worker probes against staging show the dependency:

| Local probe                        | Result              | Cause                                                  |
| ---------------------------------- | ------------------- | ------------------------------------------------------ |
| `GET /umi/login`                   | 200                 | Static UI                                              |
| `GET /`                            | 307 to `/umi/login` | Expected root behavior                                 |
| `GET /:ref`                        | 404                 | `/api/:ref/config` returns 404                         |
| `GET /:ref/terminos`               | 404                 | The page needs the tenant configuration                |
| `GET /api/umi/session`             | 404                 | Route absent upstream                                  |
| `GET /api/:ref/config`             | 404                 | Route absent upstream                                  |
| `GET /api/:ref/passes/apple`       | 401                 | Wallet route exists upstream                           |
| Cross-site `POST /api/umi/tenants` | 403                 | The Worker blocks the request before the upstream call |

Deploy the API before the Worker. A Worker deploy without the API routes breaks the public pages
and the internal admin pages.

## Deploy

Do not deploy during this run.

From `apps/umi-cash`, run:

```sh
npm ci
npm test
npx tsc --noEmit
npm run build
npm run build:cloudflare
npx wrangler deploy --dry-run --outdir=.wrangler-dry-run
```

The staging deploy command is `npm run deploy:staging`.
The API staging workflow can deploy a selected branch through `workflow_dispatch`.
It deploys the same branch that the workflow builds. Push events still deploy `staging`.

Wrangler needs a writable configuration directory.
This shell uses `/tmp` for `XDG_CONFIG_HOME` because the default home is read-only.

## Cookie and domain behavior

The API sets `umi_access`, `umi_refresh`, and `umi_csrf` cookies.
The access and refresh cookies are httpOnly. The CSRF cookie is readable for double submission.
`COOKIE_DOMAIN`, `COOKIE_SECURE`, and `COOKIE_SAMESITE` come from API configuration.

The Worker proxy removes the `Domain` attribute from every `Set-Cookie` response.
The browser then stores host-only cookies for the Worker host.
This behavior is necessary on a `workers.dev` host, where a `.umiconsulting.co` domain is invalid.
On `cash.umiconsulting.co`, it also keeps the Cash session apart from other subdomains.

The proxy copies `umi_csrf` from the cookie into the `x-umi-csrf` header.
The middleware rejects a cross-site mutating request with HTTP 403.
A request without an `Origin` header can pass the middleware. The API still enforces authentication.

When the API returns HTTP 401 on an `/api/umi/` request, the proxy refreshes the session once.
It retries the original request once with the new cookies and the new CSRF value.

## Production route and wallet-origin compatibility

The production host is `https://cash.umiconsulting.co`.
It currently serves a Vercel deployment.
The frozen path prefixes must not change:

- `/api/:merchantRef/passes/apple`
- `/api/:merchantRef/passes/apple/v1/devices/...`
- `/api/:merchantRef/passes/apple/v1/passes/...`
- `/api/:merchantRef/passes/apple/v1/log`
- `/api/:merchantRef/passes/google`
- `/api/:merchantRef/stamp-strip/:state`
- `/api/:merchantRef/card` and `/api/:merchantRef/card/qr`
- `/api/:merchantRef/customers`
- `/umi/admin`, `/umi/login`, and the public `/:slug` pages

Installed Apple passes contain the web service URL from `WALLET_PUBLIC_ORIGIN`.
Issued Google objects contain the same public origin.
A production Worker must answer on `https://cash.umiconsulting.co`.
Do not use a `workers.dev` host for production wallet traffic.
Do not change the path or the method of a frozen route.

The Worker adds security headers, including HSTS and CSP.
The API keeps the wallet token checks and the conditional download.
The Worker forwards `If-Modified-Since` and returns the empty HTTP 304 response unchanged.

## Cutover sequence

Do not start this sequence without Juan's approval.

1. Merge the candidate into `staging`, or deploy the API from the candidate SHA.
2. Run the API probes in the acceptance table. Stop on a mismatch.
3. Deploy the Worker with staging values. Run the staging acceptance probes.
4. Prepare the production Worker deploy with production values.
   Keep the Vercel production deployment in place.
5. Add the `cash.umiconsulting.co` custom domain to the Worker.
   Change DNS only at this step. Keep the previous DNS record for rollback.
6. Run the production acceptance probes. Include one Apple pass and one Google pass
   for the synthetic café only.
7. Observe the agreed rollback window. Do not retire Vercel during this window.
8. Retire Vercel only when every rollback trigger is clear.

The production API deploy is a prerequisite. Production `1bbc9b1` lacks the Cash routes.

## Acceptance probes

Run these probes after the API deploy and after the Worker deploy.

| Probe                                                                   | Expected                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------- |
| `GET /health` on the API                                                | 200. `release.gitCommit` equals the deployed API SHA    |
| `GET /api/umi/session` without a session                                | 401, not 404                                            |
| `GET /api/:ref/config` for the synthetic café                           | 200. The response has `id`, `slug`, and `rewardProfile` |
| `GET /api/:ref/config` for an unknown reference                         | 404 with the application error shape                    |
| `GET /api/:ref/passes/apple` without a token                            | 401                                                     |
| `GET /api/:ref/passes/google` without a token                           | 401                                                     |
| `GET /api/:ref/passes/apple/v1/passes/:type/:serial` with a valid token | 200 with `application/vnd.apple.pkpass`                 |
| The same request with the current `If-Modified-Since`                   | 304 with an empty body                                  |
| The same request with a stale date                                      | 200 with the changed pass                               |
| The same request with an invalid token and a matching date              | 401                                                     |
| `GET /umi/login`                                                        | 200                                                     |
| `GET /`                                                                 | 307 to `/umi/login`                                     |
| `GET /:ref` for the synthetic café                                      | 200 with the merchant name and reward ladder            |
| `GET /:ref/terminos` and `/:ref/aviso-privacidad`                       | 200                                                     |
| Anonymous `GET /api/umi/tenants`                                        | 401                                                     |
| Business identity `GET /api/umi/tenants`                                | 403                                                     |
| Cross-site `POST /api/umi/tenants`                                      | 403 at the Worker                                       |
| Business login, then one read                                           | 200. The session survives one refresh                   |
| Worker `Set-Cookie` header                                              | No `Domain` attribute                                   |
| `GET /health` on the API after a Worker request                         | Same release SHA. No drift                              |

Check the response of `/:ref/config` for internal fields.
The response must not contain subscription state, internal settings, or another merchant's data.

## Rollback package

Rollback levels, from fastest to slowest:

1. Restore the previous DNS record. Traffic returns to the Vercel deployment.
   Installed passes keep the same host and continue to reach the API.
2. Run `wrangler rollback` from Cash. This restores the previous Worker version.
3. Deploy the previous API SHA through the staging or production workflow.
   The previous API build must contain the frozen wallet routes.
4. Rename the private `.wallet-staging.env` file before a staging API rollback.
   Recreate the API without that file before you deploy an older image.
   Older images do not enforce `WALLET_MODE`.
   Restore the file only after the isolation guards run again.

Rollback triggers:

- A frozen route returns 404 or 405 in production.
- An Apple or Google pass request returns 5xx, or returns 200 for a deleted pass.
- A valid token cannot download a pass. A changed pass still returns 304.
- Login or MFA fails for a known account.
- A session drops after one refresh. A cookie appears without the host-only behavior.
- A public configuration response contains another merchant's data.
- A cross-site mutation does not return 403.
- The API `release.gitCommit` differs from the deployed SHA.
- The error rate or latency passes the threshold that Juan approves before cutover.
  This document does not set a numeric threshold.
- A wallet device check fails for the synthetic café.

The Vercel retirement point is after all of these conditions:

- The production Worker serves every acceptance probe for the agreed rollback window.
- The API release identity matches the deployed SHA for the same window.
- One Apple device and one Android device complete a pass download and an update for the synthetic café.
- No rollback trigger fired during the window.
- Juan approves the retirement.

Until that point, keep the Vercel project, its domains, and its environment values.
Do not shut down Vercel as a side effect of the Worker deploy.

## Staging verification, 2026-11-05 UTC

The staging Worker was live at `https://umi-cash-staging.hola-8ae.workers.dev`.
Its version at that time was `d5300352-324b-4861-a6fe-36c2d65bc1d2`.
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

## Device confirmations, 2026-11-06 UTC

The user confirmed these results on real devices:

- Apple Wallet: pass update and notification confirmed around 00:50 UTC.
- Google Wallet on Android: installation explicitly confirmed at 04:05:44 UTC.

These confirmations cover the pass signing path, the provider delivery path,
the notification path, and the staging wallet origin for the synthetic café.
They are dated acceptance evidence. They do not prove the current merged candidate.
Run the wallet checks again after a change to any of these items:

- The `Set-Cookie` handling or the proxy response headers.
- The pass serialization, the stamp strip, or the conditional download.
- The Apple push path or the Google update path.
- `WALLET_PUBLIC_ORIGIN`, `WALLET_MODE`, or the allowlist.
- The Worker route or the API host.

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
The staging API health endpoint reported release `966c39a2ce419002a3771d5c91c3889789715456` after the fix.
The [staging deployment](https://github.com/umiconsulting/umi/actions/runs/41979391723) passed its checks.
Real Chromium checks confirmed the returning-customer success screen and an Apple pass download through the button.
The Google button received HTTP 200 and opened the signed save URL.
The browser test blocked navigation to Google before any provider account or installed object changed.

The temporary platform administrator grant was revoked, and its account was suspended after the checks.
The permanent platform administrator remains active.
The synthetic café and its business login remain available for review.
The disposable local PostgreSQL and Redis containers were stopped.

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

The backend suite passes 2,167 tests. Cash passes 59 tests. Type checks, lint, and Worker build checks pass.
See [protocol research](../research/2026-11-05-staging-wallet-updates.md) for delivery and notification limits.

The first delivery deployment failed because the VPS registry pull returned `denied`.
The reusable deployment now authenticates that pull with the current job token through SSH stdin.
A temporary Docker configuration keeps shared VPS credentials unchanged and is removed after deployment.
The VPS has no automatic Docker credential helper installed.
Bash syntax checks and ShellCheck 0.11.0 verify the deployment shell.

The [delivery deployment](https://github.com/umiconsulting/umi/actions/runs/42133876705) passed.
Runtime checks confirm test mode in the API and isolated mode in the worker.
The test café has three Apple cards and two registered passes on the test iPhone.
The authenticated Apple resync returned `cards: 3, sent: 2`.
The phone then polled and downloaded both passes with HTTP 200.
The signed pass for the scanned card contains `1/9` and the first-stamp message.
The two stamp image states both return HTTP 200 and have different image content.

The phone reported redundant full downloads when it sent `If-Modified-Since`.
Cash now forwards that header. The authenticated API returns HTTP 304 when the pass is unchanged.
Changed passes retain HTTP 200. Invalid tokens retain HTTP 401, even when the date matches.
