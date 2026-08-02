import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import { SUPER_ADMIN_SA_CTE } from '../auth/rbac.sql';

export interface MerchantSummary {
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

/** LocationRow + the location-resolution profile fields (Phase 2). */
export interface LocationProfileRow extends LocationRow {
  aliases: string[];
  descriptor: string | null;
}

/**
 * Merchant/location/product reads + admin writes. Merchant-scoped queries run on the
 * request path after MerchantAccessGuard set the RLS context, so they go through
 * `withMerchant` (umi_app, RLS) while still carrying explicit `merchant_id`
 * predicates (defense in depth). The cross-merchant `/me/merchants` list and product
 * ENTITLEMENTS use the worker pool — the latter is MANDATORY because entitlements
 * live in the SEALED `umi` schema (no umi_app USAGE on `umi`).
 *
 * build-v3 model: core.tenants -> merchant.merchant, core.locations -> merchant.location,
 * core.product_instances -> the entitlement cluster read via
 * `umi.effective_entitlement` (merchant granularity — no location_id),
 * RBAC -> `umi.user_role` grants joined to the `umi.role` catalog (a user may hold
 * several roles per merchant, so roles come back as an array).
 */
@Injectable()
export class MerchantsRepository {
  constructor(private readonly pg: PgService) {}

  /**
   * Active memberships for the authed user (the `/me/merchants` list). Single role
   * per (login, merchant). A global super_admin (any active super_admin edge) sees
   * EVERY active merchant, tagged with its explicit role where one exists.
   */
  async merchantsForUser(userId: string): Promise<MerchantSummary[]> {
    const { rows } = await this.pg.query<MerchantSummary>(
      `WITH ${SUPER_ADMIN_SA_CTE}
       SELECT
         t.id::text AS "id",
         t.id::text AS "slug",
         t.name     AS "name",
         t.timezone AS "timezone",
         COALESCE(array_agg(r.key) FILTER (WHERE r.key IS NOT NULL),
                  ARRAY['super_admin']) AS "roles"
       FROM merchant.merchant AS t
       LEFT JOIN umi.user_role AS ur
         ON ur.merchant_id = t.id AND ur.user_id = $1::uuid
       LEFT JOIN umi.role AS r ON r.id = ur.role_id
       WHERE t.status = 'active'
         AND (ur.id IS NOT NULL OR (SELECT is_sa FROM sa))
       GROUP BY t.id, t.name, t.timezone
       ORDER BY t.name`,
      [userId],
    );
    return rows;
  }

  /**
   * Merchant-level product entitlements — the SINGLE SOURCE is the derived
   * `umi.effective_entitlement` view (same source the EntitlementGuard reads), so
   * the capabilities map and per-request gating can never disagree. Each `enabled`
   * feature becomes a product keyed by `feature_key`, carrying the café's real
   * subscription status (joined from `umi.subscription`). Read on the WORKER pool
   * (BYPASSRLS): the view is `security_invoker`, so the explicit `merchant_id`
   * predicate — not RLS — scopes it. `locationId` stays null (merchant-grained) and
   * `config` is `{}` (build-v3 carries no per-product config in this view).
   */
  async loadProducts(merchantId: string): Promise<Record<string, ProductInstance>> {
    const { rows } = await this.pg.query<{
      productKey: string;
      status: string;
    }>(
      `SELECT ee.feature_key AS "productKey", s.status
         FROM umi.effective_entitlement AS ee
         JOIN umi.subscription          AS s ON s.merchant_id = ee.merchant_id
        WHERE ee.merchant_id = $1::uuid
          AND ee.enabled
        ORDER BY ee.feature_key`,
      [merchantId],
    );
    return Object.fromEntries(
      rows.map((r) => [r.productKey, { status: r.status, locationId: null, config: {} }]),
    );
  }

  /**
   * Merchant branding for the dashboard settings/theming payload. build-v3 keeps
   * branding as TYPED columns on `merchant.merchant` (`brand_color`,
   * `secondary_color`, `logo_url` — "add columns rather than a catch-all blob").
   * Runs on the RLS app pool (`withMerchant`) with an explicit `merchant_id`
   * predicate, like the other merchant reads.
   */
  async loadBranding(
    merchantId: string,
  ): Promise<{ brandColor: string | null; secondaryColor: string | null }> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<{ brandColor: string | null; secondaryColor: string | null }>(
        `SELECT brand_color AS "brandColor", secondary_color AS "secondaryColor"
         FROM merchant.merchant
         WHERE id = $1::uuid
         LIMIT 1`,
        [merchantId],
      ),
    );
    return rows[0] ?? { brandColor: null, secondaryColor: null };
  }

  /** Locations with the (merchant) timezone, oldest first (merchant-neutral, deterministic). */
  async loadLocations(merchantId: string): Promise<LocationRow[]> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<LocationRow>(
        `SELECT l.id::text, l.slug, l.name, t.timezone, l.status
         FROM merchant.location AS l
         JOIN merchant.merchant AS t ON t.id = l.merchant_id
         WHERE l.merchant_id = $1::uuid
         ORDER BY l.created_at ASC, l.id ASC`,
        [merchantId],
      ),
    );
    return rows;
  }

  /**
   * Resolve the effective location id for a merchant: the requested active
   * location, else the default active one — the OLDEST active location
   * (created_at, then id). Merchant-neutral and deterministic: no hardcoded location
   * name (locations can be renamed/deleted; the platform is multi-merchant). Null
   * when the merchant has no active location.
   */
  async resolveLocationId(
    merchantId: string,
    requestedLocationId: string | null,
  ): Promise<string | null> {
    if (requestedLocationId) {
      const loc = await this.findActiveLocation(merchantId, requestedLocationId);
      if (loc) return loc.id;
      // Stale/invalid requested id (renamed/deleted/wrong merchant) → fall through
      // to the deterministic default rather than returning null (which would make
      // hours resolve merchant-wide instead of at the canonical active location).
    }
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<{ id: string }>(
        `SELECT id::text AS id
         FROM merchant.location
         WHERE merchant_id = $1::uuid AND status = 'active'
         ORDER BY created_at ASC, id ASC
         LIMIT 1`,
        [merchantId],
      ),
    );
    return rows[0]?.id ?? null;
  }

  /** Verify a location belongs to the merchant and is active. */
  async findActiveLocation(merchantId: string, locationId: string): Promise<LocationRow | null> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<LocationRow>(
        `SELECT id::text, slug, name, NULL::text AS timezone, status
         FROM merchant.location
         WHERE merchant_id = $1::uuid AND id = $2::uuid AND status = 'active'
         LIMIT 1`,
        [merchantId, locationId],
      ),
    );
    return rows[0] ?? null;
  }

  /**
   * Worker-pool (BYPASSRLS) variant of resolveLocationId — for the unauthenticated
   * WhatsApp path, which has no member user and so can't use withMerchant. MUST use
   * the SAME merchant-neutral resolution as the dashboard (oldest active location),
   * so the bot reads hours at the SAME location_id the dashboard wrote.
   */
  async resolveLocationIdWorker(
    merchantId: string,
    requestedLocationId: string | null,
  ): Promise<string | null> {
    if (requestedLocationId) {
      const { rows } = await this.pg.query<{ id: string }>(
        `SELECT id::text AS id
         FROM merchant.location
         WHERE merchant_id = $1::uuid AND id = $2::uuid AND status = 'active'
         LIMIT 1`,
        [merchantId, requestedLocationId],
      );
      if (rows[0]) return rows[0].id;
      // Stale/invalid requested id → fall through to the deterministic default
      // (must mirror resolveLocationId so the bot reads at the same location the
      // dashboard writes).
    }
    const { rows } = await this.pg.query<{ id: string }>(
      `SELECT id::text AS id
       FROM merchant.location
       WHERE merchant_id = $1::uuid AND status = 'active'
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
      [merchantId],
    );
    return rows[0]?.id ?? null;
  }

  /**
   * Worker-pool list of the merchant's ACTIVE locations (id + name), oldest-first.
   * Feeds location resolution: the `# SUCURSALES` prompt block, `set_location`
   * validation, and the checkout location gate.
   */
  async listActiveLocationsWorker(
    merchantId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const { rows } = await this.pg.query<{ id: string; name: string }>(
      `SELECT id::text AS id, name
       FROM merchant.location
       WHERE merchant_id = $1::uuid AND status = 'active'
       ORDER BY created_at ASC, id ASC`,
      [merchantId],
    );
    return rows;
  }

  /**
   * Rank a merchant's ACTIVE locations against free customer text for location
   * resolution (Phase 2). Returns every active location with its owner-curated
   * `aliases` and a pg_trgm `word_similarity` score of the (accent-stripped,
   * lowercased) query against `search_text` (= name + aliases). Worker pool
   * (unauthenticated WhatsApp path). `set_location` combines this fuzzy score with
   * a deterministic name/alias match to decide auto-select vs. ask.
   */
  async matchLocationCandidates(
    merchantId: string,
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
         FROM merchant.location
        WHERE merchant_id = $1::uuid AND status = 'active'
        ORDER BY sim DESC, created_at ASC`,
      [merchantId, query],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      aliases: r.aliases ?? [],
      sim: Number(r.sim) || 0,
    }));
  }

  /** Worker-pool read of the merchant's canonical timezone (`merchant.merchant.timezone`). */
  async getMerchantTimezoneWorker(merchantId: string): Promise<string | null> {
    const { rows } = await this.pg.query<{ timezone: string | null }>(
      `SELECT timezone FROM merchant.merchant WHERE id = $1::uuid`,
      [merchantId],
    );
    return rows[0]?.timezone ?? null;
  }

  async updateMerchantSettings(
    merchantId: string,
    patch: { name?: string; timezone?: string },
  ): Promise<void> {
    await this.pg.withMerchant((c) =>
      c.query(
        `UPDATE merchant.merchant
         SET name = COALESCE($2, name),
             timezone = COALESCE($3, timezone),
             updated_at = now()
         WHERE id = $1::uuid`,
        [merchantId, patch.name ?? null, patch.timezone ?? null],
      ),
    );
  }

  async updateLocation(
    merchantId: string,
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
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<LocationProfileRow>(
        `UPDATE merchant.location
         SET name = COALESCE($3, name),
             timezone = COALESCE($4, timezone),
             status = COALESCE($5, status),
             aliases = COALESCE($6::text[], aliases),
             descriptor = CASE WHEN $7::boolean THEN $8 ELSE descriptor END,
             updated_at = now()
         WHERE id = $2::uuid AND merchant_id = $1::uuid
         RETURNING id::text, slug, name, timezone, status, aliases, descriptor`,
        [
          merchantId,
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
   * Per-location profiles for the dashboard location editor: name + owner-curated
   * aliases + descriptor. Reads the Phase 2 columns, so it is a dedicated read
   * (NOT folded into loadLocations / buildCapabilities) — a pre-migration deploy
   * only breaks the location-settings section, never the whole dashboard.
   */
  async listLocationProfiles(merchantId: string): Promise<LocationProfileRow[]> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<LocationProfileRow>(
        `SELECT id::text, slug, name, NULL::text AS timezone, status, aliases, descriptor
         FROM merchant.location
         WHERE merchant_id = $1::uuid AND status <> 'archived'
         ORDER BY created_at ASC, id ASC`,
        [merchantId],
      ),
    );
    return rows;
  }
}
