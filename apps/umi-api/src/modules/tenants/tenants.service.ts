import { Injectable, NotFoundException } from '@nestjs/common';
import type { TenantAccess } from '../auth/auth.types';
import {
  TenantsRepository,
  type LocationRow,
  type LocationProfileRow,
  type ProductInstance,
  type TenantSummary,
} from './tenants.repository';
import {
  buildModuleAvailability,
  type ModuleAvailability,
} from './module-registry';

export interface Capabilities {
  tenant: {
    id: string;
    slug: string;
    name: string;
    timezone: string | null;
    brandColor: string | null;
    secondaryColor: string | null;
  };
  selectedLocation: LocationRow | null;
  locations: LocationRow[];
  membership: {
    // null for a synthesized global-super_admin access (no explicit edge here).
    id: string | null;
    role: string | null;
    roles: string[];
    permissions: string[];
  };
  products: Record<string, ProductInstance>;
  modules: Record<string, ModuleAvailability>;
}

/**
 * Tenant shell: the `/me/tenants` switcher, the `capabilities` payload the
 * dashboard loads on entry (products + locations + module availability), and
 * settings/location admin writes. Membership comes from the guard-resolved
 * `TenantAccess` — no re-query.
 */
@Injectable()
export class TenantsService {
  constructor(private readonly repo: TenantsRepository) {}

  listUserTenants(userId: string): Promise<TenantSummary[]> {
    return this.repo.tenantsForUser(userId);
  }

  async buildCapabilities(
    access: TenantAccess,
    selectedLocationId: string | null,
  ): Promise<Capabilities> {
    const [products, locations, branding] = await Promise.all([
      this.repo.loadProducts(access.tenantId),
      this.repo.loadLocations(access.tenantId),
      this.repo.loadBranding(access.tenantId),
    ]);

    const selectedLocation = selectedLocationId
      ? locations.find((l) => l.id === selectedLocationId) ?? null
      : locations.find((l) => l.status === 'active') ?? locations[0] ?? null;

    const membership = {
      id: access.membershipId,
      role: access.role,
      roles: access.roles,
      permissions: access.permissions,
    };
    const base = {
      tenant: {
        id: access.tenantId,
        slug: access.slug,
        name: access.name,
        timezone: access.timezone,
        brandColor: branding.brandColor,
        secondaryColor: branding.secondaryColor,
      },
      selectedLocation,
      locations,
      membership,
      products,
    };
    return { ...base, modules: buildModuleAvailability(base) };
  }

  /**
   * The dashboard settings/theming payload. Branding comes from the build-v3
   * home — the typed `tenant.business.brand_color` / `secondary_color` columns —
   * NOT the dead per-product `config` (build-v3's entitlement view carries none,
   * so that was structurally always the default). `subscriptionStatus` is the
   * café's real status from the entitlement view. Defaults apply only when a café
   * has set no color.
   */
  buildSettings(capabilities: Capabilities): Record<string, unknown> {
    const dashboard = capabilities.products.dashboard;
    return {
      id: capabilities.tenant.id,
      name: capabilities.tenant.name,
      slug: capabilities.tenant.slug,
      timezone: capabilities.tenant.timezone,
      subscriptionStatus: dashboard?.status?.toUpperCase?.() ?? 'ACTIVE',
      primaryColor: capabilities.tenant.brandColor ?? '#B5605A',
      secondaryColor: capabilities.tenant.secondaryColor ?? '#E8C9A3',
      products: capabilities.products,
      locations: capabilities.locations,
    };
  }

  async updateSettings(
    tenantId: string,
    patch: { name?: string; timezone?: string },
  ): Promise<void> {
    await this.repo.updateTenantSettings(tenantId, patch);
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
  ): Promise<LocationProfileRow> {
    // Don't pre-filter on status: updateLocation already scopes by tenant+id and
    // returns null when absent, and gating on `active` would 404 any patch to an
    // inactive location — including reactivating it with status:'active'.
    const updated = await this.repo.updateLocation(tenantId, locationId, patch);
    if (!updated) throw new NotFoundException({ error: 'location_not_found' });
    return updated;
  }

  /** Per-branch profiles (aliases + descriptor) for the dashboard branch editor. */
  async listLocationProfiles(tenantId: string): Promise<LocationProfileRow[]> {
    return this.repo.listLocationProfiles(tenantId);
  }
}
