import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT } from 'jose';
import { PgService } from '../../shared/database/pg.service';
import type { AppConfig } from '../../shared/config/config.schema';

/**
 * Cash CUSTOMER session — ported from umi-cash `createSession`. Signs the
 * customer access (24h, {sub, role, tenantId}) + refresh (30d, {sub}) JWTs with
 * the SAME `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` umi-cash uses (so the token
 * works on umi-cash's customer endpoints during coexistence) and persists the
 * refresh token's SHA-256 HASH to `runtime.session` (build-v2 stores `token_hash`,
 * not the raw token — readers hash-on-lookup). A CUSTOMER session's principal is
 * `principal_type='person'` + `principal_id` = the `tenant.customer.id`; a staff
 * session is `principal_type='user'`. Distinct from the dashboard staff JWT.
 */
@Injectable()
export class CustomerSessionService {
  private readonly accessKey?: Uint8Array;
  private readonly refreshKey?: Uint8Array;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly pg: PgService,
  ) {
    const access = config.get('JWT_ACCESS_SECRET', { infer: true });
    const refresh = config.get('JWT_REFRESH_SECRET', { infer: true });
    if (access) this.accessKey = new TextEncoder().encode(access);
    if (refresh) this.refreshKey = new TextEncoder().encode(refresh);
  }

  async createSession(
    subjectId: string,
    role: string,
    tenantId: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    if (!this.accessKey || !this.refreshKey) {
      throw new Error('JWT_ACCESS_SECRET/JWT_REFRESH_SECRET not configured.');
    }
    // jti makes each token unique even for the same subject within the same
    // second — without it two sessions collide on runtime.session.token_hash's
    // UNIQUE index (e.g. a double-submitted registration), 500ing instead of 409ing.
    const accessToken = await new SignJWT({ sub: subjectId, role, tenantId })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(this.accessKey);
    const refreshToken = await new SignJWT({ sub: subjectId })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(this.refreshKey);

    const isCustomer = role === 'CUSTOMER';
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
    await this.pg.query(
      `INSERT INTO runtime.session
         (business_id, principal_type, principal_id, token_hash, expires_at, is_active)
       VALUES ($1::uuid, $2, $3::uuid, $4, $5, true)`,
      [
        tenantId,
        isCustomer ? 'person' : 'user',
        subjectId,
        tokenHash,
        expiresAt,
      ],
    );
    return { accessToken, refreshToken };
  }
}
