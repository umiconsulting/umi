import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DashboardOperationsController } from './dashboard-operations.controller';
import { DashboardOperationsRepository } from './dashboard-operations.repository';
import { DashboardOperationsService } from './dashboard-operations.service';

@Module({
  imports: [AuthModule],
  controllers: [DashboardOperationsController],
  providers: [DashboardOperationsRepository, DashboardOperationsService],
})
export class DashboardOperationsModule {}
