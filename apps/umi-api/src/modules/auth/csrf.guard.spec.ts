import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CsrfGuard } from './csrf.guard';

const context = (request: Record<string, unknown>, isPublic = false) =>
  ({
    getType: () => 'http',
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({ getRequest: () => request }),
    __public: isPublic,
  }) as never;

describe('CsrfGuard', () => {
  const reflector = {
    getAllAndOverride: (_key: string, values: unknown[]) =>
      (values[0] as { __public?: boolean })?.__public ?? false,
  };

  it('accepts safe methods and bearer requests', () => {
    const guard = new CsrfGuard(reflector as never);
    expect(guard.canActivate(context({ method: 'GET' }))).toBe(true);
    expect(
      guard.canActivate(
        context({ method: 'POST', headers: { authorization: 'Bearer signed-token' } }),
      ),
    ).toBe(true);
  });

  it('requires the double-submit token for cookie mutations', () => {
    const guard = new CsrfGuard(reflector as never);
    expect(() =>
      guard.canActivate(
        context({ method: 'POST', cookies: { umi_access: 'signed-token', umi_csrf: 'token-a' } }),
      ),
    ).toThrow(ForbiddenException);
    expect(
      guard.canActivate(
        context({
          method: 'POST',
          cookies: { umi_access: 'signed-token', umi_csrf: 'token-a' },
          headers: { 'x-umi-csrf': 'token-a' },
        }),
      ),
    ).toBe(true);
  });

  it('rejects an invalid token and exempts public auth routes', () => {
    const guard = new CsrfGuard(reflector as never);
    expect(() =>
      guard.canActivate(
        context({
          method: 'PATCH',
          cookies: { umi_access: 'signed-token', umi_csrf: 'token-a' },
          headers: { 'x-umi-csrf': 'token-b' },
        }),
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(
        context({
          method: 'POST',
          cookies: { umi_access: 'signed-token', umi_csrf: 'token-a' },
          headers: { authorization: 'Bearer unrelated-token' },
        }),
      ),
    ).toThrow(ForbiddenException);
  });
});
