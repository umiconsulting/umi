import { describe, expect, it, vi } from 'vitest';
import type { MerchantAccess } from '../auth/auth.types';
import { CashController } from './cash.controller';
import { CashMerchantController } from './cash-merchant.controller';

const MERCHANT = { merchantId: '9f000000-0000-4000-8000-00000000a001' } as MerchantAccess;

function byRef(changed: boolean) {
  const cash = { updateSettings: vi.fn().mockResolvedValue(changed) };
  const walletPass = { refreshMerchant: vi.fn() };
  const controller = new CashController(
    cash as never,
    walletPass as never,
    {} as never,
    {} as never,
  );
  return { controller, cash, walletPass };
}

function merchantId(changed: boolean) {
  const cash = { updateSettings: vi.fn().mockResolvedValue(changed) };
  const walletPass = { refreshMerchant: vi.fn() };
  const controller = new CashMerchantController(cash as never, {} as never, walletPass as never);
  return { controller, cash, walletPass };
}

describe('Cash settings PATCH refresh', () => {
  it('does not refresh every pass for an empty byRef PATCH', async () => {
    const h = byRef(false);
    await expect(h.controller.updateSettings(MERCHANT, {})).resolves.toEqual({ ok: true });
    expect(h.cash.updateSettings).toHaveBeenCalledWith(MERCHANT.merchantId, {});
    expect(h.walletPass.refreshMerchant).not.toHaveBeenCalled();
  });

  it('does not refresh every pass for an empty merchant-id PATCH', async () => {
    const h = merchantId(false);
    await expect(h.controller.updateSettings(MERCHANT, {})).resolves.toEqual({ ok: true });
    expect(h.walletPass.refreshMerchant).not.toHaveBeenCalled();
  });

  it('refreshes when the byRef PATCH changed a field', async () => {
    const h = byRef(true);
    await h.controller.updateSettings(MERCHANT, { topupEnabled: true });
    expect(h.walletPass.refreshMerchant).toHaveBeenCalledWith(MERCHANT.merchantId);
  });

  it('refreshes when the merchant-id PATCH changed a field', async () => {
    const h = merchantId(true);
    await h.controller.updateSettings(MERCHANT, { topupEnabled: true });
    expect(h.walletPass.refreshMerchant).toHaveBeenCalledWith(MERCHANT.merchantId);
  });
});
