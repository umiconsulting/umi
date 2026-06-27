import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import fastifyCookie from '@fastify/cookie';
import { AppModule } from './app.module';
import type { AppConfig } from './shared/config/config.schema';

/**
 * Web process. Handles all HTTP ingress (health now; Twilio webhook, KDS,
 * dashboard admin API, landing leads in later phases). Produces BullMQ jobs;
 * never runs the heavy work itself — that is the worker (src/worker.ts).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
  );

  // Cookie parsing/signing for the JWT auth cookies (D9). Reads `req.cookies`
  // and enables `reply.setCookie`/`clearCookie` used by AuthController.
  await app.register(fastifyCookie);

  // Twilio webhook (§8.2) posts application/x-www-form-urlencoded and signs the
  // RAW body — keep it as a raw string so the HMAC-SHA1 validation sees the exact
  // bytes. (The only form-urlencoded route is the WhatsApp webhook; everything
  // else is JSON.)
  app
    .getHttpAdapter()
    .getInstance()
    .addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_req: unknown, body: string, done: (err: Error | null, body?: unknown) => void) =>
        done(null, body),
    );

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  app.enableShutdownHooks();

  // Read validated/coerced config, not raw process.env.
  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);

  const corsOrigins = config
    .get('CORS_ORIGINS', { infer: true })
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (corsOrigins?.length) {
    app.enableCors({ origin: corsOrigins, credentials: true });
  }

  const port = config.get('PORT', { infer: true });
  await app.listen({ port, host: '0.0.0.0' });
  Logger.log(`umi-api (web) listening on :${port}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  Logger.error(
    'Failed to start umi-api (web)',
    err instanceof Error ? err.stack : String(err),
    'Bootstrap',
  );
  process.exit(1);
});
