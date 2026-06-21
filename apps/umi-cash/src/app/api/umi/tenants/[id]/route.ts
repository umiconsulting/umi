import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getTenantConfig } from '@/lib/tenant';
import { verifyUmiSession } from '@/lib/umi-auth';
import { sendApplePushUpdateForTenant } from '@/lib/push-apple';
import tzlookup from 'tz-lookup';

const LocationUpdateSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(100),
  address: z.string().max(200).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  isActive: z.boolean().optional(),
});

const UpdateTenantSchema = z.object({
  subscriptionStatus: z.enum(['ACTIVE', 'SUSPENDED', 'TRIAL']).optional(),
  trialEndsAt: z.string().datetime().optional().nullable(),
  name: z.string().min(2).max(100).optional(),
  city: z.string().max(100).optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color inválido').optional(),
  secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().nullable(),
  selfRegistration: z.boolean().optional(),
  topupEnabled: z.boolean().optional(),
  businessHours: z.record(
    z.string().regex(/^[0-6]$/),
    z.tuple([z.number().int().min(0).max(23), z.number().int().min(0).max(23)]).nullable()
  ).optional().nullable(),
  // timezone is auto-derived from location coordinates — not manually settable
  rewardName: z.string().min(2).max(100).optional(),
  visitsRequired: z.number().int().min(1).max(50).optional(),
  locations: z.array(LocationUpdateSchema).optional(),
});

// legacy subscription enum -> canonical
const SUB_STATUS_TO_CANONICAL: Record<string, string> = {
  ACTIVE: 'active',
  SUSPENDED: 'disabled',
  TRIAL: 'trialing',
};

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!await verifyUmiSession(req)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  // Resolve the tenant by id to obtain its slug, then reassemble the legacy shape.
  const row = await prisma.tenants.findUnique({ where: { id: params.id }, select: { slug: true } });
  if (!row) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  const tenant = await getTenantConfig(row.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  const rewardConfig = await prisma.reward_configs.findFirst({
    where: { tenant_id: tenant.id, is_active: true },
    orderBy: { activated_at: 'desc' },
  });

  return NextResponse.json({
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    city: tenant.city,
    primaryColor: tenant.primaryColor,
    secondaryColor: tenant.secondaryColor,
    cardPrefix: tenant.cardPrefix,
    selfRegistration: tenant.selfRegistration,
    topupEnabled: tenant.topupEnabled,
    businessHours: tenant.businessHours,
    timezone: tenant.timezone,
    subscriptionStatus: tenant.subscriptionStatus,
    trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
    rewardConfig: rewardConfig
      ? { visitsRequired: rewardConfig.visits_required, rewardName: rewardConfig.reward_name }
      : null,
    locations: tenant.locations.map((l) => ({
      id: l.id,
      name: l.name,
      address: l.address,
      latitude: l.latitude,
      longitude: l.longitude,
      isActive: l.isActive,
    })),
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!await verifyUmiSession(req)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const data = UpdateTenantSchema.parse(body);

    const tenant = await prisma.tenants.findUnique({ where: { id: params.id } });
    if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

    // Canonical owning rows for this tenant.
    const [program, business, subscription] = await Promise.all([
      prisma.programs.findFirst({ where: { tenant_id: params.id } }),
      prisma.businesses.findUnique({ where: { tenant_id: params.id } }),
      prisma.subscriptions.findUnique({ where: { tenant_id: params.id } }),
    ]);

    // ── core.tenants (name) ──────────────────────────────────────────────────
    if (data.name !== undefined) {
      await prisma.tenants.update({ where: { id: params.id }, data: { name: data.name } });
    }

    // ── ops.businesses (city + branding) ─────────────────────────────────────
    if (business && (data.city !== undefined || data.primaryColor !== undefined || data.secondaryColor !== undefined || data.name !== undefined || data.businessHours !== undefined)) {
      const brand: Record<string, unknown> = { ...((business.branding ?? {}) as Record<string, unknown>) };
      if (data.primaryColor !== undefined) brand.primary_color = data.primaryColor;
      if (data.secondaryColor !== undefined) {
        if (data.secondaryColor === null) delete brand.secondary_color;
        else brand.secondary_color = data.secondaryColor;
      }
      await prisma.businesses.update({
        where: { tenant_id: params.id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.city !== undefined && { city: data.city || null }),
          ...(data.primaryColor !== undefined || data.secondaryColor !== undefined ? { branding: brand as Prisma.InputJsonObject } : {}),
          ...(data.businessHours !== undefined && {
            open_times: data.businessHours === null ? {} : (data.businessHours as Prisma.InputJsonObject),
          }),
        },
      });
    }

    // ── loyalty.programs (card config + branding) ────────────────────────────
    if (program && (data.selfRegistration !== undefined || data.topupEnabled !== undefined || data.primaryColor !== undefined || data.secondaryColor !== undefined)) {
      const programBrand: Record<string, unknown> = { ...((program.branding ?? {}) as Record<string, unknown>) };
      if (data.primaryColor !== undefined) programBrand.primary_color = data.primaryColor;
      if (data.secondaryColor !== undefined) {
        if (data.secondaryColor === null) delete programBrand.secondary_color;
        else programBrand.secondary_color = data.secondaryColor;
      }
      await prisma.programs.update({
        where: { id: program.id },
        data: {
          ...(data.selfRegistration !== undefined && { self_registration: data.selfRegistration }),
          ...(data.topupEnabled !== undefined && { topup_enabled: data.topupEnabled }),
          ...(data.primaryColor !== undefined || data.secondaryColor !== undefined ? { branding: programBrand as Prisma.InputJsonObject } : {}),
        },
      });
    }

    // ── grow.subscriptions (status / trial) ──────────────────────────────────
    if (subscription && (data.subscriptionStatus !== undefined || data.trialEndsAt !== undefined)) {
      const subData: { status?: string; suspended_at?: Date | null; trial_ends_at?: Date | null } = {};
      if (data.subscriptionStatus !== undefined) {
        subData.status = SUB_STATUS_TO_CANONICAL[data.subscriptionStatus];
        subData.suspended_at = data.subscriptionStatus === 'SUSPENDED' ? new Date() : null;
        if (data.subscriptionStatus !== 'TRIAL') subData.trial_ends_at = null;
      }
      if (data.trialEndsAt !== undefined) {
        subData.trial_ends_at = data.trialEndsAt ? new Date(data.trialEndsAt) : null;
      }
      await prisma.subscriptions.update({ where: { tenant_id: params.id }, data: subData });
    }

    // ── core.locations (upsert/delete) ───────────────────────────────────────
    if (data.locations !== undefined) {
      const existingLocations = await prisma.locations.findMany({ where: { tenant_id: params.id } });
      const existingIds = existingLocations.map((l) => l.id);
      const incomingIds = data.locations.filter((l) => l.id).map((l) => l.id!);

      // Delete removed locations
      const toDelete = existingIds.filter((id) => !incomingIds.includes(id));
      if (toDelete.length > 0) {
        await prisma.locations.deleteMany({ where: { id: { in: toDelete } } });
      }

      // Upsert locations
      for (const loc of data.locations) {
        if (loc.id && existingIds.includes(loc.id)) {
          await prisma.locations.update({
            where: { id: loc.id },
            data: {
              name: loc.name,
              address: loc.address ?? null,
              lat: loc.latitude ?? null,
              lng: loc.longitude ?? null,
              status: (loc.isActive ?? true) ? 'active' : 'inactive',
            },
          });
        } else {
          await prisma.locations.create({
            data: {
              tenant_id: params.id,
              name: loc.name,
              address: loc.address ?? null,
              lat: loc.latitude ?? null,
              lng: loc.longitude ?? null,
              status: 'active',
            },
          });
        }
      }

      // Auto-derive timezone from first location with coordinates
      const firstLocWithCoords = data.locations.find((l) => l.latitude != null && l.longitude != null);
      if (firstLocWithCoords && firstLocWithCoords.latitude != null && firstLocWithCoords.longitude != null) {
        const tz = tzlookup(firstLocWithCoords.latitude, firstLocWithCoords.longitude);
        if (tz) {
          await prisma.tenants.update({ where: { id: params.id }, data: { timezone: tz } });
        }
      }
    }

    // ── loyalty.reward_configs (active config) ───────────────────────────────
    if (data.rewardName !== undefined || data.visitsRequired !== undefined) {
      const activeConfig = await prisma.reward_configs.findFirst({
        where: { tenant_id: params.id, is_active: true },
      });
      if (activeConfig) {
        await prisma.reward_configs.update({
          where: { id: activeConfig.id },
          data: {
            ...(data.rewardName !== undefined && { reward_name: data.rewardName }),
            ...(data.visitsRequired !== undefined && { visits_required: data.visitsRequired }),
          },
        });

        // Bump card timestamps + push wallet updates for cards with an Apple pass.
        const passCards = await prisma.passes.findMany({
          where: { tenant_id: params.id, provider: 'apple', serial_number: { not: null } },
          select: { loyalty_card_id: true },
        });
        const passCardIds = passCards.map((p) => p.loyalty_card_id);
        if (passCardIds.length > 0) {
          await prisma.cards.updateMany({
            where: { tenant_id: params.id, id: { in: passCardIds } },
            data: { updated_at: new Date() },
          });
        }
        sendApplePushUpdateForTenant(params.id).catch((err) =>
          console.error('[umi-admin] Push update failed:', err)
        );
      }
    }

    // Re-read the canonical status for the response (legacy enum shape).
    const refreshed = await getTenantConfig(tenant.slug);

    return NextResponse.json({
      id: tenant.id,
      slug: tenant.slug,
      name: refreshed?.name ?? tenant.name,
      subscriptionStatus: refreshed?.subscriptionStatus ?? null,
      suspendedAt: refreshed?.suspendedAt?.toISOString() ?? null,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[UpdateTenant]', msg);
    return NextResponse.json({ error: `Error al actualizar tenant: ${msg}` }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!await verifyUmiSession(req)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const tenant = await prisma.tenants.findUnique({ where: { id: params.id } });
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  // Every tenant-scoped table references core.tenants with onDelete: Cascade
  // (cards, accounts, passes, pass_devices, wallet_transactions, visit_events,
  // reward_configs/redemptions, gift_cards, locations, programs, businesses,
  // subscriptions, people, users-via-memberships, sessions, …). Deleting the
  // tenant row cascades the entire fan-out. core.users are tenant-agnostic logins
  // removed via their tenant_memberships cascade; the membership delete leaves the
  // login row, matching canonical identity semantics.
  await prisma.tenants.delete({ where: { id: params.id } });

  return NextResponse.json({ ok: true });
}
