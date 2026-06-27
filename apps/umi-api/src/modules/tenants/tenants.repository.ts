import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  timezone: string | null;
  roles: string[];
}

export interface ProductInstance {
  status: string;
  locationId: string | null;
  config: Record<string, unknown>;
}

export interface LocationRow {
  id: string;
  slug: string;
  name: string;
  timezone: string | null;
  status: string;
}

/**
 * Tenant/location/product reads + admin writes. Tenant-scoped queries run on the
 * request path after TenantAccessGuard set the RLS context, so they go through
 * `withTenant` (umi_app, RLS) while still carrying explicit `tenant_id`
 * predicates (defense in depth). The cross-tenant `/me/tenants` list has no
 * single tenant context, so it uses the worker pool. SQL ported from server.js.
 */
@Injectable()
export class TenantsRepository {
  constructor(private readonly pg: PgService) {}

  /** Active memberships for the authed user (the `/me/tenants` list). */
  async tenantsForUser(userId: string): Promise<TenantSummary[]> {
    const { rows } = await this.pg.query<TenantSummary>(
      `SELECT
         t.id::text AS "id",
         t.slug     AS "slug",
         t.name     AS "name",
         t.timezone AS "timezone",
         array_remove(array_agg(DISTINCT r.key), NULL) AS "roles"
       FROM core.tenant_memberships AS tm
       JOIN core.tenants AS t ON t.id = tm.tenant_id
       LEFT JOIN core.membership_roles AS mr ON mr.membership_id = tm.id
       LEFT JOIN core.roles AS r ON r.id = mr.role_id
       WHERE tm.user_id = $1::uuid
         AND tm.status = 'active'
         AND t.status = 'active'
       GROUP BY t.id
       ORDER BY t.slug`,
      [userId],
    );
    return rows;
  }

  /** Tenant-level product entitlements (location_id IS NULL rows). */
  async loadProducts(
    tenantId: string,
  ): Promise<Record<string, ProductInstance>> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<{
        productKey: string;
        status: string;
        locationId: string | null;
        config: Record<string, unknown> | null;
      }>(
        `SELECT product_key AS "productKey", status,
                location_id::text AS "locationId", config
         FROM core.product_instances
         WHERE tenant_id = $1::uuid AND location_id IS NULL
         ORDER BY product_key`,
        [tenantId],
      ),
    );
    return Object.fromEntries(
      rows.map((r) => [
        r.productKey,
        { status: r.status, locationId: r.locationId, config: r.config ?? {} },
      ]),
    );
  }

  /** Locations with the (tenant) timezone, oldest first (tenant-neutral, deterministic). */
  async loadLocations(tenantId: string): Promise<LocationRow[]> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<LocationRow>(
        `SELECT l.id::text, l.slug, l.name, t.timezone, l.status
         FROM core.locations AS l
         JOIN core.tenants AS t ON t.id = l.tenant_id
         WHERE l.tenant_id = $1::uuid
         ORDER BY l.created_at ASC, l.id ASC`,
        [tenantId],
      ),
    );
    return rows;
  }

  /**
   * Resolve the effective location id for a tenant: the requested active
   * location, else the default active one — the OLDEST active location
   * (created_at, then id). Tenant-neutral and deterministic: no hardcoded branch
   * name (branches can be renamed/deleted; the platform is multi-tenant). Null
   * when the tenant has no active location.
   */
  async resolveLocationId(
    tenantId: string,
    requestedLocationId: string | null,
  ): Promise<string | null> {
    if (requestedLocationId) {
      const loc = await this.findActiveLocation(tenantId, requestedLocationId);
      return loc?.id ?? null;
    }
    const { rows } = await this.pg.withTenant((c) =>
      c.query<{ id: string }>(
        `SELECT id::text AS id
         FROM core.locations
         WHERE tenant_id = $1::uuid AND status = 'active'
         ORDER BY created_at ASC, id ASC
         LIMIT 1`,
        [tenantId],
      ),
    );
    return rows[0]?.id ?? null;
  }

  /** Verify a location belongs to the tenant and is active. */
  async findActiveLocation(
    tenantId: string,
    locationId: string,
  ): Promise<LocationRow | null> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<LocationRow>(
        `SELECT id::text, slug, name, NULL::text AS timezone, status
         FROM core.locations
         WHERE tenant_id = $1::uuid AND id = $2::uuid AND status = 'active'
         LIMIT 1`,
        [tenantId, locationId],
      ),
    );
    return rows[0] ?? null;
  }

  /**
   * Worker-pool (BYPASSRLS) variant of resolveLocationId — for the unauthenticated
   * WhatsApp path, which has no member user and so can't use withTenant. MUST use
   * the SAME tenant-neutral resolution as the dashboard (oldest active location),
   * so the bot reads hours at the SAME location_id the dashboard wrote.
   */
  async resolveLocationIdWorker(
    tenantId: string,
    requestedLocationId: string | null,
  ): Promise<string | null> {
    if (requestedLocationId) {
      const { rows } = await this.pg.query<{ id: string }>(
        `SELECT id::text AS id
         FROM core.locations
         WHERE tenant_id = $1::uuid AND id = $2::uuid AND status = 'active'
         LIMIT 1`,
        [tenantId, requestedLocationId],
      );
      return rows[0]?.id ?? null;
    }
    const { rows } = await this.pg.query<{ id: string }>(
      `SELECT id::text AS id
       FROM core.locations
       WHERE tenant_id = $1::uuid AND status = 'active'
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
      [tenantId],
    );
    return rows[0]?.id ?? null;
  }

  /** Worker-pool read of the tenant's canonical timezone (`core.tenants.timezone`). */
  async getTenantTimezoneWorker(tenantId: string): Promise<string | null> {
    const { rows } = await this.pg.query<{ timezone: string | null }>(
      `SELECT timezone FROM core.tenants WHERE id = $1::uuid`,
      [tenantId],
    );
    return rows[0]?.timezone ?? null;
  }

  async updateTenantSettings(
    tenantId: string,
    patch: { name?: string; timezone?: string },
  ): Promise<void> {
    await this.pg.withTenant((c) =>
      c.query(
        `UPDATE core.tenants
         SET name = COALESCE($2, name),
             timezone = COALESCE($3, timezone),
             updated_at = now()
         WHERE id = $1::uuid`,
        [tenantId, patch.name ?? null, patch.timezone ?? null],
      ),
    );
  }

  async updateLocation(
    tenantId: string,
    locationId: string,
    patch: { name?: string; timezone?: string; status?: string },
  ): Promise<LocationRow | null> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<LocationRow>(
        `UPDATE core.locations
         SET name = COALESCE($3, name),
             timezone = COALESCE($4, timezone),
             status = COALESCE($5, status),
             updated_at = now()
         WHERE id = $2::uuid AND tenant_id = $1::uuid
         RETURNING id::text, slug, name, timezone, status`,
        [
          tenantId,
          locationId,
          patch.name ?? null,
          patch.timezone ?? null,
          patch.status ?? null,
        ],
      ),
    );
    return rows[0] ?? null;
  }
}
