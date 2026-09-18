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
  // The repository is exported for its AUTHORISATION, not its checkout: the tender
  // module's capture route is the same `checkout.commit` permission on the same operator
  // session, and a second copy of that SQL would be a second security gate to keep in
  // step — the kind that drifts quietly wider.
  exports: [PosCheckoutService, PosCheckoutRepository],
})
export class PosCheckoutModule {}
