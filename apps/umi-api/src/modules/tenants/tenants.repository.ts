import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import { SUPER_ADMIN_SA_CTE } from '../auth/rbac.sql';

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

/** LocationRow + the branch-resolution profile fields (Phase 2). */
export interface LocationProfileRow extends LocationRow {
  aliases: string[];
  descriptor: string | null;
}

/**
 * Tenant/branch/product reads + admin writes. Tenant-scoped queries run on the
 * request path after TenantAccessGuard set the RLS context, so they go through
 * `withTenant` (umi_app, RLS) while still carrying explicit `business_id`
 * predicates (defense in depth). The cross-tenant `/me/tenants` list and product
 * ENTITLEMENTS use the worker pool — the latter is MANDATORY because entitlements
 * live in the SEALED `umi` schema (no umi_app USAGE on `umi`).
 *
 * 4-schema model (canonical rebuild v2): core.tenants -> tenant.business,
 * core.locations -> tenant.branch, core.product_instances -> the entitlement
 * cluster read via `umi.effective_entitlement` (tenant granularity — no
 * location_id), RBAC -> tenant.tenant_access single role.
 */
@Injectable()
export class TenantsRepository {
  constructor(private readonly pg: PgService) {}

  /**
   * Active memberships for the authed user (the `/me/tenants` list). Single role
   * per (login, tenant). A global super_admin (any active super_admin edge) sees
   * EVERY active tenant, tagged with its explicit role where one exists.
   */
  async tenantsForUser(userId: string): Promise<TenantSummary[]> {
    const { rows } = await this.pg.query<TenantSummary>(
      `WITH ${SUPER_ADMIN_SA_CTE}
       SELECT
         t.id::text AS "id",
         t.slug     AS "slug",
         t.name     AS "name",
         t.timezone AS "timezone",
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
   * Tenant-level product entitlements — the SINGLE SOURCE is the derived
   * `umi.effective_entitlement` view (same source the EntitlementGuard reads), so
   * the capabilities map and per-request gating can never disagree. Each `enabled`
   * feature becomes a product keyed by `feature_key`, carrying the café's real
   * subscription status (joined from `umi.subscription`). Read on the WORKER pool
   * (BYPASSRLS): the view is `security_invoker`, so the explicit `business_id`
   * predicate — not RLS — scopes it. `locationId` stays null (tenant-grained) and
   * `config` is `{}` (build-v3 carries no per-product config in this view).
   */
  async loadProducts(
    tenantId: string,
  ): Promise<Record<string, ProductInstance>> {
    const { rows } = await this.pg.query<{
      productKey: string;
      status: string;
    }>(
      `SELECT ee.feature_key AS "productKey", s.status
         FROM umi.effective_entitlement AS ee
         JOIN umi.subscription          AS s ON s.business_id = ee.business_id
        WHERE ee.business_id = $1::uuid
          AND ee.enabled
        ORDER BY ee.feature_key`,
      [tenantId],
    );
    return Object.fromEntries(
      rows.map((r) => [
        r.productKey,
        { status: r.status, locationId: null, config: {} },
      ]),
    );
  }

  /** Branches with the (tenant) timezone, oldest first (tenant-neutral, deterministic). */
  async loadLocations(tenantId: string): Promise<LocationRow[]> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<LocationRow>(
        `SELECT l.id::text, l.slug, l.name, t.timezone, l.status
         FROM tenant.branch AS l
         JOIN tenant.business AS t ON t.id = l.business_id
         WHERE l.business_id = $1::uuid
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
      if (loc) return loc.id;
      // Stale/invalid requested id (renamed/deleted/wrong tenant) → fall through
      // to the deterministic default rather than returning null (which would make
      // hours resolve tenant-wide instead of at the canonical active location).
    }
    const { rows } = await this.pg.withTenant((c) =>
      c.query<{ id: string }>(
        `SELECT id::text AS id
         FROM tenant.branch
         WHERE business_id = $1::uuid AND status = 'active'
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
         FROM tenant.branch
         WHERE business_id = $1::uuid AND id = $2::uuid AND status = 'active'
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
         FROM tenant.branch
         WHERE business_id = $1::uuid AND id = $2::uuid AND status = 'active'
         LIMIT 1`,
        [tenantId, requestedLocationId],
      );
      if (rows[0]) return rows[0].id;
      // Stale/invalid requested id → fall through to the deterministic default
      // (must mirror resolveLocationId so the bot reads at the same location the
      // dashboard writes).
    }
    const { rows } = await this.pg.query<{ id: string }>(
      `SELECT id::text AS id
       FROM tenant.branch
       WHERE business_id = $1::uuid AND status = 'active'
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
      [tenantId],
    );
    return rows[0]?.id ?? null;
  }

  /**
   * Worker-pool list of the tenant's ACTIVE locations (id + name), oldest-first.
   * Feeds branch resolution: the `# SUCURSALES` prompt block, `set_branch`
   * validation, and the checkout branch gate.
   */
  async listActiveLocationsWorker(
    tenantId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const { rows } = await this.pg.query<{ id: string; name: string }>(
      `SELECT id::text AS id, name
       FROM tenant.branch
       WHERE business_id = $1::uuid AND status = 'active'
       ORDER BY created_at ASC, id ASC`,
      [tenantId],
    );
    return rows;
  }

  /**
   * Rank a tenant's ACTIVE branches against free customer text for branch
   * resolution (Phase 2). Returns every active branch with its owner-curated
   * `aliases` and a pg_trgm `word_similarity` score of the (accent-stripped,
   * lowercased) query against `search_text` (= name + aliases). Worker pool
   * (unauthenticated WhatsApp path). `set_branch` combines this fuzzy score with
   * a deterministic name/alias match to decide auto-select vs. ask.
   */
  async matchBranchCandidates(
    tenantId: string,
    query: string,
  ): Promise<Array<{ id: string; name: string; aliases: string[]; sim: number }>> {
    const { rows } = await this.pg.query<{
      id: string;
      name: string;
      aliases: string[] | null;
      sim: string | number;
    }>(
      `SELECT id::text AS id,
              name,
              aliases,
              word_similarity(lower($2), search_text) AS sim
         FROM tenant.branch
        WHERE business_id = $1::uuid AND status = 'active'
        ORDER BY sim DESC, created_at ASC`,
      [tenantId, query],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      aliases: r.aliases ?? [],
      sim: Number(r.sim) || 0,
    }));
  }

  /** Worker-pool read of the tenant's canonical timezone (`tenant.business.timezone`). */
  async getTenantTimezoneWorker(tenantId: string): Promise<string | null> {
    const { rows } = await this.pg.query<{ timezone: string | null }>(
      `SELECT timezone FROM tenant.business WHERE id = $1::uuid`,
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
        `UPDATE tenant.business
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
    patch: {
      name?: string;
      timezone?: string;
      status?: string;
      aliases?: string[];
      descriptor?: string;
    },
  ): Promise<LocationProfileRow | null> {
    // descriptor uses a presence flag so an explicit empty value can CLEAR it
    // (COALESCE alone could never null it out); aliases pass through COALESCE so
    // an omitted field is untouched while an explicit [] clears the list.
    const setDescriptor = Object.prototype.hasOwnProperty.call(patch, 'descriptor');
    const { rows } = await this.pg.withTenant((c) =>
      c.query<LocationProfileRow>(
        `UPDATE tenant.branch
         SET name = COALESCE($3, name),
             timezone = COALESCE($4, timezone),
             status = COALESCE($5, status),
             aliases = COALESCE($6::text[], aliases),
             descriptor = CASE WHEN $7::boolean THEN $8 ELSE descriptor END,
             updated_at = now()
         WHERE id = $2::uuid AND business_id = $1::uuid
         RETURNING id::text, slug, name, timezone, status, aliases, descriptor`,
        [
          tenantId,
          locationId,
          patch.name ?? null,
          patch.timezone ?? null,
          patch.status ?? null,
          patch.aliases ?? null,
          setDescriptor,
          patch.descriptor ?? null,
        ],
      ),
    );
    return rows[0] ?? null;
  }

  /**
   * Per-branch profiles for the dashboard branch editor: name + owner-curated
   * aliases + descriptor. Reads the Phase 2 columns, so it is a dedicated read
   * (NOT folded into loadLocations / buildCapabilities) — a pre-migration deploy
   * only breaks the branch-settings section, never the whole dashboard.
   */
  async listLocationProfiles(tenantId: string): Promise<LocationProfileRow[]> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<LocationProfileRow>(
        `SELECT id::text, slug, name, NULL::text AS timezone, status, aliases, descriptor
         FROM tenant.branch
         WHERE business_id = $1::uuid AND status <> 'archived'
         ORDER BY created_at ASC, id ASC`,
        [tenantId],
      ),
    );
    return rows;
  }
}
