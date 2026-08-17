import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { AuthGuard } from './auth.guard';
import { MerchantAccessGuard } from './merchant-access.guard';
import { PublicMerchantGuard } from './public-merchant.guard';
import { CustomerAuthGuard } from './customer-auth.guard';
import { EntitlementGuard } from './entitlement.guard';
import { RolesGuard } from './roles.guard';
import { MfaService } from './mfa.service';

/**
 * Auth domain (D9). Owns login/refresh/logout/reset + the four guards that the
 * rest of the dashboard modules compose with `@UseGuards(...)`:
 *   AuthGuard → MerchantAccessGuard → EntitlementGuard → RolesGuard.
 * PasswordService/JwtService come from the global SharedAuthModule.
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    MfaService,
    AuthGuard,
    MerchantAccessGuard,
    PublicMerchantGuard,
    CustomerAuthGuard,
    EntitlementGuard,
    RolesGuard,
  ],
  exports: [
    AuthRepository,
    AuthGuard,
    MerchantAccessGuard,
    PublicMerchantGuard,
    CustomerAuthGuard,
    EntitlementGuard,
    RolesGuard,
  ],
})
export class AuthModule {}
