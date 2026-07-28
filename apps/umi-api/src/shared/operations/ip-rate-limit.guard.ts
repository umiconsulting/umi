import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RateLimitService } from '../ratelimit/rate-limit.service';
import { MetricsService } from './metrics.service';

const IP_LIMIT = 300;
const WINDOW_MS = 60_000;

@Injectable()
export class IpRateLimitGuard implements CanActivate {
  constructor(
    private readonly limits: RateLimitService,
    private readonly metrics: MetricsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const result = this.limits.hit(`http:ip:${request.ip}`, IP_LIMIT, WINDOW_MS);
    void reply.header('x-ratelimit-remaining', String(result.remaining));
    void reply.header('x-ratelimit-reset', String(Math.ceil(result.resetAt / 1_000)));
    if (!result.allowed) {
      this.metrics.increment('http.rate_limit.rejected', { scope: 'ip' });
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Request rate limit exceeded.',
          retryAfterSeconds: Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1_000)),
        },
        429,
      );
    }
    return true;
  }
}
