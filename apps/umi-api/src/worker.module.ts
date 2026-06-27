import { Module } from '@nestjs/common';
import { AppConfigModule } from './shared/config/config.module';
import { DatabaseModule } from './shared/database/database.module';
import { AdaptersModule } from './shared/adapters/adapters.module';
import { LoggingModule } from './shared/logging/logging.module';
import { QueueModule } from './jobs/queue.module';
import { SystemProcessor } from './jobs/system.processor';
import { TurnsProcessor } from './jobs/turns.processor';
import { OutboundProcessor } from './jobs/outbound.processor';
import { EnrichmentProcessor } from './jobs/enrichment.processor';
import { IntegrationsProcessor } from './jobs/integrations.processor';
import { LifecycleProcessor } from './jobs/lifecycle.processor';
import { LifecycleScheduler } from './jobs/lifecycle.scheduler';
import { OutboxRoutesRegistrar } from './jobs/outbox-routes';
import { DeadLetterService } from './jobs/dead-letter.service';
import { OutboxRelayService } from './jobs/outbox-relay.service';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { LifecycleModule } from './modules/lifecycle/lifecycle.module';

/**
 * Root module for the WORKER process. Same shared infrastructure as the web
 * app, plus the BullMQ @Processor classes. ConversationsModule supplies the turn
 * engine services (3b); the enrichment/outbound processors land in 3d.
 */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    AdaptersModule,
    LoggingModule,
    QueueModule,
    ConversationsModule,
    LifecycleModule,
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
  ],
})
export class WorkerModule {}
