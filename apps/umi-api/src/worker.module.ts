import { Module } from '@nestjs/common';
import { AppConfigModule } from './shared/config/config.module';
import { DatabaseModule } from './shared/database/database.module';
import { AdaptersModule } from './shared/adapters/adapters.module';
import { LoggingModule } from './shared/logging/logging.module';
import { QueueModule } from './jobs/queue.module';
import { SystemProcessor } from './jobs/system.processor';
import { DeadLetterService } from './jobs/dead-letter.service';
import { OutboxRelayService } from './jobs/outbox-relay.service';

/**
 * Root module for the WORKER process. Same shared infrastructure as the web
 * app, plus the BullMQ @Processor classes. As domains land in later phases,
 * their processors are registered here (turns, enrichment, outbound, …).
 */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    AdaptersModule,
    LoggingModule,
    QueueModule,
  ],
  // Worker-only consumers: BullMQ processors, the dead-letter sink they route
  // terminal failures to, and the transactional-outbox relay (inert until
  // OUTBOX_RELAY_ENABLED). EnqueueService/QueueRepository/OutboxRouter come from
  // the global QueueModule.
  providers: [DeadLetterService, OutboxRelayService, SystemProcessor],
})
export class WorkerModule {}
