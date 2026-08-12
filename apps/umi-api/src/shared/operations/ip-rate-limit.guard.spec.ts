import type { ExecutionContext } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { RateLimitService } from '../ratelimit/rate-limit.service';
import { IpRateLimitGuard } from './ip-rate-limit.guard';
import { MetricsService } from './metrics.service';

describe('IpRateLimitGuard', () => {
  it('fails before route authorization when the IP budget is exhausted', () => {
    const limits = {
      hit: vi.fn().mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 1_000 }),
    };
    const request = { ip: '203.0.113.10' } as FastifyRequest;
    const reply = { header: vi.fn() } as unknown as FastifyReply;
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
    } as unknown as ExecutionContext;
    const guard = new IpRateLimitGuard(
      limits as unknown as RateLimitService,
      new MetricsService(),
      { get: vi.fn().mockReturnValue(300) } as never,
    );

    expect(() => guard.canActivate(context)).toThrow('Request rate limit exceeded.');
    expect(limits.hit).toHaveBeenCalledWith('http:ip:203.0.113.10', 300, 60_000);
  });
});
