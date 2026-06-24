import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { LoggingService } from './logging.service';

/** Logs one structured line per HTTP request with method, url, status, duration. */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const http = context.switchToHttp();
    const req = http.getRequest<{ method: string; url: string }>();
    const res = http.getResponse<{ statusCode: number }>();
    const start = Date.now();
    const { method, url } = req;

    return next.handle().pipe(
      tap(() =>
        this.logger.log('request', {
          method,
          url,
          status: res.statusCode,
          ms: Date.now() - start,
        }),
      ),
    );
  }
}
