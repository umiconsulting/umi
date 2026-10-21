import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PosOfflineController } from './pos-offline.controller';
import { PosOfflineRepository } from './pos-offline.repository';
import { PosOfflineService } from './pos-offline.service';
import { PosCheckoutModule } from '../pos-checkout/pos-checkout.module';
import { PosCartModule } from '../pos-cart/pos-cart.module';
import { KdsModule } from '../kds/kds.module';
import { TableMapModule } from '../table-map/table-map.module';

@Module({
  imports: [AuthModule, PosCheckoutModule, PosCartModule, KdsModule, TableMapModule],
  controllers: [PosOfflineController],
  providers: [PosOfflineRepository, PosOfflineService],
})
export class PosOfflineModule {}
