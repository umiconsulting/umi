import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MetricsController } from './metrics.controller';
import { MetricsRepository } from './metrics.repository';
import { MetricsService } from './metrics.service';

@Module({
  imports: [AuthModule],
  controllers: [MetricsController],
  providers: [MetricsRepository, MetricsService],
})
export class MetricsModule {}
