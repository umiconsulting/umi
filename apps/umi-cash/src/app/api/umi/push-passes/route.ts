import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendApplePushUpdate } from '@/lib/push-apple';
import { isAuthorizedCron } from '@/lib/cron-auth';
import { getTenant } from '@/lib/tenant';
import { refreshGoogleWalletObjectsForTenant, type GoogleRefreshResult } from '@/lib/wallet-refresh';

// A tenant-wide refresh walks every pass; keep the invocation alive for it.
export const maxDuration = 300;

/**
 * POST /api/umi/push-passes
 * Trigger wallet refreshes for specific cards (Apple push) or entire tenants (Apple
 * push + a silent re-render of every Google object from current state).
 * Auth: Bearer CRON_SECRET
 *
 * Body: { cardIds?: string[], tenantSlugs?: string[] }
 */
export async function POST(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { cardIds, tenantSlugs } = body as { cardIds?: string[]; tenantSlugs?: string[] };

  const targetCardIds: string[] = [];

  // Collect cards by ID
  if (cardIds?.length) {
    targetCardIds.push(...cardIds);
  }

  // Collect cards by tenant slug — only those with an issued Apple pass.
  if (tenantSlugs?.length) {
    const applePasses = await prisma.passes.findMany({
      where: {
        provider: 'apple',
        serial_number: { not: null },
        tenants: { slug: { in: tenantSlugs } },
      },
      select: { loyalty_card_id: true },
    });
    targetCardIds.push(...applePasses.map((p) => p.loyalty_card_id));
  }

  if (targetCardIds.length === 0) {
    return NextResponse.json({ error: 'No cards found' }, { status: 404 });
  }

  // Bump updated_at so Apple sees the pass as changed
  await prisma.cards.updateMany({
    where: { id: { in: targetCardIds } },
    data: { updated_at: new Date() },
  });

  let pushed = 0;
  for (const cardId of targetCardIds) {
    try {
      await sendApplePushUpdate(cardId);
      pushed++;
    } catch (err) {
      console.error(`[push-passes] Failed for ${cardId}:`, err);
    }
  }

  // Google objects only change when we patch them — refresh each tenant's fleet.
  const google: Record<string, GoogleRefreshResult> = {};
  for (const slug of tenantSlugs ?? []) {
    const tenant = await getTenant(slug);
    if (tenant) google[slug] = await refreshGoogleWalletObjectsForTenant(tenant);
  }

  return NextResponse.json({ pushed, total: targetCardIds.length, google });
}
