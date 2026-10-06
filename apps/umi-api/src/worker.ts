import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { validateConfig } from './shared/config/config.schema';
import { JsonLogger } from './shared/logging/json.logger';
import { writeFileSync } from 'node:fs';

/**
 * Worker process. No HTTP listener — a Nest application context that runs the
 * BullMQ processors and the repeatable-job scheduler. Same codebase as the web
 * process; only the bootstrap differs. Slow work (AI turns, embeddings,
 * outbound sends, cash crons) lives here so it can never block ingress.
 */
async function bootstrap(): Promise<void> {
  const bootConfig = validateConfig(process.env);
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: new JsonLogger({
      service: 'umi-worker',
      environment: bootConfig.UMI_ENVIRONMENT,
      release: bootConfig.RELEASE_VERSION ?? 'development',
    }),
  });
  app.enableShutdownHooks();
  writeFileSync(
    '/tmp/umi-worker-ready',
    JSON.stringify({
      service: 'umi-worker',
      environment: bootConfig.UMI_ENVIRONMENT,
      release: bootConfig.RELEASE_VERSION ?? 'development',
      gitCommit: bootConfig.RELEASE_GIT_COMMIT ?? 'unavailable',
      readyAt: new Date().toISOString(),
    }),
    { mode: 0o600 },
  );
  Logger.log('umi-worker started — BullMQ processors online', 'Worker');
}

bootstrap().catch((err) => {
  Logger.error(
    'Failed to start umi-worker',
    err instanceof Error ? err.stack : String(err),
    'Worker',
  );
  process.exit(1);
});
