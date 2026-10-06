/**
 * Google Wallet loyalty pass generation.
 *
 * Classes are pre-created via the REST API.
 * The JWT save URL only contains the loyalty object.
 */

import { SignJWT } from 'jose';
import { signWalletBarcode } from './auth';
import { formatMXN } from './currency';
import {
  ladderSummary,
  nextRewardCopy,
  pendingRewardsCopy,
  profileFromWalletFields,
  stripState,
} from './reward-tiers';

const ISSUER_ID = (process.env.GOOGLE_WALLET_ISSUER_ID || '').trim();
const CLASS_ID_PREFIX = (process.env.GOOGLE_WALLET_CLASS_ID || 'loyalty_v2').trim();
const SERVICE_ACCOUNT_EMAIL = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://cash.umiconsulting.co').trim();

export function isGoogleWalletConfigured(): boolean {
  return !!(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY &&
    process.env.GOOGLE_WALLET_ISSUER_ID
  );
}

export interface GooglePassData {
  cardId: string;
  /**
   * Full wallet object id the customer actually saved (loyalty.passes.provider_object_id).
   * A card re-import mints a new uuid, so the id derived from cardId can name an object
   * nobody holds — when the recorded id exists it wins; the derived id is the fallback
   * for fresh passes that have no row yet.
   */
  objectId?: string | null;
  cardNumber: string;
  customerName: string;
  balanceCentavos: number;
  visitsThisCycle: number;
  visitsRequired: number;
  pendingRewards: number;
  rewardName: string;
  /**
   * Two-tier ladder: the lower tier the customer may cash out before the cycle
   * completes (see reward-tiers.ts). null/undefined = single reward.
   */
  baseReward?: { visitsRequired: number; rewardName: string } | null;
  /** Banked rewards that must be honored as the lower tier (cards.metadata.pending_tier1). */
  pendingTier1?: number;
  totalVisits: number;
  memberSince: string;
  tenantName?: string;
  tenantSlug?: string;
  primaryColor?: string;
  logoUrl?: string | null;
  topupEnabled?: boolean;
  birthdayRewardName?: string | null;
  lifecycleMessage?: string | null;
  /**
   * Re-render only: PATCH the object (lifecycle text module included) but skip the
   * addMessage notification. For settings-driven refreshes of passes whose cached
   * moment the customer has already been notified about.
   */
  silent?: boolean;
}

function getClassId(tenantSlug?: string): string {
  return `${ISSUER_ID}.${tenantSlug ? `${tenantSlug}_${CLASS_ID_PREFIX}` : CLASS_ID_PREFIX}`;
}

function resolveObjectId(data: GooglePassData): string {
  return data.objectId || `${ISSUER_ID}.card_${data.cardId}`;
}

function getLoyaltyObject(data: GooglePassData) {
  const objectId = resolveObjectId(data);
  const profile = profileFromWalletFields(data);
  const pendingTier1 = data.pendingTier1 ?? 0;

  // Visual stamp progress lives in the heroImage (a rendered stamp strip); the
  // customer name lives in accountName. So the only text modules left are the
  // genuinely free-form ones: lifecycle message, birthday, and reward status.
  const textModules: { header: string; body: string; id: string }[] = [];

  // Lifecycle message (welcome/winback/expiring) — surfaces first so it's prominent
  if (data.lifecycleMessage) {
    textModules.unshift({
      header: 'MENSAJE',
      body: data.lifecycleMessage,
      id: 'lifecycle_message',
    });
  }

  // Birthday reward
  if (data.birthdayRewardName) {
    textModules.push({
      header: 'REGALO DE CUMPLEANOS',
      body: `${data.birthdayRewardName} — canjéalo una sola vez durante este mes`,
      id: 'birthday_reward',
    });
  }

  // Reward status — copy escalates as the customer nears the reward so the line
  // pulls its weight on the card face (surfaced there by the class cardTemplateOverride)
  // and in the details view. The `pending_rewards` / `next_reward` ids are referenced
  // by that override — keep them stable. Copy lives in reward-tiers.ts, shared with
  // the Apple pass and the web card.
  const pending = pendingRewardsCopy(profile, data.pendingRewards, pendingTier1);
  if (pending) textModules.push({ ...pending, id: 'pending_rewards' });
  // Single reward: the progress line yields to the banked reward (as before). On a
  // ladder both show — a banked drink doesn't stop the running cycle from mattering,
  // and the "o 2 visitas más y ..." choice is the whole point.
  if (!pending || profile.baseTier) {
    textModules.push({ ...nextRewardCopy(profile, data.visitsThisCycle), id: 'next_reward' });
  }

  // Saldo as a STRING text module. `secondaryLoyaltyPoints` (money) is the native
  // balance display, but money does NOT render inside a cardTemplateOverride row —
  // so when the card-face override is active, its row references this string instead.
  // Kept in sync with the balance on every object update.
  if (data.topupEnabled !== false) {
    textModules.push({
      header: 'SALDO',
      body: formatMXN(data.balanceCentavos),
      id: 'saldo',
    });
  }

  const object: Record<string, unknown> = {
    id: objectId,
    classId: getClassId(data.tenantSlug),
    state: 'active',
    accountId: data.cardNumber,
    accountName: data.customerName || 'Cliente',
    loyaltyPoints: {
      balance: {
        string: `${data.visitsThisCycle} / ${data.visitsRequired}`,
      },
      label: 'Visitas',
    },
    barcode: {
      type: 'qrCode',
      value: signWalletBarcode(data.cardNumber),
      alternateText: data.cardNumber,
    },
    textModulesData: textModules,
    infoModuleData: {
      labelValueRows: [
        {
          columns: [
            { label: 'Visitas totales', value: String(data.totalVisits) },
            {
              label: 'Miembro desde',
              value: new Intl.DateTimeFormat('es-MX', {
                month: 'long',
                year: 'numeric',
                timeZone: 'America/Mexico_City',
              }).format(new Date(data.memberSince)),
            },
          ],
        },
        {
          columns: [
            { label: 'Tarjeta', value: data.cardNumber },
          ],
        },
        // Ladder tenants spell out both tiers in the details view.
        ...(profile.baseTier
          ? [{ columns: [{ label: 'Recompensas', value: ladderSummary(profile) ?? '' }] }]
          : []),
      ],
    },
    linksModuleData: {
      uris: [
        {
          kind: 'walletobjects#uri',
          uri: `${APP_URL}/${data.tenantSlug || ''}/card`,
          description: 'Ver mi tarjeta',
        },
      ],
    },
  };

  // Visual stamp card (Google's analog of the Apple strip). Content-addressed by state
  // so a stamp advance points at a new URL and Google re-fetches it; a fixed URL would be
  // served from Google's image cache and never update. Skipped when tenantSlug is absent —
  // the URL (and the whole pass, whose classId is slug-derived) would be malformed anyway.
  // On a ladder the state carries the bonus boundary (`-b7`) so the extra slots render
  // in their own color.
  if (data.tenantSlug) {
    object.heroImage = {
      sourceUri: {
        uri: `${APP_URL}/api/${data.tenantSlug}/stamp-strip/${stripState(profile, data.visitsThisCycle)}.png`,
      },
      contentDescription: {
        defaultValue: {
          language: 'es-MX',
          value: `Progreso: ${data.visitsThisCycle} de ${data.visitsRequired} visitas`,
        },
      },
    };
  }

  // Balance — only when topup/monedero is enabled (matches Apple pass)
  if (data.topupEnabled !== false) {
    object.secondaryLoyaltyPoints = {
      balance: {
        money: {
          currencyCode: 'MXN',
          micros: String(data.balanceCentavos * 10_000),
        },
      },
      label: 'Saldo',
    };
  }

  return object;
}

export async function generateGoogleWalletURL(data: GooglePassData): Promise<string> {
  if (!isGoogleWalletConfigured()) {
    throw new Error('Google Wallet not configured. Set GOOGLE_SERVICE_ACCOUNT_* env vars.');
  }

  const privateKeyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, '\n').trim();
  const privateKeyBase64 = privateKeyRaw.replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----|-----END (?:RSA )?PRIVATE KEY-----|\n|\r/g, '');
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    Buffer.from(privateKeyBase64, 'base64'),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const loyaltyObject = getLoyaltyObject(data);

  const payload = {
    iss: SERVICE_ACCOUNT_EMAIL,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins: [APP_URL],
    payload: {
      loyaltyObjects: [loyaltyObject],
    },
  };

  const jwt = await new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'RS256' })
    .sign(privateKey);

  return `https://pay.google.com/gp/v/save/${jwt}`;
}

// Every hop to Google is bounded: an unbounded one keeps the invocation alive until
// the platform kills it, which loses the wallet update AND (before afterResponse) held
// the scan response hostage. Google's own p99 here is well under a second.
const GOOGLE_TIMEOUT_MS = 8_000;

/** Bound a promise that carries no cancellation of its own (googleapis' token fetch). */
function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer));
}

// Singleton — GoogleAuth and its OAuth client are expensive to re-create on every wallet update
let googleAuthClient: any = null;
async function getGoogleAuthToken(): Promise<string> {
  if (!googleAuthClient) {
    const { google } = await import('googleapis');
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'],
    });
    googleAuthClient = await auth.getClient();
  }
  const token = await googleAuthClient.getAccessToken();
  return token.token as string;
}

/** Resolves true when the object PATCH was accepted; false on any failure (already logged). */
export async function updateGoogleWalletObject(data: GooglePassData): Promise<boolean> {
  if (!isGoogleWalletConfigured()) return false;

  try {
    const objectId = resolveObjectId(data);
    const object = getLoyaltyObject(data);
    const token = await withTimeout(getGoogleAuthToken(), GOOGLE_TIMEOUT_MS, 'google auth token');

    const patched = await fetch(
      `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${encodeURIComponent(objectId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(object),
        signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
      }
    );
    // A rejected PATCH means the customer's pass silently keeps stale state — say so.
    if (!patched.ok) {
      console.warn('[Google Wallet] PATCH failed:', patched.status, await patched.text().catch(() => ''));
      return false;
    }

    // Push a real device notification for the lifecycle message. PATCHing textModules
    // alone updates the card UI but does NOT generate a notification — Google requires
    // an explicit addMessage call (or messages[] entry) with messageType=TEXT_AND_NOTIFY.
    if (data.lifecycleMessage && !data.silent) {
      const res = await fetch(
        `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${encodeURIComponent(objectId)}/addMessage`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              id: `lifecycle_${data.cardId}_${Date.now()}`,
              header: data.tenantName || 'Mensaje',
              body: data.lifecycleMessage,
              messageType: 'TEXT_AND_NOTIFY',
            },
          }),
          signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
        }
      );
      if (!res.ok) {
        console.warn('[Google Wallet] addMessage failed:', res.status, await res.text().catch(() => ''));
      }
    }
    return true;
  } catch (err) {
    console.error('[Google Wallet] Update failed:', err instanceof Error ? err.message : String(err));
    return false;
  }
}
