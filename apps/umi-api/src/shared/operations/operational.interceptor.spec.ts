import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { lastValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { runWithRequestContext } from '../database/request-context';
import type { RateLimitService } from '../ratelimit/rate-limit.service';
import { MetricsService } from './metrics.service';
import { OperationalInterceptor } from './operational.interceptor';

describe('OperationalInterceptor', () => {
  it('applies user, device, tenant, and branch budgets after authorization', async () => {
    const hit = vi.fn().mockReturnValue({
      allowed: true,
      remaining: 10,
      resetAt: Date.now() + 60_000,
    });
    const request = {
      method: 'GET',
      ip: '127.0.0.1',
      headers: { 'x-umi-device-id': 'device-1' },
      routeOptions: { url: '/api/tenants/:tenantId/audit' },
      authUser: { id: 'user-1' },
    } as unknown as FastifyRequest;
    const reply = { statusCode: 200, header: vi.fn() } as unknown as FastifyReply;
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
    } as unknown as ExecutionContext;
    const interceptor = new OperationalInterceptor(
      { hit } as unknown as RateLimitService,
      new MetricsService(),
    );
    const next: CallHandler = { handle: () => of('ok') };

    await runWithRequestContext(
      {
        requestId: 'request-1',
        correlationId: 'correlation-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        branchId: 'branch-1',
      },
      () => lastValueFrom(interceptor.intercept(context, next)),
    );

    expect(hit.mock.calls.map(([key]) => key)).toEqual([
      'http:user:user-1',
      'http:device:device-1',
      'http:tenant:tenant-1',
      'http:branch:branch-1',
    ]);
  });
});
