import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PosOfflineController } from './pos-offline.controller';
import { PosOfflineRepository } from './pos-offline.repository';
import { PosOfflineService } from './pos-offline.service';
import { PosCheckoutModule } from '../pos-checkout/pos-checkout.module';

@Module({
  imports: [AuthModule, PosCheckoutModule],
  controllers: [PosOfflineController],
  providers: [PosOfflineRepository, PosOfflineService],
})
export class PosOfflineModule {}
