import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request context carried through the async call chain. Created by
 * RequestContextMiddleware at the edge of every HTTP request; `tenantId` and
 * `userId` are filled in by the AuthGuard (Phase 2) after authentication.
 * Repositories read it to set RLS context on the umi_app connection (§11.2).
 */
export interface RequestContext {
  tenantId: string | null;
  userId: string | null;
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
