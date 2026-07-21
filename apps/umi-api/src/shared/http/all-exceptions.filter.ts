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

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
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
