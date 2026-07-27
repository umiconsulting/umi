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
  use(
    req: { headers?: Record<string, unknown> },
    res: { header?: (name: string, value: string) => unknown },
    next: () => void,
  ): void {
    const requestId = safeIdentifier(req?.headers?.['x-request-id']) ?? randomUUID();
    const correlationId = safeIdentifier(req?.headers?.['x-correlation-id']) ?? requestId;
    res.header?.('x-request-id', requestId);
    res.header?.('x-correlation-id', correlationId);

    runWithRequestContext(
      { tenantId: null, branchId: null, userId: null, requestId, correlationId },
      () => next(),
    );
  }
}

function safeIdentifier(value: unknown): string | null {
  if (Array.isArray(value)) value = value[0];
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null;
}
