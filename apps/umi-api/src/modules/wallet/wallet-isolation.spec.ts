import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WalletIsolation } from './wallet-isolation';
import { ApplePassBuilder } from './apple-pass.builder';
import { ApplePushService } from './apple-push.service';
import { GooglePassService } from './google-pass.service';

const testMerchant = '00000000-0000-4000-8000-000000000001';
const config = (extra: Record<string, string> = {}) =>
  ({
    get: (key: string) =>
      ({ WALLET_MODE: 'isolated', WALLET_TEST_MERCHANT_IDS: testMerchant, ...extra })[key],
  }) as never;

afterEach(() => vi.unstubAllGlobals());

describe('isolated wallet tests', () => {
  it('allows only the synthetic merchant and leaves live mode unchanged', () => {
    const policy = new WalletIsolation(config());
    expect(policy.deliveryEnabled).toBe(false);
    expect(() => policy.assertCanIssue(testMerchant)).not.toThrow();
    expect(() => policy.assertCanIssue('real-cafe')).toThrow();
    expect(() => policy.assertCanIssue(null)).toThrow();
    const live = new WalletIsolation(config({ WALLET_MODE: 'live' }));
    expect(live.deliveryEnabled).toBe(true);
    expect(() => live.assertCanIssue('existing-frozen-handle')).not.toThrow();
  });

  it('blocks signing for a copied merchant before either builder reads a key', async () => {
    const apple = new ApplePassBuilder(config(), {} as never);
    const google = new GooglePassService(config(), {} as never);
    await expect(apple.build({ merchantHandle: 'real-cafe' } as never)).rejects.toMatchObject({
      status: 403,
    });
    await expect(google.saveUrl({ merchantHandle: 'real-cafe' } as never)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('blocks Google updates and bulk callbacks even when signing is configured', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const google = new GooglePassService(
      config({
        GOOGLE_WALLET_ISSUER_ID: 'issuer',
        GOOGLE_SERVICE_ACCOUNT_EMAIL: 'test@example.invalid',
        GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: 'unused',
      }),
      {} as never,
    );
    expect(google.isConfigured()).toBe(true);
    expect(await google.updateObject({} as never)).toBe('disabled');
    const refresh = vi.fn();
    expect(
      await google.refreshMerchantObjects(
        [{ cardId: 'copied-card', objectId: 'copied-object' }],
        refresh,
      ),
    ).toMatchObject({ disabled: true, refreshed: 0, failed: 0 });
    expect(refresh).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('blocks every APN path even when a valid provider key is present', async () => {
    const { privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const apple = new ApplePushService(
      config({
        APPLE_APN_KEY: Buffer.from(privateKey).toString('base64'),
        APPLE_APN_KEY_ID: 'test-key',
        APPLE_TEAM_ID: 'test-team',
        APPLE_PASS_TYPE_ID: 'pass.example.test',
      }),
      {} as never,
    );
    expect(apple.isConfigured()).toBe(false);
    expect(await apple.pushCard('copied-card')).toEqual({ sent: 0, failed: 0 });
    expect(await apple.pushMerchant('copied-merchant')).toEqual({ cards: 0, sent: 0 });
    expect(await apple.pushCards(['copied-card'])).toEqual({ cards: 0, sent: 0 });
  });
});
