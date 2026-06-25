import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  domain?: string;
  path: string;
  maxAge: number; // seconds
}

/** Parse a jose duration (`15m`, `1h`, `30d`, `3600s`) into seconds. */
export function parseDurationSeconds(input: string): number {
  const m = /^(\d+)\s*(s|m|h|d|w)?$/.exec(input.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  switch (m[2]) {
    case 'm':
      return n * 60;
    case 'h':
      return n * 3600;
    case 'd':
      return n * 86400;
    case 'w':
      return n * 604800;
    default:
      return n; // seconds (or bare number)
  }
}

/**
 * Cookie options for the access/refresh/csrf cookies. Auth cookies are
 * httpOnly; the CSRF cookie is readable (double-submit). `secure`/`sameSite`/
 * `domain` come from config so local http dev can relax them.
 */
export function buildCookieOptions(
  config: ConfigService<AppConfig, true>,
  kind: 'access' | 'refresh' | 'csrf',
): CookieOptions {
  const ttl =
    kind === 'access'
      ? config.get('JWT_ACCESS_TTL', { infer: true })
      : config.get('JWT_REFRESH_TTL', { infer: true });
  const domain = config.get('COOKIE_DOMAIN', { infer: true });
  return {
    httpOnly: kind !== 'csrf',
    secure: config.get('COOKIE_SECURE', { infer: true }),
    sameSite: config.get('COOKIE_SAMESITE', { infer: true }),
    ...(domain ? { domain } : {}),
    path: '/',
    maxAge: parseDurationSeconds(ttl),
  };
}
