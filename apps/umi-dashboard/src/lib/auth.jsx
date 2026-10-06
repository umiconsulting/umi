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
// /refresh call.
//
// ⚠️ A FAILED REFRESH IS NOT A DEAD SESSION. This used to collapse every failure
// into `false`, and every caller read `false` as "the session is gone" — so a
// 429 from the API's rate limiter, a 5xx, or a dropped connection destroyed a
// perfectly valid session and bounced the operator to /login mid-shift. The
// outcome is now one of three named states, and only 'dead' clears anything:
//
//   REFRESH_OK        new access token; schedule the next proactive refresh.
//   REFRESH_TRANSIENT 429 / 5xx / network error / unreadable body. The refresh
//                     cookie is still believed valid: keep the session, do NOT
//                     navigate, and retry with bounded backoff.
//   REFRESH_DEAD      401/403 or an auth-shaped body. The one path that clears
//                     local state and goes to /login.
//
// ⚠️ AND A FAILED REFRESH IS NOT ALWAYS A DEAD SESSION EITHER. The refresh
// cookie ROTATES server-side, so two tabs refreshing at the same moment do not
// both succeed: one rotates the cookie and the other — whose request was already
// on the wire carrying the cookie that has just been consumed — is answered 401.
// Read as "dead", that signed the whole browser out, silently, at the first
// rotation after a second tab was opened. The rotation is therefore serialised
// across tabs; see "ONE REFRESH PER BROWSER, NOT ONE PER TAB" below.
// ---------------------------------------------------------------------------
const REFRESH_SKEW_MS = 60_000; // refresh 60s before the access token expires
const MIN_REFRESH_MS = 30_000; // never schedule sooner than this

/** The three outcomes of a refresh. Compared by name — never by truthiness. */
export const REFRESH_OK = 'ok';
export const REFRESH_TRANSIENT = 'transient';
export const REFRESH_DEAD = 'dead';

// Bounded retry for the transient case: 15s, 30s, 60s, 120s, 240s, then stop.
// A retry that never gives up hammering an API that is already rate-limiting us
// makes the outage worse; one that gives up too early strands the operator on a
// dead screen. Five attempts covers a rate-limit window and a short outage.
const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 5 * 60_000;
const RETRY_LIMIT = 5;

// Cross-tab rotation lock — see "ONE REFRESH PER BROWSER" below.
const REFRESH_LOCK_NAME = 'umi-dashboard-refresh';
const TAB_LOCK_KEY = 'umi-dashboard-refresh-lock';
const TAB_LOCK_TTL_MS = 8_000; // a claim older than this is ignored: its tab is gone
const TAB_LOCK_POLL_MS = 100;
const TAB_LOCK_WAIT_MS = 12_000; // hard stop, deliberately longer than the TTL
// localStorage is NOT synchronously shared between renderer processes: a tab in
// another process can read the key as free in the same tick and claim it too, so
// a claim is only believed after it has settled and been re-read. The jitter
// stops two tabs from re-claiming in lockstep for ever.
const TAB_LOCK_SETTLE_MS = 100;
const TAB_LOCK_SETTLE_JITTER_MS = 60;
const TAB_ID = Math.random().toString(36).slice(2, 10);

let refreshTimer = null;
let refreshInFlight = null;
let refreshRetryTimer = null;
let refreshRetryAttempt = 0;
let accessExpiresAt = 0; // ms epoch; 0 = unknown

function clearRetryTimer() {
  if (refreshRetryTimer) {
    clearTimeout(refreshRetryTimer);
    refreshRetryTimer = null;
  }
}

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
    refreshTimer = null;
    // Only a 'dead' outcome signs out. A 'transient' one keeps the session and
    // arms its own bounded retry inside refreshSession.
    refreshSession().then(function (outcome) {
      if (outcome === REFRESH_DEAD) handleSessionExpired();
    });
  }, delay);
}

// ---------------------------------------------------------------------------
// ONE REFRESH PER BROWSER, NOT ONE PER TAB
//
// `refreshInFlight` above is a module variable, i.e. per PAGE. The refresh
// cookie, though, is per BROWSER: `/api/auth/local/refresh` answers 201 with a
// new cookie and kills the one presented. With the dashboard open in two tabs —
// normal for an owner — several tabs raced their proactive timers against the
// same cookie. One won the rotation; the others had a request in flight carrying
// the cookie that had just been consumed, were answered 401, and classified it
// REFRESH_DEAD. Every tab then cleared the session and navigated to /login: a
// silent, total sign-out seconds after opening the second tab.
//
// The fix is coordination, not tolerance. Exactly one tab per browser performs
// the rotation and the others ADOPT its result:
//
//   1. `navigator.locks` (Web Locks — Chromium, Firefox 96+, Safari 15.4+)
//      serialises the critical section. The browser releases the lock if the
//      holding tab dies, so a crashed tab cannot park the others.
//   2. Browsers without Web Locks get a localStorage lock with a short TTL
//      (`withLocalStorageLock` below), documented with its own limits.
//   3. Either way the tab that waited re-reads the stored expiry INSIDE the
//      critical section and, if another tab moved it forward, returns success
//      without touching the network.
//
// The classification rules are unchanged: 429/5xx/network stays transient, and
// 401/403 stays dead. The one addition is that a 401 is only believed when no
// other tab can be shown to have rotated the cookie while the request was on the
// wire (`adoptInterTabRefresh` at the 401 site) — evidence, not tolerance.
// ---------------------------------------------------------------------------

/** The stored absolute access expiry, or 0 when there is nothing to schedule against. */
function storedAccessExpiresAt(session) {
  const stored = session === undefined ? getLocalSession() : session;
  const value = Number(stored && stored.accessExpiresAt);
  return value && isFinite(value) ? value : 0;
}

/**
 * Did another tab win the rotation while this one waited?
 *
 * `stampBeforeWait` is the stored expiry the moment this tab decided to refresh,
 * captured BEFORE it queued for the lock. A strictly newer value can only have
 * come from another tab: this one has not written anything yet.
 *
 * Returns REFRESH_OK when the browser already holds a newer access cookie,
 * REFRESH_DEAD when the session was there before and another tab has since
 * proven it dead and cleared it, and null when this tab must rotate itself.
 */
function adoptInterTabRefresh(stampBeforeWait) {
  const stored = getLocalSession();
  const expiresAt = storedAccessExpiresAt(stored);
  const before = Number(stampBeforeWait) || 0;
  if (expiresAt > 0 && expiresAt > before) {
    // Adopt the shared expiry: re-arm this tab's own proactive timer against it
    // and drop any backoff this tab had armed, because the session is healthy.
    clearRetryTimer();
    refreshRetryAttempt = 0;
    scheduleProactiveRefresh(stored);
    return REFRESH_OK;
  }
  if (!stored && before > 0) return REFRESH_DEAD;
  return null;
}

/** The Web Locks API, when this browser has it. Read per call so tests can stub it. */
function webLockManager() {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  return nav && nav.locks && typeof nav.locks.request === 'function' ? nav.locks : null;
}

function localLockOwner() {
  return `${TAB_ID}:${Date.now().toString(36)}`;
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/** A live claim written by any tab, or null when the key is absent or expired. */
function readLocalLock() {
  try {
    const raw = window.localStorage.getItem(TAB_LOCK_KEY);
    if (!raw) return null;
    const claim = JSON.parse(raw);
    if (!claim || typeof claim.owner !== 'string') return null;
    if (!(Number(claim.expiresAt) > Date.now())) return null;
    return claim;
  } catch {
    // Unreadable means unusable, not "free": see claimLocalLock's 'unavailable'.
    return null;
  }
}

/**
 * Write our claim. Returns 'claimed' | 'unavailable'.
 *
 * This does NOT mean the lock is held — see `withLocalStorageLock`, which only
 * believes a claim after it has settled and been re-read. Storage that throws is
 * reported separately, because it is a different situation from a held lock.
 */
function claimLocalLock(owner) {
  try {
    const claim = JSON.stringify({ owner, expiresAt: Date.now() + TAB_LOCK_TTL_MS });
    window.localStorage.setItem(TAB_LOCK_KEY, claim);
    return 'claimed';
  } catch {
    return 'unavailable';
  }
}

/** Drop our claim — but never somebody else's. */
function releaseLocalLock(owner) {
  try {
    const held = window.localStorage.getItem(TAB_LOCK_KEY);
    if (!held) return;
    const claim = JSON.parse(held);
    if (claim && claim.owner === owner) window.localStorage.removeItem(TAB_LOCK_KEY);
  } catch {
    /* a lock we cannot read is a lock we must not clear */
  }
}

/**
 * Storage-backed mutex for browsers without Web Locks.
 *
 * ⚠️ A WRITE-THEN-READ IS NOT A MUTEX. Measured on this box: three tabs claiming
 * within 4ms all read the key as free and all believed they held it, because
 * localStorage is not synchronously shared between renderer processes. So a claim
 * is only believed after it has SETTLED (~100ms, jittered) and been re-read, and
 * the tab whose claim is actually in storage is the one that proceeds. Only after
 * that does the critical section run.
 *
 * Best effort by design, and honest about it:
 *
 *   - the claim carries a TTL, so a tab that crashed holding it only costs the
 *     others that long;
 *   - the wait has a hard deadline, after which this tab refreshes WITHOUT the
 *     lock rather than parking the operator's session for ever. That is exactly
 *     what this code did before the fix, so the worst case is the old behaviour
 *     in a browser that has no Web Locks at all — and the 401 re-check in
 *     `performRefresh` still catches the race if it does happen;
 *   - a localStorage that throws (blocked storage, private mode) is treated as
 *     "no lock available" and never delays the refresh.
 */
async function withLocalStorageLock(run) {
  const owner = localLockOwner();
  const deadline = Date.now() + TAB_LOCK_WAIT_MS;
  for (;;) {
    const held = readLocalLock();
    // Waiting out a live claim is the part that actually serialises: overwriting
    // another tab's claim would break the mutex for the tab already inside it.
    if (!held) {
      if (claimLocalLock(owner) === 'unavailable') return run();
      await sleep(TAB_LOCK_SETTLE_MS + Math.random() * TAB_LOCK_SETTLE_JITTER_MS);
      const settled = readLocalLock();
      if (settled && settled.owner === owner) break;
    }
    if (Date.now() >= deadline) {
      console.warn('cross-tab refresh lock not acquired in time; refreshing without it');
      return run();
    }
    await sleep(TAB_LOCK_POLL_MS);
  }
  try {
    return await run();
  } finally {
    releaseLocalLock(owner);
  }
}

/** Run `run` as the only tab in this browser rotating the refresh cookie. */
function withRefreshLock(run) {
  const locks = webLockManager();
  if (locks) {
    return locks.request(REFRESH_LOCK_NAME, { mode: 'exclusive' }, function () {
      return run();
    });
  }
  return withLocalStorageLock(run);
}

/**
 * Read the `{ code, message }` out of an umi-api error envelope.
 *
 * The global filter wraps a thrown payload as `{ statusCode, error: { code,
 * message, retryable, correlationId } }`, and a route may also throw a bare
 * `{ code }`. Both spellings are read here; the human sentence is tried on the
 * nested object first, then as a bare string (`UnauthorizedException('invalid_token')`).
 */
function refreshErrorShape(payload) {
  if (!payload || typeof payload !== 'object') return { code: null, message: null };
  const nested = payload.error;
  const nestedObject = nested && typeof nested === 'object' ? nested : null;
  const code =
    (typeof payload.code === 'string' && payload.code) ||
    (nestedObject && typeof nestedObject.code === 'string' && nestedObject.code) ||
    null;
  const message =
    (nestedObject && typeof nestedObject.message === 'string' && nestedObject.message) ||
    (typeof nested === 'string' && nested) ||
    (typeof payload.message === 'string' && payload.message) ||
    null;
  return { code, message };
}

// A body that names the session itself. `invalid_token` is the string
// `AuthService.refresh` throws for a forged, replayed, expired, or
// suspended-account token; the envelope rewrites its code to
// AUTHENTICATION_REQUIRED, so the sentence has to be read too.
const AUTH_SHAPED_CODES = new Set([
  'AUTHENTICATION_REQUIRED',
  'PERMISSION_DENIED',
  'OPERATOR_SESSION_REQUIRED',
  'invalid_token',
  'authentication_required',
  'TOKEN_EXPIRED',
]);
const AUTH_SHAPED_TEXT =
  /invalid[_ ]token|authentication[_ ]required|not authenticated|token (?:has )?expired|jwt expired|unauthorized/i;

/**
 * Did this refresh failure kill the session, or just fail to reach the API?
 *
 * 401/403 is dead whatever the body says. Everything else — 429, any 5xx, a
 * proxy's 404, a malformed body — is transient UNLESS the body itself names an
 * auth refusal. The default is deliberately 'transient': signing an operator out
 * is destructive and unrecoverable, so it needs positive evidence, not the
 * absence of it.
 */
function classifyRefreshFailure(status, payload) {
  if (status === 401 || status === 403) return REFRESH_DEAD;
  const { code, message } = refreshErrorShape(payload);
  if (code && AUTH_SHAPED_CODES.has(code)) return REFRESH_DEAD;
  if (message && AUTH_SHAPED_TEXT.test(message)) return REFRESH_DEAD;
  return REFRESH_TRANSIENT;
}

/**
 * Server hint for "come back after the window resets", in ms, or 0.
 *
 * A rate-limited response carries `x-ratelimit-reset` (epoch seconds) because
 * the guard writes its headers before it refuses; `retry-after` is honoured too
 * in case a proxy adds one. The envelope drops the body's `retryAfterSeconds`
 * (`publicError` forwards only code/message/retryable/correlationId), so there
 * is nothing to read there.
 */
function serverRetryAfterMs(res) {
  const get =
    res && res.headers && typeof res.headers.get === 'function'
      ? res.headers.get.bind(res.headers)
      : null;
  if (!get) return 0;
  const retryAfter = Number(get('retry-after'));
  if (isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  const reset = Number(get('x-ratelimit-reset'));
  if (isFinite(reset) && reset > 0) {
    const delta = reset * 1000 - Date.now();
    if (delta > 0) return delta;
  }
  return 0;
}

/**
 * Wait time before the next transient retry: exponential backoff, floored by
 * the server's own hint (a limiter saying "60s" knows better than we do) and
 * capped so a wild header cannot park the session for ever.
 */
function retryDelayMs(res, attempt) {
  const backoff = Math.min(RETRY_BASE_MS * 2 ** Math.max(attempt - 1, 0), RETRY_MAX_MS);
  return Math.min(Math.max(backoff, serverRetryAfterMs(res)), RETRY_MAX_MS);
}

/**
 * Arm ONE bounded retry for a transient failure.
 *
 * Never stacks: while a retry is pending, another transient failure only logs.
 * When the budget is spent it stops and says so — the session stays exactly as
 * it is, and the next 401 or focus event starts a fresh episode.
 *
 * Returns the delay it actually armed, or 0 when it deliberately armed nothing,
 * so the caller can log a number it measured rather than one it guessed.
 */
function scheduleTransientRetry(res) {
  if (!COOKIE_AUTH) return 0;
  if (refreshRetryTimer) return 0;
  if (refreshRetryAttempt >= RETRY_LIMIT) {
    console.warn(
      `session refresh still failing after ${RETRY_LIMIT} retries; keeping the session and waiting for the next request or focus`,
    );
    return 0;
  }
  refreshRetryAttempt += 1;
  const delay = retryDelayMs(res, refreshRetryAttempt);
  refreshRetryTimer = setTimeout(function () {
    refreshRetryTimer = null;
    // A transient outcome has ALREADY armed the next retry inside refreshSession
    // (that is an invariant of every transient return below), so this callback
    // only has the dead case left to handle — calling scheduleTransientRetry
    // again here would double-log and double-count the same failure.
    refreshSession({ fromRetry: true }).then(function (outcome) {
      if (outcome === REFRESH_DEAD) handleSessionExpired();
    });
  }, delay);
  return delay;
}

/**
 * Single-flight refresh. Resolves to REFRESH_OK / REFRESH_TRANSIENT /
 * REFRESH_DEAD — NEVER a bare boolean, because the difference between the last
 * two is the difference between "the network hiccuped" and "you are logged out".
 *
 * `options.fromRetry` marks the attempt the backoff timer made, so it does not
 * reset the retry budget it is spending.
 *
 * ⚠️ INVARIANT: every REFRESH_TRANSIENT return has already armed the next retry
 * (or logged why it stopped). Callers therefore never schedule a retry
 * themselves — only REFRESH_DEAD needs handling, and only with
 * handleSessionExpired().
 *
 * ⚠️ AND IT NEVER REJECTS. The proactive-timer and visibilitychange callers use
 * `.then()` with no catch, so a rejection here is an unhandled rejection and a
 * session left in limbo. Every path — including a lock API that throws — returns
 * one of the three outcomes.
 *
 * One POST per BROWSER: the body runs inside the cross-tab lock, and a tab whose
 * browser already has a newer expiry adopts it instead of rotating again.
 */
export function refreshSession(options) {
  const fromRetry = Boolean(options && options.fromRetry);
  // No cookie session to refresh (mode 'local'): the caller's request has no
  // recovery path at all, so the session is dead rather than retryable.
  if (!COOKIE_AUTH) return Promise.resolve(REFRESH_DEAD);
  if (refreshInFlight) return refreshInFlight;
  // Captured BEFORE queueing for the cross-tab lock: anything newer than this
  // that we find inside the critical section came from another tab.
  const stampBeforeWait = storedAccessExpiresAt();
  refreshInFlight = (async function () {
    let enteredCriticalSection = false;
    try {
      return await withRefreshLock(function () {
        enteredCriticalSection = true;
        return performRefresh({ fromRetry, stampBeforeWait });
      });
    } catch (err) {
      // Web Locks rejects while the page is being torn down, and a storage-backed
      // lock can throw on a hostile localStorage. Every caller reads an OUTCOME,
      // so this must not become a rejection (the proactive-timer path has no
      // catch and would raise an unhandled rejection).
      if (enteredCriticalSection) {
        console.warn('session refresh failed unexpectedly; keeping the session', err);
        scheduleTransientRetry();
        return REFRESH_TRANSIENT;
      }
      console.warn('cross-tab refresh lock unavailable; refreshing without it', err);
      return performRefresh({ fromRetry, stampBeforeWait });
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * The rotation itself. Runs inside the cross-tab lock — this is the only place
 * that POSTs /api/auth/local/refresh.
 */
async function performRefresh({ fromRetry, stampBeforeWait }) {
  // Another tab may have completed the rotation while we waited for the lock.
  // Adopting its session is the whole point: no second POST, no second rotation,
  // and therefore no 401 for the cookie we would have presented.
  const adopted = adoptInterTabRefresh(stampBeforeWait);
  if (adopted) return adopted;
  // A caller-driven attempt opens a new episode only when no retry is already
  // pending. Without that, a burst of failing requests would reset the budget
  // on every 401 and turn the backoff into a storm.
  if (!fromRetry && !refreshRetryTimer) refreshRetryAttempt = 0;
  try {
    const res = await fetch(apiUrl(routes.auth.refresh), withCreds({ method: 'POST' }));
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      if (classifyRefreshFailure(res.status, payload) === REFRESH_DEAD) {
        // THE RACE SIGNATURE. Our request carried the cookie that the winner of
        // the rotation has already consumed. If a newer expiry is stored now, the
        // refusal is about the cookie we presented, not about the session, so
        // adopt it. This cannot fire on our own success (success returns below),
        // so it needs another tab to have written — positive evidence, not a
        // loosened rule.
        if (adoptInterTabRefresh(stampBeforeWait) === REFRESH_OK) {
          console.warn(
            `session refresh refused (${res.status}) but another tab rotated; adopting its session`,
          );
          return REFRESH_OK;
        }
        console.warn(`session refresh refused (${res.status}); the session is gone, signing out`);
        return REFRESH_DEAD;
      }
      const delay = scheduleTransientRetry(res);
      console.warn(
        `session refresh deferred (${res.status}); keeping the session` +
          (delay ? `, retrying in ${Math.round(delay / 1000)}s` : ', waiting for the next request'),
      );
      return REFRESH_TRANSIENT;
    }
    if (!payload || !payload.session) {
      // 2xx with a body we cannot read. The cookies may well have rotated, but
      // we have no expiry to schedule against — keep the session and re-ask.
      console.warn(
        'session refresh returned no readable session; keeping the session and retrying',
      );
      scheduleTransientRetry();
      return REFRESH_TRANSIENT;
    }
    refreshRetryAttempt = 0;
    clearRetryTimer();
    setLocalSession(payload.session);
    scheduleProactiveRefresh(payload.session);
    return REFRESH_OK;
  } catch (err) {
    // fetch() rejects only on a network/timeout failure — the API never
    // answered, so nothing about the session has been disproved.
    console.warn('session refresh could not reach the API; keeping the session and retrying', err);
    scheduleTransientRetry();
    return REFRESH_TRANSIENT;
  }
}

// Session is truly dead (401/403, or an auth-shaped refusal): drop local state
// and go to login. THE ONLY function that clears a session — a transient
// refresh failure must never reach here.
export function handleSessionExpired() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  clearRetryTimer();
  refreshRetryAttempt = 0;
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
      refreshSession().then(function (outcome) {
        if (outcome === REFRESH_DEAD) handleSessionExpired();
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
    clearRetryTimer();
    refreshRetryAttempt = 0;
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
 * The sign-in screen is eager, and a login screen must not pull a validator into
 * the shell's bundle: the floor-plan editor is the one route that carries zod,
 * and it is loaded with `lazy()` (see `app.jsx`).
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
