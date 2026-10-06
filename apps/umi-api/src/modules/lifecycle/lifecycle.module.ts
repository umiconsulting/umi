import { Module } from '@nestjs/common';
import { LifecycleRepository } from './lifecycle.repository';
import { LifecycleService } from './lifecycle.service';

/**
 * Scheduled lifecycle journeys (3d-lifecycle). Worker-only in practice — the
 * LifecycleProcessor + LifecycleScheduler that drive it live in `src/jobs` and
 * are registered in WorkerModule. PgService (DatabaseModule) and EnqueueService
 * (QueueModule) come from the global modules.
 */
@Module({
  providers: [LifecycleRepository, LifecycleService],
  exports: [LifecycleService],
})
export class LifecycleModule {}
