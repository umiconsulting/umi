import { Injectable, Logger } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import { HAS_PLATFORM_GRANT, PLATFORM_GRANT_CTE } from './rbac.sql';

export interface UserCredential {
  userId: string;
  email: string;
  displayName: string | null;
  passwordSalt: string;
  passwordHash: string;
  /**
   * Which scheme hashed this row: `scrypt-sha256-v1` (what we write) or
   * `legacy-sha256-v1` (inherited from umi-cash). NULL is treated as legacy.
   * The verifier dispatches on it, and a non-scrypt row is re-hashed on the next
   * successful login — see `PasswordService.needsUpgrade`.
   */
  passwordAlgorithm: string | null;
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
  /** The published URL key. Null for a café created after cutover — route by `id`. */
  handle: string | null;
  name: string;
  roles: string[];
}

export interface MembershipAccess {
  // null for a SYNTHESIZED global-super_admin access (no explicit merchant_access
  // edge in the requested merchant). Only ever surfaced to the client as an
  // informational membership id — never a DB write key.
  membershipId: string | null;
  merchantId: string;
  /** The published URL key. Null for a café created after cutover — route by `id`. */
  handle: string | null;
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
 * ROUTING (P5, done). Everything routes by `id`. `merchant.handle` is the published URL
 * key and nothing else — see the column comment in 20_merchant.sql for the four things
 * that already published a café's name inside a URL. The resolvers below accept a handle
 * because those URLs exist, not because a handle is an identifier.
 *
 * The interim this replaced returned the merchant ID under the name "slug", which was
 * worse than it looked: the dashboard prints that value as the café's public address and
 * builds /logos/{value}-wallet-logo.png from it, so both had been showing and fetching a
 * uuid. Neither failed loudly.
 */
@Injectable()
export class AuthRepository {
  private readonly logger = new Logger(AuthRepository.name);

  constructor(private readonly pg: PgService) {}

  /** Login/forgot — only rows that actually have a local password. */
  async findCredentialByEmail(email: string): Promise<UserCredential | null> {
    const { rows } = await this.pg.query<UserCredential>(
      `SELECT
         u.id::text          AS "userId",
         u.email             AS "email",
         u.full_name         AS "displayName",
         u.password_salt     AS "passwordSalt",
         u.password_hash     AS "passwordHash",
         u.password_algorithm AS "passwordAlgorithm",
         u.mfa_method        AS "mfaMethod"
       FROM umi.user AS u
       WHERE lower(u.email) = $1
         AND u.password_hash IS NOT NULL
       LIMIT 1`,
      [email],
    );
    return rows[0] ?? null;
  }

  /**
   * Replace a credential in place, keeping the SAME password.
   *
   * Called after a legacy row verifies, so the weak `sha256(password + salt)` hash
   * is gone from the moment its owner next signs in. The owner is never told and
   * never has to act, which is the whole reason the backfill can carry the legacy
   * hashes forward instead of forcing a reset.
   *
   * ⚠️ THE SCHEME MOVES WITH THE HASH. Writing a scrypt hash while leaving
   * `password_algorithm` on its old value would send the next login down the
   * sha256 branch against a scrypt hash — locking the account out with no error
   * anywhere. All three columns or none.
   *
   * Best-effort by contract: the caller has already authenticated. A failure here
   * must never turn a good login into a bad one, so the caller does not await it.
   */
  async upgradeCredential(userId: string, salt: string, hash: string): Promise<void> {
    await this.pg.query(
      `UPDATE umi."user"
          SET password_salt = $2,
              password_hash = $3,
              password_algorithm = 'scrypt-sha256-v1',
              updated_at = now()
        WHERE id = $1::uuid`,
      [userId, salt, hash],
    );
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

  /** Start one dashboard refresh-token family. Dashboard sessions have no café scope. */
  async startDashboardSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.pg.query(
      `INSERT INTO runtime.session
         (merchant_id, principal_type, principal_id, token_hash, expires_at, metadata)
       VALUES (NULL, 'user', $1::uuid, $2, $3, '{"client":"dashboard"}'::jsonb)`,
      [userId, tokenHash, expiresAt],
    );
  }

  /**
   * Replace one dashboard refresh token and keep its family link.
   *
   * The row lock makes two uses of one token serial. The first use rotates it.
   * The second use sees a replaced token and revokes the live family as a replay.
   */
  async rotateDashboardSession(
    userId: string,
    currentTokenHash: string,
    nextTokenHash: string,
    nextExpiresAt: Date,
  ): Promise<boolean> {
    return this.pg.workerTx(async (client) => {
      // Token rows change as the chain rotates, but the family id does not. A
      // transaction-level family lock serializes A-replay with B→C rotation as
      // well as two uses of the same token. Hash collisions only serialize two
      // unrelated families; they cannot weaken the revocation guarantee.
      const family = await client.query<{ refresh_family_id: string }>(
        `SELECT refresh_family_id::text,
                pg_advisory_xact_lock(hashtextextended(refresh_family_id::text, 0))
           FROM runtime.session
          WHERE merchant_id IS NULL
            AND principal_type = 'user'
            AND token_hash = $1`,
        [currentTokenHash],
      );
      if (!family.rows[0]) return false;

      const { rows } = await client.query<{
        id: string;
        principal_id: string;
        refresh_family_id: string;
        replaced_by_id: string | null;
        is_active: boolean;
        unexpired: boolean;
      }>(
        `SELECT id::text, principal_id::text, refresh_family_id::text,
                replaced_by_id::text, is_active,
                (expires_at IS NULL OR expires_at > now()) AS unexpired
           FROM runtime.session
          WHERE merchant_id IS NULL
            AND principal_type = 'user'
            AND token_hash = $1`,
        [currentTokenHash],
      );
      const current = rows[0];
      if (!current || current.principal_id !== userId) return false;

      if (!current.is_active || current.replaced_by_id) {
        if (current.replaced_by_id) {
          await client.query(
            `UPDATE runtime.session
                SET is_active = false,
                    revoked_at = now(),
                    revoked_reason = 'refresh_reuse'
              WHERE merchant_id IS NULL
                AND principal_type = 'user'
                AND refresh_family_id = $1::uuid
                AND is_active`,
            [current.refresh_family_id],
          );
        }
        return false;
      }

      if (!current.unexpired) {
        await client.query(
          `UPDATE runtime.session
              SET is_active = false,
                  revoked_at = now(),
                  revoked_reason = 'expired'
            WHERE id = $1::uuid AND is_active`,
          [current.id],
        );
        return false;
      }

      const next = await client.query<{ id: string }>(
        `INSERT INTO runtime.session
           (merchant_id, principal_type, principal_id, token_hash, expires_at,
            refresh_family_id, metadata)
         VALUES (NULL, 'user', $1::uuid, $2, $3, $4::uuid,
                 '{"client":"dashboard"}'::jsonb)
         RETURNING id::text`,
        [userId, nextTokenHash, nextExpiresAt, current.refresh_family_id],
      );
      await client.query(
        `UPDATE runtime.session
            SET is_active = false,
                revoked_at = now(),
                revoked_reason = 'rotated',
                replaced_by_id = $2::uuid
          WHERE id = $1::uuid`,
        [current.id, next.rows[0].id],
      );
      return true;
    });
  }

  /** End every live token in the dashboard family named by this token. */
  async revokeDashboardSession(tokenHash: string): Promise<boolean> {
    return this.pg.workerTx(async (client) => {
      // Use the same stable lock as rotation. A logout with stale token A must
      // serialize with a concurrent refresh of its current replacement B.
      const target = await client.query<{ refresh_family_id: string }>(
        `SELECT refresh_family_id::text,
                pg_advisory_xact_lock(hashtextextended(refresh_family_id::text, 0))
           FROM runtime.session
          WHERE merchant_id IS NULL
            AND principal_type = 'user'
            AND token_hash = $1`,
        [tokenHash],
      );
      const familyId = target.rows[0]?.refresh_family_id;
      if (!familyId) return false;

      const { rows } = await client.query<{ id: string }>(
        `UPDATE runtime.session
            SET is_active = false,
                revoked_at = now(),
                revoked_reason = 'logout'
          WHERE merchant_id IS NULL
            AND principal_type = 'user'
            AND refresh_family_id = $1::uuid
            AND is_active
        RETURNING id::text`,
        [familyId],
      );
      return rows.length > 0;
    });
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
         t.handle   AS "handle",
         t.name     AS "name",
         COALESCE(array_agg(r.key) FILTER (WHERE r.key IS NOT NULL),
                  ARRAY[(SELECT platform_role FROM sa)]) AS "roles"
       FROM merchant.merchant AS t
       LEFT JOIN merchant.staff AS s
         ON s.merchant_id = t.id AND s.user_id = $1::uuid AND s.status = 'active'
       LEFT JOIN umi.role AS r ON r.id = s.role_id
       WHERE t.status = 'active'
         AND (s.id IS NOT NULL OR ${HAS_PLATFORM_GRANT})
       GROUP BY t.id, t.handle, t.name
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
  /**
   * The platform role this user holds, or null. Drives `PlatformAdminGuard`.
   *
   * Reads through `PLATFORM_GRANT_CTE` rather than asking `umi.user_role`
   * directly — the expiry and revocation predicates live in that fragment and
   * nowhere else, and a second copy is how one of them goes missing.
   */
  async platformRole(userId: string): Promise<string | null> {
    const { rows } = await this.pg.query<{ platform_role: string | null }>(
      `WITH ${PLATFORM_GRANT_CTE} SELECT platform_role FROM sa`,
      [userId],
    );
    return rows[0]?.platform_role ?? null;
  }

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
         t.handle    AS "handle",
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

  /**
   * Resolve a merchant id from its published handle, for the `/api/:handle/...` routes
   * that umi-cash and every issued wallet pass already call.
   */
  async merchantIdForHandle(handle: string): Promise<string | null> {
    const { rows } = await this.pg.query<{ id: string }>(
      `SELECT id::text AS id FROM merchant.merchant WHERE handle = $1 LIMIT 1`,
      [handle],
    );
    return rows[0]?.id ?? null;
  }

  /** Resolve merchant id + name from a handle (public routes need the name). */
  async merchantByHandle(
    handle: string,
  ): Promise<{ id: string; name: string; handle: string | null } | null> {
    const { rows } = await this.pg.query<{ id: string; name: string; handle: string | null }>(
      `SELECT id::text AS id, name, handle FROM merchant.merchant WHERE handle = $1 LIMIT 1`,
      [handle],
    );
    return rows[0] ?? null;
  }

  /**
   * The same lookup by id — the path a café created after cutover takes, because it has
   * no handle to be found by.
   */
  async merchantById(
    id: string,
  ): Promise<{ id: string; name: string; handle: string | null } | null> {
    const { rows } = await this.pg.query<{ id: string; name: string; handle: string | null }>(
      `SELECT id::text AS id, name, handle FROM merchant.merchant WHERE id = $1::uuid LIMIT 1`,
      [id],
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

  /**
   * Set a NEW password (reset flow). Always writes scrypt, so it must say so.
   *
   * ⚠️ `password_algorithm` IS NOT OPTIONAL HERE. `this.passwords.hash()` produces
   * scrypt; leaving the column on a row that still reads `legacy-sha256-v1` sends
   * the next login down the sha256 branch against a scrypt hash, which can never
   * match. The owner is then locked out permanently and resetting again does not
   * help, because the reset reproduces the same mismatch.
   *
   * This was latent until the verifier began dispatching on the column. All three
   * columns move together — same rule as {@link upgradeCredential}.
   */
  async updatePassword(userId: string, salt: string, hash: string): Promise<void> {
    await this.pg.query(
      `UPDATE umi.user
       SET password_salt = $2, password_hash = $3,
           password_algorithm = 'scrypt-sha256-v1', updated_at = now()
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
