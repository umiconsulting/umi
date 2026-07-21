import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import { SUPER_ADMIN_SA_CTE } from './rbac.sql';

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

export interface TenantMembershipSummary {
  id: string;
  slug: string;
  name: string;
  roles: string[];
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
}

export interface ResetTokenRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  usedAt: Date | null;
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
       WHERE u.id = $1::uuid AND u.password_hash IS NOT NULL
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
  async findTenantsForUser(userId: string): Promise<TenantMembershipSummary[]> {
    const { rows } = await this.pg.query<TenantMembershipSummary>(
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
         SELECT ur.id, r.key AS role_key
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
           (SELECT array_agg(DISTINCT p.key)
              FROM umi.role_permission AS rp
              JOIN umi.role AS r        ON r.id = rp.role_id
              JOIN umi.permission AS p  ON p.id = rp.permission_id
             WHERE r.key IN (SELECT role_key FROM grants)),
           '{}'
         ) AS "permissions"
       FROM tenant.business AS t
       WHERE t.id = $2::uuid
         AND t.status = 'active'
         AND (EXISTS (SELECT 1 FROM grants) OR (SELECT is_sa FROM sa))
       LIMIT 1`,
      [userId, tenantId],
    );
    return rows[0] ?? null;
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
  async productStatus(tenantId: string, productKey: string): Promise<string | null> {
    const { rows } = await this.pg.query<{ status: string }>(
      `SELECT s.status
         FROM umi.effective_entitlement AS ee
         JOIN umi.subscription          AS s ON s.business_id = ee.business_id
        WHERE ee.business_id = $1::uuid
          AND ee.feature_key = $2
          AND ee.enabled
        LIMIT 1`,
      [tenantId, productKey],
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
