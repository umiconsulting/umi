import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { decodeJwt, SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { AppConfig } from '../config/config.schema';

/**
 * `mfa_challenge` is the token handed out when a password is correct but the second
 * factor is still outstanding. It is deliberately a THIRD kind and not a short access
 * token: `verify()` below rejects any token whose `typ` is not the one the caller
 * asked for, so a challenge can never be presented to AuthGuard as an access token.
 * That is the whole point — a half-authenticated caller must reach exactly one
 * endpoint, `POST /auth/mfa/verify`, and nothing else.
 */
export type TokenKind = 'access' | 'refresh' | 'mfa_challenge';

/** Verified claims carried by an access token. */
export interface AccessClaims {
  sub: string; // user id
  email: string;
  sessionId: string;
  deviceId: string | null;
}

export interface RefreshClaims {
  sub: string;
  sessionId: string;
}

const ISSUER = 'umi-api';
const AUDIENCE = 'umi-dashboard';

/**
 * JWT signing/verification (D9). HS256 over `JWT_SECRET`. Two token kinds:
 *   - access  (short TTL, `umi_access` cookie) carries {sub, email}
 *   - refresh (long TTL,  `umi_refresh` cookie) carries {sub} only
 * Merchant is intentionally NOT in the token — a user belongs to many merchants and
 * the active merchant is resolved per-request from the route + membership check
 * (MerchantAccessGuard), mirroring the dashboard's per-request `requireMerchantAccess`.
 */
@Injectable()
export class JwtService {
  private readonly logger = new Logger(JwtService.name);
  private readonly secret?: Uint8Array;
  private readonly accessTtl: string;
  private readonly refreshTtl: string;

  constructor(config: ConfigService<AppConfig, true>) {
    const raw = config.get('JWT_SECRET', { infer: true });
    this.secret = raw ? new TextEncoder().encode(raw) : undefined;
    this.accessTtl = config.get('JWT_ACCESS_TTL', { infer: true });
    this.refreshTtl = config.get('JWT_REFRESH_TTL', { infer: true });
  }

  private key(): Uint8Array {
    if (!this.secret) {
      // Misconfiguration, not a client error — fail loudly.
      throw new Error('JWT_SECRET is not configured; auth is unavailable.');
    }
    return this.secret;
  }

  async signAccess(claims: AccessClaims): Promise<string> {
    return this.sign(
      {
        sub: claims.sub,
        email: claims.email,
        sid: claims.sessionId,
        device_id: claims.deviceId,
        typ: 'access',
      },
      this.accessTtl,
    );
  }

  /**
   * A refresh token names its durable session (`sid`) as well as its user. The
   * dashboard stores that id on the `runtime.session` row it opens, and the POS
   * stores it on its device-bound session; both verify the claim against the row.
   * `jti` keeps two tokens for one session distinct even inside one second.
   */
  async signRefresh(userId: string, sessionId: string): Promise<string> {
    return this.sign(
      { sub: userId, sid: sessionId, typ: 'refresh', jti: randomUUID() },
      this.refreshTtl,
    );
  }

  /** Read the expiry from a refresh token this service has just signed. */
  refreshExpiresAt(token: string): Date {
    const { exp } = decodeJwt(token);
    if (typeof exp !== 'number') throw new Error('signed refresh token has no expiry');
    return new Date(exp * 1000);
  }

  /**
   * Mint the half-authenticated token for a pending second factor. The TTL is the
   * caller's, so it matches the lifetime of the code that was mailed — a challenge
   * that outlives its code is a window with nothing behind it.
   */
  async signMfaChallenge(userId: string, ttlSeconds: number): Promise<string> {
    return this.sign({ sub: userId, typ: 'mfa_challenge' }, `${ttlSeconds}s`);
  }

  /** Verify a challenge token, returning the user id. Throws on any failure. */
  async verifyMfaChallenge(token: string): Promise<string> {
    const payload = await this.verify(token, 'mfa_challenge');
    if (typeof payload.sub !== 'string') {
      throw new UnauthorizedException('invalid_token');
    }
    return payload.sub;
  }

  private async sign(payload: JWTPayload & { typ: TokenKind }, ttl: string): Promise<string> {
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime(ttl)
      .sign(this.key());
  }

  /** Verify an access token. Throws UnauthorizedException on any failure. */
  async verifyAccess(token: string): Promise<AccessClaims> {
    const payload = await this.verify(token, 'access');
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.sid !== 'string'
    ) {
      throw new UnauthorizedException('invalid_token');
    }
    return {
      sub: payload.sub,
      email: payload.email,
      sessionId: payload.sid,
      deviceId: typeof payload.device_id === 'string' ? payload.device_id : null,
    };
  }

  /** Verify a refresh token and return its durable session identity. */
  async verifyRefresh(token: string): Promise<RefreshClaims> {
    const payload = await this.verify(token, 'refresh');
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
      throw new UnauthorizedException('invalid_token');
    }
    return { sub: payload.sub, sessionId: payload.sid };
  }

  private async verify(
    token: string,
    expected: TokenKind,
  ): Promise<JWTPayload & { email?: unknown }> {
    // Resolve the key OUTSIDE the try so a missing JWT_SECRET surfaces as a
    // config failure (500), not a blanket 401 on every request.
    const key = this.key();
    try {
      const { payload } = await jwtVerify(token, key, {
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      if (payload.typ !== expected) {
        throw new UnauthorizedException('invalid_token');
      }
      return payload;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      // Expired / bad signature / malformed — all map to 401.
      throw new UnauthorizedException('invalid_token');
    }
  }
}
