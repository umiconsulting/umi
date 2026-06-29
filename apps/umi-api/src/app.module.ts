import {
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
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
import { TenantsModule } from './modules/tenants/tenants.module';
import { StaffModule } from './modules/staff/staff.module';
import { HoursModule } from './modules/hours/hours.module';
import { VoiceModule } from './modules/voice/voice.module';
import { CustomersModule } from './modules/customers/customers.module';
import { CashModule } from './modules/cash/cash.module';
import { KdsModule } from './modules/kds/kds.module';
import { ConversationsModule } from './modules/conversations/conversations.module';

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
    TenantsModule,
    StaffModule,
    HoursModule,
    VoiceModule,
    CustomersModule,
    CashModule,
    KdsModule,
    ConversationsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Establish the per-request AsyncLocalStorage context (tenant/user/requestId)
    // for the whole request, so repositories can set RLS context. The AuthGuard
    // (Phase 2) populates tenant/user into this context after authentication.
    // NestJS 11 uses path-to-regexp v8 — the bare '*' wildcard is deprecated;
    // '{*splat}' matches all paths including the root.
    consumer.apply(RequestContextMiddleware).forRoutes('{*splat}');
  }
}
