/**
 * Broadcast a one-off message to every wallet pass of a tenant.
 *
 * A Wallet banner only appears when a *watched field's value changes* — a bare
 * background push of identical content is a silent refresh. So this script:
 *   1. writes the text to cards.metadata.lifecycle_message (the "Mensaje" field, changeMessage '%@')
 *   2. bumps cards.updated_at so listSerials reports the card as updated
 *   3. pushes Apple (background refresh → device refetches → banner) + Google (addMessage)
 *
 * The lifecycle message is cleared on the customer's next visit, so the announcement
 * won't linger. Canonical schema: pass identity lives in loyalty.passes; the message
 * cache lives in loyalty.cards.metadata.
 *
 * Usage:
 *   npx tsx scripts/broadcast-message.ts <slug> "<message>"        # send for real
 *   npx tsx scripts/broadcast-message.ts <slug> "<message>" --dry  # preview only
 */

import './_load-env'; // must be first — sets env before app modules evaluate
import { prisma } from '../src/lib/prisma';
import type { Prisma } from '@prisma/client';
import { getTenantConfig } from '../src/lib/tenant';
import { sendApplePushUpdate } from '../src/lib/push-apple';
import { updateGoogleWalletObject } from '../src/lib/pass-google';
import { getActiveRewardConfig, rewardConfigDefaults } from '../src/lib/prisma-helpers';
import { DEFAULT_CUSTOMER_NAME } from '../src/lib/constants';

async function main() {
  const [slug, message, ...rest] = process.argv.slice(2);
  const dryRun = rest.includes('--dry') || rest.includes('--dry-run');

  if (!slug || !message) {
    console.error('Usage: npx tsx scripts/broadcast-message.ts <slug> "<message>" [--dry]');
    process.exit(1);
  }
  if (message.length > 200) {
    console.error(`Message is ${message.length} chars; keep it under 200 for wallet display.`);
    process.exit(1);
  }

  const tenant = await getTenantConfig(slug);
  if (!tenant) throw new Error(`Tenant not found for slug "${slug}"`);

  // Only cards that have at least one wallet pass installed can show a banner.
  const cards = await prisma.cards.findMany({
    where: { tenant_id: tenant.id, passes: { some: {} } },
    include: {
      passes: true,
      balances: true,
      accounts: { include: { people: true } },
    },
  });

  const rewardConfig = await getActiveRewardConfig(tenant.id);
  const { visitsRequired, rewardName } = rewardConfigDefaults(rewardConfig);

  console.log(`Tenant: ${tenant.name} (${slug})`);
  console.log(`Message: "${message}"`);
  console.log(`Cards with a wallet pass: ${cards.length}`);
  if (dryRun) {
    console.log('\n--dry: no fields written, no pushes sent. Re-run without --dry to broadcast.');
    await prisma.$disconnect();
    return;
  }

  const now = new Date();
  let apple = 0, appleFail = 0, google = 0, googleFail = 0;

  for (const card of cards) {
    const hasApple = card.passes.some((p) => p.provider === 'apple');
    const hasGoogle = card.passes.some((p) => p.provider === 'google');

    // 1+2: change the watched field (in metadata) and bump updated_at.
    const metadata = { ...((card.metadata as Record<string, unknown>) ?? {}) };
    metadata.lifecycle_message = message;
    metadata.lifecycle_message_updated_at = now.toISOString();
    await prisma.cards.update({
      where: { id: card.id },
      data: { metadata: metadata as Prisma.InputJsonObject, updated_at: now },
    });

    // 3: push. Helpers log their own failures; we just tally outcomes.
    if (hasApple) {
      const res = await sendApplePushUpdate(card.id)
        .catch((e) => { console.warn(`apple push failed for ${card.id}:`, e?.message ?? e); return { sent: 0, failed: 1 }; });
      apple += res.sent;
      appleFail += res.failed;
    }
    if (hasGoogle) {
      const ok = await updateGoogleWalletObject({
        cardId: card.id,
        cardNumber: card.card_number,
        customerName: card.accounts?.people?.display_name || DEFAULT_CUSTOMER_NAME,
        balanceCentavos: card.balances?.balance ?? card.balance_cents,
        visitsThisCycle: card.visits_this_cycle,
        visitsRequired,
        pendingRewards: card.pending_rewards,
        rewardName,
        totalVisits: card.total_visits,
        memberSince: card.created_at.toISOString(),
        tenantName: tenant.name,
        tenantSlug: slug,
        primaryColor: tenant.primaryColor,
        logoUrl: tenant.logoUrl,
        topupEnabled: tenant.topupEnabled,
        lifecycleMessage: message,
      }).then(() => true).catch((e) => { console.warn(`google update failed for ${card.id}:`, e?.message ?? e); return false; });
      ok ? google++ : googleFail++;
    }
  }

  console.log(`\nDone. Apple: ${apple} devices ok / ${appleFail} failed · Google: ${google} cards ok / ${googleFail} failed`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
