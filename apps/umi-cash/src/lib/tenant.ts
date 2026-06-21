import { NextResponse } from 'next/server';
import { prisma } from './prisma';
import { tenantWeekday } from './timezone';

/**
 * Tenant config adapter. The old single `Tenant` row is now fanned out across
 * `core.tenants` + `loyalty.programs` + `ops.businesses` + `grow.subscriptions`.
 * `getTenantConfig` reassembles the legacy `Tenant` shape (camelCase) so the ~14
 * read sites barely change, and exposes the canonical ids (`programId`,
 * `businessId`, `subscriptionId`) that write sites need to fan out updates.
 */

const SUB_STATUS_TO_LEGACY: Record<string, string> = {
  active: 'ACTIVE',
  trialing: 'TRIAL',
  disabled: 'SUSPENDED',
  missing: 'SUSPENDED',
  archived: 'SUSPENDED',
};

/** Returns the promoMessage only if the promotion is currently active based on schedule */
export function getActivePromo(tenant: {
  promoMessage: string | null;
  promoStartsAt: Date | null;
  promoEndsAt: Date | null;
  promoDays: string | null;
  timezone?: string | null;
}): string | null {
  if (!tenant.promoMessage) return null;
  const now = new Date();
  if (tenant.promoStartsAt && now < tenant.promoStartsAt) return null;
  if (tenant.promoEndsAt && now > tenant.promoEndsAt) return null;
  if (tenant.promoDays) {
    const allowedDays = tenant.promoDays.split(',').map(Number);
    if (!allowedDays.includes(tenantWeekday(tenant.timezone, now))) return null;
  }
  return tenant.promoMessage;
}

function toDate(v: unknown): Date | null {
  return v ? new Date(v as string) : null;
}

export async function getTenantConfig(slug: string) {
  const t = await prisma.tenants.findUnique({ where: { slug } });
  if (!t) return null;

  const [program, business, sub, locs] = await Promise.all([
    prisma.programs.findFirst({ where: { tenant_id: t.id } }),
    prisma.businesses.findUnique({ where: { tenant_id: t.id } }),
    prisma.subscriptions.findUnique({ where: { tenant_id: t.id } }),
    prisma.locations.findMany({ where: { tenant_id: t.id, status: 'active' } }),
  ]);

  const brand = (business?.branding ?? {}) as Record<string, unknown>;
  const programBrand = (program?.branding ?? {}) as Record<string, unknown>;
  const openTimes = (business?.open_times ?? {}) as Record<string, unknown>;
  const hasHours = openTimes && Object.keys(openTimes).length > 0;

  return {
    // identity
    id: t.id,
    slug: t.slug,
    name: t.name,
    timezone: t.timezone,
    city: business?.city ?? null,
    // loyalty program config
    cardPrefix: program?.card_prefix ?? null,
    topupEnabled: program?.topup_enabled ?? true,
    selfRegistration: program?.self_registration ?? false,
    passStyle: program?.pass_style ?? (brand.pass_style as string) ?? 'default',
    birthdayRewardEnabled: program?.birthday_reward_enabled ?? false,
    birthdayRewardName: program?.birthday_reward_name ?? null,
    lifecycleCopy: (programBrand.lifecycle_copy as Record<string, string>) ?? {},
    // brand / wallet styling
    primaryColor: (brand.primary_color as string) ?? '#B5605A',
    secondaryColor: (brand.secondary_color as string) ?? null,
    logoUrl: (brand.logo_url as string) ?? null,
    stripImageUrl: (brand.strip_image_url as string) ?? null,
    promoMessage: (brand.promo_message as string) ?? null,
    promoDays: (brand.promo_days as string) ?? null,
    promoStartsAt: toDate(brand.promo_starts_at),
    promoEndsAt: toDate(brand.promo_ends_at),
    businessHours: hasHours ? openTimes : null,
    // subscription (legacy enum so existing checks keep working)
    subscriptionStatus: SUB_STATUS_TO_LEGACY[sub?.status ?? 'active'] ?? 'ACTIVE',
    trialEndsAt: sub?.trial_ends_at ?? null,
    suspendedAt: sub?.suspended_at ?? null,
    // canonical ids for write fan-out
    programId: program?.id ?? null,
    businessId: business?.id ?? null,
    subscriptionId: sub?.id ?? null,
    // locations in the legacy shape
    locations: locs.map((l) => ({
      id: l.id,
      name: l.name,
      address: l.address,
      latitude: l.lat,
      longitude: l.lng,
      isActive: l.status === 'active',
    })),
  };
}

/** Back-compat alias: existing call sites use getTenant(slug). */
export const getTenant = getTenantConfig;

export type TenantConfig = NonNullable<Awaited<ReturnType<typeof getTenantConfig>>>;
export type TenantWithLocations = TenantConfig;

/** Returns a 402 if the tenant subscription is suspended or the trial expired, else null. */
export async function requireActiveSubscription(tenant: {
  subscriptionId?: string | null;
  subscriptionStatus: string;
  trialEndsAt?: Date | null;
}): Promise<NextResponse | null> {
  if (tenant.subscriptionStatus === 'SUSPENDED') {
    return NextResponse.json(
      { error: 'Servicio suspendido. Contacta a tu administrador de Umi Cash.' },
      { status: 402 },
    );
  }
  if (
    tenant.subscriptionStatus === 'TRIAL' &&
    tenant.trialEndsAt &&
    tenant.trialEndsAt < new Date()
  ) {
    if (tenant.subscriptionId) {
      try {
        await prisma.subscriptions.update({
          where: { id: tenant.subscriptionId },
          data: { status: 'disabled', suspended_at: new Date() },
        });
      } catch (err) {
        console.error(
          '[Tenant] Failed to auto-suspend expired trial:',
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    return NextResponse.json(
      { error: 'Tu período de prueba ha terminado. Contacta a Umi Cash para activar tu cuenta.' },
      { status: 402 },
    );
  }
  return null;
}
