import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantsModule } from '../tenants/tenants.module';
import { CashController } from './cash.controller';
import { CashTenantController } from './cash-tenant.controller';
import { CashReadService } from './cash-read.service';
import { CashRepository } from './cash.repository';
import { CashWriteController } from './cash-write.controller';
import { CashWriteService } from './cash-write.service';
import { CashWriteRepository } from './cash-write.repository';
import { CashScanController } from './cash-scan.controller';
import { CashScanService } from './cash-scan.service';
import { CashScanRepository } from './cash-scan.repository';
import { CashCustomerController } from './cash-customer.controller';
import { CashRegisterService } from './cash-register.service';
import { CashRegisterRepository } from './cash-register.repository';
import { CustomerSessionService } from './customer-session.service';

/**
 * Cash domain — reads (analytics, customers, gift-cards) + live customer-facing
 * writes on canonical loyalty.*: top-up, purchase, gift-card issue/redeem, the
 * loyalty scan (visit/redeem/birthday), and customer self-registration. Staff
 * routes are dashboard-auth gated; the gift redeem/info + registration routes
 * are public (slug-resolved, rate-limited). QrService/WalletPassAdapter/
 * RateLimitService come from global modules.
 */
@Module({
  imports: [AuthModule, TenantsModule],
  controllers: [
    CashController,
    CashTenantController,
    CashWriteController,
    CashScanController,
    CashCustomerController,
  ],
  providers: [
    CashReadService,
    CashRepository,
    CashWriteService,
    CashWriteRepository,
    CashScanService,
    CashScanRepository,
    CashRegisterService,
    CashRegisterRepository,
    CustomerSessionService,
  ],
})
export class CashModule {}
