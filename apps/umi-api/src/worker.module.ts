import { Module } from '@nestjs/common';
import { AppConfigModule } from './shared/config/config.module';
import { DatabaseModule } from './shared/database/database.module';
import { AdaptersModule } from './shared/adapters/adapters.module';
import { LoggingModule } from './shared/logging/logging.module';
import { QueueModule } from './jobs/queue.module';
import { SystemProcessor } from './jobs/system.processor';

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
  providers: [SystemProcessor],
})
export class WorkerModule {}
