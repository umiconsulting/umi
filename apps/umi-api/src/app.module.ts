import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AppConfigModule } from './shared/config/config.module';
import { DatabaseModule } from './shared/database/database.module';
import { RequestContextMiddleware } from './shared/database/request-context.middleware';
import { AdaptersModule } from './shared/adapters/adapters.module';
import { LoggingModule } from './shared/logging/logging.module';
import { LoggingInterceptor } from './shared/logging/logging.interceptor';
import { AllExceptionsFilter } from './shared/http/all-exceptions.filter';
import { SharedAuthModule } from './shared/auth/auth.shared.module';
import { RateLimitModule } from './shared/ratelimit/rate-limit.module';
import { QueueModule } from './jobs/queue.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { IdentityModule } from './modules/identity/identity.module';
import { MerchantsModule } from './modules/merchants/merchants.module';
import { StaffModule } from './modules/staff/staff.module';
import { BusinessHoursModule } from './modules/business-hours/business-hours.module';
import { VoiceModule } from './modules/voice/voice.module';
import { CustomersModule } from './modules/customers/customers.module';
import { CashModule } from './modules/cash/cash.module';
import { KdsModule } from './modules/kds/kds.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { LeadsModule } from './modules/leads/leads.module';
import { IntegrityModule } from './modules/integrity/integrity.module';
import { OperationsModule } from './shared/operations/operations.module';
import { OperationalInterceptor } from './shared/operations/operational.interceptor';
import { IpRateLimitGuard } from './shared/operations/ip-rate-limit.guard';
import { DevicesModule } from './modules/devices/devices.module';
import { PosEntryModule } from './modules/pos-entry/pos-entry.module';
import { PosCatalogModule } from './modules/pos-catalog/pos-catalog.module';
import { PosCartModule } from './modules/pos-cart/pos-cart.module';
import { PosCheckoutModule } from './modules/pos-checkout/pos-checkout.module';
import { PosOfflineModule } from './modules/pos-offline/pos-offline.module';
import { PosSaleModule } from './modules/pos-sale/pos-sale.module';
import { PosCashModule } from './modules/pos-cash/pos-cash.module';
import { PosExceptionModule } from './modules/pos-exception/pos-exception.module';
import { PosInventoryModule } from './modules/pos-inventory/pos-inventory.module';
import { PosCustomerValueModule } from './modules/pos-customer-value/pos-customer-value.module';
import { PosHardwareModule } from './modules/pos-hardware/pos-hardware.module';
import { DashboardOperationsModule } from './modules/dashboard-operations/dashboard-operations.module';

/**
 * Root module for the WEB process. Imports shared infrastructure + domain
 * modules. It registers BullMQ queues as a PRODUCER only — processors live in
 * WorkerModule so they don't run here.
 */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    AdaptersModule,
    SharedAuthModule,
    RateLimitModule,
    LoggingModule,
    QueueModule,
    HealthModule,
    AuthModule,
    IdentityModule,
    MerchantsModule,
    StaffModule,
    BusinessHoursModule,
    VoiceModule,
    CustomersModule,
    CashModule,
    KdsModule,
    ConversationsModule,
    LeadsModule,
    IntegrityModule,
    OperationsModule,
    DevicesModule,
    PosEntryModule,
    PosCatalogModule,
    PosCartModule,
    PosCheckoutModule,
    PosOfflineModule,
    PosSaleModule,
    PosCashModule,
    PosExceptionModule,
    PosInventoryModule,
    PosCustomerValueModule,
    PosHardwareModule,
    DashboardOperationsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: IpRateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: OperationalInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Establish the per-request AsyncLocalStorage context (merchant/user/requestId)
    // for the whole request, so repositories can set RLS context. The AuthGuard
    // (Phase 2) populates merchant/user into this context after authentication.
    // NestJS 11 uses path-to-regexp v8 — the bare '*' wildcard is deprecated;
    // '{*splat}' matches all paths including the root.
    consumer.apply(RequestContextMiddleware).forRoutes('{*splat}');
  }
}
