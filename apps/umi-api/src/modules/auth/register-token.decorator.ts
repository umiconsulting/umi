import { SetMetadata } from '@nestjs/common';

export const ACCEPT_REGISTER_TOKEN = 'accept_register_token';

/**
 * Lets a route accept the credential UMI-CASH ACTUALLY SENDS.
 *
 * The dashboard authenticates with the `umi_access` cookie. The register does
 * not and cannot: `apps/umi-cash/src/lib/authed-fetch.ts` reads the access token
 * out of `localStorage` and attaches it as `Authorization: Bearer`, and that
 * client is frozen. Without this decorator every ported register route answers
 * `authentication_required` the moment umi-cash rewrites to umi-api — which is
 * the whole reason the rewrite flip could not happen.
 *
 * OPT-IN, ROUTE BY ROUTE, and deliberately not a widening of `AuthGuard`. The
 * dashboard surface has no reason to accept a till token, and a guard that
 * accepts both everywhere is a guard nobody can reason about.
 *
 * ⚠️ WHAT THIS DOES NOT DO. It does not admit every token the register's key
 * signs. `JWT_ACCESS_SECRET` signs the CUSTOMER's session as well, with the same
 * algorithm and the same shape — so a validly signed customer token is presented
 * to these routes for free. `AuthGuard` refuses it on the role claim. See the
 * escalation test in `auth.guard.spec.ts`.
 */
export const AcceptRegisterToken = () => SetMetadata(ACCEPT_REGISTER_TOKEN, true);

/** What the register calls a staff session. `cash-roles.ts` mints only these two. */
export const REGISTER_STAFF_ROLES: ReadonlySet<string> = new Set(['ADMIN', 'STAFF']);
