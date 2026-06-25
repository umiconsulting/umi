import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { TenantsRepository } from './tenants.repository';

/**
 * Tenant shell domain (switcher, capabilities, settings, locations). Imports
 * AuthModule for the guard chain (Auth → TenantAccess → Entitlement).
 */
@Module({
  imports: [AuthModule],
  controllers: [TenantsController],
  providers: [TenantsService, TenantsRepository],
  exports: [TenantsService, TenantsRepository],
})
export class TenantsModule {}
