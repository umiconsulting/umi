import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { buildCookieOptions, parseDurationSeconds } from './cookies';

function cfg(values: Record<string, unknown>): ConfigService<
  Record<string, unknown>,
  true
> {
  return { get: (k: string) => values[k] } as unknown as ConfigService<
    Record<string, unknown>,
    true
  >;
}

describe('parseDurationSeconds', () => {
  it('parses jose durations', () => {
    expect(parseDurationSeconds('15m')).toBe(900);
    expect(parseDurationSeconds('1h')).toBe(3600);
    expect(parseDurationSeconds('30d')).toBe(2592000);
    expect(parseDurationSeconds('3600s')).toBe(3600);
    expect(parseDurationSeconds('42')).toBe(42);
    expect(parseDurationSeconds('garbage')).toBe(0);
  });
});

describe('buildCookieOptions', () => {
  const base = {
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    COOKIE_SECURE: true,
    COOKIE_SAMESITE: 'lax',
    COOKIE_DOMAIN: '.umiconsulting.co',
  };

  it('makes auth cookies httpOnly and the csrf cookie readable', () => {
    expect(buildCookieOptions(cfg(base), 'access').httpOnly).toBe(true);
    expect(buildCookieOptions(cfg(base), 'refresh').httpOnly).toBe(true);
    expect(buildCookieOptions(cfg(base), 'csrf').httpOnly).toBe(false);
  });

  it('uses the matching TTL for maxAge and carries domain/secure/sameSite', () => {
    const access = buildCookieOptions(cfg(base), 'access');
    expect(access.maxAge).toBe(900);
    expect(access.domain).toBe('.umiconsulting.co');
    expect(access.secure).toBe(true);
    expect(access.sameSite).toBe('lax');
    expect(buildCookieOptions(cfg(base), 'refresh').maxAge).toBe(2592000);
  });

  it('omits domain when unset', () => {
    const opts = buildCookieOptions(cfg({ ...base, COOKIE_DOMAIN: undefined }), 'access');
    expect(opts.domain).toBeUndefined();
  });

  it('drops maxAge (session cookie) when remember is false', () => {
    for (const kind of ['access', 'refresh', 'csrf'] as const) {
      expect(buildCookieOptions(cfg(base), kind, false).maxAge).toBeUndefined();
    }
  });

  it('keeps maxAge (persistent cookie) when remember is true or default', () => {
    expect(buildCookieOptions(cfg(base), 'refresh', true).maxAge).toBe(2592000);
    expect(buildCookieOptions(cfg(base), 'refresh').maxAge).toBe(2592000);
  });
});
