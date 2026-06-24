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
import { QueueModule } from './jobs/queue.module';
import { HealthModule } from './modules/health/health.module';

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
    LoggingModule,
    QueueModule,
    HealthModule,
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
