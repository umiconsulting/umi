/**
 * Google Wallet loyalty pass generation.
 *
 * Classes are pre-created via the REST API.
 * The JWT save URL only contains the loyalty object.
 */

import { SignJWT } from 'jose';
import { formatMXN } from './currency';
import { signWalletBarcode } from './auth';

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
  cardNumber: string;
  customerName: string;
  balanceCentavos: number;
  visitsThisCycle: number;
  visitsRequired: number;
  pendingRewards: number;
  rewardName: string;
  totalVisits: number;
  memberSince: string;
  tenantName?: string;
  tenantSlug?: string;
  primaryColor?: string;
  logoUrl?: string | null;
  topupEnabled?: boolean;
  birthdayRewardName?: string | null;
  lifecycleMessage?: string | null;
}

function getClassId(tenantSlug?: string): string {
  return `${ISSUER_ID}.${tenantSlug ? `${tenantSlug}_${CLASS_ID_PREFIX}` : CLASS_ID_PREFIX}`;
}

function getLoyaltyObject(data: GooglePassData) {
  const remaining = data.visitsRequired - data.visitsThisCycle;
  const objectId = `${ISSUER_ID}.card_${data.cardId}`;

  // Stamp progress: ● for filled, ○ for empty
  const filled = '●'.repeat(data.visitsThisCycle);
  const empty = '○'.repeat(remaining);
  const stampProgress = `${filled}${empty} (${data.visitsThisCycle}/${data.visitsRequired})`;

  // Build text modules to match Apple pass fields
  const textModules: { header: string; body: string; id: string }[] = [
    {
      header: 'MIEMBRO',
      body: data.customerName || 'Cliente',
      id: 'member_name',
    },
    {
      header: data.rewardName.toUpperCase(),
      body: stampProgress,
      id: 'stamp_progress',
    },
  ];

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

  // Reward status
  if (data.pendingRewards > 0) {
    textModules.push({
      header: 'RECOMPENSAS DISPONIBLES',
      body: `${data.pendingRewards} recompensa${data.pendingRewards > 1 ? 's' : ''} — ¡canjéala en tienda!`,
      id: 'pending_rewards',
    });
  } else {
    textModules.push({
      header: 'PRÓXIMA RECOMPENSA',
      body: `${remaining} visita${remaining !== 1 ? 's' : ''} para ${data.rewardName}`,
      id: 'next_reward',
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
        string: String(data.visitsThisCycle),
      },
      label: `Visitas (meta: ${data.visitsRequired})`,
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

export async function updateGoogleWalletObject(data: GooglePassData): Promise<void> {
  if (!isGoogleWalletConfigured()) return;

  try {
    const objectId = `${ISSUER_ID}.card_${data.cardId}`;
    const object = getLoyaltyObject(data);
    const token = await getGoogleAuthToken();

    await fetch(
      `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${encodeURIComponent(objectId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(object),
      }
    );

    // Push a real device notification for the lifecycle message. PATCHing textModules
    // alone updates the card UI but does NOT generate a notification — Google requires
    // an explicit addMessage call (or messages[] entry) with messageType=TEXT_AND_NOTIFY.
    if (data.lifecycleMessage) {
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
        }
      );
      if (!res.ok) {
        console.warn('[Google Wallet] addMessage failed:', res.status, await res.text().catch(() => ''));
      }
    }
  } catch (err) {
    console.error('[Google Wallet] Update failed:', err instanceof Error ? err.message : String(err));
  }
}
