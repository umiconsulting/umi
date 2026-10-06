import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PointWebhookController } from './point-webhook.controller';
import { PointWebhookService } from './point-webhook.service';
import { PointCredentialRepository } from './point-credential.repository';
import { PointCredentialService } from './point-credential.service';
import { PointCredentialRenewalService } from './point-credential-renewal.service';
import { PointOAuthController } from './point-oauth.controller';
import { PointTerminalController } from './point-terminal.controller';
import { PointTerminalRepository } from './point-terminal.repository';
import { PointTerminalService } from './point-terminal.service';

/**
 * THE MERCADO PAGO POINT SURFACE: what the vendor tells us, and what the café tells the vendor.
 *
 *   · the webhook receiver (Phase 2) — verify, enqueue, answer;
 *   · the OAuth connection (Phase 5) — send the seller to authorize, take the code back, and
 *     hold the resulting token per merchant, encrypted.
 *
 * ONE import, and it is not optional:
 *
 * - `AuthModule`, because the OAuth and terminal controllers are guarded by the same chain
 *   the fiscal documents and the devices screen use (`AuthGuard`, `MerchantAccessGuard`,
 *   `EntitlementGuard`, `RolesGuard`). Those guards are CLASSES Nest instantiates, and the
 *   merchant guard's own dependency (`AuthRepository`) is exported by `AuthModule` and by
 *   nothing else — so without this import the whole application fails to boot with
 *   `Nest can't resolve dependencies of the MerchantAccessGuard`, not one route at a time.
 *   That is worth stating rather than leaving to be discovered, because the failure is at
 *   STARTUP and nothing in the unit suite reaches it.
 * - `QueueModule` is `@Global()` and is registered once in `AppModule`, and it exports
 *   `EnqueueService`, so this module gets the producer without importing it — the same
 *   arrangement `LeadsModule` documents.
 * - `ConfigService` is global through `AppConfigModule`, also registered in `AppModule`.
 * - `PgService` is global through `DatabaseModule`, as it is for every other repository.
 *
 * The RECEIVER stays as small as it is on purpose: it is the only thing standing inside the
 * vendor's 22-second budget, and everything expensive happens in the worker behind it.
 */
@Module({
  imports: [AuthModule],
  controllers: [PointWebhookController, PointOAuthController, PointTerminalController],
  providers: [
    PointWebhookService,
    PointCredentialRepository,
    PointCredentialService,
    // The renewal sweep is PROVIDED here because its caller lives outside this module — the
    // worker's `SystemProcessor`, which owns the `system` queue this module must not depend on.
    PointCredentialRenewalService,
    PointTerminalRepository,
    PointTerminalService,
  ],
  exports: [
    PointCredentialService,
    PointCredentialRepository,
    PointCredentialRenewalService,
    PointTerminalService,
  ],
})
export class MercadoPagoPointModule {}
