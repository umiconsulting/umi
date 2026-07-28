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
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const payload =
      exception instanceof HttpException ? exception.getResponse() : 'Internal server error';

    if (status >= SERVER_ERROR_MIN) {
      const correlationId = getRequestContext()?.correlationId ?? 'unavailable';
      const errorType = exception instanceof Error ? exception.constructor.name : 'UnknownError';
      this.logger.error(
        `${status} request_failed correlationId=${correlationId} type=${errorType}`,
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

  return {
    code,
    message,
    retryable: status === 429 || status >= SERVER_ERROR_MIN,
    correlationId,
    ...(fieldErrors ? { fieldErrors } : {}),
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
