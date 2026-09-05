import { ForbiddenException, Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import { AuthRepository } from './auth.repository';
import { MfaService } from './mfa.service';
import type { AuthUser } from './auth.types';

/**
 * How long a step-up lasts. Long enough for a support session, short enough that
 * a forgotten tab does not stay privileged: the operator re-proves who they are
 * rather than inheriting authority from a login earlier in the day.
 */
const ELEVATION_MINUTES = 30;

/**
 * Step-up authentication for a platform operator acting inside a merchant they
 * do not work for.
 *
 * The rule this enforces: strong authentication belongs at the door to a
 * merchant, not at the counter. A cashier PIN on a till is explicitly exempt
 * from multi-factor authentication under PCI DSS v4.0 8.4.2 because it sees one
 * card at a time; a super_admin who can become any merchant is not, so the
 * obligation is discharged here — once, at a desk — and the till keeps its PIN.
 */
@Injectable()
export class PlatformElevationService {
  constructor(
    private readonly pg: PgService,
    private readonly mfa: MfaService,
    private readonly repo: AuthRepository,
  ) {}

  /** Sends the operator a one-time code. Reuses the login MFA channel. */
  async challenge(user: AuthUser): Promise<{ issued: true }> {
    // A till token carries no address: it authenticates a person at a café, not
    // a mailbox. Stepping up to act as a merchant is a desk activity and always
    // happens on a dashboard session, so a missing address is a refusal rather
    // than something to work around.
    if (!user.email) {
      throw new ForbiddenException({ code: 'PLATFORM_ELEVATION_UNAVAILABLE' });
    }
    await this.mfa.issueChallenge({
      id: user.id,
      email: user.email,
      displayName: null,
    });
    return { issued: true };
  }

  /**
   * Verifies the code and opens a grant for ONE merchant. Assuming café A must
   * not carry authority into café B, so the grant names the merchant.
   */
  async verify(user: AuthUser, merchantId: string, code: string): Promise<{ expiresAt: string }> {
    await this.mfa.verifyCode(user.id, code);
    const { rows } = await this.pg.query<{ expiresAt: Date }>(
      `INSERT INTO runtime.platform_elevation (user_id, merchant_id, expires_at)
       VALUES ($1::uuid, $2::uuid, now() + ($3 || ' minutes')::interval)
       RETURNING expires_at AS "expiresAt"`,
      [user.id, merchantId, String(ELEVATION_MINUTES)],
    );
    await this.repo.recordSecurityEvent({
      actorUserId: user.id,
      eventType: 'platform.elevation_granted',
      outcome: 'success',
    });
    return { expiresAt: rows[0].expiresAt.toISOString() };
  }

  /** True while the operator holds a live grant for this merchant. */
  async isElevated(userId: string, merchantId: string): Promise<boolean> {
    const { rows } = await this.pg.query<{ ok: boolean }>(
      `SELECT true AS ok FROM runtime.platform_elevation
        WHERE user_id = $1::uuid AND merchant_id = $2::uuid
          AND revoked_at IS NULL AND expires_at > now()
        LIMIT 1`,
      [userId, merchantId],
    );
    return rows.length > 0;
  }

  /** Ends every live grant this operator holds for a merchant. */
  async revoke(userId: string, merchantId: string): Promise<void> {
    await this.pg.query(
      `UPDATE runtime.platform_elevation SET revoked_at = now()
        WHERE user_id = $1::uuid AND merchant_id = $2::uuid AND revoked_at IS NULL`,
      [userId, merchantId],
    );
  }

  /** Throws unless the caller may act on this merchant right now. */
  async assertElevated(userId: string, merchantId: string): Promise<void> {
    if (!(await this.isElevated(userId, merchantId))) {
      throw new ForbiddenException({ code: 'PLATFORM_ELEVATION_REQUIRED' });
    }
  }
}
