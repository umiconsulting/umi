import { Module } from '@nestjs/common';
import { AuthController, PosAuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { AuthGuard } from './auth.guard';
import { MerchantAccessGuard } from './merchant-access.guard';
import { PublicMerchantGuard } from './public-merchant.guard';
import { CustomerAuthGuard } from './customer-auth.guard';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformElevationController } from './platform-elevation.controller';
import { PlatformElevationGuard } from './platform-elevation.guard';
import { PlatformElevationService } from './platform-elevation.service';
import { EntitlementGuard } from './entitlement.guard';
import { RolesGuard } from './roles.guard';
import { MfaService } from './mfa.service';
import { CsrfGuard } from './csrf.guard';

/**
 * Auth domain (D9). Owns login/refresh/logout/reset + the four guards that the
 * rest of the dashboard modules compose with `@UseGuards(...)`:
 *   AuthGuard → MerchantAccessGuard → EntitlementGuard → RolesGuard.
 * PasswordService/JwtService come from the global SharedAuthModule.
 */
@Module({
  controllers: [AuthController, PosAuthController, PlatformElevationController],
  providers: [
    AuthService,
    AuthRepository,
    MfaService,
    AuthGuard,
    MerchantAccessGuard,
    PublicMerchantGuard,
    CustomerAuthGuard,
    PlatformAdminGuard,
    PlatformElevationService,
    PlatformElevationGuard,
    EntitlementGuard,
    RolesGuard,
    CsrfGuard,
  ],
  exports: [
    AuthRepository,
    PlatformElevationService,
    PlatformElevationGuard,
    AuthGuard,
    MerchantAccessGuard,
    PublicMerchantGuard,
    CustomerAuthGuard,
    PlatformAdminGuard,
    EntitlementGuard,
    RolesGuard,
    CsrfGuard,
  ],
})
export class AuthModule {}
