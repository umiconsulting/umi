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
