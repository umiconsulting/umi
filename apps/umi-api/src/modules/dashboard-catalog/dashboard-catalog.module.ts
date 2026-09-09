import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DashboardCatalogController } from './dashboard-catalog.controller';
import { DashboardCatalogRepository } from './dashboard-catalog.repository';
import { DashboardCatalogService } from './dashboard-catalog.service';

@Module({
  imports: [AuthModule],
  controllers: [DashboardCatalogController],
  providers: [DashboardCatalogRepository, DashboardCatalogService],
})
export class DashboardCatalogModule {}
