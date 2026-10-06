import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { getRequestContext } from '../database/request-context';
import { API_ERROR_CODES, type ApiError } from '@umi/contract';

// `HttpException.getStatus()` returns a plain `number`, so comparing it against a
// member of the numeric `HttpStatus` enum is an unsafe-enum-comparison. Pin the
// threshold as a number once, where the intent stays readable.
const SERVER_ERROR_MIN: number = HttpStatus.INTERNAL_SERVER_ERROR;

/** Catch-all filter → consistent JSON error envelope with the request id. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    // A websocket handler shares this global filter. `getResponse()` returns a
    // socket there, and writing an HTTP status to it crashes a second time on
    // top of the original error. Let the ws layer handle its own failures.
    if (host.getType() !== 'http') throw exception;

    const reply = host.switchToHttp().getResponse<FastifyReply>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const payload =
      exception instanceof HttpException ? exception.getResponse() : 'Internal server error';

    if (status >= SERVER_ERROR_MIN) {
      const correlationId = getRequestContext()?.correlationId ?? 'unavailable';
      const errorType = exception instanceof Error ? exception.constructor.name : 'UnknownError';
      // The message and stack stay OUT of the response — `publicError` below is the
      // only thing the caller sees — but they have to reach the log. A 500 that
      // records nothing but a constructor name cannot be diagnosed from the outside,
      // and the correlation id it hands back leads to a line that says no more than
      // the caller already knew.
      const detail = exception instanceof Error ? exception.message : String(exception);
      this.logger.error(
        `${status} request_failed correlationId=${correlationId} type=${errorType} detail=${detail}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      // A REFUSAL IS LOGGED TOO, AT `warn`. It used to be silent: the log recorded
      // only 2xx, so a client that kept being told "no" left no trace, and the only
      // way to find out why was to guess. The till's inventory surface failed this
      // way for a whole afternoon on a missing policy lease, and the log said
      // nothing at all. The code and the route are enough to find the caller.
      const correlationId = getRequestContext()?.correlationId ?? 'unavailable';
      const scope = getRequestContext();
      const requestScope = scope
        ? `merchant=${scope.merchantId ?? 'none'} location=${scope.locationId ?? 'none'}`
        : 'unknown_scope';
      this.logger.warn(
        `${status} request_refused correlationId=${correlationId} ${requestScope} code=${publicError(status, payload, correlationId).code} detail=${describeRefusal(payload)}`,
      );
    }

    const context = getRequestContext();
    const requestId = context?.requestId ?? 'unavailable';
    const error = publicError(status, payload, context?.correlationId ?? requestId);
    void reply.status(status).send({
      statusCode: status,
      error,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
}

function publicError(status: number, payload: string | object, correlationId: string): ApiError {
  const source = typeof payload === 'object' && payload !== null ? payload : {};
  const explicitCode =
    'code' in source &&
    typeof source.code === 'string' &&
    API_ERROR_CODES.includes(source.code as ApiError['code'])
      ? (source.code as ApiError['code'])
      : null;
  const code = explicitCode ?? codeForStatus(status);
  const message =
    status >= SERVER_ERROR_MIN
      ? 'Internal server error'
      : typeof payload === 'string'
        ? payload
        : 'message' in source && typeof source.message === 'string'
          ? source.message
          : 'error' in source && typeof source.error === 'string'
            ? source.error
            : 'Request failed';
  const fieldErrors =
    'fieldErrors' in source && typeof source.fieldErrors === 'object' && source.fieldErrors !== null
      ? (source.fieldErrors as Record<string, string[]>)
      : undefined;
  // The facts a refusal needs in order to be actionable. Only for 4xx: a 5xx
  // message is already replaced with "Internal server error", and a detail bag
  // on a server fault would leak whatever the failing code happened to know —
  // ids from another merchant, an internal path, a constraint name.
  const details =
    status < SERVER_ERROR_MIN &&
    'details' in source &&
    typeof source.details === 'object' &&
    source.details !== null
      ? (source.details as Record<string, string | number | boolean | null>)
      : undefined;

  return {
    code,
    message,
    retryable: status === 429 || status >= SERVER_ERROR_MIN,
    correlationId,
    ...(fieldErrors ? { fieldErrors } : {}),
    ...(details ? { details } : {}),
  };
}

function codeForStatus(status: number): ApiError['code'] {
  if (status === 400) return 'VALIDATION_FAILED';
  if (status === 401) return 'AUTHENTICATION_REQUIRED';
  if (status === 403) return 'PERMISSION_DENIED';
  if (status === 404) return 'RESOURCE_NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  return 'INTERNAL_ERROR';
}

/**
 * A one-line summary of a refusal for the log. The operator still sees the same
 * envelope; this exists so the person reading the server log can tell WHICH item and
 * which rule refused, which the code alone does not say. Bounded, and it never
 * carries a stack.
 */
function describeRefusal(payload: string | object): string {
  if (typeof payload === 'string') return payload.slice(0, 300);
  const source = payload as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ['code', 'message', 'inventoryItemId', 'inventoryLocationId', 'detail']) {
    const value = source?.[key];
    if (typeof value === 'string' && value.length > 0) parts.push(`${key}=${value.slice(0, 120)}`);
  }
  if (
    'details' in (source ?? {}) &&
    typeof source.details === 'object' &&
    source.details !== null
  ) {
    parts.push(`details=${JSON.stringify(source.details).slice(0, 200)}`);
  }
  return parts.join(' ') || 'no_detail';
}
