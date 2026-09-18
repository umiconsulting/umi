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
import { MercadoPagoPointModule } from './modules/mercado-pago/mercadopago-point.module';
import { MerchantsModule } from './modules/merchants/merchants.module';
import { StaffModule } from './modules/staff/staff.module';
import { BusinessHoursModule } from './modules/business-hours/business-hours.module';
import { VoiceModule } from './modules/voice/voice.module';
import { CustomersModule } from './modules/customers/customers.module';
import { CashModule } from './modules/cash/cash.module';
import { FloorPlanModule } from './modules/floor-plan/floor-plan.module';
import { TableMapModule } from './modules/table-map/table-map.module';
import { KdsModule } from './modules/kds/kds.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { PlatformModule } from './modules/platform/platform.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { LeadsModule } from './modules/leads/leads.module';
import { IntegrityModule } from './modules/integrity/integrity.module';
import { OperationsModule } from './shared/operations/operations.module';
import { OperationalInterceptor } from './shared/operations/operational.interceptor';
import { IpRateLimitGuard } from './shared/operations/ip-rate-limit.guard';
import { DevicesModule } from './modules/devices/devices.module';
import { RealtimeEventsModule } from './modules/realtime/realtime-events.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { PosEntryModule } from './modules/pos-entry/pos-entry.module';
import { PosCatalogModule } from './modules/pos-catalog/pos-catalog.module';
import { PosCartModule } from './modules/pos-cart/pos-cart.module';
import { PosCheckoutModule } from './modules/pos-checkout/pos-checkout.module';
import { PosOfflineModule } from './modules/pos-offline/pos-offline.module';
import { PosSaleModule } from './modules/pos-sale/pos-sale.module';
import { PosCashModule } from './modules/pos-cash/pos-cash.module';
import { PosExceptionModule } from './modules/pos-exception/pos-exception.module';
import { PosInventoryModule } from './modules/pos-inventory/pos-inventory.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { InventoryCostingModule } from './modules/inventory-costing/inventory-costing.module';
import { InventoryAuthoringModule } from './modules/inventory-authoring/inventory-authoring.module';
import { TenderModule } from './modules/tender/tender.module';
import { FiscalModule } from './modules/fiscal/fiscal.module';
import { PosCustomerValueModule } from './modules/pos-customer-value/pos-customer-value.module';
import { PosHardwareModule } from './modules/pos-hardware/pos-hardware.module';
import { DashboardOperationsModule } from './modules/dashboard-operations/dashboard-operations.module';
import { DashboardCatalogModule } from './modules/dashboard-catalog/dashboard-catalog.module';
import { CsrfGuard } from './modules/auth/csrf.guard';
import { AdministrativeCommandModule } from './modules/administrative-commands/administrative-command.module';
import { ReleaseModule } from './shared/release/release.module';
import { PlatformBootstrapModule } from './modules/platform-bootstrap/platform-bootstrap.module';
import { OrdersModule } from './modules/orders/orders.module';
import { TableOrderModule } from './modules/table-order/table-order.module';

/**
 * Root module for the WEB process. Imports shared infrastructure + domain
 * modules. It registers BullMQ queues as a PRODUCER only — processors live in
 * WorkerModule so they don't run here.
 */
@Module({
  imports: [
    AppConfigModule,
    ReleaseModule,
    DatabaseModule,
    AdaptersModule,
    SharedAuthModule,
    RateLimitModule,
    LoggingModule,
    QueueModule,
    HealthModule,
    AuthModule,
    IdentityModule,
    // The Mercado Pago Point notification receiver (plan Phase 2, steps 1-2): verify the
    // panel's signature, enqueue one `tender.point.notification` job, answer 200. It never
    // writes the attempt — the worker re-reads the order and resolves it.
    MercadoPagoPointModule,
    MerchantsModule,
    StaffModule,
    BusinessHoursModule,
    VoiceModule,
    CustomersModule,
    CashModule,
    KdsModule,
    FloorPlanModule,
    TableMapModule,
    WalletModule,
    PlatformModule,
    ConversationsModule,
    LeadsModule,
    IntegrityModule,
    OperationsModule,
    DevicesModule,
    RealtimeEventsModule,
    RealtimeModule,
    PosEntryModule,
    PosCatalogModule,
    PosCartModule,
    PosCheckoutModule,
    PosOfflineModule,
    PosSaleModule,
    PosCashModule,
    PosExceptionModule,
    PosInventoryModule,
    ProcurementModule,
    InventoryCostingModule,
    // §11 phase 1 of the recipes and inventory plan: the console's AUTHORING
    // surface for items, unit conversions and allergen labels. Its three reads live
    // here; its six writes are administrative commands, which is why
    // `AdministrativeCommandModule` imports it too.
    InventoryAuthoringModule,
    // Workstream G: the tender attempt model, its three outcomes and the fiscal record.
    // Registered here rather than inside the checkout module because taking money is a
    // concern of its own — the checkout commits a sale, and this decides what its tenders
    // are and what proved them.
    TenderModule,
    // The fiscal record (§8G step 5): the CFDI state machine, the PAC behind its port, and
    // the deadline the owner reads. Imported by `PosExceptionModule` as well, because
    // voiding a committed sale cancels its document inside the same command.
    FiscalModule,
    PosCustomerValueModule,
    PosHardwareModule,
    DashboardOperationsModule,
    DashboardCatalogModule,
    AdministrativeCommandModule,
    PlatformBootstrapModule,
    OrdersModule,
    // §8I step 2, ADR 2026-09-13 §9: table-order INTAKE. A seated guest orders from a QR
    // at the table; the order goes through the one writer with the channel identity `web`
    // and lands in the till's incoming-orders list and on the kitchen board. Payment
    // stays at the counter — nothing in this module takes money.
    TableOrderModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: IpRateLimitGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
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
