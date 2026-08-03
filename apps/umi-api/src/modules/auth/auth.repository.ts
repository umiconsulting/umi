import { Injectable, Logger } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import { HAS_PLATFORM_GRANT, PLATFORM_GRANT_CTE } from './rbac.sql';

export interface UserCredential {
  userId: string;
  email: string;
  displayName: string | null;
  passwordSalt: string;
  passwordHash: string;
  /** null = no second factor enrolled. 'email_otp' | 'totp'. */
  mfaMethod: string | null;
}

/** A live, unconsumed one-time code. */
export interface OtpRecord {
  id: string;
  userId: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
}

export interface UserSummary {
  userId: string;
  email: string;
  displayName: string | null;
}

export interface MerchantMembershipSummary {
  id: string;
  slug: string;
  name: string;
  roles: string[];
}

export interface MembershipAccess {
  // null for a SYNTHESIZED global-super_admin access (no explicit merchant_access
  // edge in the requested merchant). Only ever surfaced to the client as an
  // informational membership id — never a DB write key.
  membershipId: string | null;
  merchantId: string;
  slug: string;
  name: string;
  timezone: string | null;
  roles: string[];
  permissions: string[];
}

export interface ResetTokenRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface EffectiveEntitlementRecord {
  featureKey: string;
  enabled: boolean;
  limit: number | null;
  subscriptionStatus: string;
}

export interface PosPinStaffRecord {
  staffId: string;
  userId: string;
  email: string;
  displayName: string | null;
  pinSalt: string;
  pinHash: string;
}

/**
 * Auth/membership/entitlement reads. These run BEFORE any merchant RLS context
 * exists (login resolves which merchants a user has), so they use the worker pool
 * (`query`) with explicit parameterized predicates — never `withMerchant`. The
 * worker pool is also MANDATORY here because the entitlement + RBAC-policy sources
 * (`umi.effective_entitlement`, `umi.role_permission`) live in the SEALED `umi`
 * schema that `umi_app` has no USAGE on.
 *
 * build-v3 model: staff credentials + identity live on `umi.user` (email + hash +
 * `full_name`); a café grant is `merchant.staff` (the employment, FK role_id) read
 * against the sealed `umi.role_permission` (role_id×permission_id) catalog.
 * `super_admin` is Umi's cross-merchant operator: a user holding a `umi.user_role`
 * with role `super_admin` can select/access EVERY active merchant.
 *
 * TWO grant tables, one per SCOPE, never overlapping:
 *   merchant.staff   the employment, and the café role on it. Every human who works a
 *                    café has one; a PIN-only operator's `umi.user` simply carries no
 *                    email and no password. A membership IS an employment — there is
 *                    no third table for it, which is why this replaced the old
 *                    `umi.user_role` café grant: that was (user, role, merchant,
 *                    location) and this is (user, merchant, location).
 *   umi.user_role    the PLATFORM grant, and nothing else: Umi's own operators, who
 *                    are employees of no café.
 *
 * STILL PENDING (P5, "route by id"): `merchantIdForSlug` / `merchantBySlug` read the
 * dropped `slug` column, and the queries above return the merchant id AS "slug" as an
 * interim. Closing both halves changes the /me/merchants + merchant-access API contract,
 * so it lands as a coordinated @umi/contract release with the dashboard.
 */
@Injectable()
export class AuthRepository {
  private readonly logger = new Logger(AuthRepository.name);

  constructor(private readonly pg: PgService) {}

  async effectiveEntitlement(
    merchantId: string,
    productKey: string,
  ): Promise<EffectiveEntitlementRecord | null> {
    const { rows } = await this.pg.query<EffectiveEntitlementRecord>(
      `SELECT ee.feature_key AS "featureKey", ee.enabled,
              ee.limit_value AS "limit", s.status AS "subscriptionStatus"
         FROM umi.effective_entitlement AS ee
         JOIN umi.subscription AS s ON s.merchant_id = ee.merchant_id
        WHERE ee.merchant_id = $1::uuid
          AND ee.feature_key = $2
        LIMIT 1`,
      [merchantId, productKey],
    );
    return rows[0] ?? null;
  }

  async findPosPinStaff(
    merchantId: string,
    locationId: string,
    lookupHash: string,
  ): Promise<PosPinStaffRecord | null> {
    const { rows } = await this.pg.query<PosPinStaffRecord>(
      `SELECT s.id::text AS "staffId", s.user_id::text AS "userId",
              COALESCE(u.email, s.email) AS email,
              COALESCE(u.full_name, s.name) AS "displayName",
              s.operator_pin_salt AS "pinSalt",
              s.operator_pin_hash AS "pinHash"
         FROM merchant.staff AS s
         JOIN umi.user AS u ON u.id = s.user_id AND u.status = 'active'
         JOIN merchant.location AS l
           ON l.id = $2::uuid AND l.merchant_id = s.merchant_id
        WHERE s.merchant_id = $1::uuid
          AND s.status = 'active'
          AND (s.location_id IS NULL OR s.location_id = l.id)
          AND s.operator_pin_lookup = $3
          AND s.operator_pin_salt IS NOT NULL
          AND s.operator_pin_hash IS NOT NULL
        LIMIT 1`,
      [merchantId, locationId, lookupHash],
    );
    return rows[0] ?? null;
  }

  async validatePosDevice(input: {
    deviceId: string;
    merchantId: string;
    locationId: string;
    installationHash: string;
    credentialHash: string;
  }): Promise<boolean> {
    const { rows } = await this.pg.query<{ allowed: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM merchant.device AS d
          WHERE d.id = $1::uuid
            AND d.merchant_id = $2::uuid
            AND d.location_id = $3::uuid
            AND d.kind = 'pos_terminal'
            AND d.status = 'active'
            AND d.installation_hash = $4
            AND d.credential_hash = $5
       ) AS allowed`,
      [
        input.deviceId,
        input.merchantId,
        input.locationId,
        input.installationHash,
        input.credentialHash,
      ],
    );
    return rows[0]?.allowed === true;
  }

  async recordPosPinFailure(deviceId: string): Promise<void> {
    await this.pg.query(
      `UPDATE merchant.device
          SET pin_failed_attempts = least(pin_failed_attempts + 1, 10),
              pin_locked_until = CASE
                WHEN pin_failed_attempts + 1 >= 5 THEN now() + interval '15 minutes'
                ELSE pin_locked_until
              END,
              updated_at = now()
        WHERE id = $1::uuid`,
      [deviceId],
    );
  }

  async clearPosPinFailures(deviceId: string): Promise<void> {
    await this.pg.query(
      `UPDATE merchant.device
          SET pin_failed_attempts = 0, pin_locked_until = null, updated_at = now()
        WHERE id = $1::uuid`,
      [deviceId],
    );
  }

  async createPosSession(input: {
    id: string;
    merchantId: string;
    locationId: string;
    userId: string;
    deviceId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.pg.query(
      `INSERT INTO runtime.session
         (id, merchant_id, principal_type, principal_id, token_hash, metadata, expires_at)
       VALUES ($1::uuid, $2::uuid, 'device', $3::uuid, $4,
               jsonb_build_object('app','pos','operatorUserId',$5::text,'locationId',$6::text), $7)`,
      [
        input.id,
        input.merchantId,
        input.deviceId,
        input.tokenHash,
        input.userId,
        input.locationId,
        input.expiresAt,
      ],
    );
  }

  async validatePosSession(input: {
    sessionId: string;
    userId: string;
    installationHash: string;
    credentialHash: string;
  }): Promise<{ deviceId: string } | null> {
    const { rows } = await this.pg.worker.query<{ deviceId: string }>(
      `SELECT d.id::text AS "deviceId"
       FROM runtime.session s
       JOIN merchant.device d
         ON s.principal_type='device' AND d.id=s.principal_id
        AND d.merchant_id=s.merchant_id
       WHERE s.id=$1::uuid AND s.is_active AND s.expires_at>now()
         AND s.metadata->>'app'='pos'
         AND s.metadata->>'operatorUserId'=$2
         AND d.status='active'
         AND d.installation_hash=$3
         AND d.credential_hash=$4
       LIMIT 1`,
      [input.sessionId, input.userId, input.installationHash, input.credentialHash],
    );
    return rows[0] ?? null;
  }

  async rotatePosSessionToken(sessionId: string, tokenHash: string): Promise<boolean> {
    const { rowCount } = await this.pg.worker.query(
      `UPDATE runtime.session
       SET token_hash=$2, last_used_at=now()
       WHERE id=$1::uuid AND principal_type='device' AND is_active AND expires_at>now()`,
      [sessionId, tokenHash],
    );
    return rowCount === 1;
  }

  async revokePosSession(sessionId: string, userId: string, tokenHash: string): Promise<void> {
    await this.pg.worker.query(
      `WITH revoked AS (
         UPDATE runtime.session
         SET is_active=false, revoked_at=now(), revoked_reason='operator_logout'
         WHERE id=$1::uuid AND principal_type='device' AND token_hash=$3
           AND metadata->>'operatorUserId'=$2 AND is_active
         RETURNING id
       )
       UPDATE runtime.operator_session
       SET state='ended',ended_at=now(),last_activity_at=now()
       WHERE durable_session_id IN (SELECT id FROM revoked) AND state<>'ended'`,
      [sessionId, userId, tokenHash],
    );
  }

  async revokePosSessionsForOperator(
    userId: string,
    exceptSessionId: string | null,
  ): Promise<void> {
    await this.pg.worker.query(
      `WITH revoked AS (
         UPDATE runtime.session
         SET is_active=false, revoked_at=now(), revoked_reason='operator_global_logout'
         WHERE principal_type='device' AND metadata->>'app'='pos'
           AND metadata->>'operatorUserId'=$1 AND is_active
           AND ($2::uuid IS NULL OR id<>$2::uuid)
         RETURNING id
       )
       UPDATE runtime.operator_session
       SET state='ended',ended_at=now(),last_activity_at=now()
       WHERE durable_session_id IN (SELECT id FROM revoked) AND state<>'ended'`,
      [userId, exceptSessionId],
    );
  }

  /** Login/forgot — only rows that actually have a local password. */
  async findCredentialByEmail(email: string): Promise<UserCredential | null> {
    const { rows } = await this.pg.query<UserCredential>(
      `SELECT
         u.id::text          AS "userId",
         u.email             AS "email",
         u.full_name         AS "displayName",
         u.password_salt     AS "passwordSalt",
         u.password_hash     AS "passwordHash",
         u.mfa_method        AS "mfaMethod"
       FROM umi.user AS u
       WHERE lower(u.email) = $1
         AND u.password_hash IS NOT NULL
       LIMIT 1`,
      [email],
    );
    return rows[0] ?? null;
  }

  // ── Second factor ──────────────────────────────────────────────────────────
  // All three run on the worker pool for the same reason the credential read does:
  // there is no merchant context yet. A half-authenticated caller has not chosen a
  // café and may not belong to one.

  /**
   * Burn every live code for this user, then store the new one. ONE statement, so a
   * second login cannot race between the delete and the insert and leave two live
   * codes — which would double an attacker's guessing budget for free.
   */
  async replaceMfaOtp(userId: string, codeHash: string, expiresAt: Date): Promise<void> {
    await this.pg.query(
      `WITH burned AS (
         UPDATE runtime.otp
            SET consumed_at = now()
          WHERE user_id = $1::uuid AND purpose = 'mfa' AND consumed_at IS NULL
       )
       INSERT INTO runtime.otp (user_id, purpose, code_hash, expires_at)
       VALUES ($1::uuid, 'mfa', $2, $3)`,
      [userId, codeHash, expiresAt],
    );
  }

  /** The one live code for this user, if any. */
  async findLiveMfaOtp(userId: string): Promise<OtpRecord | null> {
    const { rows } = await this.pg.query<OtpRecord>(
      `SELECT id::text AS "id", user_id::text AS "userId", code_hash AS "codeHash",
              attempts AS "attempts", expires_at AS "expiresAt"
         FROM runtime.otp
        WHERE user_id = $1::uuid AND purpose = 'mfa'
          AND consumed_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  /**
   * Count one wrong guess, and burn the code when it reaches the ceiling. Returning
   * the new count lets the caller tell "wrong, try again" from "that code is dead".
   */
  async recordMfaOtpFailure(otpId: string, maxAttempts: number): Promise<number> {
    const { rows } = await this.pg.query<{ attempts: number }>(
      `UPDATE runtime.otp
          SET attempts    = attempts + 1,
              consumed_at = CASE WHEN attempts + 1 >= $2 THEN now() ELSE consumed_at END
        WHERE id = $1::uuid
        RETURNING attempts`,
      [otpId, maxAttempts],
    );
    return rows[0]?.attempts ?? maxAttempts;
  }

  /**
   * Consume the code. The `consumed_at IS NULL` predicate is the single-use guarantee:
   * two concurrent verifications of the same correct code both UPDATE, but only one
   * matches the predicate and returns a row.
   */
  async consumeMfaOtp(otpId: string): Promise<boolean> {
    const { rows } = await this.pg.query<{ id: string }>(
      `UPDATE runtime.otp SET consumed_at = now()
        WHERE id = $1::uuid AND consumed_at IS NULL
        RETURNING id::text AS id`,
      [otpId],
    );
    return rows.length > 0;
  }

  /**
   * Append one row to the internal security log. THE FIRST WRITER this table has had:
   * `runtime.security_audit_event` shipped with build-v3 and nothing ever inserted into
   * it, which is indistinguishable from "nothing bad happened" right up to the moment
   * somebody asks.
   *
   * NEVER THROWS. An audit write must not be able to fail a login, and it must not be
   * able to turn a rejected code into a 500 that tells the caller their guess was
   * interesting. A failure here is logged and swallowed.
   *
   * Worker pool: the table is sealed from `api`, and there is no merchant context at
   * login anyway — the caller has not chosen a café and may not belong to one.
   */
  async recordSecurityEvent(event: {
    actorUserId: string | null;
    eventType: string;
    outcome: 'success' | 'denied' | 'failure';
    reasonCode?: string;
    requestId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.pg.query(
        `INSERT INTO runtime.security_audit_event
           (actor_user_id, event_type, entity_type, outcome, reason_code, request_id, metadata)
         VALUES ($1::uuid, $2, 'umi.user', $3, $4, $5, $6::jsonb)`,
        [
          event.actorUserId,
          event.eventType,
          event.outcome,
          event.reasonCode ?? null,
          event.requestId ?? null,
          JSON.stringify(event.metadata ?? {}),
        ],
      );
    } catch (err) {
      this.logger.error(
        `security_audit_write_failed type=${event.eventType} ${(err as Error).message}`,
      );
    }
  }

  /** Refresh — re-load the user so a rotated access token carries fresh email. */
  async findUserById(userId: string): Promise<UserSummary | null> {
    const { rows } = await this.pg.query<UserSummary>(
      `SELECT u.id::text AS "userId", u.email, u.full_name AS "displayName"
       FROM umi.user AS u
       WHERE u.id = $1::uuid AND u.password_hash IS NOT NULL
       LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  /**
   * Active merchant memberships + role for the login response body / merchant picker.
   * One employment per (login, merchant), so one café role. A platform operator sees
   * EVERY active merchant, tagged with their café role where an employment exists,
   * else with the platform role itself.
   *
   * This is the REACH half of a platform grant, and it is deliberately unchanged by the
   * move away from the `['*']` wildcard. Hopping between cafés is what makes debugging
   * quick; what an operator may DO once inside is a separate question, answered by
   * findMembershipAccess below.
   */
  async findMerchantsForUser(userId: string): Promise<MerchantMembershipSummary[]> {
    const { rows } = await this.pg.query<MerchantMembershipSummary>(
      `WITH ${PLATFORM_GRANT_CTE}
       SELECT
         t.id::text AS "id",
         t.id::text AS "slug",
         t.name     AS "name",
         COALESCE(array_agg(r.key) FILTER (WHERE r.key IS NOT NULL),
                  ARRAY[(SELECT platform_role FROM sa)]) AS "roles"
       FROM merchant.merchant AS t
       LEFT JOIN merchant.staff AS s
         ON s.merchant_id = t.id AND s.user_id = $1::uuid AND s.status = 'active'
       LEFT JOIN umi.role AS r ON r.id = s.role_id
       WHERE t.status = 'active'
         AND (s.id IS NOT NULL OR ${HAS_PLATFORM_GRANT})
       GROUP BY t.id, t.name
       ORDER BY t.name`,
      [userId],
    );
    return rows;
  }

  /**
   * Membership + role + permissions for one (user, merchant). Drives
   * MerchantAccessGuard. Null ⇒ no active access (404 merchant_not_found).
   *
   * Permissions come from the sealed `umi.role_permission` catalog, and NOW THAT IS THE
   * ONLY SOURCE. `effectivePermissions` used to convert super_admin into `['*']`, which
   * meant a platform operator held every permission key in the catalog — including keys
   * added long after the grant. Eight POS keys arrived that way in July 2026 with no
   * review. So the permission subquery reads BOTH the café role and the platform role,
   * and `seed_rbac.sql` names super_admin's permissions one by one.
   *
   * A platform operator with no employment here still gets access (never 404 Umi's own
   * operator) and is tagged with their platform role.
   */
  async findMembershipAccess(userId: string, merchantId: string): Promise<MembershipAccess | null> {
    const { rows } = await this.pg.query<MembershipAccess>(
      `WITH ${PLATFORM_GRANT_CTE},
       grants AS (
         -- The café grant, and only that. The platform role is added separately below,
         -- because it is not an employment and has no merchant.staff row to come from.
         -- A disabled employment grants nothing, so status is part of the predicate.
         SELECT s.id, r.key AS role_key
         FROM merchant.staff AS s
         JOIN umi.role AS r ON r.id = s.role_id
         WHERE s.user_id = $1::uuid
           AND s.merchant_id = $2::uuid
           AND s.status = 'active'
       )
       SELECT
         (SELECT id::text FROM grants ORDER BY id LIMIT 1) AS "membershipId",
         t.id::text  AS "merchantId",
         t.id::text  AS "slug",
         t.name      AS "name",
         t.timezone  AS "timezone",
         COALESCE((SELECT array_agg(role_key) FROM grants),
                  ARRAY[(SELECT platform_role FROM sa)]) AS "roles",
         COALESCE(
           (SELECT array_agg(DISTINCT p.key)
              FROM umi.role_permission AS rp
              JOIN umi.role AS r        ON r.id = rp.role_id
              JOIN umi.permission AS p  ON p.id = rp.permission_id
             -- The union is deliberate. Someone who is 'staff' at this café AND holds a
             -- platform grant gets both sets, not the lesser of the two.
             WHERE r.key IN (SELECT role_key FROM grants)
                OR r.key = (SELECT platform_role FROM sa)),
           '{}'
         ) AS "permissions"
       FROM merchant.merchant AS t
       WHERE t.id = $2::uuid
         AND t.status = 'active'
         AND (EXISTS (SELECT 1 FROM grants) OR ${HAS_PLATFORM_GRANT})
       LIMIT 1`,
      [userId, merchantId],
    );
    return rows[0] ?? null;
  }

  /** Resolve a merchant id from its slug (for the legacy `/:slug/...` routes). */
  async merchantIdForSlug(slug: string): Promise<string | null> {
    const { rows } = await this.pg.query<{ id: string }>(
      `SELECT id::text AS id FROM merchant.merchant WHERE slug = $1 LIMIT 1`,
      [slug],
    );
    return rows[0]?.id ?? null;
  }

  /** Resolve merchant id + name from a slug (public routes need the name). */
  async merchantBySlug(slug: string): Promise<{ id: string; name: string; slug: string } | null> {
    const { rows } = await this.pg.query<{ id: string; name: string; slug: string }>(
      `SELECT id::text AS id, name, slug FROM merchant.merchant WHERE slug = $1 LIMIT 1`,
      [slug],
    );
    return rows[0] ?? null;
  }

  /**
   * Merchant-level product entitlement status — the SINGLE SOURCE is the derived
   * `umi.effective_entitlement` view (plan_feature overlaid by override, already
   * filtered to trialing/active subscriptions). A feature is entitled iff an
   * `enabled` row exists for it; we join `umi.subscription` back for the café's
   * real status so the guard keeps its `active`/`trialing` vocabulary. Read on the
   * worker pool, which is BYPASSRLS — the view is `security_invoker`, so RLS does
   * NOT scope it here; the explicit `merchant_id` predicate does. Returns null when
   * the feature is absent/disabled (→ `product_not_active`).
   */
  async productStatus(merchantId: string, productKey: string): Promise<string | null> {
    const { rows } = await this.pg.query<{ status: string }>(
      `SELECT s.status
         FROM umi.effective_entitlement AS ee
         JOIN umi.subscription          AS s ON s.merchant_id = ee.merchant_id
        WHERE ee.merchant_id = $1::uuid
          AND ee.feature_key = $2
          AND ee.enabled
        LIMIT 1`,
      [merchantId, productKey],
    );
    return rows[0]?.status ?? null;
  }

  // ── password reset (runtime.password_reset_token, user-keyed) ──
  async insertResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.pg.query(
      `INSERT INTO runtime.password_reset_token (user_id, token_hash, expires_at)
       VALUES ($1::uuid, $2, $3)`,
      [userId, tokenHash, expiresAt],
    );
  }

  async findResetToken(tokenHash: string): Promise<ResetTokenRecord | null> {
    const { rows } = await this.pg.query<ResetTokenRecord>(
      `SELECT id::text, user_id::text AS "userId",
              expires_at AS "expiresAt", used_at AS "usedAt"
       FROM runtime.password_reset_token
       WHERE token_hash = $1
       LIMIT 1`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  async updatePassword(userId: string, salt: string, hash: string): Promise<void> {
    await this.pg.query(
      `UPDATE umi.user
       SET password_salt = $2, password_hash = $3, updated_at = now()
       WHERE id = $1::uuid`,
      [userId, salt, hash],
    );
  }

  async markResetTokenUsed(tokenId: string): Promise<void> {
    await this.pg.query(
      `UPDATE runtime.password_reset_token SET used_at = now() WHERE id = $1::uuid`,
      [tokenId],
    );
  }
}
