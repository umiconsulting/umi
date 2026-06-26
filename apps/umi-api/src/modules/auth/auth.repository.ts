import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

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
  membershipId: string;
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
 * (`query`) with explicit parameterized predicates — never `withTenant`. SQL is
 * ported verbatim from `apps/umi-dashboard/server.js`.
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
         u.display_name      AS "displayName",
         u.password_salt     AS "passwordSalt",
         u.password_hash     AS "passwordHash"
       FROM core.users AS u
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
      `SELECT u.id::text AS "userId", u.email, u.display_name AS "displayName"
       FROM core.users AS u
       WHERE u.id = $1::uuid AND u.password_hash IS NOT NULL
       LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  /** Active tenant memberships + role keys for the login response body. */
  async findTenantsForUser(
    userId: string,
  ): Promise<TenantMembershipSummary[]> {
    const { rows } = await this.pg.query<TenantMembershipSummary>(
      `SELECT
         t.id::text AS "id",
         t.slug     AS "slug",
         t.name     AS "name",
         COALESCE(
           array_agg(r.key ORDER BY r.key) FILTER (WHERE r.key IS NOT NULL),
           '{}'
         ) AS "roles"
       FROM core.tenant_memberships AS tm
       JOIN core.tenants AS t ON t.id = tm.tenant_id
       LEFT JOIN core.membership_roles AS mr ON mr.membership_id = tm.id
       LEFT JOIN core.roles AS r ON r.id = mr.role_id
       WHERE tm.user_id = $1::uuid
         AND tm.status = 'active'
       GROUP BY t.id, t.slug, t.name
       ORDER BY t.slug`,
      [userId],
    );
    return rows;
  }

  /**
   * Membership + roles + permissions for one (user, tenant). Drives
   * TenantAccessGuard. Null ⇒ no active membership (404 tenant_not_found).
   */
  async findMembershipAccess(
    userId: string,
    tenantId: string,
  ): Promise<MembershipAccess | null> {
    const { rows } = await this.pg.query<MembershipAccess>(
      `SELECT
         tm.id::text AS "membershipId",
         t.id::text  AS "tenantId",
         t.slug      AS "slug",
         t.name      AS "name",
         t.timezone  AS "timezone",
         array_remove(array_agg(DISTINCT r.key), NULL) AS "roles",
         array_remove(array_agg(DISTINCT p.key), NULL) AS "permissions"
       FROM core.tenant_memberships AS tm
       JOIN core.tenants AS t ON t.id = tm.tenant_id
       LEFT JOIN core.membership_roles AS mr ON mr.membership_id = tm.id
       LEFT JOIN core.roles AS r ON r.id = mr.role_id
       LEFT JOIN core.role_permissions AS rp ON rp.role_id = r.id
       LEFT JOIN core.permissions AS p ON p.id = rp.permission_id
       WHERE tm.user_id = $1::uuid
         AND tm.tenant_id = $2::uuid
         AND tm.status = 'active'
         AND t.status = 'active'
       GROUP BY tm.id, t.id
       LIMIT 1`,
      [userId, tenantId],
    );
    return rows[0] ?? null;
  }

  /** Resolve a tenant id from its slug (for the legacy `/:slug/...` routes). */
  async tenantIdForSlug(slug: string): Promise<string | null> {
    const { rows } = await this.pg.query<{ id: string }>(
      `SELECT id::text AS id FROM core.tenants WHERE slug = $1 LIMIT 1`,
      [slug],
    );
    return rows[0]?.id ?? null;
  }

  /** Resolve tenant id + name from a slug (public routes need the name). */
  async tenantBySlug(
    slug: string,
  ): Promise<{ id: string; name: string; slug: string } | null> {
    const { rows } = await this.pg.query<{ id: string; name: string; slug: string }>(
      `SELECT id::text AS id, name, slug FROM core.tenants WHERE slug = $1 LIMIT 1`,
      [slug],
    );
    return rows[0] ?? null;
  }

  /** Tenant-level product entitlement status (location_id IS NULL row). */
  async productStatus(
    tenantId: string,
    productKey: string,
  ): Promise<string | null> {
    const { rows } = await this.pg.query<{ status: string }>(
      `SELECT status
       FROM core.product_instances
       WHERE tenant_id = $1::uuid
         AND product_key = $2
         AND location_id IS NULL
       LIMIT 1`,
      [tenantId, productKey],
    );
    return rows[0]?.status ?? null;
  }

  // ── password reset ──
  async insertResetToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.pg.query(
      `INSERT INTO core.password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1::uuid, $2, $3)`,
      [userId, tokenHash, expiresAt],
    );
  }

  async findResetToken(tokenHash: string): Promise<ResetTokenRecord | null> {
    const { rows } = await this.pg.query<ResetTokenRecord>(
      `SELECT id::text, user_id::text AS "userId",
              expires_at AS "expiresAt", used_at AS "usedAt"
       FROM core.password_reset_tokens
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
      `UPDATE core.users
       SET password_salt = $2, password_hash = $3, updated_at = now()
       WHERE id = $1::uuid`,
      [userId, salt, hash],
    );
  }

  async markResetTokenUsed(tokenId: string): Promise<void> {
    await this.pg.query(
      `UPDATE core.password_reset_tokens SET used_at = now() WHERE id = $1::uuid`,
      [tokenId],
    );
  }
}
