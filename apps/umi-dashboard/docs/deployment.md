# Dashboard Deployment

Status: S4.1 schema cutover complete, 2026-06-10 — the dashboard has a single schema path
(platform transition schema); `UMI_DASHBOARD_SCHEMA` no longer exists.

## Deployment Shape

`umi-dashboard` deploys as a Vite static frontend with an Express API exposed through Vercel Functions:

- static output: `dist`
- API entrypoint: `api/index.js`
- Express app source: `server.js`
- route mapping: `/api/*` -> `api/index.js`

This keeps the current Dashboard behavior contract in one repo while avoiding a new backend service before the platform schema cutover proves it is needed.

## Required Environment Variables

Set these in the Vercel Preview environment for staging validation:

```text
DATABASE_URL
DIRECT_DATABASE_URL
VITE_AUTH_MODE=local
APP_URL
DASHBOARD_ALLOWED_ORIGIN
```

Set these only when pairing or KDS mutations must call Supabase functions:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Password reset email requires:

```text
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASSWORD
EMAIL_FROM
```

## Checks

```sh
npm run api:check
npm run build
```

For local staging-rehearsal API checks, run:

```sh
UMI_DASHBOARD_DISABLE_LISTEN=1 node --env-file=.env.local-postgres -e "import('./server.js').then(() => console.log('server import ok'))"
```
