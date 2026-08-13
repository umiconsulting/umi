import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jwtVerify } from 'jose';
import type { AppConfig } from '../config/config.schema';

export interface CustomerClaims {
  /** The customer this token speaks for. */
  subjectId: string;
  /** The café the session belongs to. */
  merchantId: string;
}

/**
 * Verifies a cash CUSTOMER access token.
 *
 * `CustomerSessionService` already SIGNS these; nothing verified them until now,
 * because every customer route umi-api served was public. The wallet download is
 * the first customer-authenticated route here.
 *
 * ⚠️ TWO ISSUERS, TWO CLAIM NAMES. The same `JWT_ACCESS_SECRET` signs tokens from
 * both apps during coexistence, deliberately, so a session survives whichever app
 * the customer reaches. They disagree on one claim name:
 *   - umi-api  `{ sub, role, merchantId }`
 *   - umi-cash `{ sub, role, tenantId }`
 * Both are accepted below. When umi-cash stops issuing customer sessions, the
 * `tenantId` branch can go — and not before, or every customer holding a live
 * umi-cash token is logged out.
 *
 * The algorithm is pinned to HS256. Without it a caller could present an `alg:none`
 * token and authenticate as anyone.
 */
@Injectable()
export class CustomerTokenService {
  private readonly key?: Uint8Array;

  constructor(config: ConfigService<AppConfig, true>) {
    const secret = config.get('JWT_ACCESS_SECRET', { infer: true });
    if (secret) this.key = new TextEncoder().encode(secret);
  }

  async verify(token: string): Promise<CustomerClaims | null> {
    if (!this.key) return null;
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] });
      const claims = payload as {
        sub?: unknown;
        merchantId?: unknown;
        tenantId?: unknown;
      };
      const subjectId = String(claims.sub ?? '');
      const merchantId = String(claims.merchantId ?? claims.tenantId ?? '');
      if (!subjectId || !merchantId) return null;
      return { subjectId, merchantId };
    } catch {
      return null;
    }
  }

  /** Read `Authorization: Bearer <token>` and verify it. */
  async fromHeader(header: string | undefined): Promise<CustomerClaims | null> {
    if (!header?.startsWith('Bearer ')) return null;
    return this.verify(header.slice('Bearer '.length));
  }
}
