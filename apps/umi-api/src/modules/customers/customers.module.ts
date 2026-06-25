import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantsModule } from '../tenants/tenants.module';
import { CustomersController } from './customers.controller';
import { ConversationsController } from './conversations.controller';
import { CustomersService } from './customers.service';
import { CustomersRepository } from './customers.repository';

/**
 * Customer 360 domain (reads only in Phase 2). Imports AuthModule (guards) and
 * TenantsModule (product entitlements for availability flags).
 */
@Module({
  imports: [AuthModule, TenantsModule],
  controllers: [CustomersController, ConversationsController],
  providers: [CustomersService, CustomersRepository],
})
export class CustomersModule {}
