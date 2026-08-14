import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrivateKey } from 'node:crypto';
import { SignJWT } from 'jose';
import type { AppConfig } from '../../shared/config/config.schema';
import { QrService } from '../../shared/auth/qr.service';
import { formatMxn2 } from '../../shared/format/money';

const WALLET_OBJECTS = 'https://walletobjects.googleapis.com/walletobjects/v1';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';
/** Google's p99 here is well under a second; an unbounded hop loses the update. */
const GOOGLE_TIMEOUT_MS = 8_000;
const TOKEN_TTL_MS = 50 * 60 * 1000;

/**
 * Google Wallet loyalty passes.
 *
 * PORTED FROM `origin/main`, NOT from build-v3. build-v3 forked before the July
 * Google work and its copy of `pass-google.ts` is the June version — it has no
 * Saldo text module, no hero image, and the flat reward copy. Porting the branch
 * we happen to be sitting on would have shipped a silent regression to every
 * Android pass at Kalala and El Gran Ribera. `pass-apple.ts` was identical on
 * both branches, which is why the Apple half did not have this problem.
 *
 * Three details are necessary. Each one was a separate correction in July:
 *
 *  1. SALDO IS A STRING MODULE, not just `secondaryLoyaltyPoints`. Money does not
 *     render inside a `cardTemplateOverride` row, so the card-face override
 *     references this string instead. Both are emitted: the native money field for
 *     the details view, the string for the face.
 *  2. THE HERO IMAGE IS CONTENT-ADDRESSED — `/stamp-strip/{filled}-{required}.png`.
 *     A fixed URL is served from Google's image cache forever and never updates.
 *     Advancing a stamp must change the URL.
 *  3. `pending_rewards` AND `next_reward` MODULE IDS ARE REFERENCED by the class
 *     `cardTemplateOverride`. Renaming them blanks the card face.
 *
 * Unlike Apple, Google is push-only: nothing calls back, so no URL is frozen into
 * an issued pass and there is no web service to host. Updates are a PATCH.
 */
@Injectable()
export class GooglePassService {
  private readonly logger = new Logger(GooglePassService.name);
  private readonly issuerId: string;
  private readonly classPrefix: string;
  private readonly serviceAccountEmail: string;
  private readonly privateKeyPem: string | null;
  private readonly origin: string;
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly qr: QrService,
  ) {
    this.issuerId = (config.get('GOOGLE_WALLET_ISSUER_ID', { infer: true }) ?? '').trim();
    this.classPrefix = (config.get('GOOGLE_WALLET_CLASS_ID', { infer: true }) ?? '').trim();
    this.serviceAccountEmail = (
      config.get('GOOGLE_SERVICE_ACCOUNT_EMAIL', { infer: true }) ?? ''
    ).trim();
    const key = config.get('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', { infer: true });
    // Secret stores hand back the PEM with literal backslash-n. Un-escape once, here.
    this.privateKeyPem = key ? key.replace(/\\n/g, '\n').trim() : null;
    this.origin = (config.get('WALLET_PUBLIC_ORIGIN', { infer: true }) ?? '').replace(/\/$/, '');
  }

  isConfigured(): boolean {
    return !!this.issuerId && !!this.serviceAccountEmail && !!this.privateKeyPem;
  }

  /** `https://pay.google.com/gp/v/save/<jwt>` — the Add to Google Wallet link. */
  async saveUrl(data: GooglePassData): Promise<string> {
    if (!this.isConfigured() || !this.privateKeyPem) {
      throw new Error('Google Wallet is not configured');
    }
    const jwt = await new SignJWT({
      iss: this.serviceAccountEmail,
      aud: 'google',
      typ: 'savetowallet',
      iat: Math.floor(Date.now() / 1000),
      origins: [this.origin],
      payload: { loyaltyObjects: [this.loyaltyObject(data)] },
    })
      .setProtectedHeader({ alg: 'RS256' })
      .sign(createPrivateKey({ key: this.privateKeyPem, format: 'pem' }));
    return `https://pay.google.com/gp/v/save/${jwt}`;
  }

  /**
   * Update the object already in the customer's wallet.
   *
   * Best-effort, like the Apple push: the money write has committed and must not
   * be undone by an unreachable Google. Nothing here throws.
   */
  async updateObject(data: GooglePassData): Promise<void> {
    if (!this.isConfigured()) return;
    const objectId = this.objectId(data.cardId);
    try {
      const token = await this.accessToken();
      if (!token) return;

      const patched = await fetch(
        `${WALLET_OBJECTS}/loyaltyObject/${encodeURIComponent(objectId)}`,
        {
          method: 'PATCH',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify(this.loyaltyObject(data)),
          signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
        },
      );
      // A rejected PATCH means the customer's pass silently keeps stale state.
      if (!patched.ok) {
        this.logger.warn(
          `google_patch_failed object=${objectId} status=${patched.status} ` +
            `${await patched.text().catch(() => '')}`,
        );
        return;
      }

      // PATCHing text modules updates the card but raises NO notification. Google
      // requires an explicit addMessage with TEXT_AND_NOTIFY for the phone to
      // actually tell the customer.
      if (data.lifecycleMessage) {
        await this.notify(objectId, token, data);
      }
    } catch (err) {
      this.logger.warn(`google_update_failed object=${objectId}: ${String(err)}`);
    }
  }

  private async notify(objectId: string, token: string, data: GooglePassData): Promise<void> {
    const res = await fetch(
      `${WALLET_OBJECTS}/loyaltyObject/${encodeURIComponent(objectId)}/addMessage`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            // Unique per send, or Google collapses it into the previous message.
            // Keyed on WHEN the message was set, so re-sending the same message
            // stays one notification and a new message becomes a new one.
            id: `lifecycle_${data.cardId}_${data.lifecycleMessageAt?.getTime() ?? 0}`,
            header: data.merchantName,
            body: data.lifecycleMessage,
            messageType: 'TEXT_AND_NOTIFY',
          },
        }),
        signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      this.logger.warn(
        `google_addmessage_failed object=${objectId} status=${res.status} ` +
          `${await res.text().catch(() => '')}`,
      );
    }
  }

  // ─── OAuth ─────────────────────────────────────────────────────────────────

  /**
   * A service-account access token, by the JWT-bearer grant.
   *
   * umi-cash reached this through `googleapis`, which is a very large dependency
   * for one token exchange. The grant itself is two steps — sign a JWT, POST it —
   * and the key is already loaded here for the save URL, so it is done directly.
   */
  private async accessToken(): Promise<string | null> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
      return this.cachedToken.token;
    }
    if (!this.privateKeyPem) return null;
    const now = Math.floor(Date.now() / 1000);
    const assertion = await new SignJWT({
      iss: this.serviceAccountEmail,
      scope: SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600,
    })
      .setProtectedHeader({ alg: 'RS256' })
      .sign(createPrivateKey({ key: this.privateKeyPem, format: 'pem' }));

    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
    });
    if (!res.ok) {
      this.logger.error(`google_token_failed status=${res.status}`);
      return null;
    }
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) return null;
    this.cachedToken = { token: body.access_token, expiresAt: Date.now() + TOKEN_TTL_MS };
    return body.access_token;
  }

  // ─── the object ────────────────────────────────────────────────────────────

  private objectId(cardId: string): string {
    return `${this.issuerId}.card_${cardId}`;
  }

  private classId(handle: string): string {
    return `${this.issuerId}.${handle}_${this.classPrefix}`;
  }

  private loyaltyObject(data: GooglePassData): Record<string, unknown> {
    return buildLoyaltyObject({
      issuerId: this.issuerId,
      classPrefix: this.classPrefix,
      origin: this.origin,
      barcodeValue: this.qr.signWalletBarcode(data.cardNumber),
      data,
    });
  }
}

/**
 * The loyalty object itself, as a pure function so its shape can be tested
 * without a service account or a network.
 *
 * The three details this exists to protect are named in the class comment above.
 * build-v3 carried a copy of this that had lost all three, which is what a test
 * would have caught and a code review did not.
 */
export function buildLoyaltyObject(input: {
  issuerId: string;
  classPrefix: string;
  origin: string;
  barcodeValue: string;
  data: GooglePassData;
}): Record<string, unknown> {
  const { issuerId, classPrefix, origin, barcodeValue, data } = input;
  const remaining = data.visitsRequired - data.visitsThisCycle;
  const handle = data.merchantHandle ?? '';

  // The stamp progress is DRAWN (heroImage) and the name lives in accountName,
  // so the only text modules left are the genuinely free-form ones.
  const textModules: { header: string; body: string; id: string }[] = [];

  if (data.lifecycleMessage) {
    textModules.push({ header: 'MENSAJE', body: data.lifecycleMessage, id: 'lifecycle_message' });
  }
  if (data.birthdayRewardName) {
    textModules.push({
      header: 'REGALO DE CUMPLEANOS',
      body: `${data.birthdayRewardName} — canjéalo una sola vez durante este mes`,
      id: 'birthday_reward',
    });
  }

  // The copy changes as the reward gets nearer, to keep the line useful on the
  // card face. These two ids are named by the class cardTemplateOverride.
  if (data.pendingRewards > 0) {
    const plural = data.pendingRewards > 1;
    textModules.push({
      header: plural ? 'RECOMPENSAS DISPONIBLES' : 'RECOMPENSA LISTA',
      body: plural
        ? `🎉 Tienes ${data.pendingRewards} ${data.rewardName} — ¡canjéalas en tienda!`
        : `🎉 Tu ${data.rewardName} te espera — ¡canjéala en tienda!`,
      id: 'pending_rewards',
    });
  } else {
    let body: string;
    if (remaining === 1) {
      body = `¡Última visita! Tu próxima compra desbloquea ${data.rewardName} 🎁`;
    } else if (remaining === 2) {
      body = `¡Ya casi! Solo 2 visitas para ${data.rewardName}`;
    } else {
      body = `${remaining} visitas para ${data.rewardName}`;
    }
    textModules.push({ header: 'PRÓXIMA RECOMPENSA', body, id: 'next_reward' });
  }

  // Saldo as a STRING. See the class comment: money does not render in a
  // cardTemplateOverride row, so the face reads this instead.
  if (data.topupEnabled) {
    textModules.push({
      header: 'SALDO',
      body: formatMxn2(data.balanceCentavos),
      id: 'saldo',
    });
  }

  const object: Record<string, unknown> = {
    id: `${issuerId}.card_${data.cardId}`,
    classId: `${issuerId}.${handle}_${classPrefix}`,
    state: 'active',
    accountId: data.cardNumber,
    accountName: data.customerName,
    loyaltyPoints: {
      balance: { string: `${data.visitsThisCycle} / ${data.visitsRequired}` },
      label: 'Visitas',
    },
    barcode: {
      type: 'qrCode',
      value: barcodeValue,
      alternateText: data.cardNumber,
    },
    textModulesData: textModules,
    infoModuleData: {
      labelValueRows: [
        {
          columns: [
            { label: 'Visitas totales', value: String(data.totalVisits) },
            { label: 'Miembro desde', value: monthYear(data.memberSince) },
          ],
        },
        { columns: [{ label: 'Tarjeta', value: data.cardNumber }] },
      ],
    },
    linksModuleData: {
      uris: [
        {
          kind: 'walletobjects#uri',
          uri: `${origin}/${handle}/card`,
          description: 'Ver mi tarjeta',
        },
      ],
    },
  };

  // Content-addressed, so a stamp advance points at a NEW url and Google
  // re-fetches. Skipped without a handle: the classId would be malformed too.
  if (handle) {
    object.heroImage = {
      sourceUri: {
        uri: `${origin}/api/${handle}/stamp-strip/${data.visitsThisCycle}-${data.visitsRequired}.png`,
      },
      contentDescription: {
        defaultValue: {
          language: 'es-MX',
          value: `Progreso: ${data.visitsThisCycle} de ${data.visitsRequired} visitas`,
        },
      },
    };
  }

  if (data.topupEnabled) {
    object.secondaryLoyaltyPoints = {
      balance: { money: { currencyCode: 'MXN', micros: String(data.balanceCentavos * 10_000) } },
      label: 'Saldo',
    };
  }

  return object;
}

export interface GooglePassData {
  cardId: string;
  cardNumber: string;
  customerName: string;
  merchantName: string;
  merchantHandle: string | null;
  balanceCentavos: number;
  visitsThisCycle: number;
  visitsRequired: number;
  pendingRewards: number;
  totalVisits: number;
  rewardName: string;
  memberSince: Date;
  topupEnabled: boolean;
  lifecycleMessage: string | null;
  /** Makes the notification id unique per message, so Google does not collapse it. */
  lifecycleMessageAt?: Date | null;
  birthdayRewardName?: string | null;
}

const MONTH_YEAR = new Intl.DateTimeFormat('es-MX', {
  month: 'long',
  year: 'numeric',
  timeZone: 'America/Mexico_City',
});

function monthYear(date: Date): string {
  return MONTH_YEAR.format(date);
}
