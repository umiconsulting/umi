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
 * worker pool is also MANDATORY here because the entitlement + RBAC-policy tables
 * (`umi.subscription_item`, `umi.role_permission`) live in the SEALED `umi`
 * schema that `umi_app` has no USAGE on.
 *
 * build-v3 model: staff credentials + identity live on `umi.user` (email + hash +
 * `full_name`); grants are `umi.user_role` (user×role×business, FK role_id) read
 * against the sealed `umi.role_permission` (role_id×permission_id) catalog.
 * `super_admin` is Umi's cross-tenant operator: a user holding ANY `umi.user_role`
 * with role `super_admin` can select/access EVERY active business.
 *
 * PENDING (Phase 3a coordinated change — owner decision 2026-07-12 "route by id"):
 * `findTenantsForUser` / `findMembershipAccess` / `tenantIdForSlug` / `tenantBySlug`
 * still read `tenant.tenant_access` + the dropped `slug` column. That rewrite
 * (tenant_access→umi.user_role FK joins + drop slug, route by business id) changes
 * the /me/tenants + tenant-access API contract, so it lands with the dashboard.
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
  async findTenantsForUser(
    userId: string,
  ): Promise<TenantMembershipSummary[]> {
    const { rows } = await this.pg.query<TenantMembershipSummary>(
      `WITH ${SUPER_ADMIN_SA_CTE}
       SELECT
         t.id::text AS "id",
         t.slug     AS "slug",
         t.name     AS "name",
         ARRAY[COALESCE(ta.role, 'super_admin')] AS "roles"
       FROM tenant.business AS t
       LEFT JOIN tenant.tenant_access AS ta
         ON ta.business_id = t.id
        AND ta.login_id  = $1::uuid
        AND ta.status    = 'active'
       WHERE t.status = 'active'
         AND (ta.id IS NOT NULL OR (SELECT is_sa FROM sa))
       ORDER BY t.slug`,
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
  async findMembershipAccess(
    userId: string,
    tenantId: string,
  ): Promise<MembershipAccess | null> {
    const { rows } = await this.pg.query<MembershipAccess>(
      `WITH ${SUPER_ADMIN_SA_CTE},
       edge AS (
         SELECT ta.id, ta.role
         FROM tenant.tenant_access AS ta
         WHERE ta.login_id = $1::uuid
           AND ta.business_id = $2::uuid
           AND ta.status = 'active'
         LIMIT 1
       )
       SELECT
         e.id::text  AS "membershipId",
         t.id::text  AS "tenantId",
         t.slug      AS "slug",
         t.name      AS "name",
         t.timezone  AS "timezone",
         ARRAY[COALESCE(e.role, 'super_admin')] AS "roles",
         COALESCE(
           (SELECT array_agg(rp.permission_key)
              FROM umi.role_permission AS rp
             WHERE rp.role = COALESCE(e.role, 'super_admin')),
           '{}'
         ) AS "permissions"
       FROM tenant.business AS t
       LEFT JOIN edge AS e ON true
       WHERE t.id = $2::uuid
         AND t.status = 'active'
         AND (e.id IS NOT NULL OR (SELECT is_sa FROM sa))
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
  async tenantBySlug(
    slug: string,
  ): Promise<{ id: string; name: string; slug: string } | null> {
    const { rows } = await this.pg.query<{ id: string; name: string; slug: string }>(
      `SELECT id::text AS id, name, slug FROM tenant.business WHERE slug = $1 LIMIT 1`,
      [slug],
    );
    return rows[0] ?? null;
  }

  /**
   * Tenant-level product entitlement status. Entitlements live in the sealed
   * `umi.subscription_item` (tenant granularity — no location_id), read on the
   * worker pool.
   */
  async productStatus(
    tenantId: string,
    productKey: string,
  ): Promise<string | null> {
    const { rows } = await this.pg.query<{ status: string }>(
      `SELECT status
       FROM umi.subscription_item
       WHERE business_id = $1::uuid
         AND product_key = $2
       LIMIT 1`,
      [tenantId, productKey],
    );
    return rows[0]?.status ?? null;
  }

  // ── password reset (runtime.password_reset_token, user-keyed) ──
  async insertResetToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
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

  async updatePassword(
    userId: string,
    salt: string,
    hash: string,
  ): Promise<void> {
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
