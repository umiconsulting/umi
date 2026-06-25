import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { AppConfig } from '../config/config.schema';

export type TokenKind = 'access' | 'refresh';

/** Verified claims carried by an access token. */
export interface AccessClaims {
  sub: string; // user id
  email: string;
}

const ISSUER = 'umi-api';
const AUDIENCE = 'umi-dashboard';

/**
 * JWT signing/verification (D9). HS256 over `JWT_SECRET`. Two token kinds:
 *   - access  (short TTL, `umi_access` cookie) carries {sub, email}
 *   - refresh (long TTL,  `umi_refresh` cookie) carries {sub} only
 * Tenant is intentionally NOT in the token — a user belongs to many tenants and
 * the active tenant is resolved per-request from the route + membership check
 * (TenantAccessGuard), mirroring the dashboard's per-request `requireTenantAccess`.
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
    return this.sign({ ...claims, typ: 'access' }, this.accessTtl);
  }

  async signRefresh(userId: string): Promise<string> {
    return this.sign({ sub: userId, typ: 'refresh' }, this.refreshTtl);
  }

  private async sign(
    payload: JWTPayload & { typ: TokenKind },
    ttl: string,
  ): Promise<string> {
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
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
      throw new UnauthorizedException('invalid_token');
    }
    return { sub: payload.sub, email: payload.email };
  }

  /** Verify a refresh token, returning the user id. */
  async verifyRefresh(token: string): Promise<string> {
    const payload = await this.verify(token, 'refresh');
    if (typeof payload.sub !== 'string') {
      throw new UnauthorizedException('invalid_token');
    }
    return payload.sub;
  }

  private async verify(
    token: string,
    expected: TokenKind,
  ): Promise<JWTPayload & { email?: unknown }> {
    try {
      const { payload } = await jwtVerify(token, this.key(), {
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
