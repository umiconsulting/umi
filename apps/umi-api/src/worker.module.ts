import { Module } from '@nestjs/common';
import { AppConfigModule } from './shared/config/config.module';
import { DatabaseModule } from './shared/database/database.module';
import { AdaptersModule } from './shared/adapters/adapters.module';
import { LoggingModule } from './shared/logging/logging.module';
import { SharedAuthModule } from './shared/auth/auth.shared.module';
import { QueueModule } from './jobs/queue.module';
import { SystemProcessor } from './jobs/system.processor';
import { TurnsProcessor } from './jobs/turns.processor';
import { OutboundProcessor } from './jobs/outbound.processor';
import { EnrichmentProcessor } from './jobs/enrichment.processor';
import { IntegrationsProcessor } from './jobs/integrations.processor';
import { LifecycleProcessor } from './jobs/lifecycle.processor';
import { LifecycleScheduler } from './jobs/lifecycle.scheduler';
import { LeadsScheduler } from './jobs/leads.scheduler';
import { OutboxRoutesRegistrar } from './jobs/outbox-routes';
import { DeadLetterService } from './jobs/dead-letter.service';
import { OutboxRelayService } from './jobs/outbox-relay.service';
import { IdentityModule } from './modules/identity/identity.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { LifecycleModule } from './modules/lifecycle/lifecycle.module';
import { LeadsModule } from './modules/leads/leads.module';
import { PosCustomerValueModule } from './modules/pos-customer-value/pos-customer-value.module';
import { CustomerValueExpiryScheduler } from './jobs/customer-value-expiry.scheduler';
import { MercadoPagoPointProcessor } from './jobs/mercado-pago-point.processor';
import { PointCredentialRenewalScheduler } from './jobs/mp-point-credential.scheduler';
import { PointAttemptHealthScheduler } from './jobs/mp-point-attempt-health.scheduler';
import { MercadoPagoPointModule } from './modules/mercado-pago/mercadopago-point.module';
import { ReleaseModule } from './shared/release/release.module';
import { RateLimitModule } from './shared/ratelimit/rate-limit.module';
import { UsageModule } from './shared/usage/usage.module';
import { TenderModule } from './modules/tender/tender.module';

/**
 * Root module for the WORKER process. Same shared infrastructure as the web
 * app, plus the BullMQ @Processor classes. ConversationsModule supplies the turn
 * engine services (3b); the enrichment/outbound processors land in 3d.
 */
@Module({
  imports: [
    AppConfigModule,
    RateLimitModule,
    ReleaseModule,
    UsageModule,
    DatabaseModule,
    AdaptersModule,
    LoggingModule,
    // The web AppModule pulls in the global SharedAuthModule; the worker is a
    // separate Nest root, so it must import it too — ConversationsModule's turn
    // engine transitively needs PasswordService from this layer.
    SharedAuthModule,
    QueueModule,
    IdentityModule,
    ConversationsModule,
    LifecycleModule,
    LeadsModule,
    PosCustomerValueModule,
    // The Point notification job resolves a tender attempt, so the worker needs the
    // tender path itself — the same module the web process uses, not a second copy of it.
    TenderModule,
    // The D8 renewal sweep is a job, so the worker is the process that holds it. Imported
    // directly as well as through `TenderModule`, because the service it calls is this module's
    // own provider and its other half — the OAuth credential — is what the sweep renews.
    MercadoPagoPointModule,
  ],
  // Worker-only consumers: BullMQ processors, the dead-letter sink they route
  // terminal failures to, and the transactional-outbox relay (inert until
  // OUTBOX_RELAY_ENABLED). EnqueueService/QueueRepository/OutboxRouter come from
  // the global QueueModule.
  providers: [
    DeadLetterService,
    OutboxRelayService,
    OutboxRoutesRegistrar,
    SystemProcessor,
    TurnsProcessor,
    OutboundProcessor,
    EnrichmentProcessor,
    IntegrationsProcessor,
    LifecycleProcessor,
    LifecycleScheduler,
    LeadsScheduler,
    CustomerValueExpiryScheduler,
    PointCredentialRenewalScheduler,
    PointAttemptHealthScheduler,
    MercadoPagoPointProcessor,
  ],
})
export class WorkerModule {}
