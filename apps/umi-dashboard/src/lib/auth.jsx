import { t } from '@lingui/core/macro';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { COOKIE_AUTH, LOCAL_SESSION, apiUrl, withCreds, errMessage } from './config.js';
import { routes } from '@umi/contract/routes';

const AuthContext = createContext(null);
const LOCAL_SESSION_KEY = 'umi-dashboard-local-session';

function getLocalSession() {
  const raw = window.localStorage.getItem(LOCAL_SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    window.localStorage.removeItem(LOCAL_SESSION_KEY);
    return null;
  }
}

export function getStoredSession() {
  if (LOCAL_SESSION) return getLocalSession();
  return null;
}

export async function getAuthHeaders() {
  return {};
}

// ---------------------------------------------------------------------------
// Cookie-mode session auto-refresh
//
// The umi-api access cookie is short-lived. Rather than let it expire silently
// — which 401s API calls while the SPA still thinks it's logged in — we refresh
// it just before expiry (proactive) and also on the first 401 (reactive, wired
// in data.jsx). A single-flight guard collapses concurrent refreshes into one
// /refresh call. If refresh fails, the refresh cookie is dead too → clear the
// session and bounce to /login.
// ---------------------------------------------------------------------------
const REFRESH_SKEW_MS = 60_000; // refresh 60s before the access token expires
const MIN_REFRESH_MS = 30_000; // never schedule sooner than this
let refreshTimer = null;
let refreshInFlight = null;
let accessExpiresAt = 0; // ms epoch; 0 = unknown

function setLocalSession(session) {
  // Stamp an ABSOLUTE expiry at persist time. accessExpiresIn is relative to
  // when login/refresh issued the cookie, so on a later reload we must schedule
  // against the absolute timestamp — not Date.now()+accessExpiresIn, which would
  // reset the clock and could schedule a refresh after the cookie already died.
  const secs = Number(session && session.accessExpiresIn);
  const stampedAt = secs && isFinite(secs) ? Date.now() + secs * 1000 : 0;
  window.localStorage.setItem(
    LOCAL_SESSION_KEY,
    JSON.stringify(
      stampedAt ? Object.assign({}, session, { accessExpiresAt: stampedAt }) : session,
    ),
  );
}

function scheduleProactiveRefresh(session) {
  if (!COOKIE_AUTH) return;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  const storedExpiresAt = Number(session && session.accessExpiresAt);
  const secs = Number(session && session.accessExpiresIn);
  accessExpiresAt =
    storedExpiresAt && isFinite(storedExpiresAt)
      ? storedExpiresAt
      : secs && isFinite(secs)
        ? Date.now() + secs * 1000
        : 0;
  if (!accessExpiresAt) return;
  const delay = Math.max(accessExpiresAt - Date.now() - REFRESH_SKEW_MS, MIN_REFRESH_MS);
  refreshTimer = setTimeout(function () {
    // A failed proactive refresh means the refresh cookie is dead too — route
    // through the same cleanup the 401 path uses instead of leaving stale state.
    refreshSession().then(function (ok) {
      if (!ok) handleSessionExpired();
    });
  }, delay);
}

// Single-flight refresh. Resolves true on success, false otherwise.
export function refreshSession() {
  if (!COOKIE_AUTH) return Promise.resolve(false);
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async function () {
    try {
      const res = await fetch(apiUrl(routes.auth.refresh), withCreds({ method: 'POST' }));
      if (!res.ok) return false;
      const payload = await res.json().catch(() => ({}));
      if (payload && payload.session) {
        setLocalSession(payload.session);
        scheduleProactiveRefresh(payload.session);
      }
      return true;
    } catch (err) {
      console.warn('session refresh failed', err);
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

// Session is truly dead (refresh failed): drop local state and go to login.
export function handleSessionExpired() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  accessExpiresAt = 0;
  window.localStorage.removeItem(LOCAL_SESSION_KEY);
  if (!window.location.pathname.startsWith('/login')) {
    window.location.assign('/login');
  }
}

// Start proactive refresh + resume-refresh listeners. Returns a cleanup fn.
export function startSessionAutoRefresh() {
  if (!COOKIE_AUTH) return function () {};
  const session = getLocalSession();
  if (session) scheduleProactiveRefresh(session);
  function onResume() {
    if (!getLocalSession()) return;
    if (
      typeof document !== 'undefined' &&
      document.visibilityState &&
      document.visibilityState !== 'visible'
    )
      return;
    // Refresh only when at/near expiry — avoids a refresh storm on every focus.
    if (!accessExpiresAt || Date.now() >= accessExpiresAt - REFRESH_SKEW_MS) {
      refreshSession().then(function (ok) {
        if (!ok) handleSessionExpired();
      });
    }
  }
  document.addEventListener('visibilitychange', onResume);
  window.addEventListener('online', onResume);
  return function () {
    document.removeEventListener('visibilitychange', onResume);
    window.removeEventListener('online', onResume);
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  };
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading
  useEffect(() => {
    setSession(getLocalSession());
    return startSessionAutoRefresh();
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading: session === undefined }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

/**
 * Sign in. The umi-api login route answers with ONE OF TWO shapes.
 *
 *   - No second factor → `{ session }`. Cookies are set, and this navigates.
 *   - A second factor  → `{ mfaRequired: true, method, challengeToken,
 *     expiresInSeconds }`. NO cookies, and no session. The caller must collect
 *     the code and call `verifyMfaCode`.
 *
 * ⚠️ Read the outcome before you navigate. This function used to store
 * `payload.session` and go to `/` for either shape. On a challenge it stored
 * `undefined`, and the person returned to this screen. That account could then
 * never sign in again.
 *
 * 'local' (server.js) and 'cookie' (umi-api) both POST the same login route. The
 * difference is that umi-api sets an httpOnly cookie, which `withCreds` carries,
 * while server.js uses the localStorage session id in `X-UMI-User-ID`. Either
 * way we cache `session.*` for the UI. `remember` makes umi-api issue persistent
 * cookies instead of session cookies.
 */
export async function signIn(email, password, remember = false) {
  // umi-api is the only login the dashboard has. The Supabase session path that
  // once sat behind this left with the UmiPOS integration, together with its
  // client and dependency; the MFA challenge handling below is what remains
  // from build-v3's side of that fork.
  const res = await fetch(
    apiUrl(routes.auth.login),
    withCreds({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password, remember }),
    }),
  );
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errMessage(payload, t`Credenciales incorrectas`));
  if (isMfaChallenge(payload)) return payload;
  return completeLocalSignIn(payload);
}

/**
 * Does this login answer ask for a second factor?
 *
 * ⚠️ Compare against the literal `true`. A truthy test lets an error body with a
 * `mfaRequired` string open the code screen.
 *
 * This repeats `mfaChallenged` from `@umi/contract`. The copy is deliberate:
 * that module is zod-aware, `packages/contract/src/routes.ts` is the ONLY
 * zero-dependency entry, and a `routes.test.mjs` case fails if zod reaches it.
 * The dashboard has no zod, and a login screen must not pull a validator into
 * the browser bundle.
 */
export function isMfaChallenge(payload) {
  return Boolean(payload) && payload.mfaRequired === true;
}

/**
 * Store a session and go to the panel. Shared by both halves of the login.
 *
 * ⚠️ Do not navigate without a session. `setLocalSession(undefined)` writes the
 * string "undefined" to localStorage, `/` finds no session, and the person lands
 * back on the login screen with no message. Throw an error instead.
 */
function completeLocalSignIn(payload) {
  if (!payload || !payload.session) {
    throw new Error(t`El servidor no devolvió una sesión. Inténtalo otra vez.`);
  }
  setLocalSession(payload.session);
  window.location.assign('/');
  return payload.session;
}

/**
 * Second half of the two-step login. Exchanges the challenge token and the code
 * for the cookies the first half withheld.
 *
 * `remember` must match what the first half was given, so the choice survives
 * the second step.
 */
export async function verifyMfaCode(challengeToken, code, remember = false) {
  const res = await fetch(
    apiUrl(routes.auth.mfaVerify),
    withCreds({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeToken, code, remember }),
    }),
  );
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errMessage(payload, t`Código incorrecto o vencido.`));
  return completeLocalSignIn(payload);
}

export async function signOut() {
  try {
    const res = await fetch(apiUrl(routes.auth.logout), withCreds({ method: 'POST' }));
    if (!res.ok) {
      console.warn(`logout failed (${res.status}); auth cookie may persist server-side`);
    }
  } catch (err) {
    console.warn('logout request failed; auth cookie may persist server-side', err);
  }
  window.localStorage.removeItem(LOCAL_SESSION_KEY);
  window.location.assign('/login');
}
