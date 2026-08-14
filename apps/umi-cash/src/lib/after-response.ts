/**
 * Run post-commit work without holding the HTTP response.
 *
 * Work that follows a committed write (wallet pushes, mail) must not sit between
 * the commit and the response: the row is already saved, so every extra second
 * spent on Apple/Google is a second in which the network can drop and the client
 * reports a failure for a write that actually landed.
 *
 * Plain fire-and-forget does not work either — Vercel suspends the invocation as
 * soon as the response is returned, silently dropping anything still in flight.
 * waitUntil reconciles the two: the response goes out now and the platform keeps
 * the invocation alive until the promise settles.
 *
 * Outside a Vercel request context (next dev, tests, any other host) there is no
 * lifetime to extend, so the promise is handed back for the caller to await.
 * Blocking there is harmless — the process stays alive anyway — and it degrades
 * to the previous behaviour rather than silently losing the update.
 */
import { waitUntil } from '@vercel/functions';

// The symbol Vercel's runtime uses to publish the per-request context.
// @vercel/functions reads it through an optional chain, so a missing context turns
// waitUntil into a silent no-op. We read it ourselves to tell "handed to the
// platform" apart from "dropped on the floor".
const REQUEST_CONTEXT = Symbol.for('@vercel/request-context');

type ContextHolder =
  | { get?: () => { waitUntil?: (promise: Promise<unknown>) => void } | undefined }
  | undefined;

function canExtendLifetime(): boolean {
  const holder = (globalThis as unknown as Record<symbol, ContextHolder>)[REQUEST_CONTEXT];
  return typeof holder?.get?.()?.waitUntil === 'function';
}

let warnedMissingContext = false;

/**
 * Hand `work` to the platform to finish after the response is sent.
 *
 * Always await the returned promise at the call site: it resolves immediately when
 * the platform took ownership, and only blocks on the fallback path.
 */
export function afterResponse(label: string, work: Promise<unknown>): Promise<void> {
  const guarded = work.then(
    () => undefined,
    (err: unknown) => {
      console.error(`[after:${label}] failed:`, err instanceof Error ? err.message : String(err));
    },
  );

  if (canExtendLifetime()) {
    waitUntil(guarded);
    return Promise.resolve();
  }

  if (!warnedMissingContext) {
    warnedMissingContext = true;
    console.warn(`[after:${label}] no request context — running inline; response will block on it`);
  }
  return guarded;
}
