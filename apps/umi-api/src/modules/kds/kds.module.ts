import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { KdsController } from './kds.controller';
import { KdsAdminController, KdsDashboardController } from './kds-dashboard.controller';
import { KdsService } from './kds.service';
import { KdsRepository } from './kds.repository';
import { KdsPosController } from './kds-pos.controller';
import { KdsLocationGuard } from './kds-location.guard';

/**
 * The UMI API owns kitchen projections and transitions.
 * The existing iPad KDS, the POS, and the Dashboard use this module as clients.
 */
@Module({
  imports: [AuthModule, MerchantsModule],
  controllers: [KdsController, KdsDashboardController, KdsAdminController, KdsPosController],
  providers: [KdsService, KdsRepository, KdsLocationGuard],
})
export class KdsModule {}
