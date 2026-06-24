import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * Health domain. The `system` queue (for the Redis ping) and PgService come
 * from the global QueueModule / DatabaseModule.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
