import { Injectable, NotFoundException } from '@nestjs/common';
import type { MerchantAccess } from '../auth/auth.types';
import {
  MerchantsRepository,
  type LocationRow,
  type LocationProfileRow,
  type LocationPatch,
  type NewLocation,
  type ProductInstance,
  type MerchantSummary,
} from './merchants.repository';
import { buildModuleAvailability, type ModuleAvailability } from './module-registry';
import { PasswordService } from '../../shared/auth/password.service';
import type { ProvisionMerchantDto } from './dto/provision-merchant.dto';

export interface Capabilities {
  merchant: {
    id: string;
    /** The published URL key. Null for a café created after cutover — route by id. */
    handle: string | null;
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
  constructor(
    private readonly repo: MerchantsRepository,
    private readonly passwords: PasswordService,
  ) {}

  /**
   * Open a café, with the defaults umi-cash's form carried.
   *
   * The owner's password is hashed HERE and the plaintext never reaches the
   * repository — the same rule `auth.service` follows, so no query ever holds a
   * password in a bind parameter that could be logged.
   */
  async provision(dto: ProvisionMerchantDto): Promise<{ merchantId: string; userId: string }> {
    const { salt, hash } = this.passwords.hash(dto.adminPassword);
    return this.repo.provisionMerchant({
      name: dto.name,
      city: dto.city,
      timezone: dto.timezone,
      plan: dto.plan,
      trialEndsAt: dto.trialEndsAt,
      cardPrefix: dto.cardPrefix,
      primaryColor: dto.primaryColor,
      secondaryColor: dto.secondaryColor,
      adminEmail: dto.adminEmail,
      adminName: dto.adminName ?? 'Admin',
      passwordSalt: salt,
      passwordHash: hash,
      // umi-cash's defaults, carried: ten stamps for a free drink.
      stampsRequired: dto.stampsRequired ?? 10,
      rewardName: dto.rewardName ?? 'Bebida gratis',
      locations: dto.locations,
    });
  }

  listUserMerchants(userId: string): Promise<MerchantSummary[]> {
    return this.repo.merchantsForUser(userId);
  }

  async buildCapabilities(
    access: MerchantAccess,
    selectedLocationId: string | null,
  ): Promise<Capabilities> {
    const [products, allLocations, branding] = await Promise.all([
      this.repo.loadProducts(access.merchantId),
      this.repo.loadLocations(access.merchantId),
      this.repo.loadBranding(access.merchantId),
    ]);

    const locations = access.locationId
      ? allLocations.filter((location) => location.id === access.locationId)
      : allLocations;
    const selectedLocation =
      (selectedLocationId
        ? locations.find((location) => location.id === selectedLocationId)
        : null) ??
      locations.find((location) => location.status === 'active') ??
      locations[0] ??
      null;

    const membership = {
      id: access.membershipId,
      role: access.role,
      roles: access.roles,
      permissions: access.permissions,
      locationId: access.locationId,
    };
    const base = {
      merchant: {
        id: access.merchantId,
        handle: access.handle,
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
      handle: capabilities.merchant.handle,
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
    patch: LocationPatch,
  ): Promise<LocationProfileRow> {
    // Don't pre-filter on status: updateLocation already scopes by merchant+id and
    // returns null when absent, and gating on `active` would 404 any patch to an
    // inactive location — including reactivating it with status:'active'.
    const updated = await this.repo.updateLocation(merchantId, locationId, patch);
    if (!updated) throw new NotFoundException({ error: 'location_not_found' });
    return updated;
  }

  /**
   * Open a branch.
   *
   * The 404 is the same shape `updateLocation` throws. It is a backstop rather than
   * the tenancy check: a café the caller does not own is already refused twice
   * before this — by `MerchantAccessGuard`, which is where `merchantId` comes from,
   * and then by RLS, which raises rather than returning nothing. This only fires if
   * the INSERT returned no row for some other reason, and a write that returned
   * nothing must not be reported as a success.
   */
  async createLocation(merchantId: string, input: NewLocation): Promise<LocationProfileRow> {
    const created = await this.repo.createLocation(merchantId, input);
    if (!created) throw new NotFoundException({ error: 'merchant_not_found' });
    return created;
  }

  /** Per-location profiles (address, pin, aliases, descriptor) for the branch editor. */
  async listLocationProfiles(merchantId: string): Promise<LocationProfileRow[]> {
    return this.repo.listLocationProfiles(merchantId);
  }
}
