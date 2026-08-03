import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Observable, finalize } from 'rxjs';
import type { AuthedRequest } from '../../modules/auth/auth.types';
import { getRequestContext } from '../database/request-context';
import { RateLimitService } from '../ratelimit/rate-limit.service';
import { MetricsService } from './metrics.service';

const WINDOW_MS = 60_000;
const LIMITS = { user: 240, device: 240, tenant: 1_000, branch: 600 } as const;

@Injectable()
export class OperationalInterceptor implements NestInterceptor {
  constructor(
    private readonly limits: RateLimitService,
    private readonly metrics: MetricsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest & AuthedRequest>();
    const reply = http.getResponse<FastifyReply>();
    const dimensions = this.dimensions(request);
    let minimumRemaining = Number.MAX_SAFE_INTEGER;
    let resetAt = 0;
    for (const [scope, identity] of dimensions) {
      const result = this.limits.hit(`http:${scope}:${identity}`, LIMITS[scope], WINDOW_MS);
      minimumRemaining = Math.min(minimumRemaining, result.remaining);
      resetAt = Math.max(resetAt, result.resetAt);
      if (!result.allowed) {
        this.metrics.increment('http.rate_limit.rejected', { scope });
        throw new HttpException(
          {
            code: 'RATE_LIMITED',
            message: 'Request rate limit exceeded.',
            retryAfterSeconds: Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1_000)),
          },
          429,
        );
      }
    }
    void reply.header('x-ratelimit-remaining', String(minimumRemaining));
    void reply.header('x-ratelimit-reset', String(Math.ceil(resetAt / 1_000)));

    const started = Date.now();
    const route = routeLabel(request);
    this.metrics.increment('http.requests', { method: request.method, route });
    return next.handle().pipe(
      finalize(() => {
        this.metrics.observe('http.duration_ms', Date.now() - started, {
          method: request.method,
          route,
          status: String(reply.statusCode),
        });
      }),
    );
  }

  private dimensions(
    request: FastifyRequest & AuthedRequest,
  ): Array<[keyof typeof LIMITS, string]> {
    const context = getRequestContext();
    const device = header(request, 'x-umi-device-id');
    const dimensions: Array<[keyof typeof LIMITS, string]> = [];
    if (request.authUser?.id) dimensions.push(['user', request.authUser.id]);
    if (device) dimensions.push(['device', device]);
    if (context?.merchantId) dimensions.push(['tenant', context.merchantId]);
    if (context?.locationId) dimensions.push(['branch', context.locationId]);
    return dimensions;
  }
}

function header(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name];
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null;
}

function routeLabel(request: FastifyRequest): string {
  const route = request.routeOptions?.url;
  return typeof route === 'string' ? route : 'unmatched';
}
