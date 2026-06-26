import { describe, expect, it } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from './jwt.service';

function jwtWith(values: Record<string, unknown>): JwtService {
  const config = {
    get: (k: string) => values[k],
  } as unknown as ConfigService<Record<string, unknown>, true>;
  return new JwtService(config);
}

const FULL = {
  JWT_SECRET: 'this-is-a-sufficiently-long-secret',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '30d',
};

describe('JwtService', () => {
  it('signs and verifies an access token round-trip', async () => {
    const svc = jwtWith(FULL);
    const token = await svc.signAccess({ sub: 'u1', email: 'a@b.co' });
    const claims = await svc.verifyAccess(token);
    expect(claims).toEqual({ sub: 'u1', email: 'a@b.co' });
  });

  it('signs and verifies a refresh token round-trip', async () => {
    const svc = jwtWith(FULL);
    const token = await svc.signRefresh('u9');
    expect(await svc.verifyRefresh(token)).toBe('u9');
  });

  it('rejects an access token presented as a refresh token (kind mismatch)', async () => {
    const svc = jwtWith(FULL);
    const access = await svc.signAccess({ sub: 'u1', email: 'a@b.co' });
    await expect(svc.verifyRefresh(access)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token signed with a different secret', async () => {
    const a = jwtWith(FULL);
    const b = jwtWith({ ...FULL, JWT_SECRET: 'a-totally-different-secret-value' });
    const token = await a.signAccess({ sub: 'u1', email: 'a@b.co' });
    await expect(b.verifyAccess(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws a config error (not 401) when JWT_SECRET is missing', async () => {
    const svc = jwtWith({ JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL: '30d' });
    await expect(
      svc.signAccess({ sub: 'u1', email: 'a@b.co' }),
    ).rejects.toThrow(/JWT_SECRET/);
  });
});
