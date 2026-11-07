import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DashboardOperationsController } from './dashboard-operations.controller';
import { DashboardOperationsRepository } from './dashboard-operations.repository';
import { DashboardOperationsService } from './dashboard-operations.service';
import { SalesAnalysisController } from './sales-analysis.controller';
import { SalesAnalysisRepository } from './sales-analysis.repository';
import { SalesAnalysisService } from './sales-analysis.service';

@Module({
  imports: [AuthModule],
  controllers: [DashboardOperationsController, SalesAnalysisController],
  providers: [
    DashboardOperationsRepository,
    DashboardOperationsService,
    SalesAnalysisRepository,
    SalesAnalysisService,
  ],
})
export class DashboardOperationsModule {}
