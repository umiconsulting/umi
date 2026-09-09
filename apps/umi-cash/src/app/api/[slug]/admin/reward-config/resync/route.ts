import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getTenant } from '@/lib/tenant';
import { sendApplePushUpdateForTenant } from '@/lib/push-apple';
import { refreshGoogleWalletObjectsForTenant } from '@/lib/wallet-refresh';

// Walks every pass of the tenant; keep the invocation alive for it.
export const maxDuration = 300;

/**
 * POST /api/{slug}/admin/reward-config/resync — re-render every customer's wallet
 * pass from current state, without changing any configuration.
 *
 * ADMIN-only. The escape hatch for "I changed the rewards and the passes didn't
 * update": Apple passes get an APNs nudge (the device then re-fetches), Google
 * objects are PATCHed silently. Idempotent — safe to press twice.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const user = await requireAuth(['ADMIN'])(req);
  if (!user) return NextResponse.json({ error: 'Solo administradores pueden actualizar los pases' }, { status: 403 });

  const tenant = await getTenant(params.slug);
  if (!tenant) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });
  if (user.tenantId !== tenant.id) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

  try {
    // Apple only re-fetches a pass whose card changed since its last sync.
    const apple = await prisma.cards.updateMany({
      where: { tenant_id: tenant.id, passes: { some: { provider: 'apple', serial_number: { not: null } } } },
      data: { updated_at: new Date() },
    });
    try {
      await sendApplePushUpdateForTenant(tenant.id);
    } catch (err) {
      console.error('[reward-config resync] Apple push failed:', err instanceof Error ? err.message : String(err));
    }

    const google = await refreshGoogleWalletObjectsForTenant(tenant);

    return NextResponse.json({ apple: { total: apple.count }, google });
  } catch (err) {
    console.error('[reward-config resync]', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Error al actualizar los pases' }, { status: 500 });
  }
}
