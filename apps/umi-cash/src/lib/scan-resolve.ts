import { verifyQRPayload } from './auth';
import { findPersonByPhone } from './identity';
import { findCardByIdentifier } from './prisma-helpers';
import { prisma } from './prisma';

type HydratedCard = NonNullable<Awaited<ReturnType<typeof findCardByIdentifier>>>;
type QrData = Awaited<ReturnType<typeof verifyQRPayload>>;

export type ScanResolution =
  | { ok: true; card: HydratedCard; qrData: QrData }
  | { ok: false; status: number; error: string };

/**
 * Resolve a scan input to a hydrated card — SHARED by scan preview and scan commit
 * so the two can never disagree (the bug: a phone number that previewed fine then
 * hard-errored on commit because commit only understood signed QR payloads).
 *
 * Resolution order: a verified QR payload (JWT / wallet barcode / legacy card-number
 * token), else a raw card number, else a phone number (person → account → newest
 * card). For a verified non-wallet QR the token freshness is enforced; manual entry
 * (card number / phone) is tokenless like a wallet scan and `qrData` is null.
 */
export async function resolveScanTarget(
  tenantId: string,
  qrPayload: string,
): Promise<ScanResolution> {
  const qrData = await verifyQRPayload(qrPayload);

  if (qrData) {
    const card = await findCardByIdentifier(qrData.cardId, tenantId, { person: true });
    if (!card) return { ok: false, status: 404, error: 'Tarjeta no encontrada' };
    if (!qrData.isWalletScan && card.qr_token !== qrData.qrToken) {
      return {
        ok: false,
        status: 400,
        error: 'Código QR ya fue usado. Pídele al cliente que actualice su código.',
      };
    }
    return { ok: true, card, qrData };
  }

  // Manual lookup: card number first, then phone number.
  const input = qrPayload.trim();
  let card = await findCardByIdentifier(input, tenantId, { person: true });
  if (!card) {
    const person = await findPersonByPhone(tenantId, input);
    if (person) {
      const acct = await prisma.accounts.findFirst({
        where: { tenant_id: tenantId, person_id: person.id },
        select: { id: true },
      });
      if (acct) {
        const found = await prisma.cards.findFirst({
          where: { tenant_id: tenantId, account_id: acct.id },
          orderBy: { created_at: 'desc' },
          select: { id: true },
        });
        // Re-resolve through the helper so the card shape (accounts + balances +
        // person) matches what callers expect.
        if (found) card = await findCardByIdentifier(found.id, tenantId, { person: true });
      }
    }
  }
  if (!card) {
    return { ok: false, status: 404, error: 'Tarjeta no encontrada. Verifica el número o teléfono.' };
  }
  return { ok: true, card, qrData: null };
}
