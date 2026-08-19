import { Module } from '@nestjs/common';
import { AppleWebServiceController } from './apple-web-service.controller';
import { GoogleWalletController } from './google-wallet.controller';
import { ApplePassBuilder } from './apple-pass.builder';
import { ApplePushService } from './apple-push.service';
import { GooglePassService } from './google-pass.service';
import { WalletPassRepository } from './wallet-pass.repository';
import { WalletPassService } from './wallet-pass.service';

/**
 * The wallet layer: the code that keeps an issued wallet pass alive, on both
 * platforms.
 *
 * It moved here from umi-cash because umi-cash reached Postgres straight from
 * Vercel, which blocked the D6 network restriction, Supabase "Enforce SSL", and
 * any move off Vercel. umi-cash keeps ANSWERING the frozen pass URL — host and
 * path are signed into every issued Apple pass, so it can never be decommissioned
 * — but it now forwards that prefix here instead of querying the database.
 *
 * Apple and Google are not symmetric, and the asymmetry drives the design:
 *   - Apple PULLS. It calls back with a token, so this module hosts a web service
 *     on a frozen path and must re-sign a pass on every request.
 *   - Google is PUSHED. Nothing calls back, so an update is a PATCH we make. The
 *     one url Google stores is the hero image, which is why that is served here
 *     too and proxied on the same host.
 *
 * This module owns no guard and no RLS context on purpose. See
 * `apple-web-service.controller.ts` and `wallet-pass.repository.ts`.
 */
// QrService (barcode signing) comes from the @Global SharedAuthModule.
@Module({
  controllers: [AppleWebServiceController, GoogleWalletController],
  providers: [
    WalletPassService,
    WalletPassRepository,
    ApplePassBuilder,
    ApplePushService,
    GooglePassService,
  ],
  // `WalletPassRepository` is exported for the PLATFORM ops surface, which reads
  // `passHealth` — a counter that had no caller at all until then.
  exports: [WalletPassService, ApplePushService, WalletPassRepository],
})
export class WalletModule {}
