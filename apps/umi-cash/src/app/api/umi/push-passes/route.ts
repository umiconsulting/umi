import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendApplePushUpdate } from '@/lib/push-apple';
import { isAuthorizedCron } from '@/lib/cron-auth';

/**
 * POST /api/umi/push-passes
 * Trigger Apple Wallet push updates for specific cards or entire tenants.
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

  return NextResponse.json({ pushed, total: targetCardIds.length });
}
