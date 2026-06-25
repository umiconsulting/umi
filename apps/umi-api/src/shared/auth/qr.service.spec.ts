import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { SignJWT } from 'jose';
import { QrService } from './qr.service';

const SECRET = 'a'.repeat(40); // >= 32 chars

function svc(): QrService {
  return withSecret(SECRET);
}
function withSecret(secret: string | undefined): QrService {
  const config = {
    get: (k: string) => (k === 'APP_QR_SECRET' ? secret : undefined),
  } as unknown as ConfigService<Record<string, unknown>, true>;
  return new QrService(config);
}

async function signInAppJwt(cardId: string, tok: string): Promise<string> {
  return new SignJWT({ sub: cardId, tok, type: 'SCAN' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(SECRET));
}

function walletBarcode(cardNumber: string): string {
  const hmac = createHmac('sha256', SECRET).update(cardNumber).digest('hex').slice(0, 16);
  return `${cardNumber}.${hmac}`;
}

describe('QrService.verifyQRPayload', () => {
  it('verifies an in-app JWT (isWalletScan=false, carries the rotating token)', async () => {
    const token = await signInAppJwt('card-uuid-1', 'nonce-abc');
    const r = await svc().verifyQRPayload(token);
    expect(r).toEqual({ cardId: 'card-uuid-1', qrToken: 'nonce-abc', isWalletScan: false });
  });

  it('verifies a static wallet barcode via raw-string HMAC (isWalletScan=true)', async () => {
    const r = await svc().verifyQRPayload(walletBarcode('LYL-1234567890'));
    expect(r).toEqual({ cardId: 'LYL-1234567890', qrToken: '', isWalletScan: true });
  });

  it('rejects a tampered wallet barcode', async () => {
    const r = await svc().verifyQRPayload('LYL-1234567890.deadbeefdeadbeef');
    expect(r).toBeNull();
  });

  it('accepts a legacy bare card number', async () => {
    const r = await svc().verifyQRPayload('EGR-42');
    expect(r).toEqual({ cardId: 'EGR-42', qrToken: '', isWalletScan: true });
  });

  it('returns null on garbage and when the secret is unset', async () => {
    expect(await svc().verifyQRPayload('not a code at all')).toBeNull();
    expect(await withSecret(undefined).verifyQRPayload(walletBarcode('LYL-1'))).toBeNull();
  });

  it('does not verify a barcode signed with a different secret', async () => {
    const other = createHmac('sha256', 'b'.repeat(40)).update('LYL-9').digest('hex').slice(0, 16);
    expect(await svc().verifyQRPayload(`LYL-9.${other}`)).toBeNull();
  });
});
