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
      let payloadStr: string;
      try {
        payloadStr = JSON.stringify(payload);
      } catch {
        payloadStr = String(payload);
      }
      this.logger.error(
        `${status} ${payloadStr}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    void reply.status(status).send({
      statusCode: status,
      error: payload,
      requestId: getRequestContext()?.requestId,
      timestamp: new Date().toISOString(),
    });
  }
}
