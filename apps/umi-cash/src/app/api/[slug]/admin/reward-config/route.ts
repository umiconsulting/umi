import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getTenant } from '@/lib/tenant';
import { sendApplePushUpdateForTenant } from '@/lib/push-apple';

const TierSchema = z.object({
  visitsRequired: z.number().int().min(1).max(100),
  rewardName: z.string().min(2).max(100),
  rewardDescription: z.string().max(300).optional(),
  rewardCostCentavos: z.number().int().min(0).max(1000000).optional(),
});

const UpdateRewardSchema = TierSchema.extend({
  /**
   * Optional upper tier of a two-tier ladder (e.g. 7 visits = capuccino, 9 = bebida
   * en las rocas): the cycle runs to this threshold, and the standard reward becomes
   * an early cash-out the customer may take once its own threshold is reached.
   * null/absent = single reward.
   */
  upgrade: TierSchema.nullable().optional(),
});

// Map canonical snake_case rows to the camelCase RewardConfig API shape the UI expects.
const toApi = (c: {
  id: string; visits_required: number; reward_name: string; reward_description: string | null;
  reward_cost_cents: number; is_active: boolean; activated_at: Date;
}) => ({
  id: c.id,
  visitsRequired: c.visits_required,
  rewardName: c.reward_name,
  rewardDescription: c.reward_description,
  rewardCostCentavos: c.reward_cost_cents,
  isActive: c.is_active,
  activatedAt: c.activated_at,
});

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const user = await requireAuth(['STAFF', 'ADMIN'])(req);
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

  if (user.tenantId !== tenant.id) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  const [active, upgrade, history] = await Promise.all([
    prisma.reward_configs.findFirst({
      where: { tenant_id: tenant.id, is_active: true, kind: 'standard' },
      orderBy: { activated_at: 'desc' },
    }),
    prisma.reward_configs.findFirst({
      where: { tenant_id: tenant.id, is_active: true, kind: 'upgrade' },
      orderBy: { activated_at: 'desc' },
    }),
    prisma.reward_configs.findMany({
      where: { tenant_id: tenant.id, is_active: false, kind: 'standard' },
      orderBy: { activated_at: 'desc' },
      take: 10,
    }),
  ]);

  return NextResponse.json({
    active: active ? toApi(active) : null,
    upgrade: upgrade ? toApi(upgrade) : null,
    history: history.map(toApi),
  });
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
    const upgrade = data.upgrade ?? null;
    if (upgrade && upgrade.visitsRequired <= data.visitsRequired) {
      return NextResponse.json(
        { error: 'El segundo nivel debe requerir más visitas que el primero' },
        { status: 400 },
      );
    }

    const newConfig = await prisma.$transaction(async (tx) => {
      const hadUpgrade = await tx.reward_configs.findFirst({
        where: { tenant_id: tenant.id, is_active: true, kind: 'upgrade' },
        select: { id: true },
      });

      // Retire the running tiers (override rows are never active, so this is every
      // active row) — the new standard row, and the new upgrade row if any, replace them.
      await tx.reward_configs.updateMany({
        where: { tenant_id: tenant.id, is_active: true, kind: { in: ['standard', 'upgrade'] } },
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
          kind: 'standard',
        },
      });

      if (upgrade) {
        await tx.reward_configs.create({
          data: {
            tenant_id: tenant.id,
            program_id: tenant.programId,
            visits_required: upgrade.visitsRequired,
            reward_name: upgrade.rewardName,
            reward_description: upgrade.rewardDescription,
            reward_cost_cents: upgrade.rewardCostCentavos ?? 0,
            is_active: true,
            kind: 'upgrade',
          },
        });

        // Switching a ladder ON: every reward banked so far was earned under the single
        // standard threshold, so it must keep being the standard reward — not the new
        // upper tier the cycle banks from now on. Tag those cards (pending_tier1) so the
        // redeem path hands over the lower tier first; the tag counts down as they go.
        // Re-tagging on a later OFF→ON flip is right too: while the ladder was off every
        // banked reward was, again, the standard one.
        if (!hadUpgrade) {
          await tx.$executeRaw(Prisma.sql`
            UPDATE loyalty.cards
            SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('pending_tier1', pending_rewards)
            WHERE tenant_id = ${tenant.id}::uuid AND pending_rewards > 0
          `);
        }
      }

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
