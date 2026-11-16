import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MetricsController } from './metrics.controller';
import { MetricsInsightService } from './metrics-insight.service';
import { MetricsRepository } from './metrics.repository';
import { MetricsService } from './metrics.service';

@Module({
  imports: [AuthModule],
  controllers: [MetricsController],
  providers: [MetricsRepository, MetricsService, MetricsInsightService],
})
export class MetricsModule {}
