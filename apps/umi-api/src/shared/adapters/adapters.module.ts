import { Global, Module } from '@nestjs/common';
import { AnthropicAdapter } from './anthropic.adapter';
import { VoyageAdapter } from './voyage.adapter';
import { TwilioAdapter } from './twilio.adapter';
import { EmailAdapter } from './email.adapter';
import { ZettleAdapter } from './zettle.adapter';
import { WalletPassAdapter } from './wallet-pass.adapter';

/**
 * One canonical wrapper per external service (the only place each is reached).
 * Global so any module/processor can inject an adapter without re-wiring.
 */
@Global()
@Module({
  providers: [
    AnthropicAdapter,
    VoyageAdapter,
    TwilioAdapter,
    EmailAdapter,
    ZettleAdapter,
    WalletPassAdapter,
  ],
  exports: [
    AnthropicAdapter,
    VoyageAdapter,
    TwilioAdapter,
    EmailAdapter,
    ZettleAdapter,
    WalletPassAdapter,
  ],
})
export class AdaptersModule {}
