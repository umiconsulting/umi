import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { runWithRequestContext } from './request-context';

/**
 * Establishes the AsyncLocalStorage request context for the entire request.
 * Runs before guards, so tenant/user start null; the AuthGuard (Phase 2)
 * mutates the same context object once the JWT is verified. Using middleware
 * (not an interceptor) is deliberate — it wraps `next()` inside `als.run`, so
 * the context survives across the whole async handler chain.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: { headers?: Record<string, unknown> }, _res: unknown, next: () => void): void {
    const headerRequestId = req?.headers?.['x-request-id'];
    const requestId =
      typeof headerRequestId === 'string' ? headerRequestId : randomUUID();

    runWithRequestContext(
      { tenantId: null, userId: null, requestId },
      () => next(),
    );
  }
}
