import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
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

  /**
   * The in-app QR the customer shows at the counter — the inverse of the JWT
   * branch of `verifyQRPayload`, and the claim names must stay exactly these:
   * `sub` is read back as the card id and `tok` as the rotating nonce.
   *
   * FIVE MINUTES, and it is the token's own expiry that enforces it. The card
   * page counts down from 300s and refetches, but a customer who screenshots the
   * code is holding a JWT that stops verifying — not a picture that keeps working.
   *
   * Keyed on the UTF-8 bytes of `APP_QR_SECRET` (`jwtKey`), never the raw string
   * used for wallet barcodes. See the dual-derivation warning on the class.
   */
  async signQRPayload(cardId: string, qrToken: string): Promise<string> {
    if (!this.jwtKey) throw new Error('APP_QR_SECRET is not set');
    return new SignJWT({ sub: cardId, tok: qrToken, type: 'SCAN' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(this.jwtKey);
  }

  async verifyQRPayload(payload: string): Promise<QrResult | null> {
    if (!this.jwtKey || !this.hmacKey) return null;
    try {
      const { payload: p } = await jwtVerify(payload, this.jwtKey, {
        algorithms: ['HS256'], // do NOT drop — prevents alg downgrade
      });
      const data = p as { sub?: unknown; tok?: unknown };
      const cardId = String(data.sub ?? '');
      // A verified token with no `sub` is malformed — reject rather than return
      // a valid-looking result with an empty cardId.
      if (!cardId) return null;
      return {
        cardId,
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

  /**
   * The barcode printed on a wallet pass: the card number, then a truncated
   * HMAC so a guessed card number cannot be scanned.
   *
   * This is the inverse of `verifyWalletBarcode` below and MUST stay keyed the
   * same way — the raw secret string, not the UTF-8 bytes used for the in-app
   * JWT. See the dual-derivation warning in the class comment. A pass signed
   * with a differently derived key produces a barcode the register rejects.
   */
  signWalletBarcode(cardNumber: string): string {
    if (!this.hmacKey) throw new Error('APP_QR_SECRET is not set');
    const tag = createHmac('sha256', this.hmacKey).update(cardNumber).digest('hex').slice(0, 16);
    return `${cardNumber}.${tag}`;
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
    if (!timingSafeEqual(Buffer.from(providedHmac), Buffer.from(expectedHmac))) {
      return null;
    }
    return cardNumber;
  }
}
