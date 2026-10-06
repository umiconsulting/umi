import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WalletModule } from '../../modules/wallet/wallet.module';
import type { AppConfig } from '../config/config.schema';
import { AnthropicAdapter } from './anthropic.adapter';
import { DeepseekAdapter } from './deepseek.adapter';
import { LLM_COMPLETION, type LlmCompletionProvider } from './llm-completion';
import { VoyageAdapter } from './voyage.adapter';
import { TwilioAdapter } from './twilio.adapter';
import { EmailAdapter } from './email.adapter';
import { ZettleAdapter } from './zettle.adapter';
import { GeocodeAdapter } from './geocode.adapter';
import { WalletPassAdapter } from './wallet-pass.adapter';
import { FacturapiAdapter } from './facturapi.adapter';

/**
 * One canonical wrapper per external service (the only place each is reached).
 * Global so any module/processor can inject an adapter without re-wiring.
 *
 * `LLM_COMPLETION` binds the single-shot completion provider once, from
 * `LLM_PROVIDER`: AnthropicAdapter (default) or DeepseekAdapter. Callers inject the
 * token, never a concrete provider. The WhatsApp tool loop still injects
 * AnthropicAdapter directly (tool-calling migration is a separate step).
 */
@Global()
@Module({
  // WalletPassAdapter delegates to ApplePushService now that the wallet layer
  // lives in this process rather than behind an HTTP call to umi-cash.
  imports: [WalletModule],
  providers: [
    AnthropicAdapter,
    DeepseekAdapter,
    {
      provide: LLM_COMPLETION,
      useFactory: (
        config: ConfigService<AppConfig, true>,
        anthropic: AnthropicAdapter,
        deepseek: DeepseekAdapter,
      ): LlmCompletionProvider =>
        config.get('LLM_PROVIDER', { infer: true }) === 'deepseek' ? deepseek : anthropic,
      inject: [ConfigService, AnthropicAdapter, DeepseekAdapter],
    },
    VoyageAdapter,
    TwilioAdapter,
    EmailAdapter,
    ZettleAdapter,
    WalletPassAdapter,
    GeocodeAdapter,
    FacturapiAdapter,
  ],
  exports: [
    AnthropicAdapter,
    DeepseekAdapter,
    LLM_COMPLETION,
    VoyageAdapter,
    TwilioAdapter,
    EmailAdapter,
    ZettleAdapter,
    WalletPassAdapter,
    GeocodeAdapter,
    FacturapiAdapter,
  ],
})
export class AdaptersModule {}
