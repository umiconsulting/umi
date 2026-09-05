# Super-admin Dashboard research

Date: 2026-08-31  
Scope: the local build-v3 rehearsal at commit `11994b2a47af`

## Result

The build-v3 data is not the primary fault.

The strongest cause is a hostname mismatch in the local Dashboard launch.
The Dashboard runs at `http://localhost:4000`.
The API and cookie configuration use `http://127.0.0.1:4001`.
The API sets `SameSite=Lax` cookies.

This mismatch explains both reported symptoms:

1. Login returns a session body, which the Dashboard stores in local storage.
2. The browser then loads `GET /api/me/merchants` without the API cookie.
3. The merchant provider catches that request failure and keeps an empty merchant list.
4. The home page therefore has no selected merchant or capabilities.
5. The Cafés screen repeats `GET /api/me/merchants` through the shared data client.
6. That client treats a `401` as an expired session.
7. A failed refresh clears local storage and redirects to `/login`.

This is a Umi-specific inference from the runtime configuration and the source path.
An authenticated browser trace was not captured during this read-only review.

## Intended behavior

`hola@umiconsulting.co` is the bootstrap platform operator.
The 2026-07-21 decision replaced four café memberships with one platform grant.
That grant reaches every active merchant.

The current rehearsal confirms this state:

- The user is active.
- The `super_admin` platform grant is live and unexpired.
- Five active merchants exist.
- El Gran Ribera and Kalala Café have an active Dashboard entitlement.
- Kalala Café also has the POS entitlement.

The API orders the merchant list by name.
The Dashboard preserves a valid stored selection.
Otherwise, it selects the first returned merchant.
The expected default in this rehearsal is El Gran Ribera.

Sources:

- [`seed_rbac.sql`](../migration/build-v3/backfill/seed_rbac.sql#L93) creates the platform grant.
- [`rbac.sql.ts`](../../apps/umi-api/src/modules/auth/rbac.sql.ts#L31) defines a live platform grant.
- [`auth.repository.ts`](../../apps/umi-api/src/modules/auth/auth.repository.ts#L721) lists every active merchant for a platform operator.
- [`merchant-context.jsx`](../../apps/umi-dashboard/src/lib/merchant-context.jsx#L36) loads merchants and selects the stored or first merchant.
- [`merchants.repository.ts`](../../apps/umi-api/src/modules/merchants/merchants.repository.ts#L229) orders the merchant list by name.
- Commit `42da8ad43abd119f117e2b72059cbdd092fd4afe` made `super_admin` a real platform grant.
- Commit `26c1f5959ca24f3c79be5ce76ac776a29910538c` retained automatic merchant selection after the merchant rename.

## Why the home page is empty

The auth shell trusts the cached session body in local storage.
It does not validate that session through `/api/auth/me` during application start.
Therefore, login can appear complete while later cookie-authenticated requests fail.

The merchant provider uses a small `apiGet` helper.
That helper does not use the shared `401` refresh path.
Its error handler stores the error and replaces the merchant list with an empty list.
The layout then renders without a selected merchant.

Sources:

- [`auth.jsx`](../../apps/umi-dashboard/src/lib/auth.jsx#L44) stores the session body in local storage.
- [`app.jsx`](../../apps/umi-dashboard/src/app.jsx#L366) accepts that stored value as the application auth gate.
- [`merchant-context.jsx`](../../apps/umi-dashboard/src/lib/merchant-context.jsx#L16) uses a separate request helper.
- [`merchant-context.jsx`](../../apps/umi-dashboard/src/lib/merchant-context.jsx#L52) converts the request failure into an empty merchant list.

## Why Cafés signs the user out

The Cafés module is a platform screen.
It is not scoped to the selected merchant.
Its source uses the same `GET /api/me/merchants` route as the merchant selector.

The screen uses `_apiFetch`, unlike the merchant provider.
On a `401`, `_apiFetch` tries the refresh route once.
If refresh fails, it removes the cached session and redirects to `/login`.
The Cafés module does not call `signOut` directly.

Sources:

- [`module-registry.js`](../../apps/umi-dashboard/src/lib/module-registry.js#L129) defines Cafés as platform-only.
- [`cafes.jsx`](../../apps/umi-dashboard/src/screens/cafes.jsx#L315) checks `platformRole` before it renders.
- [`data.jsx`](../../apps/umi-dashboard/src/data.jsx#L1086) loads Cafés from `/api/me/merchants`.
- [`data.jsx`](../../apps/umi-dashboard/src/data.jsx#L87) refreshes once after a `401`.
- [`auth.jsx`](../../apps/umi-dashboard/src/lib/auth.jsx#L108) clears the session after refresh failure.
- Commit `7617908e6b1dfa4d33f62f98c37851bb3dc4f841` added this `401` recovery behavior.
- Commit `6e027461d3c45468af83e0801c2de989ae5966d7` added the Cafés screen and its platform gate.

## Local configuration conflict

The local files define one expected browser origin:

```text
Dashboard: http://127.0.0.1:4000
API:       http://127.0.0.1:4001
Cookie:    SameSite=Lax
```

The current Vite process listens only on `[::1]:4000`.
`http://localhost:4000` answers.
`http://127.0.0.1:4000` does not answer.
Vite has no explicit `server.host` value, so the launch does not meet the local profile.

CORS is not the main fault.
The current API permits both Dashboard origins and returns the matching CORS header.
The conflict is the cookie site, not the CORS allowlist.

Sources:

- [`.env.example`](../../apps/umi-dashboard/.env.example#L4) defines the `127.0.0.1` Dashboard and API origins.
- [`vite.config.js`](../../apps/umi-dashboard/vite.config.js#L32) sets the port but does not set the host.
- [`config.js`](../../apps/umi-dashboard/src/lib/config.js#L31) uses cross-origin cookies with credentials.
- [`cookies.ts`](../../apps/umi-api/src/modules/auth/cookies.ts#L32) applies the configured cookie policy.
- [`RUNNING_UMIPOS.md`](../development/RUNNING_UMIPOS.md#L751) requires both local services on `127.0.0.1`.
- [`SOLUCION_DE_PROBLEMAS.md`](../knowledge-base/SOLUCION_DE_PROBLEMAS.md#L31) directs cookie failures to the proxy and origin settings.

## Ranked causes

1. **Hostname mismatch.** This cause matches the runtime and the complete symptom chain.
2. **A stale pre-rehearsal cookie.** The cutover plan requires a new login after the session migration.
3. **A missing platform grant.** The rehearsal database disproves this cause.
4. **Missing merchant data or entitlements.** The rehearsal database disproves this cause.

The cutover plan states that old Dashboard refresh cookies have no durable session row.
Such a cookie also causes refresh failure after the database switch.
However, the current database contains six active Dashboard session families for this user.
The hostname mismatch remains the stronger cause.

Source: [`GATED_CUTOVER_PLAN.md`](../migration/build-v3/GATED_CUTOVER_PLAN.md#L619).

## Recovery steps

1. Stop the current Dashboard process.
2. Start Vite with an explicit local host.

   ```sh
   pnpm --filter @umi/dashboard dev
   ```

3. Open `http://127.0.0.1:4000` exactly.
4. Remove old Dashboard storage for `localhost:4000`.
5. Remove old Umi cookies for `127.0.0.1` if the first fresh login fails.
6. Sign in again as the bootstrap operator.
7. Confirm that `/api/auth/me` returns `200` with `platformRole: super_admin`.
8. Confirm that `/api/me/merchants` returns five merchants.
9. Confirm that the selector defaults to El Gran Ribera.
10. Select Kalala Café before the POS registration test.

Do not add café memberships to repair this symptom.
The platform grant intentionally replaces those memberships.

The documented bootstrap command remains:

```sh
BOOTSTRAP_EMAIL=<operator-address> ./00_run_backfill.sh <target-db> <source-db>
```

The current rehearsal already completed this step.
Do not run the backfill again for this browser fault.

## Test gap

No Dashboard test covers this complete path:

- login stores a session body;
- the cookie is unavailable;
- merchant bootstrap receives `401`;
- the home page becomes empty;
- Cafés triggers refresh and redirects.

The merchant provider and the shared data client use different `401` behavior.
This difference turns one auth fault into two visible symptoms.
A later fix needs one browser test at the real cookie boundary.

Commit `cee824766bf7874d4ab69f33cc1c3dc1679ea48e` added the explicit `platformRole` session field.
Its service tests cover login, MFA, and `/me` envelope consistency.
They do not cover browser cookie delivery across different local hostnames.
