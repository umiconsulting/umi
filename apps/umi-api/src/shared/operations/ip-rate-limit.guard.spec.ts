import { HttpException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { RateLimitService, type RateLimitResult } from '../ratelimit/rate-limit.service';
import { IpRateLimitGuard } from './ip-rate-limit.guard';
import { MetricsService } from './metrics.service';
import type { JwtService } from '../auth/jwt.service';

const ANONYMOUS_CEILING = 300;
const AUTHENTICATED_CEILING = 3_000;
const ADDRESS = '203.0.113.10';

function configService(overrides: Record<string, number> = {}) {
  const values: Record<string, number> = {
    RATE_LIMIT_IP_PER_MINUTE: ANONYMOUS_CEILING,
    RATE_LIMIT_IP_AUTHENTICATED_PER_MINUTE: AUTHENTICATED_CEILING,
    ...overrides,
  };
  return { get: vi.fn((key: string) => values[key]) } as never;
}

function jwtService(sub: string | null) {
  return {
    verifyAccess: vi.fn(async () => {
      if (sub === null) throw new UnauthorizedException('invalid_token');
      return { sub, email: null, sessionId: 's-1', deviceId: null };
    }),
  } as unknown as JwtService;
}

function harness(
  request: Partial<FastifyRequest> & { cookies?: Record<string, string | undefined> },
  limits: { hit: ReturnType<typeof vi.fn> },
  options: { jwt?: JwtService; config?: Record<string, number> } = {},
) {
  const reply = { header: vi.fn() };
  const metrics = new MetricsService();
  const guard = new IpRateLimitGuard(
    limits as unknown as RateLimitService,
    metrics,
    configService(options.config),
    options.jwt ?? jwtService(null),
  );
  const context = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => reply as unknown as FastifyReply,
    }),
  } as unknown as ExecutionContext;
  return { guard, context, reply, metrics };
}

function result(overrides: Partial<RateLimitResult> = {}): RateLimitResult {
  return { allowed: true, remaining: 10, resetAt: Date.now() + 30_000, ...overrides };
}

describe('IpRateLimitGuard', () => {
  it('charges exactly one bucket on the anonymous path — the address, nothing else', async () => {
    const hit = vi.fn().mockReturnValue(result());
    const { guard, context } = harness({ ip: ADDRESS, cookies: {} }, { hit });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(hit).toHaveBeenCalledTimes(1);
    expect(hit).toHaveBeenCalledWith('http:ip:203.0.113.10', 300, 60_000);
  });

  it('fails before route authorization when the IP budget is exhausted', async () => {
    const hit = vi
      .fn()
      .mockReturnValue(result({ allowed: false, remaining: 0, resetAt: Date.now() + 1_000 }));
    const { guard, context } = harness({ ip: ADDRESS, cookies: {} }, { hit });

    await expect(guard.canActivate(context)).rejects.toThrow('Request rate limit exceeded.');
    expect(hit).toHaveBeenCalledWith(`http:ip:${ADDRESS}`, 300, 60_000);
  });

  it('charges exactly one bucket on the authenticated path — the address at the higher ceiling', async () => {
    const hit = vi.fn().mockReturnValue(result({ remaining: 2_999, resetAt: 60_000 }));
    const { guard, context, reply } = harness(
      { ip: ADDRESS, cookies: { umi_access: 'signed' }, headers: {} },
      { hit },
      { jwt: jwtService('user-1') },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);

    // One request, one bucket. `http:user:<id>` is charged by the globally
    // registered `OperationalInterceptor`, never here: a second charge against the
    // same counter would halve the principal's effective 240/min to 120/min.
    expect(hit).toHaveBeenCalledTimes(1);
    expect(hit).toHaveBeenCalledWith(`http:ip:${ADDRESS}`, AUTHENTICATED_CEILING, 60_000);
    expect(hit).not.toHaveBeenCalledWith(
      expect.stringContaining('http:user:'),
      expect.anything(),
      expect.anything(),
    );
    // The header reports the only bucket the guard consulted.
    expect(reply.header).toHaveBeenCalledWith('x-ratelimit-remaining', '2999');
    expect(reply.header).toHaveBeenCalledWith('x-ratelimit-reset', '60');
  });

  it('treats an unverifiable credential as anonymous — the stricter ceiling', async () => {
    const hit = vi.fn().mockReturnValue(result());
    const { guard, context, metrics } = harness(
      { ip: ADDRESS, cookies: { umi_access: 'forged' }, headers: {} },
      { hit },
      { jwt: jwtService(null) },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(hit).toHaveBeenCalledTimes(1);
    expect(hit).toHaveBeenCalledWith(`http:ip:${ADDRESS}`, ANONYMOUS_CEILING, 60_000);
    expect(metrics.snapshot()).toMatchObject({ counters: {} });
  });

  it('reports the address bucket when it rejects', async () => {
    const hit = vi
      .fn()
      .mockReturnValue(result({ allowed: false, remaining: 0, resetAt: Date.now() + 1_000 }));
    const { guard, context, metrics } = harness(
      { ip: ADDRESS, cookies: { umi_access: 'signed' }, headers: {} },
      { hit },
      { jwt: jwtService('user-1') },
    );

    await expect(guard.canActivate(context)).rejects.toThrow('Request rate limit exceeded.');
    expect(metrics.snapshot()).toMatchObject({
      counters: { 'http.rate_limit.rejected{scope=ip_authenticated}': 1 },
    });
  });

  it('applies the configured ceiling to a real burst (3/minute here)', async () => {
    const limits = new RateLimitService();
    const metrics = new MetricsService();
    const guard = new IpRateLimitGuard(
      limits,
      metrics,
      configService({ RATE_LIMIT_IP_AUTHENTICATED_PER_MINUTE: 3 }),
      jwtService('user-1'),
    );
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ ip: ADDRESS, cookies: { umi_access: 'signed' }, headers: {} }),
        getResponse: () => ({ header: vi.fn() }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);

    const rejection = await guard.canActivate(context).then(
      () => null,
      (error: unknown) => error,
    );
    expect(rejection).toBeInstanceOf(HttpException);
    expect((rejection as HttpException).getStatus()).toBe(429);
    expect((rejection as HttpException).getResponse()).toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: expect.any(Number),
    });
    expect(metrics.snapshot()).toMatchObject({
      counters: { 'http.rate_limit.rejected{scope=ip_authenticated}': 1 },
    });
  });
});
