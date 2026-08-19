import { Global, Module } from '@nestjs/common';
import { WalletModule } from '../../modules/wallet/wallet.module';
import { AnthropicAdapter } from './anthropic.adapter';
import { VoyageAdapter } from './voyage.adapter';
import { TwilioAdapter } from './twilio.adapter';
import { EmailAdapter } from './email.adapter';
import { ZettleAdapter } from './zettle.adapter';
import { GeocodeAdapter } from './geocode.adapter';
import { WalletPassAdapter } from './wallet-pass.adapter';

/**
 * One canonical wrapper per external service (the only place each is reached).
 * Global so any module/processor can inject an adapter without re-wiring.
 */
@Global()
@Module({
  // WalletPassAdapter delegates to ApplePushService now that the wallet layer
  // lives in this process rather than behind an HTTP call to umi-cash.
  imports: [WalletModule],
  providers: [
    AnthropicAdapter,
    VoyageAdapter,
    TwilioAdapter,
    EmailAdapter,
    ZettleAdapter,
    WalletPassAdapter,
    GeocodeAdapter,
  ],
  exports: [
    AnthropicAdapter,
    VoyageAdapter,
    TwilioAdapter,
    EmailAdapter,
    ZettleAdapter,
    WalletPassAdapter,
    GeocodeAdapter,
  ],
})
export class AdaptersModule {}
