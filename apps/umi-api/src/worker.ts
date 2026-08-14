import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

/**
 * Worker process. No HTTP listener — a Nest application context that runs the
 * BullMQ processors and the repeatable-job scheduler. Same codebase as the web
 * process; only the bootstrap differs. Slow work (AI turns, embeddings,
 * outbound sends, cash crons) lives here so it can never block ingress.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
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
