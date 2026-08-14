import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getTenant } from '@/lib/tenant';
import { sendApplePushUpdateForTenant } from '@/lib/push-apple';
import { DEFAULT_LIFECYCLE_COPY, LIFECYCLE_JOURNEYS, LIFECYCLE_VARIABLES } from '@/lib/lifecycle-copy';

// All journey keys must be optional + max 300 chars. Empty string = clear override (fall back to default).
const LifecycleCopySchema = z.object(
  Object.fromEntries(
    LIFECYCLE_JOURNEYS.map(({ key }) => [key, z.string().max(300).optional()]),
  ),
).strict().optional();

const SettingsSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  city: z.string().max(100).optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color inválido').optional(),
  secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color inválido').optional().or(z.literal('')),
  logoUrl: z.string().max(500).optional().or(z.literal('')),
  stripImageUrl: z.string().max(500).optional().or(z.literal('')),
  passStyle: z.enum(['default', 'stamps']).optional(),
  promoMessage: z.string().max(200).optional().or(z.literal('')),
  promoStartsAt: z.string().datetime().optional().nullable(),
  promoEndsAt: z.string().datetime().optional().nullable(),
  promoDays: z.string().max(20).optional().nullable(),
  selfRegistration: z.boolean().optional(),
  birthdayRewardEnabled: z.boolean().optional(),
  birthdayRewardName: z.string().min(1).max(100).optional(),
  lifecycleCopy: LifecycleCopySchema,
});

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const user = await requireAuth(['ADMIN'])(req);
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  if (user.tenantId !== tenant.id) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  return NextResponse.json({
    name: tenant.name,
    city: tenant.city,
    primaryColor: tenant.primaryColor,
    secondaryColor: tenant.secondaryColor,
    logoUrl: tenant.logoUrl,
    stripImageUrl: tenant.stripImageUrl,
    passStyle: tenant.passStyle,
    promoMessage: tenant.promoMessage,
    promoStartsAt: tenant.promoStartsAt?.toISOString() ?? null,
    promoEndsAt: tenant.promoEndsAt?.toISOString() ?? null,
    promoDays: tenant.promoDays,
    selfRegistration: tenant.selfRegistration,
    birthdayRewardEnabled: tenant.birthdayRewardEnabled,
    birthdayRewardName: tenant.birthdayRewardName,
    cardPrefix: tenant.cardPrefix,
    slug: tenant.slug,
    lifecycleCopy: tenant.lifecycleCopy ?? {},
    lifecycleDefaults: DEFAULT_LIFECYCLE_COPY,
    lifecycleJourneys: LIFECYCLE_JOURNEYS,
    lifecycleVariables: LIFECYCLE_VARIABLES,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { slug: string } }) {
  const user = await requireAuth(['ADMIN'])(req);
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  if (user.tenantId !== tenant.id) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  try {
    const body = await req.json();
    const data = SettingsSchema.parse(body);

    // The legacy single Tenant row is fanned out: tenant name → core.tenants; brand/promo/city
    // → ops.businesses (typed cols + branding json); program flags + pass style → loyalty.programs
    // (lifecycle copy lives in programs.branding.lifecycle_copy).
    const [businessRow, programRow] = await Promise.all([
      tenant.businessId
        ? prisma.businesses.findUnique({ where: { id: tenant.businessId } })
        : prisma.businesses.findUnique({ where: { tenant_id: tenant.id } }),
      tenant.programId
        ? prisma.programs.findUnique({ where: { id: tenant.programId } })
        : prisma.programs.findFirst({ where: { tenant_id: tenant.id } }),
    ]);

    const branding = { ...((businessRow?.branding ?? {}) as Record<string, unknown>) };
    const programBranding = { ...((programRow?.branding ?? {}) as Record<string, unknown>) };

    if (data.primaryColor !== undefined) branding.primary_color = data.primaryColor;
    if (data.secondaryColor !== undefined) branding.secondary_color = data.secondaryColor || null;
    if (data.logoUrl !== undefined) branding.logo_url = data.logoUrl || null;
    if (data.stripImageUrl !== undefined) branding.strip_image_url = data.stripImageUrl || null;
    if (data.passStyle !== undefined) branding.pass_style = data.passStyle;
    if (data.promoMessage !== undefined) branding.promo_message = data.promoMessage || null;
    if (data.promoStartsAt !== undefined) branding.promo_starts_at = data.promoStartsAt ? new Date(data.promoStartsAt).toISOString() : null;
    if (data.promoEndsAt !== undefined) branding.promo_ends_at = data.promoEndsAt ? new Date(data.promoEndsAt).toISOString() : null;
    if (data.promoDays !== undefined) branding.promo_days = data.promoDays || null;

    if (data.lifecycleCopy !== undefined) {
      // Strip empty strings — they mean "use default" and storing them just bloats the JSON.
      programBranding.lifecycle_copy = Object.fromEntries(
        Object.entries(data.lifecycleCopy).filter(([, v]) => typeof v === 'string' && v.trim().length > 0),
      );
    }

    await prisma.$transaction(async (tx) => {
      // core.tenants — name only
      if (data.name !== undefined) {
        await tx.tenants.update({ where: { id: tenant.id }, data: { name: data.name } });
      }

      // ops.businesses — city + name mirror + branding json
      const businessData: Record<string, unknown> = { branding };
      if (data.city !== undefined) businessData.city = data.city;
      if (data.name !== undefined) businessData.name = data.name;
      if (businessRow) {
        await tx.businesses.update({ where: { id: businessRow.id }, data: businessData });
      } else {
        await tx.businesses.create({ data: { tenant_id: tenant.id, name: data.name ?? tenant.name, ...businessData } });
      }

      // loyalty.programs — flags + pass style + lifecycle copy branding
      const programData: Record<string, unknown> = { branding: programBranding };
      if (data.passStyle !== undefined) programData.pass_style = data.passStyle;
      if (data.selfRegistration !== undefined) programData.self_registration = data.selfRegistration;
      if (data.birthdayRewardEnabled !== undefined) programData.birthday_reward_enabled = data.birthdayRewardEnabled;
      if (data.birthdayRewardName !== undefined) programData.birthday_reward_name = data.birthdayRewardName;
      if (programRow) {
        await tx.programs.update({ where: { id: programRow.id }, data: programData });
      } else {
        // No loyalty.programs row yet (partially-provisioned tenant) — create it so
        // self-registration / birthday / lifecycle settings actually persist instead
        // of being silently dropped while the response still says { ok: true }.
        await tx.programs.create({ data: { tenant_id: tenant.id, ...programData } });
      }
    });

    // If visible pass content changed, bump cards and push to all wallets
    const promoChanged = data.promoMessage !== undefined && data.promoMessage !== (tenant.promoMessage ?? '');
    const passStyleChanged = data.passStyle !== undefined && data.passStyle !== tenant.passStyle;
    const visibleChange = promoChanged || passStyleChanged;
    console.log('[settings] visibleChange:', visibleChange, 'promo:', promoChanged, 'passStyle:', passStyleChanged);

    if (visibleChange) {
      const bumped = await prisma.cards.updateMany({
        where: { tenant_id: tenant.id, passes: { some: { provider: 'apple' } } },
        data: { updated_at: new Date() },
      });
      console.log('[settings] Bumped', bumped.count, 'cards');
      // Await push inline — waitUntil + http2 is unreliable on Vercel
      try {
        await sendApplePushUpdateForTenant(tenant.id);
        console.log('[settings] Push complete');
      } catch (err) {
        console.error('[settings] Push update failed:', err instanceof Error ? err.message : String(err));
      }
    }

    return NextResponse.json({ ok: true, tenant: { name: data.name ?? tenant.name, primaryColor: data.primaryColor ?? tenant.primaryColor } });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
    return NextResponse.json({ error: 'Error al guardar' }, { status: 500 });
  }
}
