import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { jwtVerify } from 'jose';
import type { AppConfig } from '../config/config.schema';

export interface QrResult {
  cardId: string; // card UUID (in-app JWT) OR card_number (wallet/legacy barcode)
  qrToken: string; // the rotating nonce (JWT only); '' for wallet/legacy
  isWalletScan: boolean;
}

/**
 * QR verification — ported BYTE-FOR-BYTE from umi-cash `auth.ts` so QR codes
 * already issued to live customer wallet passes keep verifying.
 *
 * ⚠️ DUAL KEY DERIVATION (do not "simplify"): `APP_QR_SECRET` is consumed two
 * different ways from the SAME string:
 *   - in-app QR = HS256 JWT keyed on `TextEncoder().encode(secret)` (UTF-8 bytes)
 *   - wallet barcode = HMAC-SHA256 keyed on the RAW string (Node coerces to utf8)
 * These yield equivalent bytes ONLY if the secret is never pre-transformed
 * (no base64, no trim). Unifying them silently breaks every issued pass.
 *
 * Verify order (first success wins): JWT → wallet HMAC barcode → legacy bare
 * `PREFIX-digits`. The single-use token check + qr_token rotation live in the
 * SCAN flow (not here), exactly as in umi-cash.
 */
@Injectable()
export class QrService {
  private readonly jwtKey?: Uint8Array; // for jose (UTF-8 bytes)
  private readonly hmacKey?: string; // for createHmac (raw string)

  constructor(config: ConfigService<AppConfig, true>) {
    const raw = config.get('APP_QR_SECRET', { infer: true });
    if (raw) {
      this.jwtKey = new TextEncoder().encode(raw);
      this.hmacKey = raw;
    }
  }

  /** crypto.randomBytes(bytes).toString('hex') — the qr_token nonce generator. */
  generateRandomToken(bytes = 16): string {
    return randomBytes(bytes).toString('hex');
  }

  async verifyQRPayload(payload: string): Promise<QrResult | null> {
    if (!this.jwtKey || !this.hmacKey) return null;
    try {
      const { payload: p } = await jwtVerify(payload, this.jwtKey, {
        algorithms: ['HS256'], // do NOT drop — prevents alg downgrade
      });
      const data = p as { sub?: unknown; tok?: unknown };
      return {
        cardId: String(data.sub ?? ''),
        qrToken: String(data.tok ?? ''),
        isWalletScan: false,
      };
    } catch {
      const cardNumber = this.verifyWalletBarcode(payload);
      if (cardNumber) return { cardId: cardNumber, qrToken: '', isWalletScan: true };
      if (/^[A-Z]+-\d+$/.test(payload)) {
        return { cardId: payload, qrToken: '', isWalletScan: true };
      }
      return null;
    }
  }

  /** "<cardNumber>.<first 16 hex of HMAC-SHA256(cardNumber, rawSecret)>". */
  private verifyWalletBarcode(payload: string): string | null {
    if (!this.hmacKey) return null;
    const dotIndex = payload.lastIndexOf('.'); // split on the LAST dot (contract)
    if (dotIndex === -1) return null;
    const cardNumber = payload.slice(0, dotIndex);
    const providedHmac = payload.slice(dotIndex + 1);
    if (!cardNumber || !providedHmac) return null;
    const expectedHmac = createHmac('sha256', this.hmacKey)
      .update(cardNumber)
      .digest('hex')
      .slice(0, 16); // 8-byte truncated tag, lowercase hex
    if (providedHmac.length !== expectedHmac.length) return null;
    if (
      !timingSafeEqual(Buffer.from(providedHmac), Buffer.from(expectedHmac))
    ) {
      return null;
    }
    return cardNumber;
  }
}
