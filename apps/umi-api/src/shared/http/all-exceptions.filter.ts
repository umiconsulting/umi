import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { getRequestContext, type RequestContext } from '../database/request-context';
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

    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    // The METHOD and the URL, for the refusal line below. The comment there says the
    // route is what lets a caller be found, and it was not in the line: a commissioning
    // session produced eleven `403 ... code=PERMISSION_DENIED` records with no way to
    // tell which surface was refused, and the answer — a role missing one permission —
    // had to be guessed. `url` is the path WITHOUT the query string, because a query
    // carries operator session ids and the log is not the place for them.
    //
    // Read defensively, because this is the ERROR path: a filter that throws while
    // reporting a failure replaces a 400 with a 500 and says nothing about either.
    // A real host always answers `getRequest`; a test double or a future adapter that
    // does not must still get its error reported.
    const request =
      typeof http.getRequest === 'function'
        ? http.getRequest<{
            method?: string;
            url?: string;
            ip?: string;
            headers?: Record<string, string | string[] | undefined>;
            user?: { deviceId?: string | null; device_id?: string | null };
          }>()
        : undefined;
    const method = request?.method ?? '?';
    const path = (request?.url ?? '?').split('?')[0];
    const route = `${method} ${path}`;

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const payload =
      exception instanceof HttpException ? exception.getResponse() : 'Internal server error';

    const scope = getRequestContext();
    const correlationId = scope?.correlationId ?? 'unavailable';
    const error = publicError(
      status,
      payload,
      scope?.correlationId ?? scope?.requestId ?? 'unavailable',
    );
    const opsContext = describeOperationalContext(request, scope);

    if (status >= SERVER_ERROR_MIN) {
      const errorType = exception instanceof Error ? exception.constructor.name : 'UnknownError';
      // The message and stack stay OUT of the response — `publicError` below is the
      // only thing the caller sees — but they have to reach the log. A 500 that
      // records nothing but a constructor name cannot be diagnosed from the outside,
      // and the correlation id it hands back leads to a line that says no more than
      // the caller already knew.
      const detail = exception instanceof Error ? exception.message : String(exception);
      this.logger.error(
        `${status} request_failed ${route} statusCode=${status} method=${method} path=${path} correlationId=${correlationId} ${opsContext} code=${error.code} type=${errorType} detail=${detail}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      // A REFUSAL IS LOGGED TOO, AT `warn`. It used to be silent: the log recorded
      // only 2xx, so a client that kept being told "no" left no trace, and the only
      // way to find out why was to guess. The till's inventory surface failed this
      // way for a whole afternoon on a missing policy lease, and the log said
      // nothing at all. The code, route, deviceId, posBuild, and ip identify the caller
      // without ever recording credentials, PINs, or PII.
      const requestScope = scope
        ? `merchant=${scope.merchantId ?? 'none'} location=${scope.locationId ?? 'none'}`
        : 'unknown_scope';
      this.logger.warn(
        `${status} request_refused ${route} statusCode=${status} method=${method} path=${path} correlationId=${correlationId} ${requestScope} ${opsContext} code=${error.code} detail=${describeRefusal(payload)}`,
      );
    }

    const requestId = scope?.requestId ?? 'unavailable';
    // The client needs the wait it must observe before it sends again. Without
    // this header a refusal of type 429 is only a status, and every surface
    // retries at its own cadence against a bucket that is still empty.
    const retryAfterSeconds = error.details?.retryAfterSeconds;
    if (status === 429 && typeof retryAfterSeconds === 'number') {
      void reply.header('retry-after', String(retryAfterSeconds));
    }
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
  const retryAfterSeconds =
    status === 429 && 'retryAfterSeconds' in source && typeof source.retryAfterSeconds === 'number'
      ? source.retryAfterSeconds
      : undefined;
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
    retryable:
      status === 429 ||
      status >= SERVER_ERROR_MIN ||
      (status === 409 && code === 'INVENTORY_COUNT_BUSY'),
    correlationId,
    ...(fieldErrors ? { fieldErrors } : {}),
    ...(details || retryAfterSeconds !== undefined
      ? {
          details: {
            ...(details ?? {}),
            ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
          },
        }
      : {}),
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
  if (
    'fieldErrors' in (source ?? {}) &&
    typeof source.fieldErrors === 'object' &&
    source.fieldErrors !== null
  ) {
    parts.push(`fields=${JSON.stringify(source.fieldErrors).slice(0, 500)}`);
  }
  return parts.join(' ') || 'no_detail';
}

interface RefusalRequestLike {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  user?: { deviceId?: string | null; device_id?: string | null };
}

function describeOperationalContext(
  request: RefusalRequestLike | undefined,
  scope: RequestContext | undefined,
): string {
  const deviceId =
    safeToken(scope?.deviceId, SAFE_ID_PATTERN) ??
    safeToken(request?.user?.deviceId, SAFE_ID_PATTERN) ??
    safeToken(request?.user?.device_id, SAFE_ID_PATTERN) ??
    safeHeader(request?.headers, 'x-umi-device-id', SAFE_ID_PATTERN) ??
    safeHeader(request?.headers, 'x-device-id', SAFE_ID_PATTERN) ??
    'none';
  const posBuild = safeHeader(request?.headers, 'x-umi-pos-build', SAFE_BUILD_PATTERN) ?? 'unknown';
  const ip =
    safeToken(request?.ip, SAFE_IP_PATTERN) ?? safeForwardedIp(request?.headers) ?? 'unknown';
  return `deviceId=${deviceId} posBuild=${posBuild} ip=${ip}`;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_BUILD_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const SAFE_IP_PATTERN = /^[0-9A-Fa-f:.]{1,64}$/;

function safeToken(value: unknown, pattern: RegExp): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return pattern.test(trimmed) ? trimmed : null;
}

function safeHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
  pattern: RegExp,
): string | null {
  if (!headers) return null;
  const raw = headers[name] ?? headers[name.toLowerCase()];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  return safeToken(candidate, pattern);
}

function safeForwardedIp(
  headers: Record<string, string | string[] | undefined> | undefined,
): string | null {
  if (!headers) return null;
  const raw = headers['x-forwarded-for'];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (typeof candidate !== 'string') return null;
  const first = candidate.split(',')[0];
  return safeToken(first, SAFE_IP_PATTERN);
}
