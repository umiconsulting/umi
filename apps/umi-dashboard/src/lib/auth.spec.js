import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The refresh outcome is a THREE-state union, and the whole point of these
 * tests is that the third state cannot be reached from a hiccup.
 *
 *   429 / 5xx / network / unreadable body → 'transient' → session kept
 *   401 / 403 / auth-shaped body          → 'dead'      → session cleared
 *
 * The suite stubs `window`, `document` and `fetch` by hand (the house style in
 * `data.devices.spec.jsx`) rather than pulling in jsdom, and reloads the module
 * per test with `vi.resetModules()` because the retry budget, the timers and the
 * single-flight guard are module-level state.
 *
 * Two more things are stubbed, because the rotation is now serialised per
 * BROWSER and not per page: `navigator.locks` (the Web Locks path every modern
 * browser takes), and `localStorage` (the fallback path a browser without Web
 * Locks takes). Loading the module twice gives two independent module instances
 * over one shared `window` — which is exactly what two dashboard tabs are.
 */

const LOCAL_SESSION_KEY = 'umi-dashboard-local-session';
const TAB_LOCK_KEY = 'umi-dashboard-refresh-lock';

// The umi-api error envelope (see `AllExceptionsFilter.publicError`): the code
// and message live under `error`, and `retryable` is true for 429 and 5xx.
const RATE_LIMITED_BODY = {
  statusCode: 429,
  error: {
    code: 'RATE_LIMITED',
    message: 'Request rate limit exceeded.',
    retryable: true,
    correlationId: 'rate-limited-test',
  },
  requestId: 'rate-limited-test',
  timestamp: '2026-09-16T10:00:00.000Z',
};

const AUTH_REQUIRED_BODY = {
  statusCode: 401,
  error: {
    code: 'AUTHENTICATION_REQUIRED',
    message: 'invalid_token',
    retryable: false,
    correlationId: 'invalid-token-test',
  },
  requestId: 'invalid-token-test',
  timestamp: '2026-09-16T10:00:00.000Z',
};

const SERVER_ERROR_BODY = {
  statusCode: 500,
  error: {
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
    retryable: true,
    correlationId: 'boom',
  },
  requestId: 'boom',
  timestamp: '2026-09-16T10:00:00.000Z',
};

const session = {
  user: { id: 'u-1', email: 'admin@kalalacafe.mx', displayName: 'Admin' },
  accessExpiresIn: 900,
};

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    json: async () => body,
  };
}

function unreadableResponse(status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    },
  };
}

/**
 * A stand-in for the Web Locks API: one holder at a time, FIFO.
 *
 * `manual: true` parks every request until the test calls `runNext()`, which is
 * how a cross-tab ordering gets staged deterministically instead of hoped for.
 */
function installLocks({ manual = false } = {}) {
  const queue = [];
  let busy = false;
  function serveNext() {
    if (manual || busy || queue.length === 0) return;
    const job = queue.shift();
    busy = true;
    Promise.resolve()
      .then(() => job.callback({ name: 'umi-dashboard-refresh', mode: 'exclusive' }))
      .then(
        (value) => {
          busy = false;
          job.resolve(value);
          serveNext();
        },
        (error) => {
          busy = false;
          job.reject(error);
          serveNext();
        },
      );
  }
  const locks = {
    request(name, optionsOrCallback, maybeCallback) {
      const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
      return new Promise((resolve, reject) => {
        queue.push({ callback, resolve, reject });
        serveNext();
      });
    },
  };
  vi.stubGlobal('navigator', { locks });
  return {
    locks,
    queued: () => queue.length,
    async runNext() {
      const job = queue.shift();
      if (!job) throw new Error('no lock request is queued');
      const running = Promise.resolve().then(() =>
        job.callback({ name: 'umi-dashboard-refresh', mode: 'exclusive' }),
      );
      running.then(job.resolve, job.reject);
      return running;
    },
  };
}

/** A browser-shaped global scope good enough for auth.jsx, plus handles to assert on. */
function installBrowser({ stored = session, pathname = '/orders', locks = 'auto' } = {}) {
  const entries = new Map();
  if (stored) entries.set(LOCAL_SESSION_KEY, JSON.stringify(stored));
  const storage = {
    getItem: vi.fn((key) => (entries.has(key) ? entries.get(key) : null)),
    setItem: vi.fn((key, value) => void entries.set(key, String(value))),
    removeItem: vi.fn((key) => void entries.delete(key)),
    has: (key) => entries.has(key),
    entries,
  };
  const location = { pathname, assign: vi.fn() };
  const listeners = new Map();
  globalThis.document = {
    visibilityState: 'visible',
    cookie: '',
    addEventListener: vi.fn((type, handler) => listeners.set(type, handler)),
    removeEventListener: vi.fn((type) => listeners.delete(type)),
  };
  globalThis.window = {
    localStorage: storage,
    location,
    addEventListener: vi.fn((type, handler) => listeners.set(type, handler)),
    removeEventListener: vi.fn((type) => listeners.delete(type)),
  };
  // 'auto' = a real browser's Web Locks, 'manual' = the same API with the test
  // driving who enters first, 'off' = a browser without it (the fallback path).
  let lockApi = null;
  if (locks === 'off') vi.stubGlobal('navigator', {});
  else lockApi = installLocks({ manual: locks === 'manual' });
  return { storage, location, listeners, locks: lockApi };
}

/** Reload the module so timers, the retry budget and the in-flight guard start clean. */
async function loadAuth() {
  vi.resetModules();
  return import('./auth.jsx');
}

/** The outcome of one refresh attempt against a stubbed response, through the public API. */
async function outcomeFor(response) {
  installBrowser();
  const auth = await loadAuth();
  globalThis.fetch = vi.fn(async () => response);
  return auth.refreshSession();
}

const defer = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.useFakeTimers();
  // Cookie auth is what makes a refresh possible at all, and `.env.local` is
  // gitignored — so the mode is pinned here rather than inherited from a file a
  // CI checkout does not have.
  vi.stubEnv('VITE_AUTH_MODE', 'cookie');
  vi.stubEnv('VITE_API_BASE', 'http://127.0.0.1:4001');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.fetch;
});

describe('refresh failure classification', () => {
  it('the harness pins cookie auth mode, not a gitignored .env.local', async () => {
    // The whole suite only means something in cookie mode, and `.env.local` is
    // not in a CI checkout. This asserts the stub actually reaches
    // `import.meta.env` instead of the runs passing by accident on this machine.
    vi.stubEnv('VITE_AUTH_MODE', 'invalid');
    vi.resetModules();
    await expect(import('./config.js')).resolves.toMatchObject({ COOKIE_AUTH: false });

    vi.stubEnv('VITE_AUTH_MODE', 'cookie');
    vi.resetModules();
    await expect(import('./config.js')).resolves.toMatchObject({ COOKIE_AUTH: true });
  });

  it('reads the rate limiter by its code, not by the number alone', async () => {
    expect(await outcomeFor(jsonResponse(429, RATE_LIMITED_BODY))).toBe('transient');
    expect(await outcomeFor(jsonResponse(429, null))).toBe('transient');
  });

  it('treats 5xx and unreadable bodies as transient', async () => {
    expect(await outcomeFor(jsonResponse(500, SERVER_ERROR_BODY))).toBe('transient');
    expect(await outcomeFor(jsonResponse(503, null))).toBe('transient');
    expect(await outcomeFor(unreadableResponse(200))).toBe('transient');
    expect(await outcomeFor(unreadableResponse(429))).toBe('transient');
  });

  it('treats 401 and 403 as dead whatever the body says', async () => {
    expect(await outcomeFor(jsonResponse(401, AUTH_REQUIRED_BODY))).toBe('dead');
    expect(await outcomeFor(jsonResponse(403, null))).toBe('dead');
  });

  it('treats an auth-shaped body as dead even under a non-auth status', async () => {
    expect(
      await outcomeFor(
        jsonResponse(400, {
          error: { code: 'AUTHENTICATION_REQUIRED', message: 'Request failed' },
        }),
      ),
    ).toBe('dead');
    expect(await outcomeFor(jsonResponse(502, { statusCode: 502, error: 'invalid_token' }))).toBe(
      'dead',
    );
  });
});

describe('refreshSession outcome (cookie auth)', () => {
  it('reports ok and schedules the next proactive refresh on success', async () => {
    const { storage } = installBrowser();
    const auth = await loadAuth();
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { session }));

    await expect(auth.refreshSession()).resolves.toBe('ok');
    expect(storage.has(LOCAL_SESSION_KEY)).toBe(true);
    // The next proactive refresh is armed against the new expiry.
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it('keeps the session and arms a retry on 429', async () => {
    const { storage, location } = installBrowser();
    const auth = await loadAuth();
    globalThis.fetch = vi.fn(async () => jsonResponse(429, RATE_LIMITED_BODY));

    await expect(auth.refreshSession()).resolves.toBe('transient');

    expect(storage.has(LOCAL_SESSION_KEY)).toBe(true);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(location.assign).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    // The armed retry fires and asks the API again.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the session on a 5xx', async () => {
    const { storage, location } = installBrowser();
    const auth = await loadAuth();
    globalThis.fetch = vi.fn(async () => jsonResponse(500, SERVER_ERROR_BODY));

    await expect(auth.refreshSession()).resolves.toBe('transient');
    expect(storage.has(LOCAL_SESSION_KEY)).toBe(true);
    expect(location.assign).not.toHaveBeenCalled();
  });

  it('keeps the session when the network never answers', async () => {
    const { storage, location } = installBrowser();
    const auth = await loadAuth();
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(auth.refreshSession()).resolves.toBe('transient');
    expect(storage.has(LOCAL_SESSION_KEY)).toBe(true);
    expect(location.assign).not.toHaveBeenCalled();
  });

  it('treats a malformed body as transient, not as a dead session', async () => {
    installBrowser();
    const auth = await loadAuth();
    globalThis.fetch = vi.fn(async () => unreadableResponse(200));

    await expect(auth.refreshSession()).resolves.toBe('transient');
    expect(globalThis.window.localStorage.has(LOCAL_SESSION_KEY)).toBe(true);
    expect(globalThis.window.location.assign).not.toHaveBeenCalled();
  });

  it('reports dead on 401 and leaves clearing to handleSessionExpired', async () => {
    const { storage, location } = installBrowser();
    const auth = await loadAuth();
    globalThis.fetch = vi.fn(async () => jsonResponse(401, AUTH_REQUIRED_BODY));

    await expect(auth.refreshSession()).resolves.toBe('dead');
    // A 401 is still only an outcome: the caller decides to sign out, and the
    // dead path is the ONLY one allowed to.
    auth.handleSessionExpired();
    expect(storage.has(LOCAL_SESSION_KEY)).toBe(false);
    expect(location.assign).toHaveBeenCalledWith('/login');
  });

  it('never clears the session for a transient failure, and stops after a bounded number of retries', async () => {
    const { storage, location } = installBrowser();
    const auth = await loadAuth();
    globalThis.fetch = vi.fn(async () => jsonResponse(429, RATE_LIMITED_BODY));

    await expect(auth.refreshSession()).resolves.toBe('transient');
    // Backoff: 15s, 30s, 60s, 120s, 240s — five retries, then it stops.
    await vi.advanceTimersByTimeAsync(15_000 + 30_000 + 60_000 + 120_000 + 240_000);
    expect(globalThis.fetch).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(globalThis.fetch).toHaveBeenCalledTimes(6);
    expect(storage.has(LOCAL_SESSION_KEY)).toBe(true);
    expect(location.assign).not.toHaveBeenCalled();
  });

  it('collapses concurrent callers into one in-flight refresh', async () => {
    installBrowser();
    const auth = await loadAuth();
    const pending = defer();
    globalThis.fetch = vi.fn(async () => pending.promise);

    const first = auth.refreshSession();
    const second = auth.refreshSession();
    // The per-page guard is the same promise for both callers — the strongest
    // form of "one refresh" — and the cross-tab lock then hands the critical
    // section over in a microtask, so the POST itself starts one tick later.
    expect(first).toBe(second);
    await vi.advanceTimersByTimeAsync(0);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    pending.resolve(jsonResponse(200, { session }));
    await expect(Promise.all([first, second])).resolves.toEqual(['ok', 'ok']);
  });

  it('honours a rate-limit reset hint instead of retrying inside the window', async () => {
    installBrowser();
    const auth = await loadAuth();
    const resetAt = Math.ceil((Date.now() + 45_000) / 1000);
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(429, RATE_LIMITED_BODY, { 'x-ratelimit-reset': String(resetAt) }),
    );

    await expect(auth.refreshSession()).resolves.toBe('transient');
    // 45s from now, so the 15s backoff must not fire first.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('callers treat the union correctly', () => {
  it('the proactive timer signs out only when the refresh is dead', async () => {
    const { storage, location } = installBrowser({
      stored: { ...session, accessExpiresAt: Date.now() - 1_000 },
    });
    const auth = await loadAuth();
    globalThis.fetch = vi.fn(async () => jsonResponse(401, AUTH_REQUIRED_BODY));

    const stop = auth.startSessionAutoRefresh();
    await vi.advanceTimersByTimeAsync(31_000);

    expect(storage.has(LOCAL_SESSION_KEY)).toBe(false);
    expect(location.assign).toHaveBeenCalledWith('/login');
    stop();
  });

  it('the proactive timer KEEPS the session when the refresh is transient', async () => {
    const { storage, location } = installBrowser({
      stored: { ...session, accessExpiresAt: Date.now() - 1_000 },
    });
    const auth = await loadAuth();
    globalThis.fetch = vi.fn(async () => jsonResponse(429, RATE_LIMITED_BODY));

    const stop = auth.startSessionAutoRefresh();
    await vi.advanceTimersByTimeAsync(31_000);

    expect(storage.has(LOCAL_SESSION_KEY)).toBe(true);
    expect(location.assign).not.toHaveBeenCalled();
    stop();
  });

  it('a returning tab retries a transient refresh without bouncing the operator', async () => {
    const { storage, location, listeners } = installBrowser({
      stored: { ...session, accessExpiresAt: Date.now() - 1_000 },
    });
    const auth = await loadAuth();
    globalThis.fetch = vi.fn(async () => jsonResponse(503, SERVER_ERROR_BODY));

    const stop = auth.startSessionAutoRefresh();
    listeners.get('visibilitychange')();
    await vi.advanceTimersByTimeAsync(0);

    expect(storage.has(LOCAL_SESSION_KEY)).toBe(true);
    expect(location.assign).not.toHaveBeenCalled();
    stop();
  });
});

// ---------------------------------------------------------------------------
// The refresh cookie is per BROWSER and it rotates, so the refresh itself has to
// be per browser too. Before this, two tabs refreshing at the same moment each
// presented the cookie the other was consuming; the loser got a 401, called it
// REFRESH_DEAD, and every open tab lost the session.
// ---------------------------------------------------------------------------
describe('cross-tab serialisation (one rotation per browser, Web Locks)', () => {
  it('a tab that loses the inter-tab lock adopts the rotation and never calls the network', async () => {
    const before = Date.now() + 60_000;
    const { storage, location, locks } = installBrowser({
      stored: { ...session, accessExpiresAt: before },
      locks: 'manual',
    });
    const auth = await loadAuth();
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { session }));

    const refreshing = auth.refreshSession();
    expect(locks.queued()).toBe(1); // parked on the lock, nothing sent yet
    expect(globalThis.fetch).not.toHaveBeenCalled();

    // Another tab won the lock while we waited, and stored the newer expiry.
    const rotated = before + 900_000;
    storage.entries.set(
      LOCAL_SESSION_KEY,
      JSON.stringify({ ...session, accessExpiresAt: rotated }),
    );
    await locks.runNext();

    await expect(refreshing).resolves.toBe('ok');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(JSON.parse(storage.entries.get(LOCAL_SESSION_KEY)).accessExpiresAt).toBe(rotated);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(location.assign).not.toHaveBeenCalled();
    // The adopted expiry is what this tab's own proactive timer now runs against.
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it('two tabs on one browser make exactly one rotation between them', async () => {
    const before = Date.now() + 60_000;
    const { storage, locks } = installBrowser({
      stored: { ...session, accessExpiresAt: before },
      locks: 'manual',
    });
    // Two module instances = two tabs: separate in-flight guards, one localStorage,
    // one lock manager.
    const tabA = await loadAuth();
    const tabB = await loadAuth();
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { session }));

    const first = tabA.refreshSession();
    const second = tabB.refreshSession();
    expect(locks.queued()).toBe(2);

    await locks.runNext(); // tab A enters the critical section and rotates
    await expect(first).resolves.toBe('ok');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    await locks.runNext(); // tab B now sees the result and adopts it
    await expect(second).resolves.toBe('ok');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // one POST, not two
    expect(JSON.parse(storage.entries.get(LOCAL_SESSION_KEY)).accessExpiresAt).toBeGreaterThan(
      before,
    );
  });

  it('adopts a rotation that lands while its own request is in flight (the 401 race)', async () => {
    const before = Date.now() + 60_000;
    const { storage, location } = installBrowser({
      stored: { ...session, accessExpiresAt: before },
    });
    const auth = await loadAuth();
    // Our POST carries a cookie that another tab consumes while it is on the
    // wire, so the API answers 401 — and by the time we read the answer the
    // winner has already stored a newer expiry.
    const rotated = before + 900_000;
    globalThis.fetch = vi.fn(async () => {
      storage.entries.set(
        LOCAL_SESSION_KEY,
        JSON.stringify({ ...session, accessExpiresAt: rotated }),
      );
      return jsonResponse(401, AUTH_REQUIRED_BODY);
    });

    await expect(auth.refreshSession()).resolves.toBe('ok');
    expect(JSON.parse(storage.entries.get(LOCAL_SESSION_KEY)).accessExpiresAt).toBe(rotated);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(location.assign).not.toHaveBeenCalled();
  });

  it('still reports dead on a 401 when no other tab rotated', async () => {
    const { storage, location } = installBrowser({
      stored: { ...session, accessExpiresAt: Date.now() + 60_000 },
    });
    const auth = await loadAuth();
    globalThis.fetch = vi.fn(async () => jsonResponse(401, AUTH_REQUIRED_BODY));

    await expect(auth.refreshSession()).resolves.toBe('dead');
    expect(storage.has(LOCAL_SESSION_KEY)).toBe(true); // clearing is still the caller's move
    auth.handleSessionExpired();
    expect(storage.has(LOCAL_SESSION_KEY)).toBe(false);
    expect(location.assign).toHaveBeenCalledWith('/login');
  });

  it('reports dead without a network call when another tab already cleared the session', async () => {
    const before = Date.now() + 60_000;
    const { storage, location, locks } = installBrowser({
      stored: { ...session, accessExpiresAt: before },
      locks: 'manual',
    });
    const auth = await loadAuth();
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { session }));

    const refreshing = auth.refreshSession();
    storage.entries.delete(LOCAL_SESSION_KEY); // the other tab reached the dead verdict
    await locks.runNext();

    await expect(refreshing).resolves.toBe('dead');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(location.assign).not.toHaveBeenCalled();
  });

  it('releases the lock, so a later rotation is not stuck behind the finished one', async () => {
    const { locks } = installBrowser({ locks: 'manual' });
    const auth = await loadAuth();
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { session }));

    const first = auth.refreshSession();
    await locks.runNext();
    await expect(first).resolves.toBe('ok');

    const second = auth.refreshSession();
    expect(locks.queued()).toBe(1);
    await locks.runNext();
    await expect(second).resolves.toBe('ok');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('cross-tab fallback (browser without Web Locks)', () => {
  it('holds the storage lock across the rotation and releases it afterwards', async () => {
    const { storage } = installBrowser({ locks: 'off' });
    const auth = await loadAuth();
    let heldWhileFetching = null;
    globalThis.fetch = vi.fn(async () => {
      heldWhileFetching = storage.entries.has(TAB_LOCK_KEY);
      return jsonResponse(200, { session });
    });

    const refreshing = auth.refreshSession();
    // A claim is only believed after it settles and is re-read, so the critical
    // section does not start in the same tick.
    await vi.advanceTimersByTimeAsync(400);
    await expect(refreshing).resolves.toBe('ok');
    expect(heldWhileFetching).toBe(true);
    expect(storage.entries.has(TAB_LOCK_KEY)).toBe(false);
  });

  it('waits on another tab and rotates once, as soon as that claim expires', async () => {
    const { storage } = installBrowser({ locks: 'off' });
    storage.entries.set(
      TAB_LOCK_KEY,
      JSON.stringify({ owner: 'other-tab', expiresAt: Date.now() + 1_000 }),
    );
    const auth = await loadAuth();
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { session }));

    const refreshing = auth.refreshSession();
    await vi.advanceTimersByTimeAsync(800);
    expect(globalThis.fetch).not.toHaveBeenCalled(); // still waiting on the other tab

    await vi.advanceTimersByTimeAsync(600);
    await expect(refreshing).resolves.toBe('ok');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(storage.entries.has(TAB_LOCK_KEY)).toBe(false);
  });

  it('backs off when another renderer’s claim wins the settle window', async () => {
    // Measured on this box: three tabs claiming within 4ms all read the key as
    // free, because localStorage is not synchronously shared between renderer
    // processes. The claim that does not survive the settle has to lose.
    const { storage } = installBrowser({ locks: 'off' });
    const auth = await loadAuth();
    const writeThrough = storage.setItem;
    let steals = 1;
    storage.setItem = vi.fn((key, value) => {
      if (key === TAB_LOCK_KEY && steals-- > 0) {
        return writeThrough(
          TAB_LOCK_KEY,
          JSON.stringify({ owner: 'other-tab', expiresAt: Date.now() + 200 }),
        );
      }
      return writeThrough(key, value);
    });
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { session }));

    const refreshing = auth.refreshSession();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(refreshing).resolves.toBe('ok');
    // Backed off, waited the other claim out, then rotated exactly once.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(storage.entries.has(TAB_LOCK_KEY)).toBe(false);
  });

  it('is never wedged for ever by a claim that is never released', async () => {
    const { storage } = installBrowser({ locks: 'off' });
    storage.entries.set(
      TAB_LOCK_KEY,
      JSON.stringify({ owner: 'crashed-tab', expiresAt: Date.now() + 86_400_000 }),
    );
    const auth = await loadAuth();
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { session }));

    const refreshing = auth.refreshSession();
    await vi.advanceTimersByTimeAsync(12_500);
    await expect(refreshing).resolves.toBe('ok');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    // The stuck claim was not ours to clear, so it is left where it was found.
    expect(storage.entries.has(TAB_LOCK_KEY)).toBe(true);
  });

  it('refreshes straight away when the lock cannot be written at all', async () => {
    const { storage } = installBrowser({ locks: 'off' });
    const writeThrough = storage.setItem;
    storage.setItem = vi.fn((key, value) => {
      if (key === TAB_LOCK_KEY) throw new DOMException('quota', 'QuotaExceededError');
      return writeThrough(key, value);
    });
    const auth = await loadAuth();
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { session }));

    await expect(auth.refreshSession()).resolves.toBe('ok');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
