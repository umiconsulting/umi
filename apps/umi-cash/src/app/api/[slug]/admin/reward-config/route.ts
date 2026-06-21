import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getTenant } from '@/lib/tenant';
import { sendApplePushUpdateForTenant } from '@/lib/push-apple';

const UpdateRewardSchema = z.object({
  visitsRequired: z.number().int().min(1).max(100),
  rewardName: z.string().min(2).max(100),
  rewardDescription: z.string().max(300).optional(),
  rewardCostCentavos: z.number().int().min(0).max(1000000).optional(),
});

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const user = await requireAuth(['STAFF', 'ADMIN'])(req);
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  if (user.tenantId !== tenant.id) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const [active, history] = await Promise.all([
    prisma.reward_configs.findFirst({
      where: { tenant_id: tenant.id, is_active: true },
      orderBy: { activated_at: 'desc' },
    }),
    prisma.reward_configs.findMany({
      where: { tenant_id: tenant.id, is_active: false },
      orderBy: { activated_at: 'desc' },
      take: 10,
    }),
  ]);

  // Map canonical snake_case rows to the camelCase RewardConfig API shape the UI expects.
  const toApi = (c: NonNullable<typeof active>) => ({
    id: c.id,
    visitsRequired: c.visits_required,
    rewardName: c.reward_name,
    rewardDescription: c.reward_description,
    rewardCostCentavos: c.reward_cost_cents,
    isActive: c.is_active,
    activatedAt: c.activated_at,
  });

  return NextResponse.json({ active: active ? toApi(active) : null, history: history.map(toApi) });
}

export async function PUT(req: NextRequest, { params }: { params: { slug: string } }) {
  const user = await requireAuth(['ADMIN'])(req);
  if (!user) return NextResponse.json({ error: 'Solo administradores pueden cambiar recompensas' }, { status: 403 });

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  if (user.tenantId !== tenant.id) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  try {
    const body = await req.json();
    const data = UpdateRewardSchema.parse(body);

    const newConfig = await prisma.$transaction(async (tx) => {
      await tx.reward_configs.updateMany({
        where: { tenant_id: tenant.id, is_active: true },
        data: { is_active: false },
      });

      const config = await tx.reward_configs.create({
        data: {
          tenant_id: tenant.id,
          program_id: tenant.programId,
          visits_required: data.visitsRequired,
          reward_name: data.rewardName,
          reward_description: data.rewardDescription,
          reward_cost_cents: data.rewardCostCentavos ?? 0,
          is_active: true,
        },
      });

      // Touch all loyalty cards that have an Apple pass so Apple's "passesUpdatedSince"
      // check sees them as changed and fetches the updated pass content.
      await tx.cards.updateMany({
        where: { tenant_id: tenant.id, passes: { some: { provider: 'apple' } } },
        data: { updated_at: new Date() },
      });

      return config;
    });

    // Await push inline — waitUntil + http2 is unreliable on Vercel
    try {
      await sendApplePushUpdateForTenant(tenant.id);
    } catch (err) {
      console.error('[reward-config] Push update failed:', err instanceof Error ? err.message : String(err));
    }

    return NextResponse.json({ newConfig });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
    console.error('[reward-config PUT]', err instanceof Error ? err.message : String(err));
    const message = err instanceof Error ? err.message : 'Error al actualizar';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
