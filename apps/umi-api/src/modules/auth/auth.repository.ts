import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import { SUPER_ADMIN_SA_CTE } from './rbac.sql';
import type { TenantMembership } from '@umi/contract';

export interface UserCredential {
  userId: string;
  email: string;
  displayName: string | null;
  passwordSalt: string;
  passwordHash: string;
}

export interface UserSummary {
  userId: string;
  email: string;
  displayName: string | null;
}

export interface MembershipAccess {
  // null for a SYNTHESIZED global-super_admin access (no explicit tenant_access
  // edge in the requested tenant). Only ever surfaced to the client as an
  // informational membership id — never a DB write key.
  membershipId: string | null;
  tenantId: string;
  slug: string;
  name: string;
  timezone: string | null;
  roles: string[];
  permissions: string[];
  deniedPermissions: string[];
  branchIds: string[];
  allBranches: boolean;
}

export interface ResetTokenRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface SessionRecord {
  id: string;
  userId: string;
  deviceId: string | null;
  app: 'dashboard' | 'kds' | 'pos';
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
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
  failedAttempts: number;
  lockedUntil: Date | null;
}

/**
 * Auth/membership/entitlement reads. These run BEFORE any tenant RLS context
 * exists (login resolves which tenants a user has), so they use the worker pool
 * (`query`) with explicit parameterized predicates — never `withTenant`. The
 * worker pool is also MANDATORY here because the entitlement + RBAC-policy sources
 * (`umi.effective_entitlement`, `umi.role_permission`) live in the SEALED `umi`
 * schema that `umi_app` has no USAGE on.
 *
 * build-v3 model: staff credentials + identity live on `umi.user` (email + hash +
 * `full_name`); grants are `umi.user_role` (user×role×business, FK role_id) read
 * against the sealed `umi.role_permission` (role_id×permission_id) catalog.
 * `super_admin` is Umi's cross-tenant operator: a user holding ANY `umi.user_role`
 * with role `super_admin` can select/access EVERY active business.
 *
 * DONE: `findTenantsForUser` / `findMembershipAccess` now read `umi.user_role` joined
 * to the `umi.role` catalog (multi-role, aggregated), and a `business_id IS NULL`
 * grant is platform-wide.
 *
 * STILL PENDING (P5, "route by id"): `tenantIdForSlug` / `tenantBySlug` read the
 * dropped `slug` column, and the queries above return the business id AS "slug" as an
 * interim. Closing both halves changes the /me/tenants + tenant-access API contract,
 * so it lands as a coordinated @umi/contract release with the dashboard.
 */
@Injectable()
export class AuthRepository {
  constructor(private readonly pg: PgService) {}

  /** Login/forgot — only rows that actually have a local password. */
  async findCredentialByEmail(email: string): Promise<UserCredential | null> {
    const { rows } = await this.pg.query<UserCredential>(
      `SELECT
         u.id::text          AS "userId",
         u.email             AS "email",
         u.full_name         AS "displayName",
         u.password_salt     AS "passwordSalt",
         u.password_hash     AS "passwordHash"
       FROM umi.user AS u
       WHERE lower(u.email) = $1
         AND u.password_hash IS NOT NULL
         AND u.status = 'active'
       LIMIT 1`,
      [email],
    );
    return rows[0] ?? null;
  }

  /** Refresh — re-load the user so a rotated access token carries fresh email. */
  async findUserById(userId: string): Promise<UserSummary | null> {
    const { rows } = await this.pg.query<UserSummary>(
      `SELECT u.id::text AS "userId", u.email, u.full_name AS "displayName"
       FROM umi.user AS u
       WHERE u.id = $1::uuid AND u.password_hash IS NOT NULL AND u.status = 'active'
       LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  /**
   * Active tenant memberships + role for the login response body / tenant picker.
   * Single role per (login, tenant) now. A global super_admin (any active
   * super_admin edge) sees EVERY active tenant, tagged with its explicit role
   * where one exists, else 'super_admin'.
   */
  async findTenantsForUser(userId: string): Promise<TenantMembership[]> {
    const { rows } = await this.pg.query<TenantMembership>(
      `WITH ${SUPER_ADMIN_SA_CTE}
       SELECT
         t.id::text AS "id",
         t.id::text AS "slug",
         t.name     AS "name",
         COALESCE(array_agg(r.key) FILTER (WHERE r.key IS NOT NULL),
                  ARRAY['super_admin']) AS "roles"
       FROM tenant.business AS t
       LEFT JOIN umi.user_role AS ur
         ON ur.business_id = t.id AND ur.user_id = $1::uuid
       LEFT JOIN umi.role AS r ON r.id = ur.role_id
       WHERE t.status = 'active'
         AND (ur.id IS NOT NULL OR (SELECT is_sa FROM sa))
       GROUP BY t.id, t.name
       ORDER BY t.name`,
      [userId],
    );
    return rows;
  }

  /**
   * Membership + role + permissions for one (user, tenant). Drives
   * TenantAccessGuard. Null ⇒ no active access (404 tenant_not_found).
   * Permissions come from the sealed `umi.role_permission` catalog. A global
   * super_admin with no explicit edge here is SYNTHESIZED as
   * {membershipId:null, role:'super_admin', permissions:['*']} so the guard
   * grants it (never 404s Umi's own operator).
   */
  async findMembershipAccess(userId: string, tenantId: string): Promise<MembershipAccess | null> {
    const { rows } = await this.pg.query<MembershipAccess>(
      `WITH ${SUPER_ADMIN_SA_CTE},
       grants AS (
         -- business_id IS NULL is a PLATFORM-WIDE grant (umi.user_role: 'NULL =
         -- platform-wide grant (superadmin)'), so it applies to every business —
         -- otherwise a super_admin would be capped by whatever lesser role they happen
         -- to hold on a given café, or locked out of one they hold no grant on.
         SELECT ur.id, ur.branch_id, r.key AS role_key
         FROM umi.user_role AS ur
         JOIN umi.role AS r ON r.id = ur.role_id
         WHERE ur.user_id = $1::uuid
           AND (ur.business_id = $2::uuid OR ur.business_id IS NULL)
       )
       SELECT
         (SELECT id::text FROM grants ORDER BY id LIMIT 1) AS "membershipId",
         t.id::text  AS "tenantId",
         t.id::text  AS "slug",
         t.name      AS "name",
         t.timezone  AS "timezone",
         COALESCE((SELECT array_agg(role_key) FROM grants),
                  ARRAY['super_admin']) AS "roles",
         COALESCE(
           (SELECT array_agg(DISTINCT branch_id::text)
              FROM grants WHERE branch_id IS NOT NULL),
           '{}'
         ) AS "branchIds",
         COALESCE((SELECT bool_or(branch_id IS NULL) FROM grants), (SELECT is_sa FROM sa))
           AS "allBranches",
         COALESCE(
           (SELECT array_agg(DISTINCT p.key)
              FROM umi.role_permission AS rp
              JOIN umi.role AS r        ON r.id = rp.role_id
              JOIN umi.permission AS p  ON p.id = rp.permission_id
             WHERE r.key IN (SELECT role_key FROM grants)),
           '{}'
         ) AS "permissions",
         COALESCE(
           (SELECT array_agg(DISTINCT p.key)
              FROM umi.user_permission_override AS upo
              JOIN umi.permission AS p ON p.id = upo.permission_id
             WHERE upo.user_id = $1::uuid
               AND (upo.business_id = $2::uuid OR upo.business_id IS NULL)
               AND upo.branch_id IS NULL
               AND upo.effect = 'deny'
               AND (upo.expires_at IS NULL OR upo.expires_at > now())),
           '{}'
         ) AS "deniedPermissions"
       FROM tenant.business AS t
       WHERE t.id = $2::uuid
         AND t.status = 'active'
         AND (EXISTS (SELECT 1 FROM grants) OR (SELECT is_sa FROM sa))
       LIMIT 1`,
      [userId, tenantId],
    );
    return rows[0] ?? null;
  }

  async branchBelongsToTenant(branchId: string, tenantId: string): Promise<boolean> {
    const { rows } = await this.pg.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM tenant.branch
         WHERE id = $1::uuid AND business_id = $2::uuid
       ) AS "exists"`,
      [branchId, tenantId],
    );
    return rows[0]?.exists === true;
  }

  async deniedPermissions(
    userId: string,
    tenantId: string,
    branchId: string | null,
  ): Promise<string[]> {
    const { rows } = await this.pg.query<{ key: string }>(
      `SELECT DISTINCT p.key
       FROM umi.user_permission_override AS upo
       JOIN umi.permission AS p ON p.id = upo.permission_id
       WHERE upo.user_id = $1::uuid
         AND (upo.business_id = $2::uuid OR upo.business_id IS NULL)
         AND (upo.branch_id IS NULL OR upo.branch_id = $3::uuid)
         AND upo.effect = 'deny'
         AND (upo.expires_at IS NULL OR upo.expires_at > now())`,
      [userId, tenantId, branchId],
    );
    return rows.map((row) => row.key);
  }

  async allowedPermissions(
    userId: string,
    tenantId: string,
    branchId: string | null,
  ): Promise<string[]> {
    const { rows } = await this.pg.query<{ key: string }>(
      `SELECT DISTINCT p.key
       FROM umi.user_permission_override AS upo
       JOIN umi.permission AS p ON p.id = upo.permission_id
       WHERE upo.user_id = $1::uuid
         AND (upo.business_id = $2::uuid OR upo.business_id IS NULL)
         AND (upo.branch_id IS NULL OR upo.branch_id = $3::uuid)
         AND upo.effect = 'allow'
         AND (upo.expires_at IS NULL OR upo.expires_at > now())`,
      [userId, tenantId, branchId],
    );
    return rows.map((row) => row.key);
  }

  /** Resolve a tenant id from its slug (for the legacy `/:slug/...` routes). */
  async tenantIdForSlug(slug: string): Promise<string | null> {
    const { rows } = await this.pg.query<{ id: string }>(
      `SELECT id::text AS id FROM tenant.business WHERE slug = $1 LIMIT 1`,
      [slug],
    );
    return rows[0]?.id ?? null;
  }

  /** Resolve tenant id + name from a slug (public routes need the name). */
  async tenantBySlug(slug: string): Promise<{ id: string; name: string; slug: string } | null> {
    const { rows } = await this.pg.query<{ id: string; name: string; slug: string }>(
      `SELECT id::text AS id, name, slug FROM tenant.business WHERE slug = $1 LIMIT 1`,
      [slug],
    );
    return rows[0] ?? null;
  }

  /**
   * Tenant-level product entitlement status — the SINGLE SOURCE is the derived
   * `umi.effective_entitlement` view (plan_feature overlaid by override, already
   * filtered to trialing/active subscriptions). A feature is entitled iff an
   * `enabled` row exists for it; we join `umi.subscription` back for the café's
   * real status so the guard keeps its `active`/`trialing` vocabulary. Read on the
   * worker pool, which is BYPASSRLS — the view is `security_invoker`, so RLS does
   * NOT scope it here; the explicit `business_id` predicate does. Returns null when
   * the feature is absent/disabled (→ `product_not_active`).
   */
  async effectiveEntitlement(
    tenantId: string,
    productKey: string,
  ): Promise<EffectiveEntitlementRecord | null> {
    const { rows } = await this.pg.query<EffectiveEntitlementRecord>(
      `SELECT ee.feature_key AS "featureKey", ee.enabled,
              ee.limit_value AS "limit", s.status AS "subscriptionStatus"
         FROM umi.effective_entitlement AS ee
         JOIN umi.subscription          AS s ON s.business_id = ee.business_id
        WHERE ee.business_id = $1::uuid
          AND ee.feature_key = $2
        LIMIT 1`,
      [tenantId, productKey],
    );
    return rows[0] ?? null;
  }

  async findPosPinStaff(
    tenantId: string,
    branchId: string,
    lookupHash: string,
  ): Promise<PosPinStaffRecord | null> {
    const { rows } = await this.pg.query<PosPinStaffRecord>(
      `SELECT s.id::text AS "staffId", s.user_id::text AS "userId",
              u.email, u.full_name AS "displayName",
              s.operator_pin_salt AS "pinSalt",
              s.operator_pin_hash AS "pinHash",
              s.pin_failed_attempts AS "failedAttempts",
              s.pin_locked_until AS "lockedUntil"
       FROM tenant.staff s
       JOIN umi.user u ON u.id = s.user_id AND u.status = 'active'
       JOIN tenant.branch b ON b.id = $2::uuid
         AND b.business_id = s.business_id AND b.status = 'active'
       WHERE s.business_id = $1::uuid
         AND s.status = 'active'
         AND (s.branch_id IS NULL OR s.branch_id = b.id)
         AND s.operator_pin_lookup_hash = $3
         AND EXISTS (
           SELECT 1 FROM umi.user_role ur
           WHERE ur.user_id = s.user_id
             AND (ur.business_id = s.business_id OR ur.business_id IS NULL)
             AND (ur.branch_id IS NULL OR ur.branch_id = b.id)
         )
       LIMIT 1`,
      [tenantId, branchId, lookupHash],
    );
    return rows[0] ?? null;
  }

  async findLegacyPosPinCandidates(
    tenantId: string,
    branchId: string,
  ): Promise<PosPinStaffRecord[]> {
    const { rows } = await this.pg.query<PosPinStaffRecord>(
      `SELECT s.id::text AS "staffId", s.user_id::text AS "userId",
              u.email, u.full_name AS "displayName",
              s.operator_pin_salt AS "pinSalt",
              s.operator_pin_hash AS "pinHash",
              s.pin_failed_attempts AS "failedAttempts",
              s.pin_locked_until AS "lockedUntil"
       FROM tenant.staff s
       JOIN umi.user u ON u.id = s.user_id AND u.status = 'active'
       JOIN tenant.branch b ON b.id = $2::uuid
         AND b.business_id = s.business_id AND b.status = 'active'
       WHERE s.business_id = $1::uuid
         AND s.status = 'active'
         AND (s.branch_id IS NULL OR s.branch_id = b.id)
         AND s.operator_pin_hash IS NOT NULL
         AND s.operator_pin_salt IS NOT NULL
         AND s.operator_pin_lookup_hash IS NULL
         AND EXISTS (
           SELECT 1 FROM umi.user_role ur
           WHERE ur.user_id = s.user_id
             AND (ur.business_id = s.business_id OR ur.business_id IS NULL)
             AND (ur.branch_id IS NULL OR ur.branch_id = b.id)
         )
       ORDER BY s.id
       LIMIT 100`,
      [tenantId, branchId],
    );
    return rows;
  }

  async recordPosPinFailure(staffId: string): Promise<void> {
    await this.pg.query(
      `UPDATE tenant.staff
       SET pin_failed_attempts = least(pin_failed_attempts + 1, 10),
           pin_locked_until = CASE
             WHEN pin_failed_attempts + 1 >= 5
             THEN now() + interval '15 minutes'
             ELSE pin_locked_until
           END,
           updated_at = now()
       WHERE id = $1::uuid`,
      [staffId],
    );
  }

  async confirmPosPin(staffId: string, tenantId: string, lookupHash: string): Promise<boolean> {
    const { rowCount } = await this.pg.query(
      `UPDATE tenant.staff
       SET operator_pin_lookup_hash = $3,
           pin_failed_attempts = 0,
           pin_locked_until = null,
           updated_at = now()
       WHERE id = $1::uuid AND business_id = $2::uuid
         AND status = 'active'
       RETURNING id`,
      [staffId, tenantId, lookupHash],
    );
    return (rowCount ?? 0) === 1;
  }

  async createSession(input: {
    id: string;
    userId: string;
    deviceId: string | null;
    app: 'dashboard' | 'kds' | 'pos';
    tokenHash: string;
    expiresAt: Date;
    ip: string | null;
    userAgent: string | null;
    familyId?: string;
  }): Promise<void> {
    await this.pg.query(
      `WITH created AS (
         INSERT INTO runtime.session
           (id, user_id, device_id, app, token_hash, expires_at, ip, user_agent, refresh_family_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8,
                 COALESCE($9::uuid, gen_random_uuid()))
         RETURNING id, user_id
       )
       INSERT INTO runtime.security_audit_event
         (actor_user_id, session_id, event_type, entity_type, entity_id, outcome, metadata)
       SELECT user_id, id, 'session.created', 'session', id, 'success',
              jsonb_build_object('app', $4, 'deviceBound', $3::uuid IS NOT NULL)
       FROM created`,
      [
        input.id,
        input.userId,
        input.deviceId,
        input.app,
        input.tokenHash,
        input.expiresAt,
        input.ip,
        input.userAgent,
        input.familyId ?? null,
      ],
    );
  }

  async findSession(sessionId: string): Promise<SessionRecord | null> {
    const { rows } = await this.pg.query<SessionRecord>(
      `SELECT id::text, user_id::text AS "userId", device_id::text AS "deviceId",
              app, token_hash AS "tokenHash", expires_at AS "expiresAt",
              revoked_at AS "revokedAt"
       FROM runtime.session WHERE id = $1::uuid LIMIT 1`,
      [sessionId],
    );
    return rows[0] ?? null;
  }

  async sessionIsActive(sessionId: string, userId: string): Promise<boolean> {
    const { rows } = await this.pg.query<{ active: boolean }>(
      `UPDATE runtime.session AS s
       SET last_seen_at = now()
       WHERE s.id = $1::uuid AND s.user_id = $2::uuid
         AND s.revoked_at IS NULL AND s.expires_at > now()
         AND (
           s.device_id IS NULL OR EXISTS (
             SELECT 1 FROM tenant.device AS d
             WHERE d.id = s.device_id AND d.status = 'active'
           )
         )
       RETURNING true AS active`,
      [sessionId, userId],
    );
    return rows[0]?.active === true;
  }

  async deviceAllowedForUser(
    userId: string,
    deviceId: string,
    app: 'dashboard' | 'kds' | 'pos',
    installationHash: string | null = null,
    credentialHash: string | null = null,
    tenantId: string | null = null,
    branchId: string | null = null,
  ): Promise<boolean> {
    if (app === 'dashboard') return false;
    const expectedKind = app === 'kds' ? 'kds' : 'pos_terminal';
    const { rows } = await this.pg.query<{ allowed: boolean }>(
      `WITH ${SUPER_ADMIN_SA_CTE}
       SELECT EXISTS (
         SELECT 1
         FROM tenant.device AS d
         WHERE d.id = $2::uuid
           AND d.kind = $3
           AND d.status = 'active'
           AND ($6::uuid IS NULL OR d.business_id = $6::uuid)
           AND ($7::uuid IS NULL OR d.branch_id = $7::uuid)
           AND (
             $3 <> 'pos_terminal' OR (
               d.lifecycle_state = 'active'
               AND d.installation_hash = $4
               AND d.credential_hash = $5
             )
           )
           AND (
             EXISTS (
               SELECT 1 FROM umi.user_role AS ur
               WHERE ur.user_id = $1::uuid
                 AND (ur.business_id = d.business_id OR ur.business_id IS NULL)
                 AND (ur.branch_id IS NULL OR ur.branch_id = d.branch_id)
             )
             OR (SELECT is_sa FROM sa)
           )
       ) AS allowed`,
      [userId, deviceId, expectedKind, installationHash, credentialHash, tenantId, branchId],
    );
    return rows[0]?.allowed === true;
  }

  async rotateSession(
    currentId: string,
    tokenHash: string,
    replacement: {
      id: string;
      userId: string;
      deviceId: string | null;
      app: 'dashboard' | 'kds' | 'pos';
      tokenHash: string;
      expiresAt: Date;
      ip: string | null;
      userAgent: string | null;
    },
  ): Promise<boolean> {
    const client = await this.pg.worker.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ refreshFamilyId: string }>(
        `SELECT refresh_family_id::text AS "refreshFamilyId"
         FROM runtime.session
         WHERE id = $1::uuid AND token_hash = $2 AND revoked_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [currentId, tokenHash],
      );
      const current = rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        `INSERT INTO runtime.session
           (id, user_id, device_id, app, token_hash, expires_at, ip, user_agent, refresh_family_id)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9::uuid)`,
        [
          replacement.id,
          replacement.userId,
          replacement.deviceId,
          replacement.app,
          replacement.tokenHash,
          replacement.expiresAt,
          replacement.ip,
          replacement.userAgent,
          current.refreshFamilyId,
        ],
      );
      await client.query(
        `UPDATE runtime.session
         SET revoked_at = now(), revoked_reason = 'rotated', replaced_by_id = $2::uuid
         WHERE id = $1::uuid`,
        [currentId, replacement.id],
      );
      await client.query(
        `INSERT INTO runtime.security_audit_event
           (actor_user_id, session_id, event_type, entity_type, entity_id, outcome, metadata)
         VALUES ($1::uuid, $2::uuid, 'session.renewed', 'session', $2::uuid, 'success',
                 jsonb_build_object('previousSessionId', $3))`,
        [replacement.userId, replacement.id, currentId],
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    await this.pg.query(
      `UPDATE runtime.session
       SET revoked_at = COALESCE(revoked_at, now()), revoked_reason = COALESCE(revoked_reason, $2)
       WHERE id = $1::uuid`,
      [sessionId, reason],
    );
  }

  async revokeSessionFamily(sessionId: string, reason: string): Promise<void> {
    await this.pg.query(
      `UPDATE runtime.session
       SET revoked_at = COALESCE(revoked_at, now()),
           revoked_reason = COALESCE(revoked_reason, $2)
       WHERE refresh_family_id = (
         SELECT refresh_family_id FROM runtime.session WHERE id = $1::uuid
       )`,
      [sessionId, reason],
    );
  }

  async revokeUserSessions(userId: string, exceptSessionId: string | null): Promise<number> {
    const { rowCount } = await this.pg.query(
      `UPDATE runtime.session
       SET revoked_at = now(), revoked_reason = 'global_logout'
       WHERE user_id = $1::uuid AND revoked_at IS NULL
         AND ($2::uuid IS NULL OR id <> $2::uuid)`,
      [userId, exceptSessionId],
    );
    return rowCount ?? 0;
  }

  async writeSecurityAudit(input: {
    actorUserId: string | null;
    sessionId: string | null;
    businessId?: string | null;
    branchId?: string | null;
    eventType: string;
    entityType: string;
    entityId?: string | null;
    outcome: 'success' | 'denied' | 'failure';
    reasonCode?: string | null;
    requestId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.pg.query(
      `INSERT INTO runtime.security_audit_event
         (actor_user_id, session_id, business_id, branch_id, event_type, entity_type,
          entity_id, outcome, reason_code, request_id, metadata)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::uuid, $8, $9, $10, $11)`,
      [
        input.actorUserId,
        input.sessionId,
        input.businessId ?? null,
        input.branchId ?? null,
        input.eventType,
        input.entityType,
        input.entityId ?? null,
        input.outcome,
        input.reasonCode ?? null,
        input.requestId ?? null,
        input.metadata ?? {},
      ],
    );
  }

  async hasElevation(input: {
    sessionId: string;
    businessId: string;
    branchId: string | null;
    permission: string;
    method: 'manager_approval' | 'operator_pin';
  }): Promise<boolean> {
    const { rows } = await this.pg.query<{ active: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM runtime.elevation_grant
         WHERE session_id = $1::uuid
           AND business_id = $2::uuid
           AND (branch_id IS NULL OR branch_id = $3::uuid)
           AND permission_key = $4
           AND method = $5
           AND expires_at > now()
           AND consumed_at IS NULL
       ) AS active`,
      [input.sessionId, input.businessId, input.branchId, input.permission, input.method],
    );
    return rows[0]?.active === true;
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
           , status = 'active'
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
