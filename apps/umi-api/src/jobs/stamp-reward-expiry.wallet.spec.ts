import { expect, it } from 'vitest';
import { StampRewardExpiryWallet } from './stamp-reward-expiry.wallet';

it('keeps the refresh pending when either wallet platform fails', async () => {
  const wallet = new StampRewardExpiryWallet(
    { pushTokensForCard: async () => [{ pushToken: 'fixture-device' }] } as never,
    { isConfigured: () => true, pushCard: async () => ({ sent: 0, failed: 1 }) } as never,
    { refreshGoogleObjectWithOutcome: async () => true } as never,
  );
  expect(await wallet.refresh('fixture-card')).toBe(false);
});

it('finishes a refresh only after both applicable platforms succeed', async () => {
  const wallet = new StampRewardExpiryWallet(
    { pushTokensForCard: async () => [{ pushToken: 'fixture-device' }] } as never,
    { isConfigured: () => true, pushCard: async () => ({ sent: 1, failed: 0 }) } as never,
    { refreshGoogleObjectWithOutcome: async () => true } as never,
  );
  expect(await wallet.refresh('fixture-card')).toBe(true);
});

it('retains the marker when Apple has a registered device but lacks credentials', async () => {
  const wallet = new StampRewardExpiryWallet(
    { pushTokensForCard: async () => [{ pushToken: 'fixture-device' }] } as never,
    { isConfigured: () => false } as never,
    { refreshGoogleObjectWithOutcome: async () => true } as never,
  );
  expect(await wallet.refresh('fixture-card')).toBe(false);
});
