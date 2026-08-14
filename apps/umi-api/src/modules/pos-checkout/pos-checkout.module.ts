import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntegrityModule } from '../integrity/integrity.module';
import { PosCartModule } from '../pos-cart/pos-cart.module';
import { PosCheckoutController } from './pos-checkout.controller';
import { PosCheckoutRepository } from './pos-checkout.repository';
import { PosCheckoutService } from './pos-checkout.service';

@Module({
  imports: [AuthModule, IntegrityModule, PosCartModule],
  controllers: [PosCheckoutController],
  providers: [PosCheckoutRepository, PosCheckoutService],
  exports: [PosCheckoutService],
})
export class PosCheckoutModule {}
