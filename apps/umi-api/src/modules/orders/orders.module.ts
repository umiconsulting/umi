import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersRepository } from './orders.repository';

/**
 * The dashboard's commercial order read/write surface. Reads `merchant.customer_order`
 * directly (ORDER_MODEL §1) so every channel's order is visible, and advances the
 * commercial status.
 */
@Module({
  imports: [AuthModule, MerchantsModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository],
})
export class OrdersModule {}
