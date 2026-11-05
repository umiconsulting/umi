import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';

/** Signing for test merchants is separate from delivery to installed wallets. */
export class WalletIsolation {
  readonly deliveryEnabled: boolean;
  readonly requiresMerchantCheck: boolean;
  private readonly merchants: Set<string>;

  constructor(config: ConfigService<AppConfig, true>) {
    const mode = config.get('WALLET_MODE', { infer: true });
    this.deliveryEnabled = mode !== 'isolated';
    this.requiresMerchantCheck = mode === 'test';
    this.merchants = new Set(
      (config.get('WALLET_TEST_MERCHANT_IDS', { infer: true }) ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    );
  }

  canDeliver(reference: string | null): boolean {
    return (
      this.deliveryEnabled &&
      (!this.requiresMerchantCheck || (!!reference && this.merchants.has(reference)))
    );
  }

  assertCanIssue(reference: string | null): void {
    if (
      (!this.deliveryEnabled || this.requiresMerchantCheck) &&
      (!reference || !this.merchants.has(reference))
    ) {
      throw new ForbiddenException({ error: 'wallet_test_merchant_required' });
    }
  }
}
