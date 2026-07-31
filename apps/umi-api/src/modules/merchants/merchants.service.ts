import { Injectable, NotFoundException } from '@nestjs/common';
import type { MerchantAccess } from '../auth/auth.types';
import {
  MerchantsRepository,
  type LocationRow,
  type LocationProfileRow,
  type ProductInstance,
  type MerchantSummary,
} from './merchants.repository';
import { buildModuleAvailability, type ModuleAvailability } from './module-registry';

export interface Capabilities {
  merchant: {
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
 * Merchant shell: the `/me/merchants` switcher, the `capabilities` payload the
 * dashboard loads on entry (products + locations + module availability), and
 * settings/location admin writes. Membership comes from the guard-resolved
 * `MerchantAccess` — no re-query.
 */
@Injectable()
export class MerchantsService {
  constructor(private readonly repo: MerchantsRepository) {}

  listUserMerchants(userId: string): Promise<MerchantSummary[]> {
    return this.repo.merchantsForUser(userId);
  }

  async buildCapabilities(
    access: MerchantAccess,
    selectedLocationId: string | null,
  ): Promise<Capabilities> {
    const [products, locations, branding] = await Promise.all([
      this.repo.loadProducts(access.merchantId),
      this.repo.loadLocations(access.merchantId),
      this.repo.loadBranding(access.merchantId),
    ]);

    const selectedLocation = selectedLocationId
      ? (locations.find((l) => l.id === selectedLocationId) ?? null)
      : (locations.find((l) => l.status === 'active') ?? locations[0] ?? null);

    const membership = {
      id: access.membershipId,
      role: access.role,
      roles: access.roles,
      permissions: access.permissions,
    };
    const base = {
      merchant: {
        id: access.merchantId,
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
   * home — the typed `merchant.merchant.brand_color` / `secondary_color` columns —
   * NOT the dead per-product `config` (build-v3's entitlement view carries none,
   * so that was structurally always the default). `subscriptionStatus` is the
   * café's real status from the entitlement view. Defaults apply only when a café
   * has set no color.
   */
  buildSettings(capabilities: Capabilities): Record<string, unknown> {
    const dashboard = capabilities.products.dashboard;
    return {
      id: capabilities.merchant.id,
      name: capabilities.merchant.name,
      slug: capabilities.merchant.slug,
      timezone: capabilities.merchant.timezone,
      subscriptionStatus: dashboard?.status?.toUpperCase?.() ?? 'ACTIVE',
      primaryColor: capabilities.merchant.brandColor ?? '#B5605A',
      secondaryColor: capabilities.merchant.secondaryColor ?? '#E8C9A3',
      products: capabilities.products,
      locations: capabilities.locations,
    };
  }

  async updateSettings(
    merchantId: string,
    patch: { name?: string; timezone?: string },
  ): Promise<void> {
    await this.repo.updateMerchantSettings(merchantId, patch);
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
  ): Promise<LocationProfileRow> {
    // Don't pre-filter on status: updateLocation already scopes by merchant+id and
    // returns null when absent, and gating on `active` would 404 any patch to an
    // inactive location — including reactivating it with status:'active'.
    const updated = await this.repo.updateLocation(merchantId, locationId, patch);
    if (!updated) throw new NotFoundException({ error: 'location_not_found' });
    return updated;
  }

  /** Per-location profiles (aliases + descriptor) for the dashboard location editor. */
  async listLocationProfiles(merchantId: string): Promise<LocationProfileRow[]> {
    return this.repo.listLocationProfiles(merchantId);
  }
}
