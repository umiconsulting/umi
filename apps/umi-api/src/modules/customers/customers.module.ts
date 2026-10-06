import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { CustomersController } from './customers.controller';
import { ConversationsController } from './conversations.controller';
import { CustomersService } from './customers.service';
import { CustomersRepository } from './customers.repository';

/**
 * Customer 360 domain (reads only in Phase 2). Imports AuthModule (guards) and
 * MerchantsModule (product entitlements for availability flags).
 */
@Module({
  imports: [AuthModule, MerchantsModule],
  controllers: [CustomersController, ConversationsController],
  providers: [CustomersService, CustomersRepository],
})
export class CustomersModule {}
