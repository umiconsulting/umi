import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { CashController } from './cash.controller';
import type { CashReadService } from './cash-read.service';
import type { WalletPassAdapter } from '../../shared/adapters/wallet-pass.adapter';
import type { RateLimitService } from '../../shared/ratelimit/rate-limit.service';
import type { CashScanService } from './cash-scan.service';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { PERMISSION_KEY } from '../auth/roles.decorator';

const MERCHANT = { merchantId: '9f000000-0000-4000-8000-00000000e001' } as MerchantAccess;
const USER = { id: '9f000000-0000-4000-8000-00000000e002' } as AuthUser;

function controller(): CashController {
  return new CashController(
    {} as CashReadService,
    {} as WalletPassAdapter,
    {} as RateLimitService,
    {} as CashScanService,
  );
}

describe('cash client-error sink', () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => {
      logged.push(String(m));
    });
  });

  it('logs at error level, so it surfaces without knowing to search for it', () => {
    controller().reportClientError(MERCHANT, USER, {
      action: 'scan',
      kind: 'unreachable',
      detail: 'fetch failed',
      online: true,
    });
    expect(logged).toHaveLength(1);
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it('names the café and the staff member who saw it', () => {
    // The line is the only trace of a failure the server never saw. Without both
    // ids it cannot be matched to the request it belongs to.
    controller().reportClientError(MERCHANT, USER, {
      action: 'scan',
      kind: 'offline',
      detail: 'no network',
    });
    const payload = JSON.parse(logged[0].replace('client_error ', ''));
    expect(payload.merchant).toBe(MERCHANT.merchantId);
    expect(payload.staff).toBe(USER.id);
    expect(payload.kind).toBe('offline');
    expect(payload.detail).toBe('no network');
  });

  it('records an omitted `online` as null, not as absent', () => {
    // `navigator.onLine` unknown and `navigator.onLine === false` are different
    // facts, and a key that disappears makes them read the same in a log search.
    controller().reportClientError(MERCHANT, USER, {
      action: 'topup',
      kind: 'malformed',
      detail: 'bad json',
    });
    const payload = JSON.parse(logged[0].replace('client_error ', ''));
    expect(payload).toHaveProperty('online', null);
  });
});

describe('cash customer reward override', () => {
  function harness(result: { cardId: string; customReward: unknown }) {
    const setCustomerReward = vi.fn().mockResolvedValue(result);
    const refreshCard = vi.fn().mockResolvedValue(undefined);
    const instance = new CashController(
      { setCustomerReward } as unknown as CashReadService,
      { refreshCard } as unknown as WalletPassAdapter,
      {} as RateLimitService,
      {} as CashScanService,
    );
    return { instance, setCustomerReward, refreshCard };
  }

  it('requires merchant.manage — the admin-only key', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, CashController.prototype.updateCustomerReward)).toBe(
      'merchant.manage',
    );
  });

  it('passes the tenant and the customer id to the service, then refreshes the card', async () => {
    const reward = { name: 'Postre gratis', description: null };
    const h = harness({ cardId: 'card-1', customReward: reward });
    const out = await h.instance.updateCustomerReward(MERCHANT, 'customer-1', {
      customReward: reward,
    });
    expect(h.setCustomerReward).toHaveBeenCalledWith(MERCHANT.merchantId, 'customer-1', reward);
    expect(h.refreshCard).toHaveBeenCalledWith('card-1');
    expect(out).toEqual({ success: true, customReward: reward });
  });

  it('clears the override with null', async () => {
    const h = harness({ cardId: 'card-1', customReward: null });
    const out = await h.instance.updateCustomerReward(MERCHANT, 'customer-1', {
      customReward: null,
    });
    expect(h.setCustomerReward).toHaveBeenCalledWith(MERCHANT.merchantId, 'customer-1', null);
    expect(out).toEqual({ success: true, customReward: null });
  });
});
